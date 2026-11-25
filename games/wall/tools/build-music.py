# The music: a lo-fi loop, written and played here (electric piano, bass, drums, vibes, a plucked string, tape and crackle).
#   python games/wall/tools/build-music.py        (numpy, ffmpeg), then `npm run audio` (GAME=wall)
# Everything's laid round a circle as long as the loop (tails run over its end into its beginning, filters and reverb too), so
# there's no seam. The file has some of the loop before and after it (PAD), and the game plays the part between (WallAudio).

import math
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44100
BPM = 76
BARS = 24
PAD = 0.25
BEAT = 60 / BPM
N = int(round(BARS * 4 * BEAT * SR))
HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "raw-assets" / "audio" / "music.mp3"
rng = np.random.default_rng(76)


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def track():
    return np.zeros((2, N))


def put(to, sound, at, gain=1.0, pan=0.0):
    """A sound (mono or stereo) from `at` (seconds), round the circle."""
    if sound.ndim == 1:
        a = (pan + 1) * math.pi / 4
        sound = np.stack([sound * math.cos(a), sound * math.sin(a)]) * math.sqrt(2)
    start = int(round(at * SR)) % N
    i = (start + np.arange(sound.shape[1])) % N
    np.add.at(to, (slice(None), i), sound * gain)


def swung(bar, beat):
    """Where a beat is, in seconds: the off eighths (and sixteenths) late."""
    eighth = beat * 2
    whole = math.floor(eighth + 1e-6)
    part = eighth - whole
    late = 0.0
    if whole % 2 == 1:
        late = 0.11 * (1 - part)
    if part > 0.2:
        late += 0.06
    return (bar * 4 + beat + late * 0.5) * BEAT


def human(amount):
    return (rng.random() - 0.5) * 2 * amount


def times(seconds):
    return np.arange(int(seconds * SR)) / SR


def fade(sound, attack, release):
    n = len(sound)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    env = np.ones(n)
    env[:a] = np.linspace(0, 1, a)
    env[-r:] *= np.linspace(1, 0, r)
    return sound * env


# ---------------------------------------------------------------- what's played

def piano(note, seconds, vel):
    """An electric piano's note: a soft body, a bell at its start, a slow turn from side to side."""
    t = times(seconds + 0.5)
    f = hz(note)
    body = np.exp(-t / (1.7 * 2 ** ((60 - note) / 24)))
    index = (0.35 + 1.15 * vel) * np.exp(-t / 0.5)
    tine = 0.28 * vel * np.exp(-t / 0.09)
    tone = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * 1.001 * t) + tine * np.sin(2 * np.pi * f * 14 * t))
    tone += 0.16 * np.sin(2 * np.pi * f * 0.5 * t) * body
    release = np.where(t < seconds, 1, np.exp(-(t - seconds) / 0.12))
    tone = fade(tone * body * release, 0.004, 0.05) * vel
    turn = 0.22 * np.sin(2 * np.pi * 4.3 * t + note)
    spread = 0.28 * math.sin(note * 1.7)
    return np.stack([tone * (1 - turn - spread), tone * (1 + turn + spread)])


def bass(note, seconds, vel):
    t = times(seconds + 0.12)
    f = hz(note)
    glide = 1 - 0.02 * np.exp(-t / 0.03)
    phase = 2 * np.pi * np.cumsum(f * glide) / SR
    tone = np.sin(phase) + 0.5 * np.sin(2 * phase) * np.exp(-t / 0.25) + 0.08 * np.sin(3 * phase) * np.exp(-t / 0.1)
    env = np.exp(-t / 1.4) * np.where(t < seconds, 1, np.exp(-(t - seconds) / 0.04))
    return np.tanh(fade(tone * env, 0.006, 0.02) * 1.3) * vel


def vibe(note, seconds, vel):
    t = times(seconds + 1.4)
    f = hz(note)
    tone = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.95) + 0.22 * np.sin(2 * np.pi * f * 3.99 * t) * np.exp(-t / 0.22) + 0.05 * np.sin(2 * np.pi * f * 9.8 * t) * np.exp(-t / 0.05)
    wobble = 1 + 0.2 * np.sin(2 * np.pi * 5.1 * t)
    return fade(tone * wobble, 0.003, 0.2) * vel


def pluck(note, seconds, vel):
    """A muted string (Karplus and Strong's)."""
    n = int((seconds + 0.5) * SR)
    period = SR / hz(note)
    size = max(2, int(period))
    burst = rng.uniform(-1, 1, size)
    for _ in range(3):
        burst = 0.5 * (burst + np.roll(burst, 1))
    out = np.zeros(n)
    ring = burst.copy()
    damp = 0.4985
    pos = 0
    while pos < n:
        take = min(size, n - pos)
        out[pos : pos + take] = ring[:take]
        ring = damp * (ring + np.roll(ring, 1))
        pos += size
    return fade(out / (np.abs(out).max() + 1e-9), 0.002, 0.15) * np.exp(-times((seconds + 0.5))[:n] / 0.5) * vel


def noise(seconds):
    return rng.normal(0, 1, int(seconds * SR))


def band(sound, low, high, soft=1.0):
    """Between two frequencies (a short sound, not round the circle)."""
    n = len(sound)
    size = 2 ** math.ceil(math.log2(n * 2))
    f = np.fft.rfftfreq(size, 1 / SR) + 1e-6
    gain = 1 / np.sqrt(1 + (f / high) ** (4 * soft)) / np.sqrt(1 + (low / f) ** (4 * soft))
    return np.fft.irfft(np.fft.rfft(sound, size) * gain, size)[:n]


def kick(vel):
    t = times(0.42)
    f = 55 + 95 * np.exp(-t / 0.028)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.15)
    click = band(noise(0.42), 900, 3500) * np.exp(-t / 0.004) * 0.12
    return np.tanh(fade(tone + click, 0.001, 0.05) * 1.6) * vel


def snare(vel):
    t = times(0.32)
    body = (np.sin(2 * np.pi * 186 * t) + 0.6 * np.sin(2 * np.pi * 278 * t)) * np.exp(-t / 0.06)
    rattle = band(noise(0.32), 900, 6200) * np.exp(-t / 0.085)
    return fade(0.5 * body + 0.55 * rattle, 0.001, 0.05) * vel


def rim(vel):
    t = times(0.09)
    return fade(np.sin(2 * np.pi * 1180 * t) * np.exp(-t / 0.011) + 0.5 * np.sin(2 * np.pi * 530 * t) * np.exp(-t / 0.02), 0.0005, 0.02) * vel


def hat(vel, long=False):
    seconds = 0.34 if long else 0.08
    t = times(seconds)
    return fade(band(noise(seconds), 6200, 11500) * np.exp(-t / (0.11 if long else 0.022)), 0.001, 0.02) * vel


def shaker(vel):
    t = times(0.11)
    return fade(band(noise(0.11), 4200, 8800) * np.sin(np.pi * np.clip(t / 0.1, 0, 1)) ** 2, 0.004, 0.02) * vel


# ---------------------------------------------------------------- the tune

# A chord: its bass note and what the right hand holds.
DM9 = (38, [53, 57, 60, 64])
G13 = (43, [53, 57, 59, 64])
CM9 = (36, [52, 55, 59, 62])
AM9 = (45, [55, 59, 60, 64])
A7 = (45, [55, 58, 61, 65])
FM9 = (41, [52, 55, 57, 60])
EM7 = (40, [50, 55, 59, 62])
EB9 = (39, [50, 55, 58, 65])
GSUS = (43, [53, 57, 60, 62])

A = [DM9, G13, CM9, AM9, DM9, G13, CM9, A7]
B = [FM9, EM7, DM9, GSUS, FM9, EM7, EB9, GSUS]
CHORDS = A + B + A

keys, low, drums, tune, strings = track(), track(), track(), track(), track()
kicks = []

for bar, (root, hand) in enumerate(CHORDS):
    section = bar // 8
    last = bar % 8 == 7
    # The hand: held from the first beat, then lighter, before and after the third.
    plan = [(0, 2.2, 0.62), (2.5, 1.2, 0.42)] if bar % 2 == 0 else [(0, 1.4, 0.58), (1.5, 0.45, 0.34), (2.5, 1.3, 0.44)]
    if section == 1:
        plan = [(0, 3.4, 0.56)] if bar % 2 == 0 else [(0, 1.9, 0.52), (2.5, 1.3, 0.4)]
    for beat, length, vel in plan:
        at = swung(bar, beat) + human(0.006)
        for k, note in enumerate(hand):
            put(keys, piano(note, length * BEAT, vel * (0.92 + human(0.08))), at + k * 0.013, 0.2)
    # The bass: the root, again ahead of the third, and a step towards what's next.
    following = CHORDS[(bar + 1) % BARS][0]
    put(low, bass(root, 1.35 * BEAT, 0.85), swung(bar, 0) + human(0.004), 0.34)
    if section != 1 or bar % 2:
        put(low, bass(root, 0.35 * BEAT, 0.5), swung(bar, 1.75), 0.34)
    put(low, bass(root + (7 if bar % 2 else 0), 0.9 * BEAT, 0.72), swung(bar, 2.5), 0.34)
    put(low, bass(following + (2 if following < root else -1), 0.4 * BEAT, 0.55), swung(bar, 3.5), 0.34)
    # The drums.
    hits = [(0, 0.95), (2.5, 0.8)] if bar % 2 == 0 else [(0, 0.92), (1.75, 0.5), (2.5, 0.82)]
    if section == 1 and bar % 4 < 2:
        hits = [(0, 0.85), (2.5, 0.6)]
    if last:
        hits = [(0, 0.95), (1.5, 0.6)]
    for beat, vel in hits:
        at = swung(bar, beat)
        kicks.append(at)
        put(drums, kick(vel), at, 0.36)
    for beat in (1, 3):
        at = swung(bar, beat) + 0.012 + human(0.003)
        if section == 1 and bar % 8 < 4:
            put(drums, rim(0.55), at, 0.34, 0.15)
        else:
            put(drums, snare(0.78 + human(0.05)), at, 0.4, 0.04)
    if rng.random() < 0.5:
        put(drums, snare(0.16), swung(bar, 3.75), 0.4, 0.04)
    for k in range(8):
        beat = k / 2
        vel = (0.62 if k % 2 == 0 else 0.4) * (0.85 + human(0.18))
        put(drums, hat(vel), swung(bar, beat) + human(0.004), 0.17, -0.28)
    if bar % 2 == 1:
        put(drums, hat(0.4), swung(bar, 2.25), 0.14, -0.28)
    if bar % 4 == 3:
        put(drums, hat(0.5, True), swung(bar, 3.5), 0.12, -0.28)
    if section > 0:
        for k in range(16):
            put(drums, shaker((0.5 if k % 4 == 2 else 0.24) * (0.85 + human(0.2))), swung(bar, k / 4) + human(0.003), 0.12, 0.35)
    if last and section != 1:
        for beat, vel in ((2.5, 0.3), (2.75, 0.36), (3.25, 0.46), (3.5, 0.55)):
            put(drums, snare(vel), swung(bar, beat), 0.34, 0.04)

# The tune, (bar, beat, note, beats, how hard): over the second half of the first part, and all of the last.
ASK = [(0, 0.5, 69, 0.5, 0.5), (0, 1, 72, 0.5, 0.55), (0, 1.5, 76, 1.5, 0.7), (1, 0.5, 74, 0.5, 0.55), (1, 1, 71, 1, 0.6), (1, 2.5, 69, 1, 0.5),
       (2, 0, 67, 1, 0.6), (2, 1.5, 71, 0.5, 0.5), (2, 2, 74, 1.5, 0.68), (3, 0.5, 72, 0.5, 0.52), (3, 1, 69, 1, 0.58), (3, 2.5, 64, 1.2, 0.5)]
ANSWER = [(0, 0.5, 77, 1, 0.66), (0, 1.5, 76, 0.5, 0.55), (0, 2, 72, 1.5, 0.6), (1, 0, 74, 1, 0.6), (1, 1.5, 71, 1, 0.52), (1, 3, 67, 0.8, 0.48),
          (2, 0.5, 64, 0.5, 0.46), (2, 1, 67, 0.5, 0.5), (2, 1.5, 71, 0.5, 0.54), (2, 2, 74, 1.5, 0.66), (3, 0.5, 73, 1.2, 0.58), (3, 2, 69, 1.6, 0.5)]
HIGH = [(0, 1.5, 81, 0.5, 0.5), (0, 2, 79, 0.5, 0.5), (0, 2.5, 76, 1.2, 0.58), (1, 1, 74, 0.5, 0.5), (1, 1.5, 76, 0.5, 0.52), (1, 2, 71, 1.5, 0.58),
        (2, 0.5, 74, 0.5, 0.52), (2, 1, 79, 1.5, 0.62), (2, 3, 76, 0.8, 0.5), (3, 1, 72, 0.5, 0.5), (3, 1.5, 71, 0.5, 0.48), (3, 2, 67, 1.6, 0.54)]
for start, phrase in ((4, ANSWER), (16, ASK), (20, HIGH)):
    for bar, beat, note, length, vel in phrase:
        put(tune, vibe(note, length * BEAT, vel), swung(start + bar, beat) + human(0.008), 0.17, 0.18)
# The string, picking through the chords of the middle part; and a little of it at the end.
for bar in range(8, 16):
    hand = CHORDS[bar][1]
    order = [0, 2, 1, 3, 2, 3, 1, 2] if bar % 2 == 0 else [3, 1, 2, 0, 1, 3, 2, 1]
    for k, which in enumerate(order):
        if rng.random() < 0.14:
            continue
        put(strings, pluck(hand[which] + 12, 0.5 * BEAT, (0.6 if k % 4 == 0 else 0.42) * (0.9 + human(0.1))), swung(bar, k / 2) + human(0.007), 0.16, -0.3)
for bar in (19, 23):
    for k, which in enumerate((0, 1, 2, 3)):
        put(strings, pluck(CHORDS[bar][1][which] + 12, 0.5 * BEAT, 0.4), swung(bar, 2 + k / 2), 0.13, -0.3)


# ---------------------------------------------------------------- the desk (round the circle)

FREQ = np.fft.rfftfreq(N, 1 / SR) + 1e-6


def shaped(sound, gain):
    return np.fft.irfft(np.fft.rfft(sound, axis=1) * gain, N, axis=1)


def low_pass(f, order=2):
    return 1 / np.sqrt(1 + (FREQ / f) ** (2 * order))


def high_pass(f, order=2):
    return 1 / np.sqrt(1 + (f / FREQ) ** (2 * order))


def room(seconds, bright):
    n = int(seconds * 3 * SR)
    t = np.arange(n) / SR
    tail = rng.normal(0, 1, (2, n)) * np.exp(-t / (seconds / 3)) * np.clip(t / 0.02, 0, 1)
    whole = np.zeros((2, N))
    whole[:, :n] = tail
    spectrum = np.fft.rfft(whole, axis=1) * low_pass(bright, 1) * high_pass(220, 1)
    return spectrum / np.sqrt((np.abs(spectrum) ** 2).mean())


ROOM = room(1.5, 3600)


def in_room(sound, wet):
    return sound + wet * np.fft.irfft(np.fft.rfft(sound, axis=1) * ROOM, N, axis=1)


# The kick presses the rest down a moment.
duck = np.ones(N)
dip = 1 - 0.3 * np.exp(-times(0.5) / 0.13)
for at in kicks:
    i = (int(round(at * SR)) + np.arange(len(dip))) % N
    duck[i] = np.minimum(duck[i], dip)

keys = in_room(shaped(keys, low_pass(4600, 1) * high_pass(170, 1)), 0.18) * duck
tune = in_room(shaped(tune, low_pass(7000, 1)), 0.3) * duck
strings = in_room(shaped(strings, low_pass(5000, 1) * high_pass(200, 1)), 0.22) * duck
low = shaped(low, low_pass(900, 2) * high_pass(32, 2)) * (0.5 + 0.5 * duck)
drums = in_room(np.tanh(shaped(drums, low_pass(9000, 1)) * 1.25) / 1.25, 0.035)
mix = keys * 1.5 + low * 0.46 + drums * 1.05 + tune * 1.35 + strings * 1.9

# Tape: it wavers (whole turns in the loop), it's warm, it's dull at the top.
n = np.arange(N)
turns = lambda f: max(1, round(f * N / SR))
waver = 26 * np.sin(2 * np.pi * turns(0.55) * n / N) + 11 * np.sin(2 * np.pi * turns(0.83) * n / N + 1) + 0.7 * np.sin(2 * np.pi * turns(6.3) * n / N)
at = n + waver
i = np.floor(at).astype(int)
part = at - i
mix = mix[:, i % N] * (1 - part) + mix[:, (i + 1) % N] * part

# The record: crackle and a little hiss.
crackle = np.zeros((2, N))
for _ in range(int(N / SR * 9)):
    size = rng.integers(8, 40)
    pop = rng.normal(0, 1, size) * np.hanning(size) * rng.exponential(0.5)
    put(crackle, pop, rng.random() * N / SR, 1, rng.uniform(-0.8, 0.8))
for _ in range(int(N / SR * 0.5)):
    size = 120
    put(crackle, np.hanning(size) * rng.normal(0, 1, size) * 2.2, rng.random() * N / SR, 1, rng.uniform(-0.5, 0.5))
crackle = shaped(crackle, high_pass(700, 1) * low_pass(6500, 1))
hiss = shaped(rng.normal(0, 1, (2, N)), low_pass(5000, 1) * high_pass(400, 1))
loud = np.sqrt((mix ** 2).mean())
mix = mix + crackle / (np.abs(crackle).max()) * loud * 0.5 + hiss / hiss.std() * loud * 0.011

mix = shaped(mix, low_pass(9500, 1) * high_pass(50, 2) * (1 + 0.5 * np.exp(-((np.log2(FREQ / 2200) / 1.3) ** 2))))
mix /= np.sqrt((mix ** 2).mean())
mix = np.tanh(mix * 0.34) / 0.34
mix *= 10 ** (-17 / 20) / np.sqrt((mix ** 2).mean())
peak = np.abs(mix).max()
if peak > 0.89:
    mix *= 0.89 / peak
seam = np.abs(mix[:, 0] - mix[:, -1]).max()
print(f"{N / SR:.3f} s, peak {20 * np.log10(np.abs(mix).max()):.1f} dB, rms {20 * np.log10(np.sqrt((mix ** 2).mean())):.1f} dB, step at the seam {seam:.4f}")
print(f"loop in the file: from {PAD * 1000:.0f} ms, {N / SR * 1000:.3f} ms")

pad = int(PAD * SR)
whole = np.concatenate([mix[:, -pad:], mix, mix[:, :pad]], axis=1)
with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / "music.wav"
    with wave.open(str(path), "wb") as file:
        file.setnchannels(2)
        file.setsampwidth(2)
        file.setframerate(SR)
        file.writeframes((np.clip(whole.T, -1, 1) * 32767).astype("<i2").tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-c:a", "libmp3lame", "-b:a", "80k", "-joint_stereo", "1", "-map_metadata", "-1", str(OUT)], check=True)
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_bytes(path.read_bytes())
print(OUT, f"{OUT.stat().st_size / 1024:.0f} KB")
