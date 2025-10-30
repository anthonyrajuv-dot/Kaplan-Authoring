import { useEffect, useRef, useState } from 'react'

type MenuAction = () => void
type Item = {
  label: string
  shortcut?: string
  onClick?: MenuAction
  disabled?: boolean
  dividerAbove?: boolean
}
type Menu = { title: string; items: Item[] }

export default function MenuBar({
  menus,
  rightSlot,                               // ← NEW
}: {
  menus: Menu[]
  rightSlot?: React.ReactNode              // ← NEW
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Close on outside click / ESC
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!barRef.current?.contains(e.target as Node)) setOpenIndex(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenIndex(null)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div
      ref={barRef}
      style={{
        display: 'flex',
        justifyContent: 'space-between',      // ← split left / right
        alignItems: 'center',
        padding: '4px 8px',
        userSelect: 'none',
        position: 'relative',
        zIndex: 10,
        background: 'rgba(11, 18, 35, 0.9)',  // ← your palette
        borderBottom: '1px solid #263043',
      }}
    >
      {/* LEFT: menus */}
      <div style={{ display: 'flex', gap: 12 }}>
        {menus.map((m, i) => (
          <div
            key={m.title}
            style={{ position: 'relative' }}
            onMouseEnter={() => (openIndex !== null ? setOpenIndex(i) : undefined)}
          >
            <button
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
              style={{
                background: openIndex === i ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: '#e2e8f0',
                border: 'none',
                padding: '4px 6px',
                cursor: 'pointer',
                fontWeight: 600,
                borderRadius: 6,
              }}
            >
              {m.title}
            </button>

            {/* Dropdown */}
            {openIndex === i && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  minWidth: 240,
                  background: 'rgba(11,18,35,0.98)',
                  border: '1px solid #263043',
                  boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
                  borderRadius: 8,
                  padding: 6,
                }}
                onMouseLeave={() => setOpenIndex(null)}
              >
                {m.items.map((it, idx) => (
                  <div key={idx}>
                    {it.dividerAbove && (
                      <div style={{ height: 1, background: '#263043', margin: '6px 4px' }} />
                    )}
                    <button
                      disabled={!!it.disabled}
                      onClick={() => {
                        if (it.disabled) return
                        setOpenIndex(null)
                        it.onClick?.()
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between', // shortcut right aligned
                        gap: 12,
                        padding: '6px 8px',
                        border: 'none',
                        background: 'transparent',
                        cursor: it.disabled ? 'default' : 'pointer',
                        color: it.disabled ? '#64748b' : '#e2e8f0',
                        borderRadius: 6,
                      }}
                      onMouseEnter={(e) => {
                        if (!it.disabled) (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)')
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    >
                      <span style={{ pointerEvents: 'none' }}>{it.label}</span>
                      {it.shortcut && (
                        <span
                          style={{
                            fontSize: 12,
                            color: '#94a3b8', // muted shortcut
                            pointerEvents: 'none',
                          }}
                        >
                          {it.shortcut}
                        </span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* RIGHT: environment switcher (or any extra) */}
      <div style={{ marginLeft: 12 }}>{rightSlot}</div>
    </div>
  )
}
