# Audio and captions

## Voice

- Engine: Kokoro-82M, local (Apache-2.0), the model /brag's HyperFrames path downloads.
  `voice.py audition "<two sentences incl. the creator's name>" --voices am_michael,am_puck,…`
  then `audio_qa.py audition <dir> --text "…"` ranks takes by blind WER, rate and pitch spread.
  Blends (`am_michael:0.5+am_puck:0.5`) give a distinct, non-cloned narrator. Never clone a
  real person's voice.
- Scene-sized or phrase-sized clips, same voice and speed throughout; measure each clip.
- Pronunciation lexicon + blind tests (see story-and-timing.md).

## Music (original, `score.py`)

Driven by `manifest.music`: `bpm`, `key`, `sections[{from,to,name,energy}]`, optional `dips`.
Energy shapes the arrangement: pads always; pluck pulse ≥ 0.35 (16ths ≥ 0.7); bass ≥ 0.45;
kick half-time ≥ 0.5, four-on-the-floor ≥ 0.7; claps ≥ 0.72; hats ≥ 0.6. Bell motif on
lifts; risers into energy jumps; a sustained tonic and a fade to silence by `musicEnd`.
Choose the BPM so scene boundaries fall on beats (120 BPM: every integer second).
Alternative: a /brag track (`fm.mjs brag` lists them) with its cue JSON for beat-locks.

## Sound design (manifest `sfx` cues → `score.py`)

Kinds: `key typing uiclick click tick card fan paper drop pop boing glint chime success tone
swell riser whoosh air drag hit thud shimmer pixels draw build signature`. Each cue is placed
at the visual's first frame (clicks at press, reveals at landing). Repeated sounds use
low-high-frequency-risk sources (/brag `sfx-analysis.md`). One restrained low hit per major
reveal; no stacked hits; no repetitive loud whooshes.

## Mix targets

| Target | Value |
|---|---|
| Integrated loudness | −14 LUFS (±1), measured by ffmpeg `ebur128` |
| True peak | ≤ −1 dBTP **on the delivered MP4** — AAC overshoots the master (this film's v1: −1.2 dBTP WAV → −0.1 dBTP AAC), so master at −2.2 dBTP (`codecHeadroomDb: 1`); `fm render` re-measures and trims if needed |
| Voice vs bed under speech (300 Hz–4 kHz) | ≥ +8 dB |
| Music ducking under voice | ≈ −10 dB with mid-band carve, 60 ms attack / 450 ms release |
| Effects under voice | ducked 3–6 dB (`fxDuckDb`); accents (hits, thuds, signature) ≤ ~+2 LU over the speech's momentary loudness (`audio_qa.py cues`) |
| Mono fold-down loss | < 1 dB; L/R correlation > 0.5 |
| Ending | music resolves and fades to silence inside the timeline |

`score.py` writes `audio/mix-report.json` (loudness, true peak, voice-vs-bed, per-kind effect
peaks relative to voice) — use it in review, then *listen*. Put the mix in the manifest
(`"mix": { "sfxDb", "musicDb", "duckDb", "fxDuckDb", "lufs", "truePeak", "codecHeadroomDb" }`) so
`score.py <project>` reproduces it; CLI flags override for experiments; per-cue `gain` trims
single accents. Measure the delivered file with `audio_qa.py cues <mp4> --manifest …` and keep
the before/after numbers (this film: loudest accent +3.6 → +1.8 LU).

## Captions

- Built from narration placement + word times (`scripts/lib/captions.mjs`): break at
  sentence ends and at commas once a line is full; ≤ 2 balanced lines of ≤ 52 characters at
  1080p; `keepTogether` protects names and noun phrases; tail 0.3–0.4 s; ≥ 1 s per cue.
- One consistent lower band (DM Sans 600, 44 px, ink plate), bottom ≥ 54 px (5%). The
  `Subtitles` component renders the builder's `lines` exactly (no browser re-wrapping).
- Hero words that repeat the spoken line replace that caption on screen; the SRT is always
  complete. Deliver the SRT next to the MP4 with the same base name.
