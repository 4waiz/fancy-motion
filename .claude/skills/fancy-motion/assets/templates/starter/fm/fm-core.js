// fm-core.js — deterministic time & motion utilities for /fancy-motion compositions.
// Part of the /fancy-motion skill (author: Awaiz Ahmed). Every function here is a pure function
// of its inputs: frames can be rendered in any order and always produce the same pixels.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
/** Normalised progress of t through [a, b], clamped to 0..1. */
export const seg = (t, a, b) => clamp(invLerp(a, b, t));
export const smoothstep = (x) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------------------------------------------------------- easing
const c1 = 1.70158;
export const ease = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  outQuart: (x) => 1 - (1 - x) ** 4,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  outQuint: (x) => 1 - (1 - x) ** 5,
  inExpo: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) =>
    x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
  inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  /** Controlled overshoot. s ≈ 1.2 subtle, 1.7 classic; keep ≤ 1.4 for readable text. */
  outBack: (x, s = 1.3) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2,
  inBack: (x, s = c1) => (s + 1) * x ** 3 - s * x * x,
};

/** Critically-damped-ish spring from 0 to 1 (analytic, seekable). zeta < 1 overshoots. */
export function spring(t, { freq = 2.2, zeta = 0.55 } = {}) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * freq;
  if (zeta >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
}

/** A decaying wobble that starts at an impulse time: used for antennae, landings, recoil. */
export function wobble(t, t0, { amp = 1, freq = 3, decay = 4 } = {}) {
  const d = t - t0;
  if (d < 0) return 0;
  return amp * Math.exp(-decay * d) * Math.sin(2 * Math.PI * freq * d);
}

/**
 * Reveal → hold → exit envelope. Returns { p, inP, outP, visible }.
 * p rises 0→1 over [start, start+inDur] (eased) and falls 1→0 over [end-outDur, end].
 */
export function envelope(t, start, end, { inDur = 0.4, outDur = 0.3, easeIn = ease.outCubic, easeOut = ease.inCubic } = {}) {
  const visible = t >= start && t < end;
  const inP = inDur > 0 ? easeIn(seg(t, start, start + inDur)) : t >= start ? 1 : 0;
  const outP = outDur > 0 ? easeOut(seg(t, end - outDur, end)) : t >= end ? 1 : 0;
  return { p: visible ? Math.min(inP, 1 - outP) : 0, inP, outP, visible };
}

/** Piecewise keyframes: [{t, v, e?}] with numbers or arrays; e = easing into that key. */
export function keyframes(t, kfs) {
  if (t <= kfs[0].t) return kfs[0].v;
  for (let i = 1; i < kfs.length; i++) {
    const k = kfs[i];
    if (t <= k.t) {
      const p = (k.e || ease.inOutCubic)(seg(t, kfs[i - 1].t, k.t));
      const a = kfs[i - 1].v;
      return Array.isArray(a) ? a.map((x, j) => lerp(x, k.v[j], p)) : lerp(a, k.v, p);
    }
  }
  return kfs[kfs.length - 1].v;
}

// ---------------------------------------------------------------- seeded randomness
/** mulberry32: tiny, fast, seedable. Never use Math.random() in a composition. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Stateless hash noise in [0,1) for an integer index and seed. */
export function hash01(i, seed = 0) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- frame/time helpers
export const toFrame = (s, fps) => Math.round(s * fps);
export const toSec = (f, fps) => f / fps;
/** Snap a time to the frame grid so a beat lands on a whole frame. */
export const snap = (s, fps = 60) => Math.round(s * fps) / fps;

// ---------------------------------------------------------------- runtime wiring
/**
 * Wire a render(t) function to HyperFrames. HyperFrames dispatches `hf-seek` for every frame it
 * captures (and while scrubbing in Studio); `waitUntil` lets async work (image decodes) finish
 * before capture. `ready` is a promise for asset loading; it is registered as a build hold so the
 * renderer never captures a half-built scene.
 */
export function run({ render, ready = Promise.resolve(), name = "fm" }) {
  window.__hf = window.__hf || {};
  window.__hf.buildReady = window.__hf.buildReady || {};
  let lastT = 0;
  let isReady = false;
  const draw = (t) => {
    lastT = t;
    if (!isReady) return undefined;
    return render(t);
  };
  window.__hf.buildReady[name] = ready.then(() => {
    isReady = true;
    return draw(window.__hfThreeTime || lastT || 0);
  });
  window.addEventListener("hf-seek", (e) => {
    const t = e.detail && typeof e.detail.time === "number" ? e.detail.time : 0;
    const p = draw(t);
    if (p && typeof p.then === "function" && e.detail && e.detail.waitUntil) e.detail.waitUntil(p);
  });
  // Standalone viewing (opened directly, no HyperFrames runtime): ?t=12.5 renders that time.
  const q = new URLSearchParams(location.search);
  if (q.has("t")) ready.then(() => draw(parseFloat(q.get("t")) || 0));
  return { draw };
}
