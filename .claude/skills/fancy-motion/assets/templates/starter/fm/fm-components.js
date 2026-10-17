// fm-components.js — the /fancy-motion component vocabulary (DOM side).
// Kinetic titles, readable subtitles, pixel wipe, screen surfaces (monitor reveal), floating file,
// pipeline cards, code panel, terminal, lower third, iteration compare, end card.
// Every component renders from explicit times you pass in, so copy length and timing are free.
// Part of the /fancy-motion skill (author: Awaiz Ahmed).
import { clamp, lerp, seg, ease, envelope, hash01 } from "./fm-core.js";
import { el, css, text, splitText, pinToQuad } from "./fm-dom.js";

// ---------------------------------------------------------------- text fitting
let probe = null;
/**
 * Largest font size ≤ max at which `value` fits in maxWidth on one line, measured with a real
 * hidden DOM node (exact for variable-font widths like font-stretch: 68%). Load fonts first.
 */
export function fitFontSize(value, { family, weight = 800, stretch = "100%", max = 160, min = 24, maxWidth = 1600, letterSpacing = "0em", transform = "uppercase" }) {
  if (!probe) {
    probe = el("span", { style: { position: "absolute", left: "-99999px", top: "0", whiteSpace: "nowrap", visibility: "hidden" } });
    document.body.appendChild(probe);
  }
  Object.assign(probe.style, { fontFamily: family, fontWeight: String(weight), fontStretch: stretch, letterSpacing, textTransform: transform });
  probe.textContent = value;
  let size = max;
  while (size > min) {
    probe.style.fontSize = `${size}px`;
    if (probe.getBoundingClientRect().width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

// ---------------------------------------------------------------- kinetic title
/**
 * Hero words. Modes: per-word or per-letter stagger. Entrances: 'depth' (from large+soft),
 * 'rise' (from below, masked), 'drop' (falls with weight and settles), 'left'.
 * Optional selective per-letter rotation and CSS extrusion.
 */
export class KineticTitle {
  constructor(parent, { text: value, mode = "words", className = "", extrude = null, maxWidth = 1640, maxSize = 168, minSize = 64, stretch = "68%", weight = 900, family = "Archivo" }) {
    this.node = el("div", { class: `fm-title ${className}` });
    parent.appendChild(this.node);
    this.mode = mode;
    this.size = fitFontSize(value, { family, weight, stretch, max: maxSize, min: minSize, maxWidth });
    css(this.node, { fontSize: `${this.size}px`, fontStretch: stretch, fontWeight: String(weight) });
    if (extrude) {
      const layers = [];
      const n = extrude.depth ?? 10;
      for (let i = 1; i <= n; i++) layers.push(`${(i * (extrude.dx ?? 0.6)).toFixed(1)}px ${(i * (extrude.dy ?? 1)).toFixed(1)}px 0 ${i === n ? extrude.edge ?? extrude.color : extrude.color}`);
      layers.push(`0 ${n * 1.4 + 10}px 34px rgba(0,0,0,0.45)`);
      this.node.style.textShadow = layers.join(",");
    }
    this.spans = splitText(this.node, value, mode);
  }
  /**
   * @param frame per-frame registry from createFrame()
   * @param t current time (s)
   * @param o { start, end, x, y, anchor:'center'|'left', stagger, inDur, outDur, from, overshoot, letterRotate, exit, color }
   */
  render(frame, t, o) {
    const { start, end, stagger = 0.06, inDur = 0.55, outDur = 0.32, from = "rise", overshoot = 1.25, letterRotate = 0, exit = "fade" } = o;
    if (t < start || t >= end) return false;
    frame.show(this.node, "block");
    css(this.node, {
      left: `${o.x ?? 960}px`,
      top: `${o.y ?? 540}px`,
      transform: o.anchor === "left" ? "translate(0,-50%)" : "translate(-50%,-50%)",
      textAlign: o.anchor === "left" ? "left" : "center",
      color: o.color ?? "",
    });
    const n = this.spans.length;
    const out = ease.inCubic(seg(t, end - outDur, end));
    this.spans.forEach((s, i) => {
      const t0 = start + i * stagger;
      const pr = seg(t, t0, t0 + inDur);
      const p = ease.outBack(pr, overshoot);
      const pf = ease.outCubic(pr);
      let tf = "";
      let op = clamp(pr * 1.8);
      let blur = 0;
      if (from === "depth") {
        tf = `scale(${lerp(1.9, 1, pf)})`;
        blur = (1 - pf) * 10;
      } else if (from === "drop") {
        const y = lerp(-0.9, 0, p);
        const squash = 1 + 0.12 * Math.sin(Math.PI * clamp((pr - 0.55) / 0.45)) * (pr > 0.55 ? 1 : 0);
        tf = `translateY(${y}em) scale(${1 / squash},${squash < 1 ? squash : 2 - squash})`;
      } else if (from === "left") {
        tf = `translateX(${lerp(-0.6, 0, p)}em)`;
      } else {
        tf = `translateY(${lerp(0.7, 0, p)}em)`;
      }
      if (letterRotate) {
        const sign = hash01(i, 7) > 0.5 ? 1 : -1;
        tf += ` rotate(${(1 - pf) * letterRotate * sign}deg)`;
      }
      if (out > 0) {
        const k = exit === "rise" ? `translateY(${-0.5 * out}em)` : exit === "depth" ? `scale(${1 + 0.35 * out})` : "";
        tf += ` ${k}`;
        op *= 1 - out;
        if (exit === "depth") blur += out * 8;
      }
      css(s, { transform: tf, opacity: op.toFixed(3), filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none" });
    });
    return true;
  }
}

// ---------------------------------------------------------------- subtitles
/** One consistent lower caption band. cues: [{start, end, text, display?}] — display:false keeps a cue in the SRT only. */
export class Subtitles {
  constructor(parent, cues, { bottom = 64, maxWidth = 1480 } = {}) {
    this.cues = cues.filter((c) => c.display !== false);
    this.wrap = el("div", { class: "fm-subs" });
    this.box = el("div", { class: "fm-subs-box" });
    this.wrap.appendChild(this.box);
    parent.appendChild(this.wrap);
    css(this.wrap, { bottom: `${bottom}px` });
    css(this.box, { maxWidth: `${maxWidth}px` });
  }
  render(frame, t, { lift = 0 } = {}) {
    const c = this.cues.find((q) => t >= q.start && t < q.end);
    if (!c) return false;
    frame.show(this.wrap, "flex");
    // the phrase-aware line breaks from buildCaptions(), exactly (the browser's own wrap broke
    // "…direction, an / idea…" in this film's v1)
    if (this.box.dataset.cue !== c.text) {
      this.box.dataset.cue = c.text;
      this.box.textContent = "";
      (c.lines || [c.text]).forEach((line, i) => {
        if (i) this.box.appendChild(document.createElement("br"));
        this.box.appendChild(document.createTextNode(line));
      });
    }
    const fi = seg(t, c.start, c.start + 0.12);
    const fo = seg(t, c.end - 0.12, c.end);
    const p = Math.min(fi, 1 - fo);
    css(this.box, { opacity: p.toFixed(3), transform: `translateY(${((1 - fi) * 10 - lift).toFixed(1)}px)` });
    return true;
  }
}

// ---------------------------------------------------------------- pixel wipe
/**
 * Square-pixel wipe on a 2D canvas: cells grow to cover the frame (start→mid), then shrink to
 * reveal (mid→end). Ordering follows distance from `origin` plus seeded jitter, so it reads as a
 * directed sweep rather than noise. Never a full-frame flash.
 */
export class PixelWipe {
  constructor(parent, { width = 1920, height = 1080, cell = 60 } = {}) {
    this.canvas = el("canvas", { class: "fm-wipe", width, height });
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.w = width;
    this.h = height;
    this.cell = cell;
  }
  render(frame, t, { start, mid, end, colors = ["#101114"], origin = [0, 0], seed = 3, spread = 0.55 }) {
    if (t < start || t >= end) return false;
    frame.show(this.canvas, "block");
    const { ctx, cell, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
    const ox = origin[0] * w, oy = origin[1] * h;
    const maxD = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const cx = c * cell + cell / 2, cy = r * cell + cell / 2;
        const d = Math.hypot(cx - ox, cy - oy) / maxD;
        const order = clamp(d * (1 - spread) + hash01(i, seed) * spread);
        let s;
        if (t < mid) s = ease.outCubic(seg(t, lerp(start, mid - 0.12, order * 0.85), lerp(start, mid - 0.12, order * 0.85) + 0.14 + 0.1 * (mid - start)));
        else s = 1 - ease.inCubic(seg(t, lerp(mid, end - 0.12, order * 0.85), lerp(mid, end - 0.12, order * 0.85) + 0.14 + 0.1 * (end - mid)));
        if (s <= 0.001) continue;
        const sz = cell * Math.min(1.02, s * 1.02);
        ctx.fillStyle = colors[Math.floor(hash01(i, seed + 11) * colors.length)];
        ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------- screen surface
/** A w×h DOM surface that can be pinned to any quad (front-facing or a projected 3D screen). */
export class ScreenSurface {
  constructor(parent, { w = 1920, h = 1080, className = "" } = {}) {
    this.w = w;
    this.h = h;
    this.node = el("div", { class: `fm-surface ${className}` });
    css(this.node, { width: `${w}px`, height: `${h}px` });
    parent.appendChild(this.node);
  }
  render(frame, quad, { opacity = 1, z = null, radius = null } = {}) {
    frame.show(this.node, "block");
    pinToQuad(this.node, this.w, this.h, quad);
    css(this.node, { opacity: opacity.toFixed(3), zIndex: z == null ? "" : String(z), borderRadius: radius == null ? "" : `${radius}px` });
  }
}

// ---------------------------------------------------------------- floating file
/** Folded-corner document. lines: [{text, cls?}] — real file content, rendered at readable size. */
export class FloatingFile {
  constructor(parent, { title, meta = "", lines = [], w = 900, h = 1060 }) {
    this.w = w;
    this.h = h;
    this.node = el("div", { class: "fm-file" });
    css(this.node, { width: `${w}px`, height: `${h}px` });
    const head = el("div", { class: "fm-file-head" }, [el("div", { class: "fm-file-title", text: title }), el("div", { class: "fm-file-meta", text: meta })]);
    this.body = el("div", { class: "fm-file-body" });
    this.rows = lines.map((l, i) => {
      const row = el("div", { class: `fm-file-row ${l.cls || ""}` }, [el("span", { class: "fm-file-ln", text: String(i + 1) }), el("span", { class: "fm-file-tx", text: l.text })]);
      this.body.appendChild(row);
      return row;
    });
    this.hl = el("div", { class: "fm-file-hl" });
    this.body.appendChild(this.hl);
    this.node.append(head, this.body, el("div", { class: "fm-file-fold" }));
    parent.appendChild(this.node);
  }
  /** highlight: {row, p} — row index to highlight with progress p (0..1). */
  render(frame, quad, { opacity = 1, highlight = null, rowsVisible = null } = {}) {
    frame.show(this.node, "block");
    pinToQuad(this.node, this.w, this.h, quad);
    css(this.node, { opacity: opacity.toFixed(3) });
    if (highlight && highlight.p > 0) {
      const r = this.rows[highlight.row];
      css(this.hl, { display: "block", top: `${r.offsetTop}px`, height: `${r.offsetHeight}px`, transform: `scaleX(${ease.outCubic(highlight.p).toFixed(3)})` });
    } else css(this.hl, { display: "none" });
    if (rowsVisible != null) this.rows.forEach((r, i) => css(r, { opacity: i < rowsVisible ? "1" : "0" }));
  }
}

// ---------------------------------------------------------------- code panel
// One pass over the raw line: comments, strings, keywords, numbers. (Chained regex replaces
// re-match their own inserted markup, e.g. `class` inside <span class="s">.)
const JS_TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(export|function|const|let|var|return|if|else|for|of|new|import|from|class|this|await|async|true|false|null|undefined)\b|\b(\d+(?:\.\d+)?)\b/g;
const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function highlightJs(line) {
  let out = "", last = 0;
  for (const m of line.matchAll(JS_TOKEN)) {
    out += escHtml(line.slice(last, m.index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : "n";
    out += `<span class="${cls}">${escHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escHtml(line.slice(last));
}
/**
 * Real source, line-numbered, with timed highlight ranges. Pass `code` + `firstLine` for a
 * contiguous block, or `lines: [{n, text}]` for a curated excerpt (n = null renders a gap row).
 */
export class CodePanel {
  constructor(parent, { file, code = "", firstLine = 1, lines = null, w = 1400, h = 760 }) {
    this.w = w;
    this.h = h;
    this.node = el("div", { class: "fm-code" });
    css(this.node, { width: `${w}px`, height: `${h}px` });
    const head = el("div", { class: "fm-code-head" }, [el("span", { class: "fm-dot a" }), el("span", { class: "fm-dot b" }), el("span", { class: "fm-dot c" }), el("span", { class: "fm-code-file", text: file })]);
    this.body = el("div", { class: "fm-code-body" });
    this.hl = el("div", { class: "fm-code-hl" });
    this.body.appendChild(this.hl);
    const rows = lines || code.split("\n").map((text, i) => ({ n: firstLine + i, text }));
    this.lines = rows.map((r) => {
      const gap = r.n == null;
      const row = el("div", { class: `fm-code-row${gap ? " gap" : ""}` }, [el("span", { class: "fm-code-ln", text: gap ? "…" : String(r.n) }), el("span", { class: "fm-code-tx", html: gap ? "" : highlightJs(r.text) || "&nbsp;" })]);
      this.body.appendChild(row);
      return row;
    });
    this.node.append(head, this.body);
    parent.appendChild(this.node);
  }
  /** hl: {from, to, p} line indexes (0-based, inclusive). scroll: px. */
  render(frame, quad, { opacity = 1, hl = null, scroll = 0, dim = 0 } = {}) {
    frame.show(this.node, "block");
    pinToQuad(this.node, this.w, this.h, quad);
    css(this.node, { opacity: opacity.toFixed(3) });
    css(this.body, { transform: `translateY(${-scroll.toFixed(1)}px)` });
    if (hl && hl.p > 0) {
      const a = this.lines[hl.from], b = this.lines[hl.to];
      css(this.hl, { display: "block", top: `${a.offsetTop}px`, height: `${b.offsetTop + b.offsetHeight - a.offsetTop}px`, opacity: hl.p.toFixed(3) });
      this.lines.forEach((r, i) => css(r, { opacity: i >= hl.from && i <= hl.to ? "1" : (1 - dim * hl.p).toFixed(3) }));
    } else {
      css(this.hl, { display: "none" });
      this.lines.forEach((r) => css(r, { opacity: "1" }));
    }
  }
}

// ---------------------------------------------------------------- terminal
/** A command typed at a prompt, then its real output lines. */
export class Terminal {
  constructor(parent, { title = "terminal", command, output = [], w = 1200, h = 520, prompt = "›" }) {
    this.w = w;
    this.h = h;
    this.command = command;
    this.node = el("div", { class: "fm-term" });
    css(this.node, { width: `${w}px`, height: `${h}px` });
    this.cmd = el("span", { class: "fm-term-cmd" });
    this.caret = el("span", { class: "fm-term-caret" });
    const head = el("div", { class: "fm-code-head" }, [el("span", { class: "fm-dot a" }), el("span", { class: "fm-dot b" }), el("span", { class: "fm-dot c" }), el("span", { class: "fm-code-file", text: title })]);
    const line = el("div", { class: "fm-term-line" }, [el("span", { class: "fm-term-prompt", text: prompt + " " }), this.cmd, this.caret]);
    this.out = output.map((o) => el("div", { class: `fm-term-out ${o.cls || ""}`, text: o.text }));
    this.node.append(head, el("div", { class: "fm-term-body" }, [line, ...this.out]));
    parent.appendChild(this.node);
  }
  /** typeStart/typeEnd: typing window; outStart + outStep: output reveal. */
  render(frame, quad, t, { typeStart, typeEnd, outStart, outStep = 0.28, opacity = 1 }) {
    frame.show(this.node, "block");
    pinToQuad(this.node, this.w, this.h, quad);
    css(this.node, { opacity: opacity.toFixed(3) });
    const n = Math.round(this.command.length * seg(t, typeStart, typeEnd));
    text(this.cmd, this.command.slice(0, n));
    css(this.caret, { opacity: t < outStart && Math.floor(t * 2.2) % 2 === 0 ? "1" : t < typeEnd ? "1" : "0" });
    this.out.forEach((o, i) => {
      const p = ease.outCubic(seg(t, outStart + i * outStep, outStart + i * outStep + 0.2));
      css(o, { opacity: p.toFixed(3), transform: `translateY(${((1 - p) * 8).toFixed(1)}px)` });
    });
  }
}

// ---------------------------------------------------------------- lower third
export class LowerThird {
  constructor(parent, { name, role }) {
    this.node = el("div", { class: "fm-l3" });
    this.bar = el("div", { class: "fm-l3-bar" });
    this.name = el("div", { class: "fm-l3-name" });
    this.nameSpans = splitText(this.name, name, "letters");
    this.role = el("div", { class: "fm-l3-role", text: role });
    this.node.append(this.bar, el("div", {}, [this.name, this.role]));
    parent.appendChild(this.node);
  }
  render(frame, t, { start, end, x = 120, y = 760 }) {
    if (t < start || t >= end) return false;
    frame.show(this.node, "flex");
    css(this.node, { left: `${x}px`, top: `${y}px` });
    const out = ease.inCubic(seg(t, end - 0.35, end));
    const bar = ease.outExpo(seg(t, start, start + 0.45));
    css(this.bar, { transform: `scaleY(${(bar * (1 - out)).toFixed(3)})` });
    this.nameSpans.forEach((s, i) => {
      const p = ease.outBack(seg(t, start + 0.12 + i * 0.025, start + 0.6 + i * 0.025), 1.2);
      css(s, { transform: `translateY(${((1 - p) * 0.6 + out * -0.3).toFixed(3)}em)`, opacity: (clamp(p * 1.6) * (1 - out)).toFixed(3) });
    });
    const r = ease.outCubic(seg(t, start + 0.45, start + 0.9));
    css(this.role, { opacity: (r * (1 - out)).toFixed(3), transform: `translateX(${((1 - r) * -16).toFixed(1)}px)` });
    return true;
  }
}

// ---------------------------------------------------------------- iteration compare
/** Before/after with a moving divider. Media nodes are supplied by the caller (img/video/div). */
export class IterationCompare {
  constructor(parent, { before, after, labels = ["v1 · rough", "v2 · refined"], note = "", w = 1440, h = 810 }) {
    this.w = w;
    this.h = h;
    this.node = el("div", { class: "fm-cmp" });
    css(this.node, { width: `${w}px`, height: `${h}px` });
    this.a = el("div", { class: "fm-cmp-a" }, [before]);
    this.b = el("div", { class: "fm-cmp-b" }, [after]);
    this.div = el("div", { class: "fm-cmp-div" });
    this.la = el("div", { class: "fm-cmp-label a", text: labels[0] });
    this.lb = el("div", { class: "fm-cmp-label b", text: labels[1] });
    this.note = el("div", { class: "fm-cmp-note", text: note });
    this.node.append(this.a, this.b, this.div, this.la, this.lb, this.note);
    parent.appendChild(this.node);
  }
  render(frame, quad, { split = 0.5, opacity = 1, noteP = 1 }) {
    frame.show(this.node, "block");
    pinToQuad(this.node, this.w, this.h, quad);
    css(this.node, { opacity: opacity.toFixed(3) });
    const x = Math.round(this.w * split);
    css(this.b, { clipPath: `inset(0 0 0 ${x}px)` });
    css(this.div, { transform: `translateX(${x}px)` });
    css(this.note, { opacity: noteP.toFixed(3), transform: `translateY(${((1 - noteP) * 10).toFixed(1)}px)` });
  }
}

// ---------------------------------------------------------------- end card
/** Ordered hierarchy of lines [{text, cls}] revealed with a stagger and held to the end. */
export class EndCard {
  constructor(parent, lines) {
    this.node = el("div", { class: "fm-end" });
    this.lines = lines.map((l) => {
      const n = el("div", { class: `fm-end-line ${l.cls || ""}`, text: l.text });
      this.node.appendChild(n);
      return n;
    });
    parent.appendChild(this.node);
  }
  render(frame, t, { at = [], end = Infinity }) {
    if (t < (at[0] ?? 0) || t >= end) return false;
    frame.show(this.node, "flex");
    this.lines.forEach((n, i) => {
      const p = ease.outBack(seg(t, at[i], at[i] + 0.6), 1.15);
      const q = ease.outCubic(seg(t, at[i], at[i] + 0.6));
      css(n, { opacity: clamp(q * 1.4).toFixed(3), transform: `translateY(${((1 - p) * 28).toFixed(1)}px)`, filter: q < 0.999 ? `blur(${((1 - q) * 6).toFixed(2)}px)` : "none" });
    });
    return true;
  }
}

export { envelope };
