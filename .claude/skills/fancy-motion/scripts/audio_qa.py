"""Audio checks for /fancy-motion: what a listener would notice, measured.

  transcribe  <wav...> [--model small.en]        word-timed transcript (faster-whisper)
  audition    <dir> --text "<script>"            rank narrator takes: WER, rate, pitch movement
  mix         <wav or mp4> [--voice vo.wav]      loudness (EBU R128 via ffmpeg), true peak,
                                                  mono fold-down loss, voice-vs-bed level under speech
  cues        <wav or mp4> --manifest m.json     momentary loudness (400 ms, K-weighted) of the mix at
                                                  every sound cue vs the speech: which effects jump out

The numbers support judgement; they do not replace it. Author: Awaiz Ahmed.
Run: uv run --project <skill>/scripts --group qa python <skill>/scripts/audio_qa.py ...
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal


def norm_words(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"[^a-z0-9' ]+", " ", s)
    return [w for w in s.split() if w]


def wer(ref, hyp):
    r, h = norm_words(ref), norm_words(hyp)
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=int)
    d[:, 0] = np.arange(len(r) + 1)
    d[0, :] = np.arange(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(r), len(h)] / max(1, len(r))


_models = {}


def whisper(model_name):
    if model_name not in _models:
        from faster_whisper import WhisperModel
        _models[model_name] = WhisperModel(model_name, device="cpu", compute_type="int8")
    return _models[model_name]


def load16k(path):
    """Decode with soundfile (faster-whisper's own PyAV decoder breaks on newer PyAV)."""
    x, sr = sf.read(str(path), dtype="float32")
    x = mono(x)
    if sr != 16000:
        g = np.gcd(16000, sr)
        x = signal.resample_poly(x, 16000 // g, sr // g)
    return x.astype(np.float32)


def transcribe(path, model_name="small.en", prompt=None):
    model = whisper(model_name)
    audio = load16k(path)

    def run(word_timestamps):
        segs, _ = model.transcribe(audio, beam_size=5, word_timestamps=word_timestamps, initial_prompt=prompt,
                                   vad_filter=False, condition_on_previous_text=False)
        words, text = [], []
        for s in segs:
            text.append(s.text.strip())
            for w in s.words or []:
                words.append({"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 3)})
        return {"text": " ".join(text), "words": words}

    try:
        return run(True)
    except IndexError:
        # faster-whisper's word alignment can fail on a segment with no aligned tokens (seen on a
        # cut's music-only tail); the text is what WER needs, so fall back to it without word times
        return {**run(False), "words_unavailable": "faster-whisper alignment error"}


def mono(x):
    return x.mean(1) if x.ndim == 2 else x


def yin_f0(x, sr, fmin=60, fmax=400, frame=0.04, hop=0.01, thresh=0.12):
    """Plain YIN. Returns f0 per hop (nan where unvoiced)."""
    x = mono(x).astype(np.float64)
    if sr != 16000:
        g = np.gcd(16000, sr)
        x = signal.resample_poly(x, 16000 // g, sr // g)
        sr = 16000
    n, h = int(frame * sr), int(hop * sr)
    tmin, tmax = int(sr / fmax), int(sr / fmin)
    out = []
    for i in range(0, len(x) - n - tmax, h):
        w = x[i:i + n + tmax]
        if np.sqrt(np.mean(w[:n] ** 2)) < 0.01:
            out.append(np.nan)
            continue
        d = np.array([np.sum((w[:n] - w[t:t + n]) ** 2) for t in range(tmax + 1)])
        cmnd = d.copy()
        cmnd[1:] = d[1:] * np.arange(1, tmax + 1) / np.maximum(np.cumsum(d[1:]), 1e-12)
        cmnd[0] = 1
        cand = np.where(cmnd[tmin:] < thresh)[0]
        if len(cand) == 0:
            out.append(np.nan)
            continue
        t = cand[0] + tmin
        while t + 1 < len(cmnd) and cmnd[t + 1] < cmnd[t]:
            t += 1
        out.append(sr / t)
    return np.array(out)


def pitch_stats(x, sr):
    f0 = yin_f0(x, sr)
    v = f0[~np.isnan(f0)]
    if len(v) < 10:
        return {"f0_median": None, "f0_spread_st": None, "voiced": 0.0}
    st = 12 * np.log2(v / np.median(v))
    return {"f0_median": round(float(np.median(v)), 1), "f0_spread_st": round(float(np.std(st)), 2),
            "voiced": round(len(v) / len(f0), 2)}


def ffmpeg_loudness(path):
    """Integrated loudness, LRA and true peak from ffmpeg's ebur128 filter (4x oversampled TP)."""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", "0:a:0",
                        "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    tail = p.stderr[p.stderr.rfind("Summary:"):]
    get = lambda pat: float(re.search(pat, tail).group(1)) if re.search(pat, tail) else None
    return {"integrated_lufs": get(r"I:\s+(-?[\d.]+) LUFS"), "lra_lu": get(r"LRA:\s+(-?[\d.]+) LU"),
            "true_peak_dbtp": get(r"Peak:\s+(-?[\d.]+) dBFS")}


def band_db(x, sr, lo, hi, mask=None):
    sos = signal.butter(4, [lo, hi], "band", fs=sr, output="sos")
    y = signal.sosfilt(sos, x)
    if mask is not None:
        y = y[mask]
    return 10 * np.log10(np.mean(y ** 2) + 1e-12)


def cmd_audition(args):
    rows = []
    for wav in sorted(Path(args.dir).glob("*.wav")):
        x, sr = sf.read(wav)
        t = transcribe(wav, args.model)
        words = len(norm_words(args.text))
        dur = len(x) / sr
        r = {"take": wav.stem, "wer": round(wer(args.text, t["text"]), 3), "words_per_s": round(words / dur, 2),
             **pitch_stats(x, sr), "heard": t["text"]}
        rows.append(r)
        print(f"{r['take']:<30} WER {r['wer']:.3f}  {r['words_per_s']:.2f} w/s  F0 {r['f0_median']} Hz  "
              f"spread {r['f0_spread_st']} st  | {r['heard']}")
    Path(args.dir, "audition-metrics.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")


def cmd_transcribe(args):
    res = {}
    for p in args.wavs:
        res[p] = transcribe(p, args.model, args.prompt)
        print(f"{p}: {res[p]['text']}")
    if args.json:
        Path(args.json).write_text(json.dumps(res, indent=2), encoding="utf-8")


def align_words(script_text, heard_words):
    """Give every script word a start/end from Whisper's words (sequence-aligned, gaps interpolated)."""
    import difflib
    sw = script_text.split()
    sn = [" ".join(norm_words(w)) for w in sw]
    hn = [" ".join(norm_words(w["text"])) for w in heard_words]
    times = [None] * len(sw)
    sm = difflib.SequenceMatcher(a=sn, b=hn, autojunk=False)
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            times[a + k] = (heard_words[b + k]["start"], heard_words[b + k]["end"])
    # unmatched script words: spread across the gap between their matched neighbours
    i = 0
    while i < len(sw):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(sw) and times[j] is None:
            j += 1
        lo = times[i - 1][1] if i > 0 else (heard_words[0]["start"] if heard_words else 0.0)
        hi = times[j][0] if j < len(sw) else (heard_words[-1]["end"] if heard_words else lo + 0.3 * (j - i))
        step = max(hi - lo, 0.05 * (j - i)) / (j - i)
        for k in range(i, j):
            times[k] = (round(lo + step * (k - i), 3), round(lo + step * (k - i + 1), 3))
        i = j
    return [{"w": w, "start": t[0], "end": t[1]} for w, t in zip(sw, times)]


def cmd_align(args):
    lines = json.loads(Path(args.lines).read_text(encoding="utf-8"))
    out, worst = {}, 0.0
    for line in lines:
        wav = Path(args.vo) / f"{line['id']}.wav"
        blind = transcribe(wav, args.model)                       # what a listener hears, no hints
        guided = transcribe(wav, args.model, prompt=line["text"])  # for timing only
        e = wer(line["text"], blind["text"])
        worst = max(worst, e)
        out[line["id"]] = {"text": line["text"], "heard": blind["text"], "wer": round(e, 3),
                           "words": align_words(line["text"], guided["words"])}
        flag = "  <-- check" if e > 0.2 else ""
        print(f"{line['id']:<6} WER {e:.2f}  heard: {blind['text']}{flag}")
    Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}; worst blind WER {worst:.2f}")


def cmd_mix(args):
    rep = {"file": args.file, **ffmpeg_loudness(args.file)}
    wav = args.file
    if not wav.lower().endswith(".wav"):
        tmp = Path(args.file).with_suffix(".qa.wav")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", args.file, "-map", "0:a:0", "-ac", "2",
                        "-ar", "48000", "-c:a", "pcm_f32le", str(tmp)], check=True)
        wav = str(tmp)
    x, sr = sf.read(wav)
    if wav != args.file:
        Path(wav).unlink(missing_ok=True)  # a decoded copy, not evidence
    if x.ndim == 2 and x.shape[1] == 2:
        L, R = x[:, 0], x[:, 1]
        st = 10 * np.log10(np.mean(L ** 2 + R ** 2) / 2 + 1e-12)
        mo = 10 * np.log10(np.mean(((L + R) / 2) ** 2) + 1e-12)
        rep["mono_folddown_loss_db"] = round(st - mo, 2)
        rep["lr_correlation"] = round(float(np.corrcoef(L, R)[0, 1]), 3)
    rep["clipped_samples"] = int(np.sum(np.abs(x) >= 0.999))
    if args.voice:
        v, vsr = sf.read(args.voice)
        v = mono(v)
        m = mono(x)
        n = min(len(v), len(m))
        env = np.convolve(np.abs(v[:n]), np.ones(int(0.05 * vsr)) / int(0.05 * vsr), mode="same")
        speech = env > 0.01
        bed = m[:n] - v[:n] * args.voice_gain
        rep["voice_minus_bed_db_300_4k"] = round(band_db(v[:n] * args.voice_gain, vsr, 300, 4000, speech) -
                                                  band_db(bed, vsr, 300, 4000, speech), 1)
    print(json.dumps(rep, indent=2))
    if args.json:
        Path(args.json).write_text(json.dumps(rep, indent=2), encoding="utf-8")


def to_wav(path):
    if path.lower().endswith(".wav"):
        return path
    tmp = Path(path).with_suffix(".qa.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-map", "0:a:0", "-ac", "2",
                    "-ar", "48000", "-c:a", "pcm_f32le", str(tmp)], check=True)
    return str(tmp)


def cmd_cues(args):
    """Momentary loudness (EBU 400 ms, K-weighted) of the finished mix at each sound cue, relative to
    the median momentary loudness of speech-only windows. A listener hears effects that sit several LU
    above the speech as jumping out; under the voice they should usually sit at or below it."""
    import pyloudnorm as pyln
    M = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    wav = to_wav(args.file)
    x, sr = sf.read(wav)
    if wav != args.file:
        Path(wav).unlink(missing_ok=True)  # a decoded copy, not evidence
    meter = pyln.Meter(sr, block_size=0.4)

    def mom(t0):
        a = int(max(0.0, t0) * sr)
        seg = x[a:a + int(0.4 * sr)]
        if len(seg) < int(0.4 * sr):
            return None
        with np.errstate(divide="ignore"):
            v = meter.integrated_loudness(seg)
        return float(v) if np.isfinite(v) else None

    cues = sorted(M.get("sfx", []), key=lambda c: c["t"])
    near_cue = lambda t: any(-0.6 < t - c["t"] < 1.0 for c in cues)
    speech = []
    for v in M.get("vo", []):
        t = v.get("start", v.get("at"))
        while t + 0.4 <= v["end"]:
            if not near_cue(t):
                m = mom(t)
                if m is not None:
                    speech.append(m)
            t += 0.1
    ref = float(np.median(speech)) if speech else None
    in_vo = lambda t: any(v.get("start", v.get("at")) - 0.05 <= t <= v["end"] + 0.05 for v in M.get("vo", []))
    rows = []
    for c in cues:
        ms = [m for m in (mom(c["t"] + d) for d in np.arange(-0.1, 0.45, 0.05)) if m is not None]
        if not ms:
            continue
        peak = max(ms)
        rows.append({"t": round(c["t"], 3), "kind": c["kind"], "momentary_lufs": round(peak, 1),
                     "over_speech_lu": round(peak - ref, 1) if ref is not None else None, "under_voice": in_vo(c["t"])})
    kinds = {}
    for r in rows:
        kinds.setdefault(r["kind"], []).append(r["over_speech_lu"])
    by_kind = {k: {"count": len(v), "median_over_speech_lu": round(float(np.median(v)), 1), "max_over_speech_lu": round(float(max(v)), 1)}
               for k, v in sorted(kinds.items(), key=lambda kv: -max(kv[1]))}
    rep = {"file": args.file, "speech_momentary_median_lufs": round(ref, 1) if ref is not None else None,
           "speech_windows": len(speech), "threshold_lu": args.threshold,
           "jumping_out": [r for r in rows if r["over_speech_lu"] is not None and r["over_speech_lu"] > args.threshold],
           "by_kind": by_kind, "cues": rows}
    print(json.dumps({k: rep[k] for k in ("speech_momentary_median_lufs", "speech_windows", "by_kind")}, indent=2))
    print(f"{len(rep['jumping_out'])} of {len(rows)} cues exceed the speech by > {args.threshold} LU")
    if args.json:
        Path(args.json).write_text(json.dumps(rep, indent=2), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("audition")
    a.add_argument("dir")
    a.add_argument("--text", required=True)
    a.add_argument("--model", default="small.en")
    t = sub.add_parser("transcribe")
    t.add_argument("wavs", nargs="+")
    t.add_argument("--model", default="small.en")
    t.add_argument("--prompt")
    t.add_argument("--json")
    al = sub.add_parser("align")
    al.add_argument("lines")
    al.add_argument("--vo", required=True)
    al.add_argument("--out", required=True)
    al.add_argument("--model", default="small.en")
    m = sub.add_parser("mix")
    m.add_argument("file")
    m.add_argument("--voice")
    m.add_argument("--voice-gain", type=float, default=1.0)
    m.add_argument("--json")
    cu = sub.add_parser("cues")
    cu.add_argument("file")
    cu.add_argument("--manifest", required=True)
    cu.add_argument("--threshold", type=float, default=3.0)
    cu.add_argument("--json")
    args = ap.parse_args()
    {"audition": cmd_audition, "transcribe": cmd_transcribe, "align": cmd_align, "mix": cmd_mix, "cues": cmd_cues}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
