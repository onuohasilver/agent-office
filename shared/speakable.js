// What a message sounds like when it is read out.
//
// Shared by the browser (speech synthesis) and the server (Piper), because a
// voice note and a spoken reply must say the same thing. Markdown, code and
// file paths are stripped: nobody wants to hear "backtick slash server slash
// index dot j s backtick", and the chat bubble keeps the detail anyway.

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
    .replace(/([.!?])\s*,\s*/g, '$1 ')
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
