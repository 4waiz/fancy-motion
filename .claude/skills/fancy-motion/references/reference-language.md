# Reference language — reading a reference and adapting its grammar

## How to study a reference (visible facts first)

1. `fm.mjs inspect ref.mp4` — duration, size, fps, audio, scene-change times.
2. `fm.mjs sheet ref.mp4 --every 2` for the arc; then `--times` around every scene change
   (6 frames 1/fps apart) to see motion, not just poses. Read screens at full resolution.
3. Transcribe narration (`audio_qa.py transcribe ref.wav --model small.en`).
4. Write one row per sequence: time range · composition · typography · camera · character
   action · transition · narration purpose · technique to recreate.
5. Keep two columns apart: **what is visible** and **what you assume about how it was made**.
   A filename or a "SKILL.md" drawn on a monitor is an illustration, not the source.
6. Never import the reference's narrator, music, watermark, creator identity, claims
   (adoption, file sizes, percentages, revision counts) or call-to-action.

## The grammar distilled (from the 2-minute studio-and-pixel-character reference this skill was built against)

| Device | What it does | How to use it well |
|---|---|---|
| Miniature studio | Warm, tactile home base; makes software feel made by someone | Voxel/low-poly diorama, one warm key (lamp), monitor glow, foreground props, soft background separation (fog/defocus) |
| Pixel character + small helper | Personality, scale, a body to point at things | Simple rigs, clear poses (idle, point, think, celebrate, wave); timing over complexity; contact shadows always |
| Word-by-word emphatic type | Rhythm and memory | Per-word stagger, controlled overshoot, then a real hold; never two big text blocks at once |
| Type through depth / extrusion | Weight, drama | Real geometry or stacked shadow; land with a squash; the heaviest word gets the low hit |
| Video inside the video | Proof and recursion | Pin real footage to the in-world screen (homography); front-face it for the proof beat |
| Floating folded-corner file | "Knowledge as an object" | A real document, readable lines highlighted one at a time |
| Dark grid stage | Neutral space for diagrams and documents | Ink floor, restrained teal grid fading with distance |
| Particle globe / cosmic passage | The signature transformation | One particle set morphing through states with seeded stagger; colours carried through |
| Traveling pipeline of stages | Process made visible | Lateral track, 2–3 readable tiles in frame, connect them, gather them |
| Version fan + timeline | Iteration made concrete | Real earlier frames; one note per real change; show before → after |
| Studio return + end card | Closure | Same characters at rest, clear hierarchy, long final hold |

## Improve on the reference

- Crowded text → one focal point per shot, captions in one lower band, hero words elsewhere.
- Hidden labels → labels never behind props; check with `hyperframes check` overlap findings.
- Excess smear / abrupt flashes → accents ≤ 6 frames on chosen transitions only; no
  full-frame luminance flashes; pixel wipes are directed sweeps, not noise.
- Words that exit before they are read → enforce the reading floor in the manifest validator.

## Adapting to a new subject

Keep the *structure* (hook → who → what → proof ×3 → signature → process → revision → reuse →
payoff → signature) and swap the *content*: the studio props become the subject's world, the
three proofs become the subject's three most convincing real moments, the signature
transformation uses the subject's own shapes and colours.
