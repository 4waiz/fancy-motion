"""Original score, sound design and final mix for a /fancy-motion film, driven by its manifest.

Reads manifest.json (music sections with energy, sound cues, narration placement) and writes:
  assets/audio/soundtrack.wav   48 kHz / 24-bit stereo, exactly `duration` seconds
  audio/stems/{music,sfx,voice}.wav   pre-master stems at mix level (float)
  audio/mix-report.json         loudness, true peak, voice-vs-bed, per-kind effect levels

  uv run --project <skill>/scripts python <skill>/scripts/score.py <project> [--manifest manifest.json]
        [--sfx-db 0] [--music-db 0] [--duck-db 10] [--fx-duck-db 3] [--lufs -14] [--tp -1.0]
        [--codec-headroom 1.0] [--seed 20261017]

A variant manifest (e.g. a cut with an edit list) carries its own `soundtrack` path and a `variant`
name; its stems and mix report are written beside the film's with that suffix (audio/stems-p60/,
audio/mix-report-p60.json) so every variant keeps its own measurements.

Reuses /brag's CC0 assets in place (keypress set, Kenney click_003, card-slide-1) when /brag is
installed; otherwise every effect is synthesized. Author: Awaiz Ahmed. Engine adapted from the
DISSECT score (see score_engine.py).
"""
import argparse
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from score_engine import SR, Synth, compress, limit_true_peak, true_peak  # noqa: E402

KEYS = {"C": -2, "C#": -1, "Db": -1, "D": 0, "D#": 1, "Eb": 1, "E": 2, "F": 3, "F#": 4, "Gb": 4, "G": 5, "G#": -6, "Ab": -6, "A": -5, "A#": -4, "Bb": -4, "B": -3}
# D-major voicings (transposed by the key offset): I maj9, vi m7, IV maj7#11, V add9
CHORDS = {"I": [50, 54, 57, 61, 64], "vi": [47, 50, 54, 57, 62], "IV": [43, 50, 54, 59, 61], "V": [45, 52, 57, 59, 61]}
ROOTS = {"I": 38, "vi": 35, "IV": 31, "V": 33}
PROG = ["I", "vi", "IV", "V"]
MOTIF = [(0.0, 78), (0.5, 81), (1.0, 83), (2.0, 81), (3.0, 76)]


def find_brag_sfx():
    home = Path(os.path.expanduser("~"))
    for d in [Path.cwd() / ".claude/skills/brag", home / ".claude/skills/brag"]:
        if (d / "assets/sfx").exists():
            return d / "assets/sfx"
    return None


def load_mono(path, sr=SR):
    x, r = sf.read(str(path), dtype="float64")
    if x.ndim == 2:
        x = x.mean(1)
    if r != sr:
        g = math.gcd(sr, r)
        x = signal.resample_poly(x, sr // g, r // g)
    return x


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    # mix settings: CLI flag > manifest "mix" block > default (so the manifest alone reproduces a mix)
    ap.add_argument("--sfx-db", type=float)
    ap.add_argument("--music-db", type=float)
    ap.add_argument("--duck-db", type=float)
    ap.add_argument("--fx-duck-db", type=float)  # effects dip under the voice too
    ap.add_argument("--lufs", type=float)
    ap.add_argument("--tp", type=float)
    # AAC (and most lossy codecs) overshoot the source's true peak on transients — this film's v1
    # measured -1.2 dBTP in the WAV and -0.1 dBTP after AAC 320k. Master below the delivery ceiling.
    ap.add_argument("--codec-headroom", type=float)
    ap.add_argument("--seed", type=int, default=20261017)
    ap.add_argument("--manifest", default="manifest.json")
    ap.add_argument("--out")  # default: the manifest's soundtrack, else assets/audio/soundtrack.wav
    a = ap.parse_args()

    P = Path(a.project).resolve()
    M = json.loads((P / a.manifest).read_text(encoding="utf-8"))
    variant = M.get("variant")
    suffix = f"-{variant}" if variant and variant not in ("landscape", "portrait") else ""
    a.out = a.out or M.get("soundtrack") or "assets/audio/soundtrack.wav"
    mixcfg = M.get("mix", {})
    for attr, key, dflt in (("sfx_db", "sfxDb", 0.0), ("music_db", "musicDb", 0.0), ("duck_db", "duckDb", 10.0),
                            ("fx_duck_db", "fxDuckDb", 3.0), ("lufs", "lufs", -14.0), ("tp", "truePeak", -1.0),
                            ("codec_headroom", "codecHeadroomDb", 1.0)):
        if getattr(a, attr) is None:
            setattr(a, attr, float(mixcfg.get(key, dflt)))
    mus = M.get("music", {})
    DUR = float(M["duration"])
    N = int(round(DUR * SR))
    S = Synth(a.seed)
    BEAT = 60 / mus.get("bpm", 120)
    BAR = 4 * BEAT
    key = KEYS.get(str(mus.get("key", "D")).split()[0], 0)
    sections = mus.get("sections", [{"from": 0, "to": DUR, "energy": 0.5, "name": "body"}])
    # music end: the manifest's own (a cut sets music.end in cut time), else the scene beat, else 0.4 s early
    music_end = mus.get("end") or next((s["beats"].get("musicEnd") for s in M["scenes"] if "musicEnd" in s.get("beats", {})), DUR - 0.4)

    def energy(t):
        for s in sections:
            if s["from"] <= t < s["to"]:
                return s["energy"]
        return sections[-1]["energy"]

    def section(t):
        for s in sections:
            if s["from"] <= t < s["to"]:
                return s
        return sections[-1]

    pads = np.zeros((N + SR * 6, 2))
    pulse = np.zeros_like(pads)
    bass = np.zeros_like(pads)
    drums = np.zeros_like(pads)
    bells = np.zeros_like(pads)
    fx = np.zeros_like(pads)
    T = lambda m: m + key  # noqa: E731

    # ------------------------------------------------ harmony: I–vi–IV–V, two bars per chord; resolve on I
    resolve = next((s for s in sections if s["name"] == "resolve"), None)
    t, k = 0.0, 0
    blocks = []
    while t < DUR - 1e-6:
        if resolve and t >= resolve["from"] - 1e-6:
            blocks.append((t, music_end + 0.2, "I"))
            break
        end = min(t + 2 * BAR, DUR, resolve["from"] if resolve and t < resolve["from"] else DUR)
        blocks.append((t, end, PROG[k % 4]))
        t, k = end, k + 1
    print(f"score: {len(blocks)} chord blocks, {mus.get('bpm', 120)} BPM, key offset {key}")
    for (b0, b1, name) in blocks:
        E = energy(b0)
        last = b1 >= music_end
        for m in CHORDS[name]:
            S.place(pads, b0, S.supersaw(T(m), b1 - b0 + 0.2, attack=1.6 if b0 < 7 else 0.5, release=3.5 if last else 1.4, cutoff=500 + 2300 * E, amp=0.05 + 0.035 * E))
        if E >= 0.7 and not last:
            S.place(pads, b0, S.supersaw(T(CHORDS[name][-1] + 12), b1 - b0 + 0.2, voices=3, attack=0.6, release=1.2, cutoff=3400, amp=0.016))

    # intro drone and the plucked wonder motif
    n = int(9 * SR)
    tt = S.secs(n)
    drone = (S.sine(S.mtof(T(38)), n) * 0.45 + S.sine(S.mtof(T(50)), n) * 0.2 + S.filt(S.noise(n), "low", 150) * 0.15)
    drone *= np.clip(tt / 2.5, 0, 1) * np.clip((9 - tt) / 2.5, 0, 1)
    S.place(pads, 0.0, S.soft_clip(drone, 1.1) * 0.22)
    for i, (bt, m) in enumerate([(0.5, 78), (1.5, 81), (2.5, 83), (4.5, 81), (5.5, 76), (6.5, 74)]):
        S.place(bells, bt, S.pluck(T(m), 0.35, amp=0.28, length=0.9), pan=-0.3 + 0.12 * i)

    # ------------------------------------------------ rhythm section by energy
    step = BEAT / 4
    i = 0
    t = 0.0
    while t < music_end - BAR / 2:
        E = energy(t)
        name = next(n for (b0, b1, n) in blocks if b0 <= t < b1) if any(b0 <= t < b1 for (b0, b1, _) in blocks) else "I"
        chord = [T(m) for m in CHORDS[name]]
        beat_pos = int(round(t / BEAT)) % 4
        sixteenth = i % 4
        # pluck arpeggio: 8ths ≥ 0.35, 16ths ≥ 0.7
        if (E >= 0.7) or (E >= 0.35 and sixteenth % 2 == 0):
            tones = chord[1:] + [chord[1] + 12]
            m = tones[(i // (1 if E >= 0.7 else 2)) % len(tones)] + 12
            vel = (1.0 if sixteenth == 0 else 0.7) * (0.3 + 0.4 * E)
            S.place(pulse, t, S.pluck(m, 0.2 + 0.6 * E, amp=vel), pan=0.25 if i % 2 else -0.25)
        if sixteenth == 0:
            if E >= 0.45 and t >= 7:
                S.place(bass, t, S.bass_note(T(ROOTS[name]), BEAT * 0.45, amp=0.17))
                S.place(bass, t + BEAT / 2, S.bass_note(T(ROOTS[name]), BEAT * 0.4, amp=0.11))
            if E >= 0.7 or (E >= 0.5 and beat_pos in (0, 2)):
                S.place(drums, t, S.kick(0.62 if E >= 0.7 else 0.5))
            if E >= 0.72 and beat_pos in (1, 3):
                S.place(drums, t, S.clap(0.24), pan=0.05)
        if E >= 0.6 and sixteenth == 2:
            S.place(drums, t, S.hat(0.05), pan=0.3)
        if E >= 0.8 and sixteenth in (1, 3):
            S.place(drums, t, S.hat(0.028, 0.03), pan=0.35)
        t += step
        i += 1
    pulse = S.pingpong(pulse, BEAT * 0.75, feedback=0.32, mix=0.3)

    # bells on lifts, risers into energy jumps
    prev = None
    for s in sections:
        if prev is not None and s["energy"] - prev["energy"] >= 0.2:
            S.place(fx, max(0, s["from"] - BAR), S.riser(BAR, 0.12))
        if s["energy"] >= 0.5 and s["name"] in ("title", "demos", "payoff"):
            for bt, m in MOTIF:
                S.place(bells, s["from"] + bt * BEAT, S.bell(T(m), 0.085), pan=-0.3 + 0.1 * (m % 7))
        prev = s

    # optional deliberate music dips (e.g. while the narration says "pull the sound back")
    dip_gain = np.ones(len(pads))
    for d in mus.get("dips", []):
        i0, i1 = int(d["from"] * SR), int(d["to"] * SR)
        ramp = int(0.25 * SR)
        g = 10 ** (d["db"] / 20)
        dip_gain[i0:i1] = g
        dip_gain[max(0, i0 - ramp):i0] = np.linspace(1, g, i0 - max(0, i0 - ramp))
        dip_gain[i1:i1 + ramp] = np.linspace(g, 1, len(dip_gain[i1:i1 + ramp]))

    # ------------------------------------------------ sound design from the manifest's cues
    brag = find_brag_sfx()
    keys = [load_mono(p) for p in sorted((brag / "keyboard").glob("keypress-*.wav"))] if brag else []
    click = load_mono(brag / "interface/click_003.ogg") if brag and (brag / "interface/click_003.ogg").exists() else None
    card = load_mono(brag / "casino/card-slide-1.ogg") if brag and (brag / "casino/card-slide-1.ogg").exists() else None
    reused = {"keypress": len(keys), "click_003": click is not None, "card-slide-1": card is not None, "from": str(brag) if brag else None}
    rng = np.random.default_rng(a.seed + 7)
    G = {  # base gains per kind (linear), before --sfx-db
        "key": 0.22, "typing": 0.16, "glint": 0.1, "swell": 0.16, "click": 0.3, "pop": 0.2, "hit": 0.32, "build": 0.06, "tick": 0.08,
        "card": 0.2, "boing": 0.14, "whoosh": 0.14, "paper": 0.11, "uiclick": 0.34, "success": 0.09, "tone": 0.08, "drag": 0.05,
        "chime": 0.09, "shimmer": 0.06, "riser": 0.14, "thud": 0.5, "air": 0.12, "pixels": 0.07, "draw": 0.06, "fan": 0.16,
        "drop": 0.14, "signature": 0.22,
    }
    sfx_gain = 10 ** (a.sfx_db / 20)
    kinds = {}
    for c in M.get("sfx", []):
        t0, kind = float(c["t"]), c["kind"]
        g = G.get(kind, 0.1) * sfx_gain * float(c.get("gain", 1.0))
        L = float(c.get("len", 0.5))
        pan = float(rng.uniform(-0.25, 0.25))
        if kind == "key" and keys:
            x = keys[int(rng.integers(len(keys)))]
        elif kind == "typing" and keys:
            x = np.zeros(int((L + 0.3) * SR))
            for j in range(int(L * 14)):  # ~14 keys per second, slightly humanised
                kx = keys[int(rng.integers(len(keys)))]
                i0 = max(0, int((j / 14 + rng.uniform(-0.01, 0.01)) * SR))
                n_ = min(len(kx), len(x) - i0)
                x[i0:i0 + n_] += kx[:n_]
        elif kind == "uiclick":
            x = click if click is not None else S.tick(1.0, 1800)
        elif kind == "card":
            x = card if card is not None else S.paper(0.3, 1.0)
        elif kind == "fan":
            x = np.zeros(int(1.0 * SR))
            for j in range(5):
                y = card if card is not None else S.paper(0.25, 1.0)
                i0 = int(j * 0.12 * SR)
                x[i0:i0 + len(y)] += y[: len(x) - i0] * (0.7 + 0.3 * rng.random())
        elif kind == "glint" or kind == "chime" or kind == "tone":
            x = S.bell(T(86 if kind == "glint" else 81), 1.0, 2.0, 2.7, 1.2) + (S.bell(T(93), 0.6, 2.0, 3.1, 1.0) if kind == "glint" else 0)
        elif kind == "success":
            x = S.bell(T(81), 1.0, 1.6) + np.pad(S.bell(T(86), 0.9, 1.6), (int(0.11 * SR), 0))[: int(1.6 * SR)]
        elif kind == "swell":
            x = S.riser(L, 1.0) * np.linspace(1, 0.6, int(L * SR))[:, None]
        elif kind == "riser":
            x = S.riser(L, 1.0)
        elif kind == "click":  # a lamp switch: a dry tick with a small low thump
            x = np.zeros(int(0.2 * SR))
            tk = S.tick(1.0, 1400)
            pp = S.pop(0.5, 160, 80)
            x[: len(tk)] += tk
            x[: len(pp)] += pp
        elif kind == "pop":
            x = S.pop(1.0)
        elif kind == "hit":
            x = S.impact(float(c.get("size", 0.7)), 1.0)
        elif kind == "thud":
            x = S.impact(1.4, 1.0)
        elif kind == "build":
            x = S.blips(L, 1.0, rate=40, lo=72, hi=96, seed=int(t0 * 10))
        elif kind == "tick":
            x = S.tick(1.0)
        elif kind == "boing":
            x = S.boing(1.0)
        elif kind == "whoosh":
            x = S.whoosh(0.6, 1.0, int(c.get("dir", 1)))
        elif kind == "paper":
            x = S.paper(0.45, 1.0)
        elif kind == "drag":
            x = S.filt(S.noise(int(L * SR)), "band", [300, 1600]) * np.sin(np.pi * np.linspace(0, 1, int(L * SR))) ** 0.8 * 0.6
        elif kind == "shimmer":
            x = S.shimmer(L, 1.0, seed=int(t0))
        elif kind == "air":
            x = S.air(L, 1.0)
        elif kind == "pixels":
            x = S.blips(L, 1.0, seed=int(t0 * 7))
        elif kind == "draw":
            x = S.scribble(L, 1.0)
        elif kind == "drop":
            x = S.knock(1.0, 380 + 40 * rng.random())
        elif kind == "signature":
            x = np.zeros((int(4.5 * SR), 2))
            for j, m in enumerate([74, 78, 81, 85, 88]):
                S.place(x, j * 0.06, S.bell(T(m), 0.5, 4.0, 2.9, 0.9), pan=-0.4 + 0.2 * j)
            S.place(x, 0, S.impact(0.5, 0.5))
        else:
            x = S.tick(1.0)
        S.place(fx, t0, np.asarray(x, float), gain=g, pan=pan)
        kinds.setdefault(kind, []).append(t0)

    # ------------------------------------------------ narration
    vo = np.zeros_like(pads)
    active = np.zeros(len(pads))
    for v in M.get("vo", []):
        x = load_mono(P / v["file"])
        x = S.filt(x, "high", 80)
        x = x + 0.22 * S.filt(x, "band", [2600, 5800])
        voiced = np.abs(x) > 0.01
        rms = np.sqrt(np.mean(x[voiced] ** 2)) if voiced.any() else 1e-6
        x *= 0.1 / max(rms, 1e-6)
        S.place(vo, v["at"], x)
        i0 = int(v["at"] * SR)
        active[i0:i0 + len(x)] = np.maximum(active[i0:i0 + len(x)], (np.abs(x) > 0.004).astype(float))
    vo = compress(vo, thresh_db=-24, ratio=2.0, attack=0.005, release=0.12)
    vo += S.reverb(vo, S.make_ir(0.9, 0.01, 0.4, seed=5)) * 0.05

    # ducking envelope (fast attack, slower release)
    win = int(0.2 * SR)
    act = np.clip(signal.convolve(active, np.ones(win) / win, mode="same") * 3, 0, 1)
    duck = np.empty(len(act))
    g, aa, ar = 0.0, math.exp(-1 / (0.06 * SR)), math.exp(-1 / (0.45 * SR))
    for j in range(0, len(act), 64):
        tgt = act[j]
        g = tgt + (g - tgt) * ((aa if tgt > g else ar) ** 64)
        duck[j:j + 64] = g
    music_duck = 1 - (1 - 10 ** (-a.duck_db / 20)) * duck

    # ------------------------------------------------ mix + master
    music = pads + pulse * 0.85 + bass * 0.8 + bells
    music += S.reverb(pads * 0.4 + pulse * 0.25 + bells * 0.8, S.make_ir(3.6, 0.03, 0.6, seed=3)) * 0.32
    music += drums * 0.85 + S.reverb(drums, S.make_ir(1.2, 0.01, 0.5, seed=9)) * 0.08
    fx_mix = fx + S.reverb(fx, S.make_ir(2.2, 0.02, 0.8, seed=11)) * 0.18
    mid = S.filt(music, "band", [700, 4500])
    music = (music - 0.45 * mid * duck[:, None]) * music_duck[:, None] * dip_gain[:, None] * 10 ** (a.music_db / 20)
    fx_mix = fx_mix * (1 - (1 - 10 ** (-a.fx_duck_db / 20)) * duck)[:, None]
    music_bus, fx_bus, vo_bus = music * 0.78, fx_mix * 0.9, vo * 1.5
    mix = compress(music_bus + fx_bus + vo_bus, thresh_db=-16, ratio=2.0)
    # intentional ending: everything fades into silence by musicEnd
    fade = np.ones(len(mix))
    f0, f1 = int((music_end - 2.6) * SR), int(music_end * SR)
    fade[f0:f1] = np.linspace(1, 0, f1 - f0) ** 1.6
    fade[f1:] = 0
    fade[: int(0.01 * SR)] = np.linspace(0, 1, int(0.01 * SR))
    mix *= fade[:, None]
    mix = mix[:N]
    meter = pyln.Meter(SR)
    loud0 = meter.integrated_loudness(mix)
    mix *= 10 ** ((a.lufs - loud0) / 20)
    ceiling = a.tp - 0.2 - a.codec_headroom
    for _ in range(3):  # limit, then restore the loudness the limiter took (converges in 1-2 passes)
        mix = limit_true_peak(mix, ceiling_db=ceiling)
        lnow = meter.integrated_loudness(mix)
        if abs(lnow - a.lufs) < 0.08:
            break
        mix *= 10 ** ((a.lufs - lnow) / 20)
    tp = true_peak(mix)
    if tp > ceiling + 0.05:
        mix *= 10 ** ((ceiling - tp) / 20)
        tp = true_peak(mix)
    loud = meter.integrated_loudness(mix)

    out = P / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, mix.astype(np.float32), SR, subtype="PCM_24")
    stems = P / "audio" / f"stems{suffix}"
    stems.mkdir(parents=True, exist_ok=True)
    scale = 10 ** ((a.lufs - loud0) / 20)
    for nm, x in [("music", music_bus), ("sfx", fx_bus), ("voice", vo_bus)]:
        sf.write(stems / f"{nm}.wav", (x[:N] * fade[:N, None] * scale).astype(np.float32), SR, subtype="FLOAT")

    # ------------------------------------------------ report: what a listener would notice
    sp = active[:N] > 0
    band = lambda x, lo, hi: S.filt(x, "band", [lo, hi])  # noqa: E731
    lvl = lambda x: 10 * np.log10(np.mean(x[sp] ** 2) + 1e-12)  # noqa: E731
    vo_s, bed_s = vo_bus[:N] * scale, (music_bus[:N] + fx_bus[:N]) * scale
    voice_rms_db = 10 * np.log10(np.mean((vo_s[sp]) ** 2) + 1e-12)
    events = {}
    fxs = fx_bus[:N] * scale
    for kind, times in kinds.items():
        peaks = []
        for t0 in times:
            i0 = int(t0 * SR)
            seg_ = fxs[i0:i0 + int(0.4 * SR)]
            if len(seg_):
                peaks.append(20 * np.log10(np.abs(seg_).max() + 1e-12))
        events[kind] = {"count": len(times), "peak_dbfs_median": round(float(np.median(peaks)), 1), "peak_vs_voice_rms_db": round(float(np.median(peaks) - voice_rms_db), 1)}
    L, R = mix[:, 0], mix[:, 1]
    report = {
        "integrated_lufs": round(float(loud), 2),
        "true_peak_dbtp_est": round(float(tp), 2),
        "duration_s": round(len(mix) / SR, 4),
        "voice_vs_bed_db_full": round(float(lvl(vo_s) - lvl(bed_s)), 1),
        "voice_vs_bed_db_300_4k": round(float(lvl(band(vo_s, 300, 4000)) - lvl(band(bed_s, 300, 4000))), 1),
        "voice_rms_dbfs_in_speech": round(float(voice_rms_db), 1),
        "mono_folddown_loss_db": round(float(10 * np.log10(np.mean(L ** 2 + R ** 2) / 2 + 1e-12) - 10 * np.log10(np.mean(((L + R) / 2) ** 2) + 1e-12)), 2),
        "settings": {"sfx_db": a.sfx_db, "music_db": a.music_db, "duck_db": a.duck_db, "fx_duck_db": a.fx_duck_db, "lufs_target": a.lufs, "tp_ceiling": a.tp, "codec_headroom_db": a.codec_headroom, "master_ceiling_dbtp": round(a.tp - 0.2 - a.codec_headroom, 2), "seed": a.seed},
        "reused_from_brag": reused,
        "sfx_levels": events,
    }
    def clean(v):  # no speech → no voice figures (NaN is not valid JSON)
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()}
        return None if isinstance(v, float) and not math.isfinite(v) else v

    report = clean(report)
    (P / "audio" / f"mix-report{suffix}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ["integrated_lufs", "true_peak_dbtp_est", "duration_s", "voice_vs_bed_db_300_4k", "mono_folddown_loss_db"]}))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
