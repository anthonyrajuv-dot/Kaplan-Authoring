import { useEffect, useRef } from 'react'
import { EditorState, Extension } from '@codemirror/state'
import { EditorView, keymap, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { history, undo, redo, defaultKeymap } from '@codemirror/commands'
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { tags as t } from '@codemirror/highlight'
import { html as htmlLang } from '@codemirror/lang-html'
import { xml as xmlLang } from '@codemirror/lang-xml'
import { json as jsonLang } from '@codemirror/lang-json'

export type Lang = 'xml' | 'html' | 'json' | 'text'

type Props = {
  value: string
  language?: Lang
  onChange: (next: string) => void
  onSave?: () => void
  onOpenFile?: (relPath: string) => void
  activePath?: string
}

// Lightweight tag/attribute colorizer (no HighlightStyle needed)
function tagAttrColorizer(): Extension {
  const angle = Decoration.mark({ class: 'cm-k-angle' })   // <, />, >
  const tname = Decoration.mark({ class: 'cm-k-tag' })     // tag name
  const aname = Decoration.mark({ class: 'cm-k-attr' })    // attribute name

  function decorateRange(view: EditorView, from: number, to: number) {
    const src = view.state.doc.sliceString(from, to)
    const decos: any[] = []

    // find each <...> region
    const tagRe = /<[^>]*>/g
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(src))) {
      const absStart = from + m.index
      const absEnd = from + m.index + m[0].length
      const chunk = m[0]

      // angle brackets
      decos.push(angle.range(absStart, absStart + 1)) // '<'
      if (chunk.endsWith('/>')) {
        decos.push(angle.range(absEnd - 2, absEnd))   // '/>'
      } else {
        decos.push(angle.range(absEnd - 1, absEnd))   // '>'
      }

      // tag name  (after optional '</' or '<')
      const nameMatch = /^<\/?\s*([A-Za-z_][\w:.\-]*)/.exec(chunk)
      if (nameMatch && nameMatch[1]) {
        const idx = chunk.indexOf(nameMatch[1])
        if (idx >= 0) decos.push(tname.range(absStart + idx, absStart + idx + nameMatch[1].length))
      }

      // attribute names inside tag  foo=  (don’t color values)
      const attrRe = /([A-Za-z_][\w:.\-]*)(?=\s*=)/g
      let am: RegExpExecArray | null
      while ((am = attrRe.exec(chunk))) {
        const i = am.index
        // skip if before tag name (rare false positive)
        if (i < 1) continue
        decos.push(aname.range(absStart + i, absStart + i + am[0].length))
      }
    }
    return decos
  }

  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.compute(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = this.compute(u.view)
      }
    }
    compute(view: EditorView) {
      const ranges = view.visibleRanges
      const all: any[] = []
      for (const r of ranges) all.push(...decorateRange(view, r.from, r.to))
      return Decoration.set(all, true)
    }
  }, { decorations: v => v.decorations })

  // visual colors (matches your palette request)
  const theme = EditorView.baseTheme({
    '.cm-k-angle, .cm-k-tag': { color: '#22c55e', fontWeight: 600 }, // green
    '.cm-k-attr': { color: '#1e3a8a', fontWeight: 600 },             // dark blue
  })

  return [plugin, theme]
}


export default function CodeEditor({
  value, onChange, language='text', onSave, onOpenFile, activePath
}: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const previewRef = useRef<HTMLIFrameElement | null>(null)
  const isPreview = useRef(false)
  const pushing = useRef(false)

  // mount
  useEffect(() => {
    if (!host.current) return

    const langExt: Extension =
      language === 'xml' ? xmlLang()
      : language === 'html' ? htmlLang()
      : language === 'json' ? jsonLang()
      : []

    // Ctrl/Cmd+S
    const saveKey = { key:'Mod-s', preventDefault:true, run:()=>{ onSave?.(); return true } }

    // Ctrl/Cmd+Click inside href="..." or conref="..."
    const ctrlClick = EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!(event.ctrlKey || event.metaKey)) return
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return
        const doc = view.state.doc
        const text = doc.toString()
        const start = Math.max(0, pos - 200)
        const end = Math.min(text.length, pos + 200)
        const snip = text.slice(start, end)
        const re = /(href|conref)\s*=\s*"([^"]+)"/gi
        let m, found: {val:string; absStart:number; absEnd:number} | null = null
        while ((m = re.exec(snip))) {
          const absStart = start + m.index, absEnd = absStart + m[0].length
          if (absStart <= pos && pos <= absEnd) { found = { val:m[2], absStart, absEnd }; break }
        }
        if (!found) return
        const val = found.val.trim()
        if (/^https?:\/\//i.test(val)) {
          window.open(val, '_blank', 'noopener'); event.preventDefault(); return
        }
        if (onOpenFile) {
          const base = (activePath || '').split('/').slice(0, -1).join('/')
          const resolved = base ? `${base}/${val}`.replace(/\/+/g, '/') : val
          if (/\.(dita|ditamap|xml|html|xhtml)$/i.test(resolved)) {
            onOpenFile(resolved); event.preventDefault()
          }
        }
      }
    })

    const extensions: Extension[] = [
      langExt,
      history(),
      bracketMatching(),                                  // matching (),{},[], and tag-angle pairs
      syntaxHighlighting(defaultHighlightStyle, { fallback:true }),
      tagAttrColorizer(),

      // make the scroller own the scrollbars and background, fixed bottom scrollbar
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': {
          height: '100%',
          overflow: 'auto',                               // vertical + horizontal within editor
          background: 'rgba(11,18,35,0.94)',              // consistent bg even past content
          color: '#e2e8f0'
        },
        '.cm-gutters': {
          background: 'rgba(11,18,35,0.94)',
          borderRight: '1px solid #263043',
          color: '#94a3b8'
        },
        '.cm-activeLine': { background: 'rgba(255,255,255,0.04)' },
        '.cm-matchingBracket': {
          backgroundColor: 'rgba(34,197,94,0.20)',        // green-ish glow
          outline: '1px solid rgba(34,197,94,0.45)',
          borderRadius: '2px'
        },
        '.cm-nonmatchingBracket': {
          backgroundColor: 'rgba(248,113,113,0.25)',
          outline: '1px solid rgba(248,113,113,0.55)'
        },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: 'rgba(99,102,241,0.25)'
        }
      }),

      keymap.of([
        ...defaultKeymap,
        { key:'Mod-z', run: undo }, { key:'Mod-y', run: redo }, { key:'Shift-Mod-z', run: redo },
        saveKey
      ]),

      EditorView.updateListener.of(u => {
        if (!u.docChanged) return
        if (pushing.current) return
        onChange(u.state.doc.toString())
      }),

      ctrlClick
    ]

    const state = EditorState.create({ doc: value, extensions })
    const view = new EditorView({ state, parent: host.current })
    viewRef.current = view

    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // external updates (format/reload)
  useEffect(() => {
    const view = viewRef.current; if (!view) return
    const cur = view.state.doc.toString()
    if (cur !== value) {
      pushing.current = true
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
      pushing.current = false
    }
  }, [value])

  // Preview (author) mode – unchanged from your last working version, optional
  const canPreview = language === 'html' || language === 'xml'
  function escapeHTML(s: string) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
  }
  function renderPreview() {
    if (!previewRef.current) return
    let html = ''
    if (language === 'html') {
      html = value
    } else {
      try {
        const doc = new DOMParser().parseFromString(value, 'text/xml')
        const title = doc.querySelector('title')?.textContent || '(Untitled)'
        const blocks = Array.from(doc.querySelectorAll('p, li')).map(n => n.textContent || '')
        html = `<!doctype html><html><head>
          <meta charset="utf-8"/><title>${escapeHTML(title)}</title>
          <style>
            body{font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e2e8f0;background:#0b1223;padding:16px}
            h1{font-size:20px;margin:0 0 12px} p,li{margin:8px 0}
          </style></head><body><h1>${escapeHTML(title)}</h1>
          ${blocks.map(t => `<p>${escapeHTML(t)}</p>`).join('')}
        </body></html>`
      } catch {
        html = `<!doctype html><html><body style="color:#e2e8f0;background:#0b1223;padding:16px"><strong>Preview unavailable.</strong></body></html>`
      }
    }
    previewRef.current.srcdoc = html
  }

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', minHeight:0 }}>
      {canPreview && (
        <div style={{ padding:'4px 8px', borderBottom:'1px solid #263043', display:'flex', gap:8 }}>
          <button onClick={()=>{
            isPreview.current = false
            if (previewRef.current) previewRef.current.style.display = 'none'
            if (host.current) host.current.style.display = 'block'
          }}>Code</button>
          <button onClick={()=>{
            isPreview.current = true
            if (host.current) host.current.style.display = 'none'
            if (previewRef.current) previewRef.current.style.display = 'block'
            renderPreview()
          }}>Preview</button>
        </div>
      )}
      {/* The editor host fills height and owns its own scrollbars */}
      <div ref={host} style={{ flex:1, minHeight:0 }} />
      <iframe ref={previewRef} title="Preview" style={{ flex:1, minHeight:0, display:'none', border:'none' }}/>
    </div>
  )
}
