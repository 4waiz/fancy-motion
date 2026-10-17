"""Narration for /fancy-motion: Kokoro-82M, locally, with a pronunciation lexicon.

Reuses /brag's voice path: the same Kokoro model and voices that `npx hyperframes tts`
downloads into ~/.cache/hyperframes/tts/ (falls back to the kanban-motion cache). Adds what a
longer film needs: per-line synthesis from a JSON script, a phoneme lexicon so names are
spoken the way the creator says them, voice blends, 48 kHz output and a duration report.

  uv run --project <skill>/scripts python <skill>/scripts/voice.py phonemes "I'm Awaiz Ahmed." --lexicon lexicon.json
  uv run --project <skill>/scripts python <skill>/scripts/voice.py synth lines.json --out vo/ --lexicon lexicon.json
  uv run --project <skill>/scripts python <skill>/scripts/voice.py audition "Some text" --voices am_michael,af_heart --out audition/

lines.json: [{"id": "s01", "text": "...", "voice": "am_michael", "speed": 1.0}, ...]
            voice may be a blend: "am_michael:0.6+am_puck:0.4"; voice/speed default from --voice/--speed;
            an optional "phonemes" field overrides the text for that line (test it blind with audio_qa.py)
lexicon.json: {"Ahmed": "ˈɑːmɛd"}  (word -> Kokoro IPA; the displayed spelling never changes)
Author: Awaiz Ahmed. Kokoro-82M is Apache-2.0 (hexgrad); kokoro-onnx is MIT (thewh1teagle).
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

SR_OUT = 48000


def find_model():
    home = Path(os.path.expanduser("~"))
    env = os.environ.get("FM_KOKORO_DIR")
    candidates = []
    if env:
        candidates.append((Path(env) / "kokoro-v1.0.onnx", Path(env) / "voices-v1.0.bin"))
    candidates += [
        (home / ".cache/hyperframes/tts/models/kokoro-v1.0.onnx", home / ".cache/hyperframes/tts/voices/voices-v1.0.bin"),
        (home / ".cache/kanban-motion/kokoro/kokoro-v1.0.onnx", home / ".cache/kanban-motion/kokoro/voices-v1.0.bin"),
    ]
    for m, v in candidates:
        if m.exists() and v.exists():
            return m, v
    sys.exit("Kokoro model not found. Run `npx hyperframes tts \"test\" -o test.wav` once (it downloads the model "
             "into ~/.cache/hyperframes/tts/), or set FM_KOKORO_DIR to a folder with kokoro-v1.0.onnx + voices-v1.0.bin.")


_K = None


def kokoro():
    global _K
    if _K is None:
        from kokoro_onnx import Kokoro
        m, v = find_model()
        _K = Kokoro(str(m), str(v))
    return _K


def lang_for(voice):
    first = voice.split("+")[0].split(":")[0]
    return "en-gb" if first.startswith("b") else "en-us"


def style_for(voice):
    """'am_michael' or a weighted blend 'am_michael:0.6+am_puck:0.4' -> style array or name."""
    if "+" not in voice and ":" not in voice:
        return voice
    k = kokoro()
    parts = []
    for p in voice.split("+"):
        name, _, w = p.partition(":")
        parts.append((name.strip(), float(w or 1)))
    total = sum(w for _, w in parts)
    return sum(k.get_voice_style(n) * (w / total) for n, w in parts).astype(np.float32)


def phonemize(text, lang, lexicon):
    k = kokoro()
    ph = k.tokenizer.phonemize(text, lang)
    for word, ipa in (lexicon or {}).items():
        if not re.search(rf"\b{re.escape(word)}\b", text):
            continue
        default = k.tokenizer.phonemize(word, lang).strip().rstrip(".")
        if default and default in ph:
            ph = ph.replace(default, ipa)
        else:
            print(f"  ! lexicon word {word!r} ({default!r}) not found in {ph!r}", file=sys.stderr)
    return ph


def synth(text, voice, speed, lexicon, phonemes=None):
    k = kokoro()
    lang = lang_for(voice)
    ph = phonemes or phonemize(text, lang, lexicon)
    audio, sr = k.create(ph, voice=style_for(voice), speed=speed, lang=lang, is_phonemes=True)
    audio = np.asarray(audio, dtype=np.float64)
    if sr != SR_OUT:
        g = np.gcd(SR_OUT, sr)
        audio = signal.resample_poly(audio, SR_OUT // g, sr // g)
    # 5 ms fades so a clip never starts or stops on a click
    n = int(0.005 * SR_OUT)
    if len(audio) > 2 * n:
        audio[:n] *= np.linspace(0, 1, n)
        audio[-n:] *= np.linspace(1, 0, n)
    return audio.astype(np.float32), ph


def stats(x):
    voiced = np.abs(x) > 0.01
    rms = float(np.sqrt(np.mean(x[voiced] ** 2))) if voiced.any() else 0.0
    return {"duration": round(len(x) / SR_OUT, 3), "peak": round(float(np.abs(x).max()), 4), "rms": round(rms, 4)}


def load_lexicon(path):
    return json.loads(Path(path).read_text(encoding="utf-8")) if path else {}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("phonemes")
    p.add_argument("text")
    p.add_argument("--voice", default="am_michael")
    p.add_argument("--lexicon")
    s = sub.add_parser("synth")
    s.add_argument("lines")
    s.add_argument("--out", required=True)
    s.add_argument("--voice", default="am_michael")
    s.add_argument("--speed", type=float, default=1.0)
    s.add_argument("--lexicon")
    s.add_argument("--only", nargs="*")
    a = sub.add_parser("audition")
    a.add_argument("text")
    a.add_argument("--voices", required=True)
    a.add_argument("--speed", type=float, default=1.0)
    a.add_argument("--out", required=True)
    a.add_argument("--lexicon")
    args = ap.parse_args()
    lex = load_lexicon(getattr(args, "lexicon", None))

    if args.cmd == "phonemes":
        print(phonemize(args.text, lang_for(args.voice), lex))
        return

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = []
    if args.cmd == "synth":
        lines = json.loads(Path(args.lines).read_text(encoding="utf-8"))
        for line in lines:
            if args.only and line["id"] not in args.only:
                continue
            voice = line.get("voice", args.voice)
            speed = float(line.get("speed", args.speed))
            x, ph = synth(line["text"], voice, speed, lex, line.get("phonemes"))
            sf.write(out / f"{line['id']}.wav", x, SR_OUT, subtype="FLOAT")
            r = {"id": line["id"], "text": line["text"], "voice": voice, "speed": speed, "phonemes": ph, **stats(x)}
            report.append(r)
            print(f"{r['id']:<8} {r['duration']:6.2f}s  {voice:<24} {line['text']}")
    else:
        for voice in args.voices.split(","):
            x, ph = synth(args.text, voice, args.speed, lex)
            name = voice.replace(":", "-").replace("+", "_")
            sf.write(out / f"{name}.wav", x, SR_OUT, subtype="FLOAT")
            r = {"voice": voice, "phonemes": ph, **stats(x)}
            report.append(r)
            print(f"{voice:<28} {r['duration']:6.2f}s")
    (out / "voice-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
