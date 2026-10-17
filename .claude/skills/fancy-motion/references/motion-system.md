# Motion system — the fm vocabulary

All modules live in `assets/templates/starter/fm/` and are vendored into a project by
`scripts/vendor.mjs` (with `--check` to detect drift). Everything renders from explicit times.

## Core (`fm-core.js`)

`seg(t,a,b)` progress · `ease.*` (outBack ≤ 1.4 for text) · `spring(t,{freq,zeta})` ·
`wobble(t,t0)` decaying impulse · `envelope(t,start,end)` reveal/hold/exit · `keyframes(t,[…])`
· `rng(seed)`, `hash01(i,seed)` · `run({render, ready})` wires HyperFrames.

## DOM (`fm-dom.js`, `fm-components.js`)

| Component | Use | Key options |
|---|---|---|
| `KineticTitle` | hero words | `mode` words/letters · `from` rise/depth/drop/left · `stagger` · `overshoot` · `letterRotate` (selective) · `extrude` · auto-fits `maxWidth` for any copy length |
| `Subtitles` | one lower caption band | cues with `lines` (≤ 2) and `display` |
| `PixelWipe` | controlled square-pixel transition | `start/mid/end`, palette, `origin`, `spread` (directed, never noise) |
| `ScreenSurface` + `pinToQuad` | monitor reveal, screens in 3D | quad from `projectPlane()`; `lerpQuad(front, world, k)` flies a screen in/out |
| `FloatingFile` | folded-corner document | real lines, per-row highlight |
| `CodePanel` | real source close-up | file, first line, timed highlight ranges, dim others |
| `Terminal` | a real command and its real output | typing window, output stagger |
| `LowerThird` | name + role on a plate | per-letter entrance |
| `IterationCompare` | before/after wipe | labels, note |
| `EndCard` | credit hierarchy | per-line times; holds to the end |

## 3D (`fm-three.js`)

`createRenderer` (pinned size, ACES, shadows) · `aim(camera,pos,at,fov)` · `projectPlane` /
`toScreen` · `Voxels` (instanced rounded voxels with baked contact shading; per-voxel
assembly via `poseInstances`) · `holeMaterial` (DOM screens under the canvas, correct
occlusion) · `gridFloor` (teal perspective grid) · `glowTexture` · `Particles` (CPU-driven,
disc or square, size-attenuated) · `loadFont` (offline typeface JSON → TextGeometry).

## Cameras

Purposeful moves only: push-in to reveal intent, pull-back to reveal context, controlled orbit
(≤ 60°) to show a space, short lateral tracks past sequences, overhead for shape matches.
Define each shot as data (`{pos, at, fov}`) and keyframe between them with `keyframes()`.
Continuity: a scene's last camera = the next scene's first camera, or a deliberate cut.
Cuts inside one canvas: declare the cut time once and use it for visibility too.

## Transitions (pick by meaning)

| Transition | When |
|---|---|
| Clean cut | default when the story carries it |
| Push through a screen | entering software/knowledge |
| Shape match (circle → circle) | two spaces share a form (rug → orbit ring) |
| Pixel wipe | between worlds made of pixels |
| Particle morph | the one signature transformation |
| Ink dip (≤ 0.3 s) | hiding a space change |

## Characters

Rounded-box rigs with pivots (hips, torso, neck, shoulders, elbows). Poses are joint sets
(`idle`, `wave`, `point`, `think`, `celebrate`, `present`, `look`); `poseAt(schedule,t)`
blends from the pose actually showing (no pops). Additive layers: breath, blinks, wave/celebrate
oscillation, hops with anticipation/squash/stretch, antenna wobble. Always a contact shadow;
assemble-from-voxels for entrances. Characters never slide without stepping or hopping.

## Particles

One set, many states: precompute per-particle positions for each state (chart, stars, globe,
pixels, document), then blend with per-particle stagger `d = hash01(i)`. Carry colour through
the states (the data's colours become the globe's bands). Switch disc → square when the story
says "pixels". Fade particles only after the destination object has appeared.

## Accents

RGB split / smear ≤ 6 frames on chosen transitions; no luminance flash > 30% of frame in
< 3 frames; let the film breathe between accents.
