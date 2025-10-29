import { useEffect, useMemo, useRef } from 'react'
import { EditorView, keymap, highlightActiveLine, drawSelection } from '@codemirror/view'
import { EditorState, Transaction } from '@codemirror/state'
import { syntaxHighlighting } from '@codemirror/language'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { kaplanDarkTheme, kaplanDarkHighlight } from '../lib/codemirrorTheme'

type Lang = 'xml'|'html'|'json'|'text'

export default function CodeEditor({
  value, onChange, language='text', onSave
}: { value: string; onChange: (v:string)=>void; language?: Lang; onSave?: ()=>void }) {
  const host = useRef<HTMLDivElement|null>(null)
  const viewRef = useRef<EditorView|null>(null)
  const settingRef = useRef(false) // <- blocks onChange for programmatic updates

  const extensions = useMemo(()=>[
    EditorView.updateListener.of(v => {
      if (!v.docChanged) return
      // Only ignore our own programmatic updates
      if (settingRef.current) return
      onChange(v.state.doc.toString())
    }),
    highlightActiveLine(), drawSelection(), EditorView.lineWrapping, kaplanDarkTheme, syntaxHighlighting(kaplanDarkHighlight),
    keymap.of([{ key:'Mod-s', preventDefault:true, run:()=>{ onSave && onSave(); return true } }]),
    ...(language==='xml' ? [xml()] : []),
    ...(language==='html' ? [html()] : []),
    ...(language==='json' ? [json()] : []),
  ], [language, onChange, onSave])


  useEffect(()=>{
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: value, extensions })
    })
    viewRef.current = view
    return ()=>view.destroy()
  }, [host])

  useEffect(()=>{
    const view = viewRef.current; if (!view) return
    const cur = view.state.doc.toString()
    if (cur !== value) {
      settingRef.current = true
      view.dispatch({ changes: { from:0, to:cur.length, insert:value } })
      settingRef.current = false
    }
  }, [value])

  return (
    <div
      ref={host}
      style={{
        flex: 1,
        minHeight: 0,
        background: 'rgba(15, 23, 42, 0.6)',  // same dark translucent tone
        backdropFilter: 'blur(10px)',
        color: '#e2e8f0',
        borderRadius: '8px',
        padding: '8px'
      }}
    />
  )

}
