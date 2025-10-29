import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type CtxItem = {
  label?: string
  shortcut?: string
  disabled?: boolean
  dividerAbove?: boolean
  onClick?: () => void
}

export default function ContextMenu({
  x, y, items, onClose
}: { x: number; y: number; items: CtxItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement|null>(null)
  const [pos, setPos] = useState({ x, y })

  // Defer installing global listeners so the opening event doesn't instantly close it
  useEffect(() => {
    const close = () => onClose()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', close, { capture: true })
      document.addEventListener('contextmenu', close, { capture: true })
      document.addEventListener('keydown', key)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', close, { capture: true } as any)
      document.removeEventListener('contextmenu', close, { capture: true } as any)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  // Clamp to viewport
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    setPos({
      x: Math.min(x, Math.max(8, vw - rect.width - 8)),
      y: Math.min(y, Math.max(8, vh - rect.height - 8)),
    })
  }, [x, y])

  const menu = (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999,
        minWidth: 220, padding: 6,
        background: 'rgba(11,18,35,0.95)',
        color: '#e2e8f0',
        backdropFilter: 'blur(10px)',
        border: '1px solid #263043',
        borderRadius: 8,
        boxShadow: '0 10px 30px rgba(0,0,0,.35)',
      }}
      onClick={e => e.stopPropagation()}
    >
      {items.map((it, i) => (
        <div key={i}>
          {it.dividerAbove && <div style={{borderTop:'1px solid #263043', margin:'6px 8px'}} />}
          <button
            disabled={it.disabled}
            onClick={()=>{ it.onClick?.(); onClose() }}
            style={{
              width:'100%', textAlign:'left',
              background:'transparent', border:'none', color: it.disabled ? '#64748b' : '#e2e8f0',
              padding:'8px 10px', borderRadius:6, cursor: it.disabled ? 'default':'pointer',
              display:'flex', justifyContent:'space-between', alignItems:'center'
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <span style={{ color:'#94a3b8', fontSize:12 }}>{it.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  )
  return createPortal(menu, document.body)
}
