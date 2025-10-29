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

export default function MenuBar({ menus }: { menus: Menu[] }) {
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
        gap: 12,
        padding: '4px 8px',
        borderBottom: '1px solid #ddd',
        userSelect: 'none',
        background: '#fafafa',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {menus.map((m, i) => (
        <div
          key={m.title}
          style={{ position: 'relative' }}
          onMouseEnter={() => (openIndex !== null ? setOpenIndex(i) : undefined)}
        >
          <button
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            style={{
              background: openIndex === i ? '#e9e9e9' : 'transparent',
              border: 'none',
              padding: '4px 6px',
              cursor: 'pointer',
              fontWeight: 600,
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
                background: '#fff',
                border: '1px solid #ddd',
                boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
                borderRadius: 4,
                padding: 6,
              }}
              onMouseLeave={() => setOpenIndex(null)}
            >
              {m.items.map((it, idx) => (
                <div key={idx}>
                  {it.dividerAbove && (
                    <div style={{ height: 1, background: '#eee', margin: '6px 4px' }} />
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
                      justifyContent: 'space-between', // <-- shortcut right aligned
                      gap: 12,
                      padding: '6px 8px',
                      border: 'none',
                      background: 'transparent',
                      cursor: it.disabled ? 'default' : 'pointer',
                      color: it.disabled ? '#aaa' : '#222',
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) => {
                      if (!it.disabled) (e.currentTarget.style.backgroundColor = '#f4f4f4')
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
                          color: '#888', // muted shortcut
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
  )
}
