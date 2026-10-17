# /fancy-motion templates

| Path | What it is | How it is used |
|---|---|---|
| `starter/fm/` | The **fm component library** (single source): `fm-core.js` (time, easing, springs, seeded randomness, HyperFrames wiring), `fm-dom.js` (cached styles, per-frame visibility, homography), `fm-components.js` (kinetic title, subtitles, pixel wipe, screen surface, floating file, code panel, terminal, lower third, iteration compare, end card), `fm-three.js` (renderer, projection, voxels, particles, grid stage, screen-hole material, typeface loader), `fm.css` | Copied into a project's `fm/` by `scripts/vendor.mjs`; `vendor.mjs --check` fails if a project's copy drifts |
| `starter/tokens.css` | Default design tokens (palette, three OFL font families) | Used when the project has no `design/tokens.css` |
| `starter/project/` | A runnable starter film: `manifest.src.mjs` (placeholders), `src/main.js` (scene kinds `title`, `file`, `end`), `brief.md`, `audio/` | `fm.mjs init <dir> --title … --creator … --duration …` |

Fonts referenced by the library live in `../fonts/symbols/` (→ ≈ ≤ ≥ subsets) and come from the
`@fontsource-variable/*` packages for everything else; `vendor.mjs` copies both, with licences.

Extend the vocabulary by adding a component to `starter/fm/fm-components.js` (pure function of the
times you pass in; register its root node with the frame so it hides when not rendered), then
re-run `vendor.mjs` in each project that should get it.
