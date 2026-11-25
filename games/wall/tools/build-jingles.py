# Short sounds, played here: combo (a bell, pitched up step by step in the game), beat (an enemy done for), clear (all of them),
# win (a boss).   python games/wall/tools/build-jingles.py   (numpy, ffmpeg), then `npm run audio` (GAME=wall)
# In the music's key (C), so they sit with it.

import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44100
OUT = Path(__file__).resolve().parent.parent / "raw-assets" / "audio"
rng = np.random.default_rng(5)


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def t_of(seconds):
    return np.arange(int(seconds * SR)) / SR


def put(to, sound, at, gain=1.0):
    i = int(at * SR)
    n = min(len(sound), len(to) - i)
    to[i : i + n] += sound[:n] * gain


def soft(sound, attack=0.002, release=0.03):
    a, r = int(attack * SR), int(release * SR)
    sound = sound.copy()
    sound[:a] *= np.linspace(0, 1, a)
    sound[-r:] *= np.linspace(1, 0, r)
    return sound


def bell(note, seconds, bright=1.0):
    t = t_of(seconds)
    f = hz(note)
    tone = np.sin(2 * np.pi * f * t) * np.exp(-t / (seconds * 0.3))
    tone += 0.45 * bright * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t / (seconds * 0.2))
    tone += 0.28 * bright * np.sin(2 * np.pi * f * 4.02 * t) * np.exp(-t / (seconds * 0.1))
    tone += 0.12 * bright * np.sin(2 * np.pi * f * 6.8 * t) * np.exp(-t / (seconds * 0.04))
    return soft(tone)


def brass(note, seconds):
    """A few saws a little apart, opening up as they sound."""
    t = t_of(seconds)
    out = np.zeros(len(t))
    for detune in (-0.06, 0, 0.07):
        f = hz(note + detune)
        for k in range(1, 12):
            bloom = 1 - np.exp(-t / (0.012 + 0.006 * k))
            out += np.sin(2 * np.pi * f * k * t + k) / k ** 1.25 * bloom
    env = np.minimum(1, t / 0.015) * np.exp(-t / (seconds * 0.6))
    return soft(out * env, 0.004, 0.08)


def band(sound, low, high):
    f = np.fft.rfftfreq(len(sound) * 2, 1 / SR) + 1e-6
    return np.fft.irfft(np.fft.rfft(sound, len(sound) * 2) / np.sqrt(1 + (f / high) ** 4) / np.sqrt(1 + (low / f) ** 4))[: len(sound)]


def room(sound, seconds, wet):
    n = int(seconds * SR)
    tail = band(rng.normal(0, 1, n) * np.exp(-np.arange(n) / SR / (seconds / 5)), 300, 5000)
    size = len(sound) + n
    out = np.fft.irfft(np.fft.rfft(sound, size) * np.fft.rfft(tail / np.sqrt((tail ** 2).sum()), size), size)
    return np.concatenate([sound, np.zeros(n)]) + wet * out


def save(name, sound, peak=0.85):
    sound = sound / np.abs(sound).max() * peak
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "x.wav"
        with wave.open(str(path), "wb") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(SR)
            file.writeframes((soft(sound, 0.001, 0.05) * 32767).astype("<i2").tobytes())
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-c:a", "libmp3lame", "-b:a", "96k", "-map_metadata", "-1", str(OUT / f"{name}.mp3")], check=True)
    print(name, f"{len(sound) / SR:.2f} s")


# The combo: one bright bell, a click at its start.
combo = np.zeros(int(0.5 * SR))
put(combo, bell(72, 0.5), 0)
put(combo, bell(84, 0.3, 0.6), 0, 0.35)
put(combo, soft(band(rng.normal(0, 1, int(0.02 * SR)), 3000, 9000) * np.exp(-t_of(0.02) / 0.004), 0.0005, 0.004), 0, 0.35)
save("combo", room(combo, 0.25, 0.12))

# An enemy done for: a puff, and a tone falling then popping up.
t = t_of(0.34)
fall = 520 * np.exp(-t / 0.09) + 150
beat = np.sin(2 * np.pi * np.cumsum(fall) / SR) * np.exp(-t / 0.1)
beat += 0.5 * band(rng.normal(0, 1, len(t)), 500, 3500) * np.exp(-t / 0.06)
put(beat, bell(79, 0.22), 0.07, 0.5)
save("beat", beat)

# All of them: up the chord, the last note held.
clear = np.zeros(int(1.2 * SR))
for k, note in enumerate((67, 72, 76, 79)):
    put(clear, bell(note, 0.6), k * 0.075, 0.8)
for note in (72, 76, 84):
    put(clear, bell(note, 0.85), 0.32, 0.75)
    put(clear, brass(note - 12, 0.5), 0.32, 0.09)
save("clear", room(clear, 0.6, 0.2))

# A boss: a fanfare (ta ta-ta taa), a big chord under its end, bells running up over it.
win = np.zeros(int(2.4 * SR))
for at, long, chord in ((0, 0.16, (60, 64, 67)), (0.2, 0.1, (60, 64, 67)), (0.32, 0.1, (60, 64, 67)), (0.44, 0.3, (65, 69, 72)), (0.78, 1.5, (67, 72, 76, 79))):
    for note in chord:
        put(win, brass(note, long + 0.12), at, 0.3)
    put(win, brass(chord[0] - 12, long + 0.15), at, 0.34)
for k, note in enumerate((72, 76, 79, 84, 88, 91)):
    put(win, bell(note, 0.7), 0.82 + k * 0.07, 0.45)
t = t_of(1.1)
put(win, soft(band(rng.normal(0, 1, len(t)), 3500, 11000) * np.exp(-t / 0.35), 0.001, 0.1), 0.78, 0.3)
save("win", room(win, 0.9, 0.22))

# The applause (as our other games have it): the first of it, dying away.
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(OUT.parents[2] / "mow" / "raw-assets" / "audio" / "applause.mp3"), "-t", "4.2", "-af", "afade=t=in:d=0.08,afade=t=out:st=2.4:d=1.8", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "80k", "-map_metadata", "-1", str(OUT / "applause.mp3")], check=True)
