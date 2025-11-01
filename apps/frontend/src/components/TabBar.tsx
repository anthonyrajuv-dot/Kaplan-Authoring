import { useEffect, useState } from 'react'
import ContextMenu, { type CtxItem } from './ContextMenu'

export type Tab = { path: string; name: string; url: string; dirty?: boolean }

export default function TabBar({
  tabs, active, onActivate, onClose, onCopyUrl, onRefresh
}: {
  tabs: Tab[]
  active: string | undefined
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onCopyUrl: (path: string) => void
  onRefresh: (path: string) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; tab: Tab } | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q' && active) {
        e.preventDefault(); onClose(active)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, onClose])

  function itemsFor(t: Tab): CtxItem[] {
    return [
      { label: 'Refresh', onClick: () => onRefresh(t.path) },
      { label: 'Copy Location', onClick: () => onCopyUrl(t.path) },
      { label: 'Close', onClick: () => onClose(t.path) },
    ]
  }

  return (
    <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderBottom: '1px solid #eee', overflowX: 'auto' }}>
      {tabs.map((t) => (
        <div
          key={t.path}
          onClick={() => onActivate(t.path)}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, tab: t }) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
            border: '1px solid ' + (active === t.path ? '#2684ff' : '#0f172a'),
            background: '#0f172a',
            borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none'
          }}
          title={t.path}
        >
          <span>{t.name}{t.dirty ? '*' : ''}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(t.path) }}
            title="Close (Ctrl+Q)"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color:'#94a3b8' }}
          >✕</button>
        </div>
      ))}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={itemsFor(menu.tab)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
