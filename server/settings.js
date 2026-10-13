// The office's own settings: what the boss can change from the Settings page.
// Each one has a default taken from the environment (or built in); a value set
// in the office is kept in state.settings and wins over it. Clearing a value
// goes back to the default. Anything not listed here stays environment-only.

const env = (k) => process.env[k];
const on = (v) => v !== 'off' && v !== '0' && v !== 'false';

// kind: text | number | bool | choice | time. `live` settings take effect at
// once; the rest are read when the thing they configure next starts.
export const SETTINGS = [
  { key: 'owner', group: 'Office', label: 'Office owner', kind: 'text', max: 40, hint: 'Whose office this is. It names the office in the header. Blank uses the name on this account.', fallback: () => String(env('OFFICE_OWNER') || '').trim() },
  { key: 'shareTitles', group: 'Office', label: 'Share job titles with linked offices', kind: 'bool', hint: 'Off: linked offices only see that an agent is busy.', fallback: () => env('OFFICE_SHARE_JOB_TITLES') === '1' },

  { key: 'tokenLimit', group: 'Agents', label: 'Token limit', kind: 'number', min: 0, max: 10_000_000, step: 10000, unit: 'tokens', hint: 'Past this much context, an agent is nudged to clear it; if it does not, the office clears it. 0 turns this off.', fallback: () => Math.max(0, parseInt(env('AGENT_CLEAR_TOKENS') ?? '150000', 10) || 0) },
  { key: 'compactPct', group: 'Agents', label: 'Compact at', kind: 'number', min: 10, max: 95, step: 5, unit: '%', hint: 'How full an agent’s context gets before Claude Code compacts it. Applies to jobs that start after you save.', fallback: () => Math.min(95, Math.max(10, parseInt(env('AGENT_COMPACT_PCT') ?? '60', 10) || 60)) },
  { key: 'chiefModel', group: 'Agents', label: 'Chief of staff model', kind: 'choice', options: ['haiku', 'sonnet', 'opus'], hint: 'Routes your messages and writes the standup.', fallback: () => env('CHIEF_MODEL') || 'sonnet' },

  { key: 'payPerMinute', group: 'Pay', label: 'Pay per active minute', kind: 'number', min: 0, max: 1_000_000, step: 100, unit: 'naira', hint: 'What an agent earns for each minute the model was working, on Opus. Haiku pays 3×, Sonnet 1.75×. Applies to work paid from now on.', fallback: () => 1000 },
  { key: 'payFinishBonus', group: 'Pay', label: 'Bonus for finishing a job', kind: 'number', min: 0, max: 1_000_000, step: 100, unit: 'naira', hint: 'Paid once when a job finishes, scaled by model like the minute rate. Kudos pays it again.', fallback: () => 2500 },

  { key: 'standupAt', group: 'Standup', label: 'Standup time', kind: 'time', hint: 'Local time, 24-hour. Blank turns the daily standup off.', fallback: () => (env('STANDUP_AT') ?? '09:30') === 'off' ? '' : (env('STANDUP_AT') ?? '09:30') },
  { key: 'standupWeekends', group: 'Standup', label: 'Hold standups on weekends', kind: 'bool', fallback: () => env('STANDUP_WEEKENDS') === '1' },

  { key: 'banter', group: 'Break room', label: 'Written break-room talk', kind: 'bool', hint: 'Off: the break room uses canned lines only.', fallback: () => on(env('BANTER')) },
  { key: 'banterModel', group: 'Break room', label: 'Break-room model', kind: 'choice', options: ['haiku', 'sonnet', 'opus'], fallback: () => env('BANTER_MODEL') || 'haiku' },
  { key: 'banterGap', group: 'Break room', label: 'Time between conversations', kind: 'number', min: 10, max: 86400, step: 10, unit: 'seconds', hint: 'At most one written conversation per this long.', fallback: () => Math.max(10, Number(env('BANTER_GAP_SECONDS') ?? 120) || 120) },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

// Returns the cleaned value, or throws with something the boss can act on.
function clean(def, v) {
  const bad = (m) => Object.assign(new Error(m), { code: 400 });
  switch (def.kind) {
    case 'text': {
      if (typeof v !== 'string') throw bad(`${def.label}: use text.`);
      v = v.trim().replace(/\s+/g, ' ');
      if (v.length > def.max) throw bad(`${def.label} is limited to ${def.max} characters.`);
      return v;
    }
    case 'bool':
      if (typeof v !== 'boolean') throw bad(`${def.label}: use on or off.`);
      return v;
    case 'number':
      if (!Number.isInteger(v) || v < def.min || v > def.max) throw bad(`${def.label}: use a whole number from ${def.min.toLocaleString()} to ${def.max.toLocaleString()}.`);
      return v;
    case 'choice':
      if (!def.options.includes(v)) throw bad(`${def.label}: pick one of ${def.options.join(', ')}.`);
      return v;
    case 'time':
      if (v !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad(`${def.label}: use HH:MM, like 09:30, or leave it blank.`);
      return v;
  }
}

export class Settings {
  // `store` is the object persisted with the office's state; `onChange` saves it.
  constructor(store, onChange = () => {}) {
    this.store = store;
    this.onChange = onChange;
  }

  get(key) {
    const def = BY_KEY.get(key);
    return key in this.store ? this.store[key] : def.fallback();
  }

  // Apply { key: value | null }. All or nothing: one bad value saves none.
  set(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('Nothing to save.'), { code: 400 });
    const next = {};
    for (const [key, v] of Object.entries(patch)) {
      const def = BY_KEY.get(key);
      if (!def) throw Object.assign(new Error(`Unknown setting: ${key}.`), { code: 400 });
      next[key] = v === null ? null : clean(def, v);
    }
    for (const [key, v] of Object.entries(next)) {
      if (v === null) delete this.store[key]; else this.store[key] = v;
    }
    this.onChange(Object.keys(next));
    return this.status();
  }

  status() {
    return SETTINGS.map(({ fallback, ...def }) => ({ ...def, value: this.get(def.key), default: fallback(), custom: def.key in this.store }));
  }
}
