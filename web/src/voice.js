// Voice, both ways.
//
// In: the microphone records a note, the server transcribes it locally and
// the words land in the composer for you to glance at before they go.
//
// Out: the office reads replies aloud with the system voices, one agent to a
// voice, so you can tell who's talking without looking. Agents only ever
// write text; the speaking happens here.

const store = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {}
  return null;
};

// ---------- recording ----------

// Safari and Chrome disagree about what they can record; the first type the
// browser admits to supporting wins.
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', ''];

export const recorder = {
  rec: null,
  stream: null,
  startedAt: 0,

  get active() { return !!this.rec && this.rec.state !== 'inactive'; },
  get supported() { return typeof window !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder); },

  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const type = TYPES.find((t) => !t || MediaRecorder.isTypeSupported(t));
    this.rec = new MediaRecorder(this.stream, type ? { mimeType: type } : {});
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
    this.startedAt = Date.now();
  },

  // Resolves with the recording, or null if nothing was captured.
  stop() {
    if (!this.active) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.rec.onstop = () => {
        const type = this.rec.mimeType?.split(';')[0] || 'audio/webm';
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.release();
        resolve(blob && blob.size > 1200 ? blob : null);
      };
      this.rec.stop();
    });
  },

  cancel() {
    if (this.active) { this.rec.onstop = null; this.rec.stop(); }
    this.release();
  },

  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rec = null;
    this.stream = null;
    this.startedAt = 0;
  },
};

// The file name carries the extension the browser actually recorded, so
// ffmpeg on the other end doesn't have to guess.
export function voiceFile(blob) {
  const ext = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }[blob.type] || 'webm';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new File([blob], `voice-note-${stamp}.${ext}`, { type: blob.type });
}

// ---------- speaking ----------

// One voice each, so you know who's talking before you've read a word. These
// are preferences in order; whatever the machine actually has gets used.
const VOICES = {
  chief: ['Moira', 'Fiona', 'Karen', 'Serena'],
  ada: ['Samantha', 'Ava', 'Allison', 'Susan'],
  tunde: ['Daniel', 'Oliver', 'Arthur', 'Alex'],
  mira: ['Karen', 'Tessa', 'Zoe', 'Fiona'],
  kai: ['Reed', 'Rocko', 'Alex', 'Tom'],
  zola: ['Tessa', 'Nicky', 'Joelle', 'Samantha'],
  remi: ['Rishi', 'Eddy', 'Aman', 'Fred'],
  obi: ['Eddy', 'Albert', 'Ralph', 'Daniel'],
  lin: ['Flo', 'Sandy', 'Shelley', 'Kathy'],
};

// Markdown, paths and code read terribly out loud: nobody wants to hear
// "backtick slash server slash index dot j s backtick". Strip it to the
// sentence underneath and let the chat bubble keep the detail.
export function speakable(text) {
  let s = String(text ?? '');
  s = s
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/~~~[\s\S]*?~~~/g, ' (code) ')
    .replace(/`([^`]*)`/g, (m, inner) => (/[\/\\]/.test(inner) ? ' that file ' : /^\W*$/.test(inner) ? ' ' : ` ${inner} `))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' a link ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, ', ')
    .replace(/^\s*\d+\.\s+/gm, ', ')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*[-=:|]{3,}\s*$/gm, ' ')
    // Bare paths and file:line references, which are for clicking, not hearing.
    .replace(/(?:\.{0,2}\/)?(?:[\w.-]+\/){1,}[\w.-]+(?::\d+)?/g, ' that file ')
    .replace(/\b[\w-]+\.(?:js|ts|tsx|jsx|css|html|json|md|py|go|rs|sh|yml|yaml)\b(?::\d+)?/gi, ' that file ')
    .replace(/[#*`_~>|]/g, ' ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([:;,])[.,]+/g, '$1')
    .replace(/\.{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.,;:!?]+/, '')
    .trim();
  // Stripped down to punctuation: there was never a sentence in there.
  if (!/[a-z0-9]/i.test(s)) return '';
  // A long result post is a wall of text; say the opening and let the eye do
  // the rest, cutting at a sentence end so it doesn't stop mid-thought.
  const LIMIT = 460;
  if (s.length > LIMIT) {
    const cut = s.slice(0, LIMIT);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = (end > 160 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…');
  }
  return s;
}

class Speech {
  constructor() {
    this.on = store('office.speak') === '1';
    this.voices = [];
    this.queue = [];
    this.saying = null;
    const synth = typeof window !== 'undefined' && window.speechSynthesis;
    if (!synth) return;
    const load = () => { this.voices = synth.getVoices() || []; };
    load();
    synth.onvoiceschanged = load;
  }

  get supported() { return typeof window !== 'undefined' && !!window.speechSynthesis; }

  setOn(on) {
    this.on = on;
    store('office.speak', on ? '1' : '0');
    if (!on) this.stop();
  }

  // Best available voice for someone, matched loosely because browsers name
  // the same voice differently ("Daniel" vs "Daniel (English (UK))").
  voiceFor(id) {
    if (!this.voices.length) this.voices = window.speechSynthesis.getVoices() || [];
    const en = this.voices.filter((v) => /^en\b/i.test(v.lang) || /^en[-_]/i.test(v.lang));
    const pool = en.length ? en : this.voices;
    for (const want of VOICES[id] || []) {
      const hit = pool.find((v) => v.name.toLowerCase().startsWith(want.toLowerCase()));
      if (hit) return hit;
    }
    // Nothing from the wish list: spread whoever is left across the roster so
    // two agents still don't sound alike.
    const ids = Object.keys(VOICES);
    const at = Math.max(0, ids.indexOf(id));
    return pool[at % pool.length] || null;
  }

  speak(text, from = 'chief', { force = false } = {}) {
    if (!this.supported || (!this.on && !force)) return;
    const say = speakable(text);
    if (!say) return;
    this.queue.push({ say, from });
    this.next();
  }

  next() {
    if (this.saying || !this.queue.length) return;
    const { say, from } = this.queue.shift();
    const u = new SpeechSynthesisUtterance(say);
    const voice = this.voiceFor(from);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = 1.05;
    u.pitch = from === 'chief' ? 1 : 1.02;
    this.saying = u;
    const done = () => { this.saying = null; this.next(); };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }

  stop() {
    this.queue = [];
    this.saying = null;
    try { window.speechSynthesis.cancel(); } catch {}
  }

  get busy() { return !!this.saying || !!this.queue.length; }
}

export const speech = new Speech();
