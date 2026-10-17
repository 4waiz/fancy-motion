// fm-dom.js — DOM helpers for frame-exact compositions: element factory, cached style writes,
// per-frame visibility reset, and a homography that pins any DOM element onto a 2D/3D quad.
// Part of the /fancy-motion skill (author: Awaiz Ahmed).

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

const cache = new WeakMap();
/** Write only the style properties that changed since the last frame. */
export function css(node, props) {
  let prev = cache.get(node);
  if (!prev) cache.set(node, (prev = {}));
  for (const k in props) {
    const v = props[k];
    if (prev[k] !== v) {
      prev[k] = v;
      if (k.startsWith("--")) node.style.setProperty(k, v);
      else node.style[k] = v;
    }
  }
}
export function text(node, value) {
  if (node.__fmText !== value) {
    node.__fmText = value;
    node.textContent = value;
  }
}

/**
 * Per-frame visibility registry. Call frame.begin() at the top of render(t); any registered node
 * not shown via frame.show(node) during that frame is hidden at frame.end(). This is what makes
 * out-of-order seeking safe: no element keeps state from a previously rendered frame.
 */
export function createFrame() {
  const nodes = new Set();
  let shown = new Set();
  return {
    register(...ns) {
      for (const n of ns) nodes.add(n);
      return ns[0];
    },
    begin() {
      shown = new Set();
    },
    show(n, display = "") {
      shown.add(n);
      css(n, { display });
      return n;
    },
    end() {
      for (const n of nodes) if (!shown.has(n)) css(n, { display: "none" });
    },
  };
}

/**
 * CSS matrix3d that maps an element of size w×h (transform-origin 0 0) onto the quad
 * q = [[x0,y0] top-left, [x1,y1] top-right, [x2,y2] bottom-right, [x3,y3] bottom-left].
 * Heckbert's square-to-quad projective mapping.
 */
export function quadMatrix(w, h, q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, hh;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0;
    d = y1 - y0; e = y3 - y0; f = y0;
    g = 0; hh = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    hh = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
  }
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(9)).join(",")})`;
}

/** Pin a w×h element onto a screen-space quad (see quadMatrix). Element must be position:absolute; left/top 0. */
export function pinToQuad(node, w, h, quad) {
  css(node, { transformOrigin: "0 0", transform: quadMatrix(w, h, quad) });
}

/** Axis-aligned screen rectangle as a quad. */
export const rectQuad = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/** Interpolate two quads corner by corner (front-facing ↔ in-world transitions). */
export const lerpQuad = (a, b, t) => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);

/** Split text into spans (words or letters) once; returns the span list for per-frame animation. */
export function splitText(node, value, mode = "words") {
  node.textContent = "";
  const spans = [];
  const words = value.split(" ");
  words.forEach((w, wi) => {
    const word = el("span", { class: "fm-word" });
    if (mode === "letters") {
      for (const ch of w) {
        const s = el("span", { class: "fm-letter", text: ch });
        word.appendChild(s);
        spans.push(s);
      }
    } else {
      word.textContent = w;
      spans.push(word);
    }
    node.appendChild(word);
    if (wi < words.length - 1) node.appendChild(document.createTextNode(" "));
  });
  return spans;
}
