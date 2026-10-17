# mini-showcase — the /fancy-motion vocabulary in 8 seconds

Kinetic title (per-letter, through depth, extruded) → a floating document pinned into a 3D
stage by homography → a directed pixel wipe → an end card that holds. 480 frames at 60 fps,
1920×1080, with an original 8-second cue from `scripts/score.py`.

Run it (from any folder; output goes to `./motion-examples/mini-showcase/`):

```bash
node .claude/skills/fancy-motion/scripts/fm.mjs example mini-showcase
```

or in Claude Code: `/fancy-motion examples/mini-showcase`. The command copies this folder,
vendors three.js/fonts/tokens/fm, builds `index.html` from `manifest.json`, renders with
HyperFrames, muxes `assets/audio/soundtrack.wav` (AAC 48 kHz) and runs `fm.mjs verify`.

Regenerate the soundtrack after editing the manifest:

```bash
uv run --project .claude/skills/fancy-motion/scripts python .claude/skills/fancy-motion/scripts/score.py .claude/skills/fancy-motion/examples/mini-showcase
```
