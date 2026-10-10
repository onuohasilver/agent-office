// Turns a raw tool call into a one-line caption and the place in the
// office where that kind of work happens.

const base = (p) => (p ? String(p).split('/').filter(Boolean).pop() : '');
const clip = (s, n = 60) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

export function summarizeTool(name, input = {}) {
  switch (name) {
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'NotebookEdit': return `Editing ${base(input.notebook_path)}`;
    case 'Grep': return `Searching for “${clip(input.pattern, 40)}”`;
    case 'Glob': return `Looking for ${clip(input.pattern, 40)}`;
    case 'LS': return `Browsing ${base(input.path) || 'a folder'}`;
    case 'Bash': return clip(input.description || `$ ${input.command}`);
    case 'WebSearch': return `Searching the web: ${clip(input.query, 45)}`;
    case 'WebFetch':
      try { return `Reading ${new URL(input.url).hostname}`; } catch { return 'Reading a web page'; }
    case 'TodoWrite': return 'Updating the plan';
    case 'Task':
    case 'Agent': return `Briefing a helper: ${clip(input.description, 40)}`;
    case 'ExitPlanMode': return 'Presenting the plan';
    case 'Skill': return `Opening the ${clip(input.skill, 30)} playbook`;
    case 'ToolSearch': return 'Fetching the right tool';
    case 'mcp__office__office_roster': return 'Checking who’s around';
    case 'mcp__office__message_colleague': return `Messaging ${clip(input.to, 20)}`;
    case 'mcp__office__hand_off': return `Handing off to ${clip(input.to, 20) || 'a colleague'}`;
    default:
      return name.startsWith('mcp__')
        ? `Using ${name.split('__').slice(1).join(' · ')}`
        : `Using ${name}`;
  }
}

const LIBRARY = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'Skill']);
const SERVERS = new Set(['Bash', 'BashOutput', 'KillShell', 'KillBash']);
const WINDOW = new Set(['WebSearch', 'WebFetch']);
const WHITEBOARD = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'Task', 'Agent', 'ExitPlanMode', 'ToolSearch']);

export function stationFor(name) {
  if (name.startsWith('mcp__office__')) return 'desk';
  if (LIBRARY.has(name)) return 'library';
  if (SERVERS.has(name)) return 'servers';
  if (WINDOW.has(name) || name.startsWith('mcp__')) return 'window';
  if (WHITEBOARD.has(name)) return 'whiteboard';
  return 'desk';
}
