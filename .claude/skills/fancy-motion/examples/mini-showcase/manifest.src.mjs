// mini-showcase — an 8-second /fancy-motion example: kinetic title → floating file on the grid
// stage → controlled pixel wipe → end card. Run:  node manifest.src.mjs  (fm.mjs build does it).
// Author: Awaiz Ahmed.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 60, DUR = 8;
const S = (id, start, end, o) => ({ id, start, end, startFrame: Math.round(start * FPS), endFrame: Math.round(end * FPS), frames: Math.round((end - start) * FPS), ...o });
const scenes = [
  S("E1", 0, 2.8, { title: "Title", space: "stage", camera: "slow push over the grid", transitionOut: "title rises away", beats: { title: [0.3, 2.65] } }),
  S("E2", 2.8, 5.6, { title: "Floating file", space: "stage", camera: "static; the page floats", transitionOut: "pixel wipe", beats: { doc: [2.8, 5.6], hl: [3.45, 4.35], wipe: [5.15, 5.6, 6.05] } }),
  S("E3", 5.6, 8.0, { title: "End card", space: "stage", camera: "static", beats: { lines: [5.9, 6.3, 6.7], musicEnd: 7.75 } }),
];
const manifest = {
  title: "Mini Showcase",
  creator: "Awaiz Ahmed",
  builtWith: "Claude Code",
  compositionId: "fm-mini-showcase",
  fps: FPS, width: 1920, height: 1080, duration: DUR, frames: DUR * FPS,
  scenes,
  vo: [],
  captions: [],
  media: [],
  sfx: [
    { t: 0.3, kind: "hit", size: 0.5 }, { t: 2.9, kind: "paper" }, { t: 3.45, kind: "tick" }, { t: 4.35, kind: "tick" },
    { t: 5.15, kind: "pixels", len: 0.9 }, { t: 5.9, kind: "signature" },
  ],
  music: { bpm: 120, key: "D major", sections: [{ from: 0, to: 2.8, name: "title", energy: 0.5 }, { from: 2.8, to: 5.6, name: "demos", energy: 0.7 }, { from: 5.6, to: 8, name: "resolve", energy: 0.3 }] },
};
writeFileSync(join(here, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${scenes.length} scenes, ${manifest.frames} frames`);
