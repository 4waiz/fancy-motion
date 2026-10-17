// media.mjs — ffprobe/ffmpeg helpers: probe, exact frame count, loudness, black frames, scene
// changes, timestamped contact sheets. Part of the /fancy-motion skill (author: Awaiz Ahmed).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });

export function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]);
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** Decode every video frame and count them (the only trustworthy frame count). */
export function countFrames(file) {
  const r = run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]);
  return parseInt(r.stdout.trim(), 10);
}

export function loudness(file) {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const tail = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  const g = (re) => (re.exec(tail) ? parseFloat(re.exec(tail)[1]) : null);
  return { integratedLufs: g(/I:\s+(-?[\d.]+) LUFS/), lraLu: g(/LRA:\s+(-?[\d.]+) LU/), truePeakDbtp: g(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/** Intervals where the picture is (near) black for ≥ minDur seconds. */
export function blackIntervals(file, { minDur = 0.1, pixTh = 0.06, picTh = 0.98 } = {}) {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:v:0", "-vf", `blackdetect=d=${minDur}:pix_th=${pixTh}:pic_th=${picTh}`, "-an", "-f", "null", "-"]);
  return [...r.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2], duration: +m[3] }));
}

/** Times where the picture changes a lot (cuts/flashes). */
export function sceneChanges(file, threshold = 0.3) {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:v:0", "-vf", `select='gt(scene,${threshold})',showinfo`, "-an", "-f", "null", "-"]);
  return [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => +(+m[1]).toFixed(3));
}

export function monoFont() {
  const c = process.platform === "win32" ? ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf"] : process.platform === "darwin" ? ["/System/Library/Fonts/Menlo.ttc", "/Library/Fonts/Courier New.ttf"] : ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/dejavu/DejaVuSansMono.ttf"];
  return c.find((p) => existsSync(p)) || null;
}

/**
 * Contact sheet: one frame every `every` seconds (or at `times`), timestamped, tiled.
 */
export function contactSheet(file, out, { every = 2, times = null, cols = 6, width = 480 } = {}) {
  const font = monoFont();
  const stamp = font ? `,drawtext=fontfile='${font.replace(/:/g, "\\:")}':text='%{pts\\:hms}':x=8:y=8:fontsize=${Math.round(width / 16)}:fontcolor=white:box=1:boxcolor=black@0.6` : "";
  // "every N s" is exact times too: ffmpeg's fps filter keeps the last frame of each N-second
  // bucket, so its tiles showed t + N/2 under a "t" label
  if (!times) times = Array.from({ length: Math.ceil(probeDuration(file) / every - 1e-9) }, (_, i) => +(i * every).toFixed(3));
  // requested times snap to the file's frame grid (a time between frames would match nothing)
  const v = probe(file).streams.find((s) => s.codec_type === "video");
  const [num, den] = String(v?.r_frame_rate || "60/1").split("/").map(Number);
  const fps = num / (den || 1);
  const snapped = [...new Set(times.map((t) => Math.round(t * fps)))].sort((a, b) => a - b);
  const sel = `select='${snapped.map((n) => `eq(n,${n})`).join("+")}'`;
  const n = snapped.length;
  const rows = Math.max(1, Math.ceil(n / cols));
  const vf = `${sel},scale=${width}:-2${stamp},tile=${cols}x${rows}:padding=4:color=0x101114`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", vf, "-frames:v", "1", "-vsync", "vfr", out]);
  return { out, frames: n, cols, rows };
}

export function probeDuration(file) {
  const r = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(r.stdout);
}

/**
 * Per-frame motion audit (a 480-px decode with ffmpeg signalstats): mean luma and the mean
 * absolute change from the previous frame. Finds one-frame flashes (luma jumps and returns —
 * flicker) and long runs with no change at all (possible frozen motion; holds are often
 * intended, so these are listed for a human decision, not failed).
 */
export function motionAudit(file, { fps = 60, flashLuma = 6, staticDiff = 0.02, staticMin = 1.5, ignore = [] } = {}) {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-v", "info", "-i", file, "-map", "0:v:0", "-an", "-vf", "scale=480:-2,signalstats,metadata=print", "-f", "null", "-"]);
  const y = [], d = [];
  let f = -1;
  for (const line of r.stderr.split(/\r?\n/)) {
    const fm = /frame:(\d+)\s+pts:/.exec(line);
    if (fm) { f = +fm[1]; continue; }
    const m = /lavfi\.signalstats\.(YAVG|YDIF)=([\d.]+)/.exec(line);
    if (m && f >= 0) (m[1] === "YAVG" ? y : d)[f] = +m[2];
  }
  const near = (t) => ignore.some((b) => Math.abs(t - b) < 1.5 / fps);
  const flashes = [];
  for (let i = 1; i < y.length - 1; i++) {
    const up = y[i] - y[i - 1], back = y[i + 1] - y[i];
    if (Math.abs(up) > flashLuma && Math.abs(back) > flashLuma && Math.sign(up) !== Math.sign(back) && Math.abs(y[i + 1] - y[i - 1]) < flashLuma / 2) {
      const t = +(i / fps).toFixed(3);
      if (!near(t)) flashes.push({ frame: i, t, luma: [y[i - 1], y[i], y[i + 1]].map((v) => +v.toFixed(1)) });
    }
  }
  const still = [];
  let s0 = null;
  for (let i = 1; i <= d.length; i++) {
    const quiet = i < d.length && d[i] < staticDiff;
    if (quiet && s0 === null) s0 = i;
    if (!quiet && s0 !== null) {
      if ((i - s0) / fps >= staticMin) still.push({ start: +(s0 / fps).toFixed(2), end: +(i / fps).toFixed(2), seconds: +((i - s0) / fps).toFixed(2) });
      s0 = null;
    }
  }
  return { frames: y.length, flashes, still };
}
