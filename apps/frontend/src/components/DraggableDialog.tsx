import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Btn = { label: string; onClick: () => void; kind?: 'primary' | 'danger' | 'default'; disabled?: boolean }

export default function DraggableDialog({
  open, title, children, onClose, buttons, width = 480
}: {
  open: boolean
  title: string
  children: React.ReactNode
  onClose: () => void
  buttons: Btn[]
  width?: number
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200
    const h = typeof window !== 'undefined' ? window.innerHeight : 800
    return { x: Math.max(12, (w - width) / 2), y: Math.max(12, (h - 320) / 3) }
  })
  const drag = useRef<{ dx: number; dy: number; active: boolean }>({ dx: 0, dy: 0, active: false })

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!open) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(3px)',
          zIndex: 9997
        }}
      />
      {/* Window */}
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', left: pos.x, top: pos.y, width,
          zIndex: 9998, background: 'rgba(11,18,35,1)', color: '#e2e8f0',
          border: '1px solid #263043', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5)'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title bar (drag handle) */}
        <div
          onMouseDown={(e) => {
            drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, active: true }
            const move = (ev: MouseEvent) => {
              if (!drag.current.active) return
              setPos({ x: Math.max(8, ev.clientX - drag.current.dx), y: Math.max(8, ev.clientY - drag.current.dy) })
            }
            const up = () => {
              drag.current.active = false
              window.removeEventListener('mousemove', move)
              window.removeEventListener('mouseup', up)
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up, { once: true })
          }}
          style={{
            padding: '10px 12px', cursor: 'move',
            background: 'rgba(15,23,42,0.9)', borderBottom: '1px solid #263043',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTopLeftRadius: 10, borderTopRightRadius: 10
          }}
        >
          <div style={{ fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Content */}
        <div style={{ padding: 12, maxHeight: '60vh', overflow: 'auto' }}>
          {children}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 12, borderTop: '1px solid #263043' }}>
          {buttons.map((b, i) => (
            <button
              key={i}
              disabled={b.disabled}
              onClick={b.onClick}
              style={{
                padding: '6px 12px', borderRadius: 6, cursor: b.disabled ? 'default' : 'pointer',
                border: '1px solid ' + (b.kind === 'danger' ? '#ef4444' : b.kind === 'primary' ? '#3b82f6' : '#334155'),
                background: b.kind === 'danger' ? 'rgba(239,68,68,0.1)' : b.kind === 'primary' ? 'rgba(59,130,246,0.1)' : 'transparent',
                color: b.disabled ? '#64748b' : '#e2e8f0'
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body
  )
}
