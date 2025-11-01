// apps/frontend/src/components/ContextMenu.tsx
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export type CtxItem = {
  label: string
  onClick?: () => void
  disabled?: boolean
  dividerAbove?: boolean
}

export default function ContextMenu({
  x, y, items, onClose
}: {
  x: number; y: number; items: CtxItem[]; onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      // only close if the click is outside the menu
      if (boxRef.current && boxRef.current.contains(e.target as Node)) return
      onClose()
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }

    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  const menu = (
    <div
      ref={boxRef}
      style={{
        position: 'fixed', left: x, top: y, zIndex: 9999,
        background: 'rgba(11,18,35,0.98)',
        border: '1px solid #263043',
        boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
        borderRadius: 8, padding: 6, minWidth: 220
      }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.stopPropagation()}  // prevent bubbling to document
    >
      {items.map((it, i) => (
        <div key={i}>
          {it.dividerAbove && <div style={{ height:1, background:'#263043', margin:'6px 4px' }}/>}
          <button
            disabled={!!it.disabled}
            onClick={() => { if (!it.disabled) it.onClick?.(); onClose() }}
            style={{
              width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
              gap: 8, padding: '6px 8px', border:'none', background:'transparent',
              color: it.disabled ? '#64748b' : '#e2e8f0', cursor: it.disabled ? 'default' : 'pointer',
              borderRadius: 6
            }}
            onMouseEnter={(e)=>{ if (!it.disabled) (e.currentTarget.style.backgroundColor='rgba(255,255,255,0.06)') }}
            onMouseLeave={(e)=>{ (e.currentTarget.style.backgroundColor='transparent') }}
          >
            <span>{it.label}</span>
          </button>
        </div>
      ))}
    </div>
  )

  return createPortal(menu, document.body)
}
