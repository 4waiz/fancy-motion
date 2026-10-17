#!/usr/bin/env node
// fm.mjs — the /fancy-motion command line. Author: Awaiz Ahmed.
//
//   init <dir> [--title T] [--creator C] [--duration S] [--format landscape|vertical|square]
//   build <dir>                      manifest.src.mjs → manifest.json → validate → index.html
//   validate <dir|manifest.json>
//   render <dir> [--draft] [--out f.mp4] [--fps 60] [--composition f.html --manifest m.json]
//                                    HyperFrames render + AAC mux + metadata (a variant: its composition and manifest)
//   mux <f.mp4> <dir> [--manifest m.json] [--out f.mp4]   re-mux a re-scored soundtrack into a render (no re-render)
//   verify <f.mp4> [--frames N] [--fps 60] [--width W --height H] [--lufs -14] [--json out]
//   inspect <media>                  streams, duration, scene changes
//   sheet <media> [--every 2 | --times a,b] [--cols 6] [--out sheet.jpg]
//   review <f.mp4> --manifest <dir> [--out dir]   sheets (full, boundaries, holds), motion audit, transcript WER
//   status <dir>                     checkpoints: what exists, what to do next
//   brag                             where /brag is and what is reused from it
//   install [--to dir] [--dry-run]   personal install to ~/.claude/skills/fancy-motion (never overwrites)
//   example <name> [--out dir]       copy, build, render and verify a bundled example
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateManifest } from "./lib/manifest.mjs";
import { writeIndexHtml } from "./lib/compose.mjs";
import { probe, countFrames, loudness, blackIntervals, sceneChanges, contactSheet, motionAudit } from "./lib/media.mjs";
import { findBrag } from "./lib/brag.mjs";
import { buildCaptions, toSrt } from "./lib/captions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(here, "..");
const SKILL = JSON.parse(readFileSync(join(skillDir, "skill.json"), "utf8"));
const [, , cmd, ...rest] = process.argv;
const VALUE_FLAGS = new Set(["--to", "--manifest", "--model", "--title", "--creator", "--duration", "--format", "--out", "--fps", "--frames", "--width", "--height", "--lufs", "--json", "--every", "--times", "--cols", "--tp", "--scene", "--composition", "--video-frame-format", "--workers"]);
const pos = rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(rest[i - 1]));
const opt = (n, d) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : d;
};
const flag = (n) => rest.includes(`--${n}`);
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => console.log(`  FAIL ${m}`);
const HF_VERSION = SKILL.renderer.split("@")[1];
/** Prefer the pinned local HyperFrames (project, cwd, or the repo that ships this skill) over npx. */
function hyperframesBin(dir) {
  for (const start of [dir, process.cwd(), skillDir]) {
    let d = resolve(start);
    for (let i = 0; i < 8; i++) {
      const p = join(d, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
      if (existsSync(p)) {
        const ver = JSON.parse(readFileSync(join(d, "node_modules", "hyperframes", "package.json"), "utf8")).version;
        if (ver === HF_VERSION) return p;
      }
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return null;
}
function hyperframes(args, cwd) {
  const bin = hyperframesBin(cwd);
  if (bin) return spawnSync(process.execPath, [bin, ...args], { cwd, stdio: "inherit" });
  return npx(["--yes", `hyperframes@${HF_VERSION}`, ...args], cwd);
}
const isWin = process.platform === "win32";

/** Video stream of `video` + `track` → AAC 320k / 48 kHz with the manifest's credits as metadata;
 *  trims the audio if AAC pushed the true peak over --tp (default −1 dBTP). */
function muxFilm(video, track, M, outFile) {
  // credits come from the manifest: creator, optional studio and url (a builtWith line only if the film sets one)
  const credit = [M.studio, M.url, M.builtWith ? `Built with ${M.builtWith}` : null].filter(Boolean).join(" · ") || "Made with /fancy-motion";
  const meta = ["-metadata", `title=${M.title}`, "-metadata", `artist=${M.creator}`, "-metadata", `album_artist=${M.studio || M.creator}`, "-metadata", `composer=${M.creator}`, "-metadata", `comment=${credit}`, "-metadata", `copyright=© ${new Date().getFullYear()} ${M.creator}${M.studio ? ` · ${M.studio}` : ""}`];
  if (!existsSync(track)) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-map", "0", "-c", "copy", ...meta, "-movflags", "+faststart", outFile]);
    return;
  }
  const mux = (gainDb = 0) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", track, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", ...(gainDb ? ["-af", `volume=${gainDb.toFixed(2)}dB`] : []), "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2", "-t", String(M.duration), ...meta, "-movflags", "+faststart", outFile]);
  mux();
  // AAC can overshoot the master's true peak on transients: measure the delivered file and,
  // if it is over the ceiling, trim the audio just enough (loudness stays inside ±1 LU)
  const ceiling = +opt("tp", "-1");
  const L = loudness(outFile);
  if (L.truePeakDbtp != null && L.truePeakDbtp > ceiling) {
    const trim = ceiling - 0.2 - L.truePeakDbtp;
    mux(trim);
    const L2 = loudness(outFile);
    console.log(`  true peak after AAC ${L.truePeakDbtp} dBTP > ${ceiling} → audio trimmed ${trim.toFixed(2)} dB → ${L2.truePeakDbtp} dBTP, ${L2.integratedLufs} LUFS`);
  }
}

function loadManifest(p) {
  const file = p.endsWith(".json") ? p : join(p, "manifest.json");
  return { M: JSON.parse(readFileSync(file, "utf8")), dir: dirname(resolve(file)) };
}

function npx(args, cwd, quiet = false) {
  // Windows needs a shell for npx.cmd; quote any argument with spaces so paths survive.
  const a = isWin ? args.map((x) => (/[s&()^|<>]/.test(x) ? `"${x}"` : x)) : args;
  return spawnSync(isWin ? "npx.cmd" : "npx", a, { cwd, encoding: "utf8", shell: isWin, maxBuffer: 1 << 28, stdio: quiet ? "pipe" : "inherit" });
}

const commands = {
  async init() {
    const dir = resolve(pos[0] || "motion");
    const fmt = opt("format", "landscape");
    const [w, h] = fmt === "vertical" ? [1080, 1920] : fmt === "square" ? [1080, 1080] : [1920, 1080];
    if (existsSync(join(dir, "manifest.src.mjs"))) throw new Error(`${dir} already has a manifest; refusing to overwrite`);
    cpSync(join(skillDir, "assets", "templates", "starter", "project"), dir, { recursive: true });
    const pj = join(dir, "package.json");
    writeFileSync(pj, readFileSync(pj, "utf8").replace(/__SKILL__/g, skillDir.split("\\").join("/")));
    const src = join(dir, "manifest.src.mjs");
    let s = readFileSync(src, "utf8");
    s = s.replace(/__TITLE__/g, opt("title", "Untitled film")).replace(/__CREATOR__/g, opt("creator", "Awaiz Ahmed")).replace(/__DURATION__/g, opt("duration", "30")).replace(/__WIDTH__/g, String(w)).replace(/__HEIGHT__/g, String(h));
    writeFileSync(src, s);
    execFileSync(process.execPath, [join(here, "vendor.mjs"), dir], { stdio: "inherit" });
    console.log(`initialised ${dir}\nnext: write brief.md, then  node ${join(here, "fm.mjs")} build ${dir}`);
  },

  async build() {
    const dir = resolve(pos[0] || ".");
    if (existsSync(join(dir, "manifest.src.mjs"))) execFileSync(process.execPath, [join(dir, "manifest.src.mjs")], { stdio: "inherit", cwd: dir });
    const { M } = loadManifest(dir);
    // captions from narration + word timings, unless the manifest already carries them
    const wordsFile = join(dir, "audio", "vo-words.json");
    if ((!M.captions || !M.captions.length) && M.vo?.length && existsSync(wordsFile)) {
      M.captions = buildCaptions(M.vo, JSON.parse(readFileSync(wordsFile, "utf8")), { maxChars: M.width < M.height ? 30 : 52, tail: 0.36 });
      writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(M, null, 2)}\n`);
      writeFileSync(join(dir, "captions.srt"), toSrt(M.captions));
      console.log(`captions: ${M.captions.length} cues → captions.srt`);
    }
    const v = validateManifest(M, { projectDir: dir });
    report(v);
    if (v.errors.length) process.exit(1);
    const custom = join(dir, "build.mjs");
    if (existsSync(custom)) execFileSync(process.execPath, [custom], { stdio: "inherit", cwd: dir });
    else {
      const r = writeIndexHtml(dir, M, { compositionId: M.compositionId || "fm-film" });
      console.log(`index.html: ${r.media} media clip(s)${r.soundtrack ? " + soundtrack" : ""}`);
      for (const m of r.missing) console.log(`  missing ${m.optional ? "(optional)" : "(REQUIRED)"} ${m.id}: ${m.src}`);
    }
  },

  async validate() {
    const { M, dir } = loadManifest(resolve(pos[0] || "."));
    const v = validateManifest(M, { projectDir: dir });
    report(v);
    process.exit(v.errors.length ? 1 : 0);
  },

  async render() {
    // a variant: --composition portrait.html --manifest manifest-portrait.json (its soundtrack comes from the manifest)
    const dir = resolve(pos[0] || ".");
    const mf = opt("manifest", null);
    const { M } = loadManifest(mf ? resolve(dir, mf) : dir);
    const comp = opt("composition", null);
    const fps = opt("fps", String(M.fps || 60));
    const draft = flag("draft");
    const outFile = resolve(opt("out", join(dir, "renders", `${slug(M.title)}${draft ? "-draft" : ""}.mp4`)));
    mkdirSync(dirname(outFile), { recursive: true });
    const raw = outFile.replace(/\.mp4$/, ".video.mp4");
    const t0 = Date.now();
    // screenshot capture always: drawElement "fast capture" cannot reproduce a WebGL canvas, and when
    // it engaged anyway on this machine it stalled and then restarted the whole capture
    // png frame extraction for the source videos: app recordings are UI (thin text, flat colour)
    const r = hyperframes(["render", ...(comp ? ["-c", comp] : []), "--fps", fps, "--quality", draft ? "draft" : "delivery", "--video-frame-format", opt("video-frame-format", "png"), ...(opt("workers") ? ["--workers", opt("workers")] : []), "--experimental-fast-capture=false", "--output", raw], dir);
    if (r.status !== 0) throw new Error("hyperframes render failed");
    const track = join(dir, M.soundtrack || "assets/audio/soundtrack.wav");
    muxFilm(raw, track, M, outFile);
    rmSync(raw, { force: true }); // the delivered file carries the same video stream (fm mux re-uses it)
    const frames = countFrames(outFile);
    console.log(`rendered ${outFile}\n  ${frames}/${M.frames} frames · ${fps} fps · ${((Date.now() - t0) / 1000).toFixed(0)} s${existsSync(track) ? " · soundtrack muxed (AAC 48 kHz)" : " · no soundtrack yet"}`);
  },

  async mux() {
    // the picture of an existing render + the manifest's (re-scored) soundtrack, same metadata and
    // true-peak guard as render: a mix change costs seconds, not a re-render
    const src = resolve(pos[0]);
    const dir = resolve(pos[1] || ".");
    const mf = opt("manifest", null);
    const { M } = loadManifest(mf ? resolve(dir, mf) : dir);
    const track = join(dir, M.soundtrack || "assets/audio/soundtrack.wav");
    if (!existsSync(track)) throw new Error(`no soundtrack at ${track}`);
    const outFile = resolve(opt("out", src));
    const tmp = outFile.replace(/.mp4$/, ".mux-tmp.mp4");
    muxFilm(src, track, M, tmp);
    renameSync(tmp, outFile);
    const L = loudness(outFile);
    console.log(`muxed ${basename(track)} → ${outFile}
  ${countFrames(outFile)}/${M.frames} frames · ${L.integratedLufs} LUFS · ${L.truePeakDbtp} dBTP`);
  },

  async verify() {
    const file = resolve(pos[0]);
    const P = probe(file);
    const v = P.streams.find((s) => s.codec_type === "video");
    const a = P.streams.find((s) => s.codec_type === "audio");
    const fps = +opt("fps", 60);
    const want = opt("frames") ? +opt("frames") : null;
    const res = { file: basename(file), checks: [] };
    const check = (name, pass, detail) => {
      res.checks.push({ name, pass, detail });
      (pass ? ok : bad)(`${name}: ${detail}`);
    };
    const frames = countFrames(file);
    if (want != null) check("frame count", frames === want, `${frames} decoded (expected ${want})`);
    check("video codec", v.codec_name === "h264" && v.pix_fmt === "yuv420p", `${v.codec_name} ${v.pix_fmt} ${v.profile || ""}`);
    check("frame rate", v.r_frame_rate === `${fps}/1` && v.avg_frame_rate === `${fps}/1`, `r ${v.r_frame_rate} · avg ${v.avg_frame_rate}`);
    if (opt("width")) check("size", v.width === +opt("width") && v.height === +opt("height"), `${v.width}×${v.height}`);
    if (want != null) check("video duration", Math.abs(frames / fps - want / fps) < 1e-9, `${(frames / fps).toFixed(3)} s of picture (container ${(+P.format.duration).toFixed(3)} s)`);
    if (a) {
      check("audio", a.codec_name === "aac" && +a.sample_rate === 48000 && a.channels === 2, `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`);
      const L = loudness(file);
      const target = +opt("lufs", -14);
      check("loudness", L.integratedLufs != null && Math.abs(L.integratedLufs - target) <= 1.0, `${L.integratedLufs} LUFS integrated (target ${target} ±1)`);
      check("true peak", L.truePeakDbtp != null && L.truePeakDbtp <= -0.9, `${L.truePeakDbtp} dBTP (ceiling −1)`);
      res.loudness = L;
    } else check("audio", false, "no audio stream");
    const blacks = blackIntervals(file, { minDur: 0.12 });
    check("black frames", blacks.length === 0, blacks.length ? blacks.map((b) => `${b.start}–${b.end}`).join(", ") : "none ≥ 0.12 s");
    const tags = P.format.tags || {};
    check("metadata", !!(tags.title && tags.artist), `title "${tags.title || "—"}" · artist "${tags.artist || "—"}"`);
    res.pass = res.checks.every((c) => c.pass);
    if (opt("json")) writeFileSync(opt("json"), JSON.stringify(res, null, 2));
    console.log(res.pass ? "verify: PASS" : "verify: FAIL");
    process.exit(res.pass ? 0 : 1);
  },

  /** Review package for a render: full sheet, every scene boundary, hero holds, transcript vs script. */
  async review() {
    const file = resolve(pos[0]);
    const { M } = loadManifest(resolve(opt("manifest", ".")));
    const out = resolve(opt("out", file.replace(/\.mp4$/, "-review")));
    mkdirSync(out, { recursive: true });
    const f = 1 / M.fps;
    contactSheet(file, join(out, "sheet-full.jpg"), { every: +opt("every", 2), cols: 6, width: 400 });
    // a cut (edit list): scene beats are film time — map them to output time; every join is a boundary
    const toOut = (t) => {
      if (!M.edl) return t;
      const e = M.edl.find((x) => t >= x.from && t < x.to);
      return e ? +(e.at + t - e.from).toFixed(4) : null;
    };
    const bounds = [...new Set([...(M.edl || []).slice(1).map((e) => e.at), ...M.scenes.slice(1).map((s) => toOut(s.start)).filter((x) => x != null && x > 0)])].sort((a, b) => a - b);
    const bt = bounds.flatMap((b) => [+(b - f).toFixed(4), b]);
    contactSheet(file, join(out, "boundaries.jpg"), { times: bt, cols: 6, width: 400 });
    const heroes = (M.scenes || []).flatMap((s) => Object.entries(s.beats || {}).filter(([k, v]) => /hero|title|heroA|heroB/.test(k) && Array.isArray(v)).map(([, v]) => toOut((v[0] + v[1]) / 2))).filter((x) => x != null).map((x) => +x.toFixed(3));
    if (heroes.length) contactSheet(file, join(out, "holds.jpg"), { times: heroes, cols: 4, width: 480 });
    const lines = [`# Review package: ${basename(file)}`, "", `- sheet-full.jpg — every ${opt("every", 2)} s`, `- boundaries.jpg — last frame before / first frame after each of ${bounds.length} ${M.edl ? "joins and scene boundaries" : "scene boundaries"}`, `- holds.jpg — mid-hold frame of ${heroes.length} hero lines`];
    // transcript of the final mix vs the narration script (what a listener hears)
    const wav = join(out, "mix.wav");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "16000", wav]);
    const py = spawnSync("uv", ["run", "--project", here, "--group", "qa", "python", join(here, "audio_qa.py"), "transcribe", wav, "--model", opt("model", "small.en"), "--json", join(out, "transcript.json")], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_OFFLINE: "1" } });
    if (py.status === 0) {
      const tr = JSON.parse(readFileSync(join(out, "transcript.json"), "utf8"))[wav];
      const script = (M.vo || []).map((v) => v.text).join(" ");
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
      const a = norm(script), b = norm(tr.text);
      const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
      for (let j = 1; j <= b.length; j++) d[0][j] = j;
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
      const wer = d[a.length][b.length] / Math.max(1, a.length);
      lines.push(`- transcript.json — final mix heard by Whisper ${opt("model", "small.en")}: WER ${(wer * 100).toFixed(1)}% over ${a.length} script words`);
      console.log(`transcript WER vs script: ${(wer * 100).toFixed(1)}% (${a.length} words)`);
    } else lines.push("- transcript: not run (install the qa group: uv sync --group qa)");
    // flicker (one-frame luma flashes, cuts excluded) and long frozen runs, for a human decision
    const ma = motionAudit(file, { fps: M.fps, ignore: bounds });
    writeFileSync(join(out, "motion.json"), `${JSON.stringify(ma, null, 2)}\n`);
    const still = ma.still.map((x) => `${x.start}–${x.end}`).join(", ");
    lines.push(`- motion.json — ${ma.frames} frames audited: ${ma.flashes.length} one-frame flash(es)${ma.flashes.length ? ` at ${ma.flashes.map((x) => x.t).join(", ")} s` : ""}; ${ma.still.length} run(s) ≥ 1.5 s with no change${still ? ` (${still} s — confirm each is an intended hold)` : ""}`);
    console.log(`motion audit: ${ma.flashes.length} flash(es), ${ma.still.length} unchanged run(s) ≥ 1.5 s`);
    writeFileSync(join(out, "README.md"), lines.join("\n") + "\n");
    console.log(`review package → ${out}`);
  },

  async inspect() {
    const file = resolve(pos[0]);
    const P = probe(file);
    const v = P.streams.find((s) => s.codec_type === "video");
    const a = P.streams.find((s) => s.codec_type === "audio");
    console.log(JSON.stringify({ duration: +P.format.duration, video: v && { codec: v.codec_name, w: v.width, h: v.height, fps: v.r_frame_rate, pix: v.pix_fmt }, audio: a && { codec: a.codec_name, rate: a.sample_rate, ch: a.channels }, sceneChanges: sceneChanges(file, +opt("scene", 0.3)) }, null, 2));
  },

  async sheet() {
    const file = resolve(pos[0]);
    const out = resolve(opt("out", file.replace(/\.[^.]+$/, ".sheet.jpg")));
    const times = opt("times") ? opt("times").split(",").map(Number) : null;
    const r = contactSheet(file, out, { every: +opt("every", 2), times, cols: +opt("cols", 6) });
    console.log(`sheet ${r.out} (${r.frames} frames, ${r.cols}×${r.rows})`);
  },

  async status() {
    const dir = resolve(pos[0] || ".");
    const has = (p) => existsSync(join(dir, p));
    const any = (p, re) => has(p) && readdirSync(join(dir, p)).some((f) => re.test(f));
    const steps = [
      ["1 brief", has("brief.md") && !readFileSync(join(dir, "brief.md"), "utf8").includes("(title)")],
      ["2 reference", any(".", /^reference.*\.md$/i) || any("docs", /reference/i)],
      ["3 script + voice", has("audio/vo-lines.json") && any("audio/vo", /\.wav$/) && has("audio/vo-words.json")],
      ["4 storyboard (manifest)", has("manifest.json") && validateManifest(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")), { projectDir: dir }).errors.length === 0],
      ["5 assets", has("assets")],
      ["6 rough render", any("renders", /(v1|rough|draft).*\.mp4$/i)],
      ["7 review notes", any("review", /\.md$/i)],
      ["8 refined render", any("renders", /(v2|final).*\.mp4$/i)],
      ["9 verification", any("renders", /verify.*\.json$/i)],
      ["10 delivery", any("deliverables", /\.mp4$/i) || any("..", /^deliverables$/)],
    ];
    let next = null;
    for (const [name, done] of steps) {
      (done ? ok : bad)(name);
      if (!done && !next) next = name;
    }
    console.log(next ? `resume at: ${next}` : "all checkpoints present");
  },

  /** Personal install: copy this skill to ~/.claude/skills/fancy-motion (no venv/caches; never overwrites). */
  async install() {
    const target = resolve(opt("to", join(homedir(), ".claude", "skills", "fancy-motion")));
    const skip = /[\\/](\.venv|__pycache__|node_modules|\.hyperframes)([\\/]|$)/;
    if (existsSync(target)) {
      const other = existsSync(join(target, "SKILL.md")) ? readFileSync(join(target, "SKILL.md"), "utf8").match(/version:\s*"?([\d.]+)/)?.[1] : null;
      console.log(`${target} already exists${other ? ` (version ${other})` : ""} — not overwriting. Rename or remove it first, or pass --to <dir>.`);
      process.exit(2);
    }
    if (flag("dry-run")) {
      console.log(`would copy ${skillDir} → ${target} (excluding .venv, __pycache__, node_modules)`);
      return;
    }
    cpSync(skillDir, target, { recursive: true, filter: (p) => !skip.test(p.slice(skillDir.length)) });
    console.log(`installed /fancy-motion ${SKILL.version} → ${target}\nnext: uv sync --project "${join(target, "scripts")}" --group qa   (voice, score and QA tools)`);
  },

  async brag() {
    const b = findBrag(process.cwd());
    if (!b) {
      console.log("/brag not found — /fancy-motion still works: SFX are synthesized and music comes from the score engine.");
      return;
    }
    console.log(JSON.stringify({ dir: b.dir, sfxFamilies: Object.keys(b.sfx), keyboard: b.sfx.keyboard || null, music: b.music.map((m) => basename(m)), cuePresets: b.cues, analyzer: b.analyzer }, null, 2));
  },

  async example() {
    const name = pos[0] || "mini-showcase";
    const src = join(skillDir, "examples", basename(name));
    if (!existsSync(src)) throw new Error(`no example "${name}" in ${join(skillDir, "examples")}`);
    const out = resolve(opt("out", join(process.cwd(), "motion-examples", basename(name))));
    cpSync(src, out, { recursive: true, filter: (p) => !/[\\/](renders|node_modules|\.hyperframes)([\\/]|$)/.test(p) });
    console.log(`example → ${out}`);
    execFileSync(process.execPath, [join(here, "vendor.mjs"), out], { stdio: "inherit" });
    pos[0] = out;
    const oi = rest.indexOf("--out");
    if (oi >= 0) rest.splice(oi, 2); // --out named the example folder; render picks its own file
    await commands.build();
    rest.push("--draft");
    await commands.render();
    const { M } = loadManifest(out);
    const file = join(out, "renders", `${slug(M.title)}-draft.mp4`);
    const r = spawnSync(process.execPath, [join(here, "fm.mjs"), "verify", file, "--frames", String(M.frames), "--fps", String(M.fps)], { stdio: "inherit" });
    process.exit(r.status);
  },
};

function slug(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "film";
}
function report(v) {
  if (v.summary) {
    const s = v.summary;
    const extra = s.narration ? ` · ${s.narration} narration clips · ${s.captionsOnScreen}/${s.captions} captions on screen · ${s.tailHold} s hold after the last word` : "";
    const head = v.errors.length ? `manifest FAIL (${v.errors.length} error${v.errors.length > 1 ? "s" : ""})` : "manifest ok";
    console.log(`${head} · ${s.scenes} scenes · ${s.frames} frames @ ${s.fps} fps · ${s.seconds} s${extra}`);
  }
  for (const e of v.errors) bad(e);
  for (const w of v.warnings) console.log(`  ! ${w}`);
}

if (!commands[cmd]) {
  const head = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(head.slice(0, head.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch((e) => {
  console.error(`fm ${cmd}: ${e.message}`);
  process.exit(1);
});
