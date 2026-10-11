"""Scores the launch video from what cine.py captured.

    /opt/homebrew/bin/python3.13 -I score.py [cinedir] [out.wav]

The sound effects are the app's own (web/src/sound.js: ship, knock,
level-up), placed on the frames events.json recorded, over a soft pad that
swells into the end card. Nothing is sampled; it is all synthesized here.
"""
import json
import os
import sys
import wave

import numpy as np

CINE = sys.argv[1] if len(sys.argv) > 1 else '/tmp/office-demo/cine'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(CINE, 'score.wav')
FPS = 60
SR = 48000

shots = sorted(d for d in os.listdir(CINE) if os.path.isdir(os.path.join(CINE, d)))
counts = {s: len([f for f in os.listdir(os.path.join(CINE, s)) if f.endswith('.jpg')]) for s in shots}
start, acc = {}, 0
for s in shots:
    start[s] = acc / FPS
    acc += counts[s]
DUR = acc / FPS
N = int(DUR * SR) + SR
mix = np.zeros((N, 2))


def osc(kind, f, n):
    ph = 2 * np.pi * f * np.arange(n) / SR
    if kind == 'triangle':
        return 2 / np.pi * np.arcsin(np.sin(ph))
    return np.sin(ph)


def tone(f, at, dur, kind='sine', gain=0.2, pan=0.0):
    """sound.js's tone(): 12 ms exponential attack, exponential decay."""
    n = int((dur + 0.05) * SR)
    i0 = int(at * SR)
    if i0 >= N:
        return
    t = np.arange(n) / SR
    env = np.where(t < 0.012, 0.0001 * (gain / 0.0001) ** (t / 0.012),
                   gain * (0.0001 / gain) ** np.clip((t - 0.012) / (dur - 0.012), 0, 1))
    env[t > dur] = 0
    y = osc(kind, f, n) * env
    n = min(n, N - i0)
    mix[i0:i0 + n, 0] += y[:n] * (1 - max(0, pan))
    mix[i0:i0 + n, 1] += y[:n] * (1 + min(0, pan))


def ship(at):
    for i, f in enumerate([659.25, 830.61, 987.77]):
        tone(f, at + i * 0.085, 0.55, gain=0.16)
        tone(f * 2, at + i * 0.085, 0.3, 'triangle', 0.035)
    tone(1318.5, at + 0.26, 0.9, gain=0.09)


def knock(at):
    tone(880, at, 0.09, gain=0.06)
    tone(1174.7, at + 0.07, 0.12, gain=0.05)


def level_up(at):
    for i, f in enumerate([523.25, 659.25, 783.99, 1046.5, 1318.5]):
        tone(f, at + i * 0.07, 0.7, gain=0.11)


def click(at, g=0.05):
    tone(2100, at, 0.035, 'triangle', g)
    tone(3100, at, 0.02, gain=g * 0.5)


# ---------- the pad: Cmaj9 / Am9 / Fmaj7#11 / G6, a bar every 4 s ----------
CHORDS = [[130.81, 196.0, 246.94, 293.66, 329.63],
          [110.0, 164.81, 196.0, 246.94, 261.63],
          [87.31, 174.61, 220.0, 261.63, 329.63],
          [98.0, 146.83, 196.0, 246.94, 329.63]]
BAR = 4.0
t = np.arange(N) / SR
pad = np.zeros((N, 2))
bars = int(np.ceil(DUR / BAR)) + 1
for b in range(bars):
    notes = CHORDS[b % 4] if b < bars - 3 else CHORDS[0]   # land home for the end card
    a, e = b * BAR, (b + 1) * BAR + 1.2
    i0, i1 = int(a * SR), min(N, int(e * SR))
    if i0 >= N:
        break
    tt = t[i0:i1] - a
    env = np.clip(tt / 1.4, 0, 1) * np.clip((e - a - tt) / 1.4, 0, 1)
    for k, f in enumerate(notes):
        for det, side in ((-0.6, 0), (0.6, 1)):   # a slow chorus across the stereo field
            v = np.sin(2 * np.pi * (f + det) * tt) + 0.18 * np.sin(4 * np.pi * (f + det) * tt)
            pad[i0:i1, side] += v * env * (0.016 if k else 0.022)
breath = 0.85 + 0.15 * np.sin(2 * np.pi * t / 7.5)
end0 = start[shots[-1]]
swell = 1 + 0.6 * np.clip((t - (end0 + 9.4)) / 2.5, 0, 1)
fade_in = np.clip(t / 2.0, 0, 1)
fade_out = np.clip((DUR - t) / 2.5, 0, 1)
pad *= (breath * swell * fade_in * fade_out)[:, None]
mix += pad

# ---------- effects, on the frames cine.py recorded ----------
events = json.load(open(os.path.join(CINE, 'events.json')))
for ev in events:
    at = start[ev['shot']] + ev['frame'] / FPS
    {'click': click, 'send': knock, 'route': knock, 'ship': ship}.get(ev['kind'], lambda a: None)(at)

# Keys while the message is typed (03_ask, 3.05 s to 4.3 s at ~55 chars/s).
if '03_ask' in start:
    rng = np.random.default_rng(7)
    k = start['03_ask'] + 3.05
    while k < start['03_ask'] + 4.3:
        tone(1700 + rng.random() * 600, k, 0.03, 'triangle', 0.018 + rng.random() * 0.01, pan=rng.uniform(-0.2, 0.2))
        k += 0.055 + rng.random() * 0.04
# Taps on the phone (mobile.py's taps).
if '06b_mobile' in start:
    for at in (2.55, 4.0, 5.35):
        click(start['06b_mobile'] + at, 0.04)
# The end card lands with the level-up arpeggio.
level_up(end0 + 10.2)

peak = np.abs(mix).max()
mix = np.tanh(mix / peak * 1.1) * 0.84                     # gentle limiting, headroom
mix = mix[: int(DUR * SR)]
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print(f'{OUT}: {DUR:.2f}s, {len(events)} events')
