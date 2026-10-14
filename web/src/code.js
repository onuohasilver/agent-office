// The file editor's code view: CodeMirror with highlighting picked from the
// file's extension, coloured from the office's own palette so it follows the
// theme and light/dark mode. Loaded only when the editor opens.

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';

function language(file) {
  const name = file.toLowerCase().split('/').pop();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'mts': case 'cts': return javascript({ typescript: true });
    case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'json': case 'jsonc': case 'json5': return json();
    case 'css': case 'scss': case 'less': return css();
    case 'html': case 'htm': case 'vue': case 'svelte': return html();
    case 'md': case 'mdx': case 'markdown': return markdown();
    case 'py': return python();
    case 'yml': case 'yaml': return yaml();
    default: return [];
  }
}

// The two-space or tab indent the file already uses, so new lines match it.
function indentOf(text) {
  const lines = text.split('\n', 400);
  const tabs = lines.filter((l) => l.startsWith('\t')).length;
  const spaced = lines.filter((l) => /^ +\S/.test(l)).map((l) => l.match(/^ +/)[0].length);
  if (tabs > spaced.length) return '\t';
  const four = spaced.length && spaced.every((n) => n % 4 === 0);
  return four ? '    ' : '  ';
}

const colours = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--syn-fn)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-prop)' },
  { tag: [t.tagName, t.heading], color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--syn-punct)' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.invalid, color: 'var(--bad)' },
]);

const look = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--ink)', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', fontVariantLigatures: 'none', fontFeatureSettings: '"calt" 0, "liga" 0' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--ink)' },
  '.cm-line': { padding: '0 20px 0 6px' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--ink-3)', border: 'none', paddingLeft: '8px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', padding: '0 6px 0 0' },
  '.cm-activeLine': { backgroundColor: 'var(--t1)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)', outline: 'none' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--ink-3)', cursor: 'pointer' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--t2)', border: 'none', color: 'var(--ink-2)' },
  '.cm-panels': { backgroundColor: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--sans)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--wait) 28%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--wait) 55%, transparent)' },
  '.cm-textfield': { border: '1px solid var(--line)', borderRadius: '6px', background: 'var(--surface)', padding: '3px 6px' },
  '.cm-button': { backgroundImage: 'none', background: 'var(--t2)', border: 'none', borderRadius: '6px', padding: '3px 9px' },
});

// `on.change()` on every edit, `on.cursor(line, col, bytes)` when the caret
// or text moves, `on.save()` for Cmd/Ctrl+S.
export function mountCode(parent, text, file, on) {
  const unit = indentOf(text);
  const report = (state) => {
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    on.cursor?.(line.number, pos - line.from + 1);
  };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(),
        EditorState.allowMultipleSelections.of(true), indentOnInput(), bracketMatching(), closeBrackets(),
        rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
        indentUnit.of(unit), EditorState.tabSize.of(unit === '\t' ? 4 : unit.length),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { on.save?.(); return true; } },
          ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
        ]),
        syntaxHighlighting(colours), look, language(file),
        EditorView.contentAttributes.of({ 'aria-label': file, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) on.change?.();
          if (u.docChanged || u.selectionSet) report(u.state);
        }),
      ],
    }),
  });
  report(view.state);
  return {
    view,
    text: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
