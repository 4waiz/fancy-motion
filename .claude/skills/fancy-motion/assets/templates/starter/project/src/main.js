// Starter engine for a /fancy-motion film: one deterministic render(t) reading manifest.json.
// Scene kinds: "title" (kinetic hero), "file" (floating document in 3D), "end" (credit card).
// Extend by adding kinds; keep every value a function of t. Author: Awaiz Ahmed.
import { THREE, createRenderer, aim, gridFloor, projectPlane } from "../fm/fm-three.js";
import { run, seg, ease, lerp } from "../fm/fm-core.js";
import { createFrame } from "../fm/fm-dom.js";
import { KineticTitle, FloatingFile, PixelWipe, EndCard, Subtitles } from "../fm/fm-components.js";

const frame = createFrame();
const above = document.getElementById("above");
const renderer = createRenderer(document.getElementById("world"), { shadows: false });
const scene = new THREE.Scene();
scene.background = new THREE.Color("#101114");
scene.fog = new THREE.Fog("#101114", 12, 42);
const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 200);
scene.add(gridFloor());
const page = new THREE.Object3D();
scene.add(page);
let M;
const parts = {};

async function boot() {
  await Promise.all([document.fonts.load("900 120px Archivo"), document.fonts.load("600 44px 'DM Sans'"), document.fonts.load("500 30px 'JetBrains Mono'")]);
  M = await (await fetch("manifest.json")).json();
  for (const s of M.scenes) {
    if (s.kind === "title") parts[s.id] = new KineticTitle(above, { text: s.text, mode: "letters", extrude: { color: "#b95a3e", edge: "#7e3a28", depth: 9 } });
    if (s.kind === "file") parts[s.id] = new FloatingFile(above, { title: s.fileTitle, meta: s.title, w: 960, h: 640, lines: s.lines.map((text) => ({ text })) });
    if (s.kind === "end") parts[s.id] = new EndCard(above, s.lines.map((text, i) => ({ text, cls: i === 0 ? "st-title" : "st-line" })));
    frame.register(parts[s.id].node);
  }
  parts.wipe = new PixelWipe(above);
  frame.register(parts.wipe.canvas);
  parts.subs = new Subtitles(above, M.captions || []);
  frame.register(parts.subs.wrap);
}

function render(t) {
  frame.begin();
  aim(camera, [0, 3.2, lerp(12, 10.5, seg(t, 0, M.duration))], [0, 1.4, 0], 34);
  const s = M.scenes.find((x) => t >= x.start && t < x.end) || M.scenes[M.scenes.length - 1];
  const p = parts[s.id];
  if (s.kind === "title") p.render(frame, t, { start: s.beats.title[0], end: s.beats.title[1], x: 960, y: 500, stagger: 0.04, from: "depth", exit: "rise" });
  if (s.kind === "file") {
    const k = ease.outCubic(seg(t, s.start, s.start + 0.5));
    page.position.set(0, lerp(0.6, 1.6, k), 0);
    page.rotation.set(-0.08, Math.sin(t * 0.8) * 0.1 - 0.1, 0.02);
    const row = s.beats.lines.filter((x) => t >= x).length - 1;
    p.render(frame, projectPlane(camera, page, 7.2, 4.8), { opacity: k, highlight: row >= 0 ? { row, p: seg(t, s.beats.lines[row], s.beats.lines[row] + 0.3) } : null });
  }
  if (s.kind === "end") p.render(frame, t, { at: s.beats.lines, end: M.duration + 0.01 });
  for (const x of M.scenes) if (x.start > 0) parts.wipe.render(frame, t, { start: x.start - 0.35, mid: x.start, end: x.start + 0.35, colors: ["#da7557", "#f3bd59", "#68c9ba", "#f4ecdd"], origin: [0.5, 0.5] });
  parts.subs.render(frame, t);
  renderer.render(scene, camera);
  frame.end();
}

run({ render, ready: boot() });
