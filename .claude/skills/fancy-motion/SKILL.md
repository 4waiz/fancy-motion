---
name: fancy-motion
description: Creates and renders cinematic motion-design videos from a brief, reference media, and available assets. Use for animated explainers, product films, kinetic typography, and code-driven showcase videos, or when someone says "/fancy-motion", "make a motion film", "turn this brief into an animated video".
argument-hint: "[brief or brief.md] [--duration 30] [--format landscape|vertical|square] [--ref clip.mp4] [--creator \"Name\"] [--out dir]"
metadata:
  author: Awaiz Ahmed
  version: "1.0.0"
  builds-on: brag
---

# /fancy-motion

Turns a creative brief into a finished, verified motion film: script, storyboard, voice,
original score, code-driven animation, captions, a reviewed rough cut, a refined master and
the evidence that it meets spec. Created by Awaiz Ahmed. Builds on /brag (see
[references/brag-integration.md](references/brag-integration.md)).

Workflow: brief → reference → script → storyboard → assets → rough render → review → refine → verify → deliver

## Inputs

Parse `$ARGUMENTS`; flags or plain language both work. Ask only if there is no brief at all.

| Input | Default |
|---|---|
| brief | required — text, or a path to a brief file |
| `--duration` | 30 s (any length; the manifest sets the exact frame count) |
| `--format` | landscape 1920×1080 · vertical 1080×1920 · square 1080×1080, always 60 fps |
| `--ref` | none — reference video/stills to study (never copied into the film) |
| `--creator` | Awaiz Ahmed (credit, end card, file metadata) |
| brand tokens | project `design/tokens.css` if present, else the starter tokens |
| assets | `./assets` (captures, logos, stills) |
| `--out` | `./motion/<slug>/` |
| voice | Kokoro `am_michael:0.5+am_puck:0.5` at 1.05, local (the /brag voice path) |

## The project you build

`node ${CLAUDE_SKILL_DIR}/scripts/fm.mjs init <out> --title "…" --creator "…" --duration 30`
scaffolds a HyperFrames project (the /brag renderer) wired to the `fm` component library:
`manifest.src.mjs` (single source of timing) → `manifest.json` → `index.html` (generated) →
`src/main.js` (one deterministic `render(t)`), plus `audio/`, `assets/`, `vendor/`.

## Tools

Node CLI: `node ${CLAUDE_SKILL_DIR}/scripts/fm.mjs <init|build|validate|render|mux|verify|review|inspect|sheet|status|brag|install|example>`.
Python tools (voice, score, QA): `uv run --project ${CLAUDE_SKILL_DIR}/scripts --group qa python ${CLAUDE_SKILL_DIR}/scripts/<tool>.py`
— `voice.py` (Kokoro synth, lexicon, blends), `audio_qa.py` (align, blind WER, mix metrics),
`score.py` (original score + sound design + mix from the manifest), `make_typeface.py` (3D type),
`font_coverage.py` (every on-screen character exists in the bundled fonts).

## Steps (each writes a checkpoint; `fm.mjs status <out>` shows where to resume)

1. **Brief** — restate goal, audience, length, format, credit and the 2–4 proof moments in
   `brief.md`. Decide what must be *real* (captures, code, commands) versus illustrative.
2. **Reference** — `fm.mjs inspect <ref>` and `fm.mjs sheet <ref>` (dense sheets at scene
   changes). Write a breakdown: time range, composition, type, camera, character action,
   transition, narration purpose, technique. Separate what is visible from assumptions.
   Grammar and how to adapt it: [references/reference-language.md](references/reference-language.md).
3. **Script** — narration in phrase-sized lines in `audio/vo-lines.json`, ~2.4–2.7 words/s.
   `voice.py synth` then `audio_qa.py align` to measure every clip, test names with a
   lexicon, and retime from the measured audio, never the draft. See
   [references/story-and-timing.md](references/story-and-timing.md).
4. **Storyboard** — fill `manifest.src.mjs`: scenes with absolute frames, narration placement,
   named beats (from word timings), camera notes, transitions, media and sound cues.
   `fm.mjs validate` must pass (contiguous frames, no unintended gaps, VO inside its scene,
   readable caption cues). Build with the vocabulary in
   [references/motion-system.md](references/motion-system.md).
5. **Assets** — record real product footage deterministically (virtual clock + real input
   events), make typefaces for 3D type (`make_typeface.py`), keep an asset manifest with
   origin, licence and use. No placeholder may survive to the final render.
6. **Rough render** — `fm.mjs render <out> --draft` (full length). Save it; it is evidence.
7. **Review** — `fm.mjs review <v1.mp4> --manifest <out>` (contact sheet, every scene boundary,
   each typography hold, a flicker/frozen-motion audit, a Whisper transcript of the mix vs the
   script), each proof moment at full size, the end card; audio with `audio_qa.py mix` and
   `audio_qa.py cues` (effects vs speech). Write concrete notes (value before → after). See
   [references/render-and-review.md](references/render-and-review.md).
8. **Refine** — fix the notes, keep before/after clips of real corrections, re-render.
9. **Verify** — `fm.mjs verify <mp4> --frames N --fps 60` (exact frame count, codecs, audio
   48 kHz stereo, loudness, black frames, metadata) and `font_coverage.py`. Score and mix:
   [references/audio-and-captions.md](references/audio-and-captions.md).
10. **Deliver** — MP4 (H.264 yuv420p, AAC 48 kHz stereo), complete SRT, poster still, editable
    project, asset credits, QA report stating what was and was not checked. Other screens and
    lengths (vertical, 60 s / 30 s cuts) are versions of the same film — recomposed and edit-listed,
    each verified on its own: [references/render-and-review.md](references/render-and-review.md#versions-other-screens-and-lengths).

## Laws (from /brag, extended for longer films)

- **Story before style.** Every move shows an action, relationship, emotion or change.
- **Readable.** Reveal → land → hold → exit. Short labels ≥ 0.8 s settled; sentences
  ≈ 0.3 s/word. Fast in, then hold. Captions ≤ 2 lines in one lower band, 5% safe margins.
- **Truthful.** Commands, results, timings, data and revisions on screen happened. Label
  illustrative systems as illustrative. Never borrow a reference's claims or credits.
- **Deterministic.** Pure `render(t)`, seeded randomness, no clocks, no network at render.
- **Sound supports motion.** Effects land with the picture and duck under the voice.
- **Check, then claim.** Nothing is "done" until it is rendered, inspected and verified.

## Completion criteria

Exact frame count at 60 fps; every scripted scene present; real demos understandable
front-facing; creator spelled exactly; no clipped or unreadable text, black frames, missing
assets or font substitution; captions match the voice; −14 LUFS (±1) and ≤ −1 dBTP; the
revision shown is genuine; delivery files and QA report written.

## Example

When the argument is `examples/<name>`, run the bundled example instead of planning a film:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/fm.mjs" example mini-showcase
```

It copies [examples/mini-showcase](examples/mini-showcase) to `./motion-examples/`, vendors
three.js, fonts and the fm library, builds from its manifest, renders 480 frames at 60 fps,
muxes its original 8-second cue and runs `fm.mjs verify` — the quickest proof the toolchain
works on a new machine. Report the verify lines. The full 120-second film made with this
skill lives in the project that ships it (`film/`).
