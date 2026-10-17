"""Synthesis and mixing building blocks for /fancy-motion scores (author: Awaiz Ahmed).

Adapted from the original-score engine written for the user's DISSECT film (made with /brag,
audio-src/score.py): band-limited oscillators, filters, convolution reverbs, instruments, and a
voice-aware mix with ducking, compression and a look-ahead limiter. Generalised here: a seeded
RNG object instead of a module global, true-peak (4x oversampled) limiting, and helpers that
score.py drives from a manifest. Everything is deterministic for a given seed.
"""
import math

import numpy as np
from scipy import signal
from scipy.ndimage import maximum_filter1d

SR = 48000


class Synth:
    def __init__(self, seed=20261017, sr=SR):
        self.sr = sr
        self.rng = np.random.default_rng(seed)

    # ------------------------------------------------------------ basics
    def secs(self, n):
        return np.arange(n) / self.sr

    def place(self, buf, t, x, gain=1.0, pan=0.0):
        """Add mono or stereo x into buf at time t (constant-power pan, unity at centre)."""
        if x.ndim == 1:
            a = (pan + 1) * math.pi / 4
            x = np.stack([x * math.cos(a), x * math.sin(a)], 1) * math.sqrt(2)
        i = int(round(t * self.sr))
        j0, j1 = max(0, i), min(len(buf), i + len(x))
        if j1 > j0:
            buf[j0:j1] += gain * x[j0 - i:j1 - i]

    def saw(self, freq, n, phase=None):
        f = np.broadcast_to(np.asarray(freq, float), (n,)).copy()
        dt = f / self.sr
        ph = (np.cumsum(dt) + (self.rng.random() if phase is None else phase)) % 1.0
        y = 2 * ph - 1
        m = ph < dt
        x = ph[m] / dt[m]
        y[m] -= x + x - x * x - 1
        m = ph > 1 - dt
        x = (ph[m] - 1) / dt[m]
        y[m] -= x * x + x + x + 1
        return y

    def sine(self, freq, n, phase=0.0):
        f = np.broadcast_to(np.asarray(freq, float), (n,))
        return np.sin(2 * np.pi * np.cumsum(f) / self.sr + phase)

    def tri(self, freq, n):
        s = self.saw(freq, n, 0.0)
        return 2 * np.abs(s) - 1

    def noise(self, n, ch=1):
        return self.rng.standard_normal((n, ch) if ch > 1 else n)

    def filt(self, x, kind, fc, order=2):
        return signal.sosfilt(signal.butter(order, fc, kind, fs=self.sr, output="sos"), x, axis=0)

    LP_BANDS = [120, 240, 480, 960, 1920, 3840, 7680, 15000]

    def lp_sweep(self, x, cutoff):
        """Time-varying low-pass: crossfades fixed low-passes an octave apart."""
        cutoff = np.broadcast_to(np.asarray(cutoff, float), (len(x),))
        lc = np.log2(np.clip(cutoff, self.LP_BANDS[0], self.LP_BANDS[-1]) / self.LP_BANDS[0])
        out = np.zeros_like(x)
        for k, fc in enumerate(self.LP_BANDS):
            w = np.clip(1 - np.abs(lc - k), 0, 1)
            if w.max() <= 0:
                continue
            y = self.filt(x, "low", fc)
            out += y * (w[:, None] if x.ndim == 2 else w)
        return out

    def env_ar(self, n, attack, release_start, release, curve=2.0):
        t = self.secs(n)
        e = np.ones(n)
        if attack > 0:
            a = t < attack
            e[a] = 0.5 - 0.5 * np.cos(np.pi * t[a] / attack)
        r = t >= release_start
        e[r] *= np.clip(1 - (t[r] - release_start) / max(release, 1e-3), 0, 1) ** curve
        return e

    @staticmethod
    def soft_clip(x, drive=1.0):
        return np.tanh(x * drive) / np.tanh(drive)

    @staticmethod
    def mtof(m):
        return 440.0 * 2 ** ((np.asarray(m, float) - 69) / 12)

    # ------------------------------------------------------------ space
    def make_ir(self, rt60, pre=0.02, bright=0.5, seed=1):
        r = np.random.default_rng(seed)
        L = int(rt60 * 1.15 * self.sr)
        t = self.secs(L)
        ir = r.standard_normal((L, 2))
        dark = self.filt(ir, "low", 1800)
        mix = np.clip(t / (rt60 * (0.25 + 0.5 * bright)), 0, 1)[:, None]
        ir = ir * (1 - mix) + dark * mix
        ir *= (10 ** (-3 * t / rt60))[:, None]
        ir[: int(pre * self.sr)] = 0
        ir = self.filt(ir, "high", 90)
        return ir / np.sqrt((ir ** 2).sum(0, keepdims=True))

    @staticmethod
    def reverb(x, ir):
        return np.stack([signal.oaconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)

    def pingpong(self, x, delay, feedback=0.35, mix=0.3, taps=6):
        d = int(delay * self.sr)
        y = np.zeros_like(x)
        g = 1.0
        for k in range(1, taps + 1):
            g *= feedback
            sh = d * k
            if sh >= len(x):
                break
            ch = k % 2
            y[sh:, ch] += x[: len(x) - sh, 0 if ch else 1] * g
        return x + self.filt(y, "low", 3500) * mix

    # ------------------------------------------------------------ instruments
    def supersaw(self, midi, dur, voices=5, detune=10.0, attack=1.0, release=2.0, cutoff=1400, amp=0.1):
        n = int((dur + release) * self.sr)
        f0 = float(self.mtof(midi))
        t = self.secs(n)
        out = np.zeros((n, 2))
        for v in range(voices):
            c = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
            drift = 1 + 0.0012 * np.sin(2 * np.pi * (0.07 + 0.09 * self.rng.random()) * t + self.rng.random() * 6.3)
            y = self.saw(f0 * 2 ** (c / 1200) * drift, n)
            pan = -0.8 + 1.6 * v / (voices - 1)
            a = (pan + 1) * math.pi / 4
            out[:, 0] += y * math.cos(a)
            out[:, 1] += y * math.sin(a)
        out = self.lp_sweep(out, np.broadcast_to(np.asarray(cutoff, float), (n,)))
        out = self.filt(out, "high", 70)
        e = self.env_ar(n, attack, dur, release, curve=1.6)
        return out * e[:, None] * amp / voices

    def pluck(self, midi, bright, amp=0.2, length=0.32):
        n = int(length * self.sr)
        f = float(self.mtof(midi))
        t = self.secs(n)
        y = 0.65 * self.saw(f, n) + 0.35 * self.saw(f * 1.006, n) + 0.25 * self.sine(f / 2, n)
        e = np.exp(-t / 0.09)
        y = self.lp_sweep(y, 300 + (900 + 3800 * bright) * np.exp(-t / 0.06))
        return y * e * np.clip(t / 0.003, 0, 1) * amp

    def bass_note(self, midi, dur, amp=0.22, cutoff=260):
        n = int((dur + 0.08) * self.sr)
        f = float(self.mtof(midi))
        y = 0.7 * self.saw(f, n) + 0.5 * self.sine(f, n) + 0.3 * self.sine(f / 2, n)
        y = self.soft_clip(self.filt(y, "low", cutoff, 3), 1.6)
        return y * self.env_ar(n, 0.015, dur, 0.08, curve=1) * amp

    def kick(self, amp=0.9):
        n = int(0.5 * self.sr)
        t = self.secs(n)
        f = 48 + 100 * np.exp(-t / 0.03)
        body = self.sine(f, n) * np.exp(-t / 0.2)
        click = self.filt(self.noise(n), "high", 2500) * np.exp(-t / 0.004) * 0.15
        return self.soft_clip((body + click) * amp, 1.2)

    def clap(self, amp=0.35):
        n = int(0.35 * self.sr)
        t = self.secs(n)
        burst = np.zeros(n)
        for k, d in enumerate((0.0, 0.011, 0.023)):
            i = int(d * self.sr)
            burst[i:] += np.exp(-(t[: n - i]) / (0.006 if k < 2 else 0.12))
        y = self.filt(self.noise(n), "band", [900, 5200]) * burst
        return y * amp

    def hat(self, amp=0.08, length=0.045):
        n = int(0.18 * self.sr)
        t = self.secs(n)
        return self.filt(self.noise(n), "high", 7000) * np.exp(-t / length) * amp

    def bell(self, midi, amp=0.18, length=3.0, ratio=3.5, index=2.0):
        n = int(length * self.sr)
        t = self.secs(n)
        f = float(self.mtof(midi))
        mod = self.sine(f * ratio, n) * index * np.exp(-t / 0.5)
        y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 1.1)
        y += 0.3 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t / 0.5)
        return y * np.clip(t / 0.002, 0, 1) * amp

    def impact(self, size=1.0, amp=0.6):
        n = int((1.2 + 2.0 * size) * self.sr)
        t = self.secs(n)
        boom = self.sine(34 + 64 * np.exp(-t / (0.05 + 0.04 * size)), n) * np.exp(-t / (0.45 + 1.1 * size))
        body = self.filt(self.noise(n), "low", 500) * np.exp(-t / 0.2) * 0.4
        crack = self.filt(self.noise(n), "band", [400, 3000]) * np.exp(-t / 0.02) * 0.25
        return self.soft_clip((boom * 1.2 + body + crack) * amp, 1.4)

    def riser(self, length, amp=0.3):
        n = int(length * self.sr)
        t = self.secs(n)
        k = t / length
        y = self.lp_sweep(self.noise(n, 2), 300 * 2 ** (5.5 * k)) * (k ** 2.2)[:, None] * 0.55
        tone = self.sine(110 * 2 ** (3.0 * k), n) * k ** 3 * 0.3
        y += np.stack([tone, tone * 0.92], 1)
        y[-int(0.01 * self.sr):] *= np.linspace(1, 0, int(0.01 * self.sr))[:, None]
        return y * amp

    def whoosh(self, length=0.55, amp=0.2, direction=1):
        n = int(length * self.sr)
        k = self.secs(n) / length
        shape = np.sin(np.pi * k) ** 1.8
        y = self.lp_sweep(self.noise(n), 400 + 5000 * np.sin(np.pi * k) ** 2)
        y = self.filt(y, "high", 220) * shape
        pan = (-0.7 + 1.4 * k) * direction
        a = (pan + 1) * np.pi / 4
        return np.stack([y * np.cos(a), y * np.sin(a)], 1) * math.sqrt(2) * amp

    def tick(self, amp=0.12, freq=2900):
        n = int(0.07 * self.sr)
        t = self.secs(n)
        y = self.filt(self.noise(n), "band", [2200, 6500]) * np.exp(-t / 0.006)
        y += np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.012) * 0.35
        return y * amp

    def pop(self, amp=0.22, f0=700, f1=240):
        n = int(0.16 * self.sr)
        t = self.secs(n)
        f = f1 + (f0 - f1) * np.exp(-t / 0.025)
        return self.sine(f, n) * np.exp(-t / 0.05) * np.clip(t / 0.002, 0, 1) * amp

    def knock(self, amp=0.16, freq=420):
        n = int(0.18 * self.sr)
        t = self.secs(n)
        y = self.filt(self.noise(n), "band", [freq * 0.8, freq * 1.25]) * np.exp(-t / 0.03) * 3
        y += self.sine(freq, n) * np.exp(-t / 0.04) * 0.5
        return y * amp

    def paper(self, length=0.4, amp=0.12):
        n = int(length * self.sr)
        t = self.secs(n)
        flutter = 0.55 + 0.45 * np.abs(np.sin(2 * np.pi * 23 * t + 3 * np.sin(2 * np.pi * 5 * t)))
        env = np.sin(np.pi * np.clip(t / length, 0, 1)) ** 1.4
        y = self.filt(self.noise(n), "band", [1800, 7000]) * flutter * env
        return y * amp

    def boing(self, amp=0.16):
        n = int(0.42 * self.sr)
        t = self.secs(n)
        f = 330 * (1 + 0.6 * np.sin(np.pi * np.clip(t / 0.3, 0, 1)))
        return self.tri(f, n) * np.exp(-t / 0.14) * amp

    def blips(self, length, amp=0.07, rate=26, lo=60, hi=88, seed=3):
        """Granular square blips (pixel dissolve)."""
        r = np.random.default_rng(seed)
        n = int(length * self.sr)
        out = np.zeros((n, 2))
        k = int(rate * length)
        for i in range(k):
            t0 = r.uniform(0, length - 0.05)
            m = r.integers(lo, hi)
            g = int(0.035 * self.sr)
            tt = self.secs(g)
            sq = np.sign(np.sin(2 * np.pi * self.mtof(m) * tt)) * np.exp(-tt / 0.012) * 0.6
            self.place(out, t0, self.filt(sq, "low", 6000), gain=amp * r.uniform(0.6, 1.0), pan=r.uniform(-0.6, 0.6))
        return out

    def scribble(self, length, amp=0.07):
        n = int(length * self.sr)
        t = self.secs(n)
        am = 0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 11 * t + 2 * np.sin(2 * np.pi * 1.7 * t)))
        y = self.filt(self.noise(n), "band", [2500, 6000]) * am * np.clip(t / 0.05, 0, 1) * np.clip((length - t) / 0.08, 0, 1)
        return y * amp

    def air(self, length, amp=0.14):
        n = int(length * self.sr)
        k = self.secs(n) / length
        shape = np.sin(np.pi * k) ** 1.2
        y = self.lp_sweep(self.noise(n, 2), 300 + 2400 * np.sin(np.pi * k) ** 1.5)
        return self.filt(y, "high", 120) * shape[:, None] * amp

    def shimmer(self, length, amp=0.06, seed=5):
        r = np.random.default_rng(seed)
        n = int(length * self.sr)
        out = np.zeros((n, 2))
        for i in range(int(length * 14)):
            t0 = r.uniform(0, max(0.01, length - 0.6))
            self.place(out, t0, self.bell(int(r.choice([86, 88, 90, 93, 95])), amp=1.0, length=0.8, ratio=2.7, index=0.8), gain=amp * r.uniform(0.4, 1.0), pan=r.uniform(-0.7, 0.7))
        return out


# ---------------------------------------------------------------- mix helpers
def compress(x, sr=SR, thresh_db=-18, ratio=2.5, attack=0.01, release=0.2):
    lvl = np.sqrt(signal.convolve((x ** 2).mean(1), np.ones(int(0.01 * sr)) / int(0.01 * sr), mode="same")) + 1e-9
    db = 20 * np.log10(lvl)
    over = np.maximum(db - thresh_db, 0)
    gr = over - over / ratio
    sm = np.empty_like(gr)
    g, aa, ar = 0.0, math.exp(-1 / (attack * sr)), math.exp(-1 / (release * sr))
    for i in range(0, len(gr), 32):
        tgt = gr[i]
        g = tgt + (g - tgt) * (aa ** 32 if tgt > g else ar ** 32)
        sm[i:i + 32] = g
    return x * (10 ** (-sm / 20))[:, None]


def true_peak(x, sr=SR):
    """4x-oversampled peak (dBTP estimate, as ITU-R BS.1770 recommends)."""
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.abs(up).max() + 1e-12)


def limit_true_peak(x, sr=SR, ceiling_db=-1.0, look=0.005, release=0.08):
    """Look-ahead limiter driven by the 4x-oversampled envelope, so inter-sample peaks stay under the ceiling."""
    ceiling = 10 ** (ceiling_db / 20)
    up = np.abs(signal.resample_poly(x, 4, 1, axis=0)).max(1)
    env = up.reshape(-1, 4).max(1) if len(up) % 4 == 0 else np.pad(up, (0, (-len(up)) % 4)).reshape(-1, 4).max(1)
    env = env[: len(x)]
    la = int(look * sr)
    peak = maximum_filter1d(env, size=2 * la + 1, origin=0)
    g = np.minimum(1, ceiling / np.maximum(peak, 1e-9))
    sm = np.empty_like(g)
    cur, ar = 1.0, math.exp(-1 / (release * sr))
    for i in range(0, len(g), 16):
        tgt = g[i:i + 16].min()
        cur = tgt if tgt < cur else tgt + (cur - tgt) * ar ** 16
        sm[i:i + 16] = cur
    return x * sm[:, None]
