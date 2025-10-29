import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'   // right place
import { tags as t } from '@lezer/highlight'            // tags live here


/** Colors matching your UI */
const bgPanel = 'rgba(15,23,42,0.80)'   // editor bg (glass)
const gutterBg = 'rgba(15,23,42,0.65)'
const text = '#e2e8f0'                  // base text
const subtle = '#94a3b8'                // muted
const border = '#334155'                // borders
const accent = '#38bdf8'                // cyan
const purple = '#c084fc'
const teal = '#34d399'
const orange = '#f59e0b'
const red = '#f87171'

export const kaplanDarkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',   // we set bg on container
      color: text,
      fontSize: '14px',
    },
    '.cm-scroller': {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    '.cm-content': {
      caretColor: accent,
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent },
    '&.cm-editor.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(56,189,248,0.25)',   // cyan selection
    },
    '.cm-activeLine': { backgroundColor: 'rgba(148,163,184,0.08)' }, // soft line highlight
    '.cm-gutters': {
      backgroundColor: gutterBg,
      color: subtle,
      borderRight: `1px solid ${border}`,
    },
    '.cm-gutterElement.lineNumber': { padding: '0 8px' },
    '.cm-tooltip': {
      background: '#0b1220',
      color: text,
      border: `1px solid ${border}`,
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': { background: 'rgba(56,189,248,0.20)', color: text },
    },
    '.cm-panels': { background: bgPanel, color: text, borderBottom: `1px solid ${border}` },
    '.cm-matchingBracket': { outline: `1px solid ${accent}`, color: text },
    '.cm-nonmatchingBracket': { outline: `1px solid ${red}` },
  },
  { dark: true }
)

export const kaplanDarkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier], color: purple, fontWeight: 600 },
  { tag: [t.definitionKeyword], color: purple },
  { tag: [t.typeName, t.className, t.namespace], color: teal },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: accent },
  { tag: [t.number, t.bool, t.null], color: orange },
  { tag: [t.string, t.special(t.string)], color: '#a7f3d0' },
  { tag: [t.attributeName], color: teal },
  { tag: [t.tagName], color: accent },
  { tag: [t.propertyName], color: '#f8fafc' },
  { tag: [t.operator, t.arithmeticOperator, t.logicOperator], color: '#eab308' },
  { tag: [t.comment], color: subtle, fontStyle: 'italic' },
  { tag: [t.meta, t.punctuation], color: subtle },
  { tag: [t.invalid], color: '#fff', backgroundColor: 'rgba(248,113,113,0.25)' },
])
