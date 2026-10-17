# Render and review

## Deterministic rendering (non-negotiable)

- One pure `render(t)`. HyperFrames dispatches `hf-seek` with `{time, waitUntil}` for every
  frame it captures and while scrubbing; `fm-core.run({render, ready})` wires it and registers
  `ready` as a build hold so nothing is captured half-built.
- Root needs `data-duration` (render length is fixed at compile time) and, when no GSAP timeline
  is used, `data-no-timeline` so lint accepts the adapter-driven composition.
- Every frame starts from a reset: `frame.begin()` … `frame.end()` hides every registered DOM
  node not shown this frame; scenes turn 3D groups on explicitly. Out-of-order seeks are safe.
- No `Date.now()`, `performance.now()`, unseeded `Math.random()`, network, or input state.
  Use `rng(seed)` / `hash01(i, seed)`. Particles, voxel scatter and character blinks are pure
  functions of `t` and a seed.
- Three.js: renderer size and pixel ratio pinned; `preserveDrawingBuffer: true`; `PCFShadowMap`
  (PCFSoft was removed in r18x — use `light.shadow.radius`). `Object3D.position` is read-only:
  use `.position.set()`, never `Object.assign(mesh, {position})`.
- Fonts: bundle the woff2 files and declare `@font-face` in `index.html`. Do **not** name
  fallback families (`Segoe UI`, `Consolas`, `Arial Narrow`): HyperFrames' compiler maps such
  names to Google substitutes and fetches them, i.e. silent font substitution.
- 3D text: make a typeface JSON offline (`make_typeface.py`); three's TTFLoader imports
  opentype.js from a CDN at runtime.

## Media inside 3D

- `<video>` must be static in `index.html` (`compose.mjs` writes them from `manifest.media`),
  each inside a wrapper `div` with **no** `data-start` (HyperFrames rejects timed ancestors).
  During render HyperFrames swaps each video for an injected `<img>` sibling in the same
  wrapper, so transform the **wrapper**, never the video.
- Pin any DOM surface to a 3D quad with `projectPlane()` + `pinToQuad()` (homography). For a
  screen inside the scene, give the 3D screen plane `holeMaterial()`; put the surface *under*
  the canvas (z 0) so objects in front correctly occlude it. Raise it (z 5) when front-facing.
- Stacking (set in `fm.css`, layers written by `compose.mjs`): `#below` 0 (screens seen through
  the canvas hole) · canvas 1 · `#mid` 3 (flat cards that a front-facing recording may cover:
  code panels, data tables, fade plates) · media wrappers 0 or 5 · `#above` 10 (titles, captions,
  labels, callouts — always readable over media). This film's v1 had the overlay layer under the
  recordings: every callout over a demo, one hero title and a caption edge were hidden. Media
  wrappers must be `position: absolute` (`.vwrap`): a static wrapper ignores z-index and stacks
  below the frame — v1-blocked showed no recordings at all.
- `place()`/`frame.show()` set `display: block`; pass `display: "flex"` for flex-laid-out cards,
  or their rows run together on one line.
- Encode recordings with dense keyframes (`-g 30`) — sparse keyframes cause seek freezes.
- Record app footage deterministically: the app exposes a virtual clock (`?capture=1`), the
  recorder dispatches real CDP input events and steps the clock one frame at a time, then
  screenshots. Document any recorder overlay (e.g. a drawn cursor).

## Commands

```bash
node ${CLAUDE_SKILL_DIR}/scripts/fm.mjs build <project>          # manifest → validate → index.html
npx hyperframes check                                            # lint + runtime + layout + contrast (run in <project>)
npx hyperframes snapshot --at 1.5,12,30 --output <dir>           # stills + contact sheet
node ${CLAUDE_SKILL_DIR}/scripts/fm.mjs render <project> --draft # rough cut (draft quality, full length)
node ${CLAUDE_SKILL_DIR}/scripts/fm.mjs render <project>         # delivery quality + AAC mux + metadata
node ${CLAUDE_SKILL_DIR}/scripts/fm.mjs verify <mp4> --frames 7200 --fps 60 --width 1920 --height 1080
node ${CLAUDE_SKILL_DIR}/scripts/fm.mjs sheet <mp4> --every 2    # timestamped contact sheet
```

A full 120 s, 60 fps render (7,200 frames) takes minutes; start long renders in the
background and poll the log, not the process. Render audio separately (`score.py`) and mux;
HyperFrames' own audio pass is fine for previews. A mix change never needs a re-render:
re-score, then `fm.mjs mux <film.mp4> <project> [--manifest m.json]` swaps the soundtrack into
the same picture (same metadata and true-peak guard).

## Versions: other screens and lengths

One engine renders every version; each is a composition (an HTML file naming its manifest with
`data-manifest`, written by `writeIndexHtml(dir, M, { file, manifest })`) plus its manifest.

- **Vertical (1080×1920) is recomposed, never cropped.** Scenes read `H > W` and switch to
  their own layouts: titles in their own bands, 3D framings converted for the narrow frame
  (dolly back to keep ~60% of the horizontal coverage, or widen the fov for fly-throughs), app
  recordings in a window that follows the action (card → editor → result) at a readable scale,
  wide arrangements re-staged (a lateral track becomes a vertical scroll). Keep text inside the
  area social apps leave free: ~220 px top, ~420 px bottom (captions sit above it), ~140 px
  right rail. Same timeline, so the same soundtrack.
- **Shorter cuts are edit lists, not new films.** A cut manifest adds `edl: [{ at, from, to,
  wipe }]` (cut time `at` plays film time `from`–`to`); the engine maps each frame, scenes keep
  film-time beats. Narration lines and sound cues inside a segment keep their offsets (a line may
  finish over a join only into silence); captions are rebuilt in cut time; each media clip gets a
  per-segment copy (`id~k`). Put joins on the score's beat grid behind a transition, let a cut
  retime a beat (a name card that must read, a card that has no story in the short version), and
  re-score: the film's music sections mapped through the edit list, the music's end in cut time
  (`music.end`), and the mix re-balanced if speech no longer sits where it does in the film
  (measure with `audio_qa.py cues`). `fm.mjs validate` checks the edit list (contiguous, adds up
  to the duration, inside the film) and narration placement in film time.
- **Commands per version**: `score.py <project> --manifest manifest-p60.json` (writes the
  manifest's `soundtrack`, `audio/mix-report-p60.json`), `fm.mjs render <project> --composition
  p60.html --manifest manifest-p60.json`, `fm.mjs verify <mp4> --frames 3600 --width 1080
  --height 1920`, `fm.mjs review <mp4> --manifest <project>/manifest-p60.json` (boundaries
  include every join). `hyperframes snapshot` reads `index.html` only: build a version into it
  to snapshot, then rebuild.

## Review loop (what to look at, in order)

1. Contact sheet of the whole film (`sheet --every 2`): pacing, colour family, empty frames.
2. Every scene boundary: last frame before and first frame after (`sheet --times`).
3. Each typography hold at full resolution: settled ≥ 0.8 s (labels) / 0.3 s per word, no
   clipping, no collision with captions (lower band ≈ y 888–1022 at 1080p), 5% margins.
4. Each proof moment front-facing at full size: start state, action, result all legible.
5. Motion: `fm.mjs review` writes `motion.json` — one-frame luma flashes (flicker, objects
   crossing the lens; cuts excluded) and runs ≥ 1.5 s with no change (frozen action, or an
   intended hold — decide which). Inspect every flash frame-by-frame (sheet of the frames
   around it); the motion audit found desk voxels crossing a close camera in this film's v1.
6. Audio: `audio_qa.py mix` (LUFS, true peak, mono fold-down, voice-vs-bed), `audio_qa.py cues
   <mp4> --manifest manifest.json` (momentary loudness at each sound cue vs the speech — cues
   more than ~3 LU over the voice jump out), the Whisper transcript of the final mix vs the
   script, and listening where possible.
7. The ending: hold length after the last word, music fades to silence inside the timeline.

Hold times passed to `sheet --times` snap to the nearest frame, so any beat time works.

Write notes as **value before → value after** with a reason (e.g. "title tracking −0.04em →
+0.01em: letters touch at 150 px"). Keep the v1 render; cut short before/after clips of each
real correction — they are evidence, and they can appear in the film.

## Checkpoints and resume

`fm.mjs status <project>` lists the ten steps by their artifacts (brief.md, reference notes,
voice clips + word timings, valid manifest, assets, v1 render, review notes, v2 render,
verify report, deliverables) and names the first missing one — resume there. Every step is
re-runnable: voice per line (`--only`), score in ~40 s, render from the manifest.

## Verify before claiming

`fm.mjs verify` decodes every frame and checks: exact count, h264/yuv420p, constant fps, size,
AAC 48 kHz stereo, integrated loudness ±1 LU of target, true peak ≤ −1 dBTP, no black runs,
title/artist metadata. A container a few ms longer than the picture (AAC priming) is fine;
a missing or extra **video frame** is not. Record which checks ran and which could not.
