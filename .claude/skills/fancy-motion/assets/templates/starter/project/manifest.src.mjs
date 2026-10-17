// Scene manifest source — the single source of timing for this film.
// Edit scenes/beats here, then:  node <skill>/scripts/fm.mjs build .
// Scene kinds understood by the starter engine (src/main.js): "title", "file", "end".
// Captions are built by fm.mjs build from audio/vo-lines.json + audio/vo-words.json when present.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 60, DUR = __DURATION__;
const W = __WIDTH__, H = __HEIGHT__;
const S = (id, start, end, o) => ({ id, start, end, startFrame: Math.round(start * FPS), endFrame: Math.round(end * FPS), frames: Math.round((end - start) * FPS), ...o });

// narration placement (absolute seconds) — fill after voice.py synth + audio_qa.py align
const AT = {};
const report = existsSync(join(here, "audio/vo/voice-report.json")) ? JSON.parse(readFileSync(join(here, "audio/vo/voice-report.json"), "utf8")) : [];
const vo = report.filter((r) => AT[r.id] != null).map((r) => ({ id: r.id, scene: r.scene || "S1", at: AT[r.id], duration: r.duration, end: +(AT[r.id] + r.duration).toFixed(3), file: `audio/vo/${r.id}.wav`, text: r.text, display: true }));

const a = DUR * 0.3, b = DUR * 0.75;
const scenes = [
  S("S1", 0, a, { kind: "title", title: "Hook", text: "__TITLE__", camera: "slow push", beats: { title: [0.4, a - 0.2] } }),
  S("S2", a, b, { kind: "file", title: "The idea", fileTitle: "brief.md", lines: ["What it is", "Who it is for", "The three proofs"], camera: "floating page", beats: { lines: [a + 0.6, a + 1.6, a + 2.6] } }),
  S("S3", b, DUR, { kind: "end", title: "Signature", lines: ["__TITLE__", "Created by __CREATOR__"], beats: { lines: [b + 0.3, b + 0.8], musicEnd: DUR - 0.4 } }),
];
const manifest = {
  title: "__TITLE__", creator: "__CREATOR__", builtWith: "Claude Code", compositionId: "fm-film",
  fps: FPS, width: W, height: H, duration: DUR, frames: DUR * FPS,
  scenes, vo, captions: [], media: [],
  sfx: [{ t: 0.4, kind: "hit", size: 0.5 }, { t: a, kind: "pixels", len: 0.8 }, { t: b + 0.3, kind: "signature" }],
  music: { bpm: 120, key: "D major", sections: [{ from: 0, to: a, name: "title", energy: 0.5 }, { from: a, to: b, name: "demos", energy: 0.7 }, { from: b, to: DUR, name: "resolve", energy: 0.3 }] },
};
writeFileSync(join(here, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${scenes.length} scenes, ${manifest.frames} frames`);
