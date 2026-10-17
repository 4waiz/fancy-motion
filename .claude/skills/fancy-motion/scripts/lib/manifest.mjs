// manifest.mjs — validate a /fancy-motion scene manifest. Returns {errors, warnings, summary}.
// Checks: frame math, contiguous scene coverage (no unintended gaps/overlaps), narration inside
// its scene and non-overlapping, caption readability (≤ 2 lines, min duration, no overlap),
// media windows inside the film and covered by the source clip, sound cues in range, required fields.
// Part of the /fancy-motion skill (author: Awaiz Ahmed).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { probeDuration } from "./media.mjs";

export function validateManifest(M, { projectDir = null, maxCharsPerLine = 52 } = {}) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), Wn = (m) => warnings.push(m);
  for (const k of ["title", "creator", "fps", "width", "height", "duration", "frames", "scenes"]) if (M[k] == null) E(`missing field: ${k}`);
  if (errors.length) return { errors, warnings, summary: null };
  const fps = M.fps;
  if (Math.round(M.duration * fps) !== M.frames) E(`frames ${M.frames} ≠ duration ${M.duration} × fps ${fps}`);
  // a cut: an edit list maps output time → film time. Scenes, beats and narration placement are
  // checked in film time; the list itself must be contiguous and add up to the duration.
  const edl = M.edl || null;
  const filmFrames = edl ? Math.round(Math.max(...M.scenes.map((x) => x.end)) * fps) : M.frames;
  if (edl) {
    let t = 0;
    edl.forEach((e, i) => {
      if (Math.abs(e.at - t) > 1e-6) E(`edl[${i}] starts at ${e.at} s, expected ${+t.toFixed(3)} s (segments must be contiguous)`);
      if (!(e.to > e.from)) E(`edl[${i}]: empty segment`);
      if (e.from < 0 || e.to > filmFrames / fps + 1e-6) E(`edl[${i}] (${e.from}–${e.to} s) lies outside the film`);
      t = e.at + (e.to - e.from);
    });
    if (Math.abs(t - M.duration) > 1e-6) E(`edl covers ${+t.toFixed(3)} s, duration is ${M.duration} s`);
  }
  const toFilm = (t) => {
    if (!edl) return t;
    const e = [...edl].reverse().find((x) => t >= x.at - 1e-9);
    return e ? e.from + (t - e.at) : t;
  };
  // scenes: contiguous, exact frames
  const S = [...M.scenes].sort((a, b) => a.start - b.start);
  if (S[0].startFrame !== 0) E(`first scene starts at frame ${S[0].startFrame}, not 0`);
  S.forEach((s, i) => {
    if (s.startFrame !== Math.round(s.start * fps) || s.endFrame !== Math.round(s.end * fps)) E(`${s.id}: frame numbers disagree with seconds`);
    if (s.endFrame <= s.startFrame) E(`${s.id}: empty or negative`);
    const next = S[i + 1];
    if (next) {
      if (next.startFrame > s.endFrame) {
        const gap = next.startFrame - s.endFrame;
        if (!(s.allowGapAfter >= gap)) E(`gap of ${gap} frames between ${s.id} and ${next.id}`);
      }
      if (next.startFrame < s.endFrame) E(`${s.id} overlaps ${next.id} by ${s.endFrame - next.startFrame} frames (put overlaps inside a scene as a transition, not across windows)`);
    }
    for (const [k, v] of Object.entries(s.beats || {})) {
      const vals = Array.isArray(v) ? v.flat() : [v];
      for (const x of vals) if (typeof x === "number" && (x < s.start - 0.5 || x > s.end + 0.5)) Wn(`${s.id}.beats.${k}=${x} lies outside its scene ${s.start}–${s.end}`);
    }
  });
  const last = S[S.length - 1];
  if (last.endFrame !== filmFrames) E(`last scene ends at frame ${last.endFrame}, film has ${filmFrames}`);
  // narration
  const vo = [...(M.vo || [])].sort((a, b) => a.at - b.at);
  vo.forEach((v, i) => {
    const sc = M.scenes.find((s) => s.id === v.scene);
    if (!sc) E(`vo ${v.id}: unknown scene ${v.scene}`);
    else {
      const fa = v.filmAt ?? toFilm(v.at), fe = fa + (v.end - v.at); // film time (same as v.at without an edit list)
      if (fa < sc.start - 1e-6 || fe > sc.end + 1e-6) Wn(`vo ${v.id} (${fa.toFixed(2)}–${fe.toFixed(2)}) leaves scene ${sc.id} (${sc.start}–${sc.end})`);
    }
    if (vo[i + 1] && vo[i + 1].at < v.end - 1e-3) E(`vo ${v.id} overlaps ${vo[i + 1].id}`);
    if (v.end > M.duration) E(`vo ${v.id} runs past the end`);
    if (projectDir && v.file && !existsSync(join(projectDir, v.file))) E(`vo ${v.id}: missing ${v.file}`);
  });
  // captions
  const C = M.captions || [];
  C.forEach((c, i) => {
    const lines = c.lines || [c.text];
    if (lines.length > 2) E(`caption ${i + 1} has ${lines.length} lines`);
    for (const l of lines) if (l.length > maxCharsPerLine) Wn(`caption ${i + 1} line over ${maxCharsPerLine} chars: "${l}"`);
    const words = c.text.split(/\s+/).length;
    const need = Math.max(0.8, Math.min(1.2, words * 0.3));
    if (c.end - c.start < need - 1e-6) Wn(`caption ${i + 1} "${c.text}" shows ${(c.end - c.start).toFixed(2)} s (< ${need.toFixed(2)} s reading floor)`);
    if (C[i + 1] && C[i + 1].start < c.end - 1e-6) E(`caption ${i + 1} overlaps caption ${i + 2}`);
  });
  // media
  for (const m of M.media || []) {
    if (m.start < 0 || m.start + m.duration > M.duration + 1e-6) E(`media ${m.id} window ${m.start}–${m.start + m.duration} is outside the film`);
    const file = projectDir && join(projectDir, m.src);
    if (file && !m.optional && !existsSync(file)) E(`media ${m.id}: missing ${m.src}`);
    if (file && existsSync(file) && /.(mp4|webm|mov)$/i.test(m.src)) {
      // the clip must cover its window, or the last frames freeze/blank (one frame of slack)
      const need = (m.mediaStart || 0) + m.duration, have = probeDuration(file);
      if (Number.isFinite(have) && need > have + 1 / (M.fps || 60) + 1e-6) E(`media ${m.id}: needs ${need.toFixed(2)} s of ${m.src} but it is ${have.toFixed(2)} s`);
    }
  }
  for (const s of M.sfx || []) if (s.t < 0 || s.t > M.duration) E(`sfx ${s.kind} at ${s.t} is outside the film`);
  const summary = {
    scenes: S.length,
    frames: M.frames,
    seconds: M.duration,
    fps,
    narration: vo.length,
    narrationSeconds: +vo.reduce((a, v) => a + (v.end - v.at), 0).toFixed(2),
    captions: C.length,
    captionsOnScreen: C.filter((c) => c.display !== false).length,
    media: (M.media || []).length,
    sfx: (M.sfx || []).length,
    lastWordAt: vo.length ? vo[vo.length - 1].end : null,
    tailHold: vo.length ? +(M.duration - vo[vo.length - 1].end).toFixed(2) : null,
  };
  return { errors, warnings, summary };
}
