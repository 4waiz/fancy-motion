// mini-showcase: the fm vocabulary in 8 seconds (kinetic title, floating file pinned into 3D,
// pixel wipe, end card) on the teal-grid stage. Author: Awaiz Ahmed.
import { THREE, createRenderer, aim, gridFloor, projectPlane } from "../fm/fm-three.js";
import { run, seg, ease, lerp } from "../fm/fm-core.js";
import { createFrame } from "../fm/fm-dom.js";
import { KineticTitle, FloatingFile, PixelWipe, EndCard } from "../fm/fm-components.js";

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
let M, title, file, wipe, end;

async function boot() {
  await Promise.all([document.fonts.load("900 120px Archivo"), document.fonts.load("600 40px 'DM Sans'"), document.fonts.load("500 30px 'JetBrains Mono'")]);
  M = await (await fetch("manifest.json")).json();
  title = new KineticTitle(above, { text: "Fancy Motion", mode: "letters", maxSize: 190, extrude: { color: "#b95a3e", edge: "#7e3a28", depth: 9 } });
  file = new FloatingFile(above, {
    title: "manifest.json",
    meta: "one source of timing",
    w: 960,
    h: 640,
    lines: [
      { text: '"fps": 60, "frames": 480,', cls: "key" },
      { text: '"scenes": [', cls: "dim" },
      { text: '  { "id": "E1", "start": 0, "end": 2.8 },' },
      { text: '  { "id": "E2", "start": 2.8, "end": 5.6 },' },
      { text: '  { "id": "E3", "start": 5.6, "end": 8.0 }', cls: "" },
      { text: "]", cls: "dim" },
    ],
  });
  wipe = new PixelWipe(above, { cell: 80 });
  end = new EndCard(above, [
    { text: "Made with /fancy-motion", cls: "ex-title" },
    { text: "Created by Awaiz Ahmed", cls: "ex-credit" },
    { text: "Built with Claude Code", cls: "ex-built" },
  ]);
  frame.register(title.node, file.node, wipe.canvas, end.node);
}

function render(t) {
  frame.begin();
  const B = Object.fromEntries(M.scenes.map((s) => [s.id, s.beats]));
  aim(camera, [0, lerp(3.4, 3.0, seg(t, 0, 8)), lerp(12, 10.5, ease.inOutSine(seg(t, 0, 8)))], [0, 1.4, 0], 34);
  title.render(frame, t, { start: B.E1.title[0], end: B.E1.title[1], x: 960, y: 500, stagger: 0.04, from: "depth", letterRotate: 8, exit: "rise" });
  if (t >= 2.8 && t < 5.9) {
    const k = ease.outCubic(seg(t, 2.8, 3.3));
    page.position.set(0, lerp(0.8, 2.0, k) + Math.sin(t * 1.3) * 0.05, 0);
    page.rotation.set(-0.08, Math.sin(t * 0.8) * 0.12 - 0.1, 0.02);
    const hl = t >= B.E2.hl[1] ? { row: 4, p: seg(t, B.E2.hl[1], B.E2.hl[1] + 0.3) } : t >= B.E2.hl[0] ? { row: 0, p: seg(t, B.E2.hl[0], B.E2.hl[0] + 0.3) } : null;
    file.render(frame, projectPlane(camera, page, 7.2, 4.8), { opacity: k, highlight: hl }); // ~1200 px wide: mono lines read at ~36 px
  }
  wipe.render(frame, t, { start: B.E2.wipe[0], mid: B.E2.wipe[1], end: B.E2.wipe[2], colors: ["#da7557", "#f3bd59", "#68c9ba", "#f4ecdd"], origin: [0.5, 0.5] });
  end.render(frame, t, { at: B.E3.lines, end: 8.01 });
  renderer.render(scene, camera);
  frame.end();
}

run({ render, ready: boot() });
