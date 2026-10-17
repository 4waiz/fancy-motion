# Story and timing

## Structure

Plan the hook first (first 1–2 s must be a strong *still* too: it is the thumbnail), then:
who/where → the idea named → 2–4 proof moments (real) → one signature passage → process →
honest iteration → reuse → payoff → signature card. Each scene has one job and one focal point.
Absolute scene windows are fixed in the manifest; transitions live *inside* scenes, never as
overlaps across windows (overlaps silently shorten films).

## Narration

- Write phrase-sized lines (one sentence or clause each) in `audio/vo-lines.json`.
  Budget ≈ 2.4–2.7 spoken words/s *including* pauses; leave ≥ 2.5 s with no voice at the end.
- Generate, then **measure**: `voice.py synth` writes each clip and a duration report;
  `audio_qa.py align` gives word times (Whisper, prompted with the script) and a *blind*
  word-error rate per line (unprompted Whisper = what a listener hears).
- Names: add IPA to `audio/lexicon.json` (e.g. `"Ahmed": "ˈɑːmɛd"`) and test blind with two
  model sizes; a larger model recognising the name ("Awais", "Awayz") confirms the sounds even
  when a small model guesses a common word. Displayed spelling never changes.
- Stress fixes: a per-line `"phonemes"` override (e.g. `tˈaɪp hˈæz wˈeɪt.` made "has" audible).
- Place clips with natural gaps (0.15–0.45 s inside a thought, 0.3–0.6 s between thoughts).
  Retime animation to the measured words, not the draft script.

## Reading time (on-screen text)

| Text | Settled hold |
|---|---|
| Short label, 1–3 words | ≥ 0.8 s |
| Sentence | ≈ 0.3 s per word, ≥ 1.2 s |
| Code/document lines | highlight one line at a time; ≥ 1 s per highlighted line |
| Captions | follow speech; ≥ 1.0 s each; tail 0.3–0.4 s after the last word |

Fast in (0.3–0.6 s), then hold. A hero word that *is* the spoken line replaces that caption
(`display: false` keeps it in the SRT only).

## Beats

Name every important moment in the manifest (`beats`), computed from word times:
`W("s04c", "click")` = absolute time the word "click" starts. Animation, sound cues and capture
scripts all read the same beat, so changing a voice line re-times everything consistently.
Snap to the music grid only when it does not hurt readability (major moves ±0.15 s, small
entrances ±0.10 s; at 120 BPM every integer second is on a beat).

## Real interactions

Show starting state → action → result, front-facing, large, for the key beat (≥ 1.5 s on the
result). Tilted or tiny screens may carry continuity, never the only evidence. The film
camera can move the screen; the app's own motion is whatever the app did.
