// Turning a recorded voice note into text, on this machine. Speech never
// leaves the laptop: ffmpeg makes the 16 kHz mono WAV whisper.cpp wants, and
// whisper-cli reads it with a local model.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const WHISPER = process.env.WHISPER_BIN || 'whisper-cli';
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const TIMEOUT = 120000;

// Whisper hears "at Ada" and writes whatever it likes; an initial prompt in
// the office's own vocabulary pulls names and projects towards the spelling
// the chief can actually route on.
const MODEL_HINT = 'Put a model in data/whisper (ggml-base.en.bin), or set WHISPER_MODEL to one you already have.';

export function modelPath(dataDir) {
  const set = process.env.WHISPER_MODEL;
  if (set) return fs.existsSync(set) ? set : null;
  const dir = path.join(dataDir, 'whisper');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith('ggml-') && n.endsWith('.bin')); } catch {}
  // base.en first on purpose: measured here it was ~3x quicker than small.en
  // and no worse on the office's own names, and you read the transcript
  // before it sends. Point WHISPER_MODEL at a bigger one to trade speed back.
  const order = ['base.en', 'small.en', 'base', 'small', 'medium.en', 'tiny.en', 'tiny'];
  names.sort((a, b) => {
    const rank = (n) => {
      const i = order.findIndex((o) => n === `ggml-${o}.bin`);
      return i === -1 ? order.length : i;
    };
    return rank(a) - rank(b);
  });
  return names.length ? path.join(dir, names[0]) : null;
}

function run(bin, args, { timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (err) { return reject(err); }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${bin} took too long.`)); }, timeout);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? `${bin} isn't installed. brew install ffmpeg whisper-cpp` : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').pop() || `${bin} exited ${code}`));
    });
  });
}

// Whisper marks the parts that aren't speech, and loves to fill silence with
// a polite nothing. None of it should reach the chief as a brief.
const NOISE = /^(?:\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|you|thank you\.?|thanks for watching\.?|bye\.?|\.|\s)*$/i;

function clean(raw) {
  const text = String(raw)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[\d:.\s\->]+\]$/.test(l))
    .join(' ')
    .replace(/\[(?:BLANK_AUDIO|INAUDIBLE|NOISE|SOUND|MUSIC|SILENCE)[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return NOISE.test(text) ? '' : text;
}

// The roster and project list, so spoken names come back spelled the way the
// tag parser expects. Front-loaded as a sentence; whisper treats it as context.
export function vocabulary(names = [], repos = []) {
  const bits = [];
  if (names.length) bits.push(`The team: ${names.join(', ')}.`);
  if (repos.length) bits.push(`The projects: ${repos.join(', ')}.`);
  return bits.length ? `${bits.join(' ')} Notes from the office.` : '';
}

export async function transcribe(file, { dataDir, prompt = '', threads = Math.max(2, Math.min(8, os.cpus().length - 2)) } = {}) {
  const model = modelPath(dataDir);
  if (!model) throw new Error(`No speech model installed. ${MODEL_HINT}`);
  const wav = path.join(path.dirname(file), 'voice.wav');
  try {
    await run(FFMPEG, ['-nostdin', '-loglevel', 'error', '-y', '-i', file, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    const out = await run(WHISPER, [
      '-m', model, '-f', wav,
      '-nt', '-np', '-l', 'en', '-sns', '-t', String(threads),
      ...(prompt ? ['--prompt', prompt.slice(0, 800)] : []),
    ]);
    return clean(out);
  } finally {
    fs.rm(wav, { force: true }, () => {});
  }
}

// Whether a voice note can be transcribed at all, for the browser to grey out
// the microphone with a reason instead of failing after the recording.
export function voiceReady(dataDir) {
  const model = modelPath(dataDir);
  return model
    ? { ok: true, model: path.basename(model) }
    : { ok: false, reason: `No speech model installed. ${MODEL_HINT}` };
}
