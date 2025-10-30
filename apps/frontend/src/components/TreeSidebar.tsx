import { useEffect, useRef, useState } from 'react'
import {
  useTree,
  type TreeItem,
  getTree,
  mkdir,
  removePath,
  movePath,
  copyPath,
  downloadFile,
  downloadZip,
  putFile,
} from '../services/files'
import ContextMenu, { type CtxItem } from './ContextMenu'

type Node = {
  path: string
  name: string
  isDir: boolean
  expanded: boolean
  children?: Node[]
  loading?: boolean
}
type Clipboard = { mode: 'cut' | 'copy'; src: string; isDir: boolean } | null

function labelStyle(): React.CSSProperties {
  return {
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
    color: '#e2e8f0',
  }
}

function Row({
  node,
  level,
  selectedPath,
  onSelect,
  onToggle,
  onOpen,
  onContext,
}: {
  node: Node
  level: number
  selectedPath?: string
  onSelect: (n: Node) => void
  onToggle: (n: Node) => void
  onOpen: (n: Node) => void
  onContext: (n: Node, x: number, y: number) => void
}) {
  const isSel = selectedPath === node.path
  return (
    <div
      onClick={() => onSelect(node)}
      onDoubleClick={() => (node.isDir ? onToggle(node) : onOpen(node))}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContext(node, e.clientX, e.clientY)
      }}
      style={{
        paddingLeft: level * 14,
        display: 'flex',
        alignItems: 'center',
        userSelect: 'none',
        background: isSel ? 'rgba(56,189,248,0.14)' : 'transparent',
        color: '#e2e8f0',
        whiteSpace: 'nowrap',
      }}
      title={node.path}
    >
      {node.isDir ? (
        <span
          title={node.expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(node)
          }}
          style={{
            width: 16,
            cursor: 'pointer',
            color: '#38bdf8',
            display: 'inline-flex',
            justifyContent: 'center',
          }}
        >
          {node.expanded ? '▾' : '▸'}
        </span>
      ) : (
        <span style={{ width: 16 }} />
      )}
      <span style={labelStyle()} title={node.name}>
        {node.isDir ? (
          <span style={{ color: '#fbbf24' }}>📁</span>
        ) : (
          <span style={{ color: '#94a3b8' }}>📄</span>
        )}{' '}
        {node.name}
      </span>
    </div>
  )
}

export default function TreeSidebar({
  onOpen,
  onRefreshRoot,
}: {
  onOpen: (item: TreeItem) => void
  onRefreshRoot?: () => void
}) {
  const rootPath = ''
  const { data, isLoading, refetch } = useTree(rootPath)

  const [rootNodes, setRootNodes] = useState<Node[]>([])
  const [width, setWidth] = useState(320)
  const dragRef = useRef<{ dragging: boolean; startX: number; startW: number }>({
    dragging: false,
    startX: 0,
    startW: 0,
  })

  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [menu, setMenu] = useState<{ x: number; y: number; node: Node } | null>(null)
  const [clip, setClip] = useState<Clipboard>(null)

  // hidden inputs for import
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)

  // Seed roots
  useEffect(() => {
    if (data) setRootNodes(data.map((d) => ({ path: d.path, name: d.name, isDir: d.isDir, expanded: false })))
  }, [data])

  // --- helpers ---
  async function fetchChildren(path: string): Promise<Node[]> {
    let items = await getTree(path)
    items = items.filter((d) => d.path !== path)
    return items.map((d) => {
      const relative = d.path.startsWith(path + '/') ? d.path.slice(path.length + 1) : d.path
      const short = relative.split('/').pop() || d.name
      return { path: d.path, name: short, isDir: d.isDir, expanded: false }
    })
  }

  function findNode(list: Node[], path: string): Node | undefined {
    for (const n of list) {
      if (n.path === path) return n
      if (n.children) {
        const found = findNode(n.children, path)
        if (found) return found
      }
    }
    return undefined
  }

  async function refreshPath(path: string) {
    if (!path) {
      await refetch()
      return
    }
    const n = findNode(rootNodes, path)
    if (!n) {
      await refetch()
      return
    }
    if (!n.isDir) {
      const parent = path.split('/').slice(0, -1).join('/')
      return refreshPath(parent)
    }
    if (n.expanded) {
      n.loading = true
      setRootNodes([...rootNodes])
      n.children = await fetchChildren(n.path)
      n.loading = false
      setRootNodes([...rootNodes])
    }
  }

  async function expandNode(n: Node) {
    if (!n.isDir) return
    n.expanded = true
    if (!n.children) {
      n.loading = true
      setRootNodes([...rootNodes])
      n.children = await fetchChildren(n.path)
      n.loading = false
      setRootNodes([...rootNodes])
    } else {
      setRootNodes([...rootNodes])
    }
  }
  function collapseNode(n: Node) {
    n.expanded = false
    if (n.children) n.children.forEach((c) => (c.expanded = false))
    setRootNodes([...rootNodes])
  }
  function toggle(n: Node) {
    n.expanded ? collapseNode(n) : expandNode(n)
  }

  function open(n: Node) {
    if (n.isDir) return
    onOpen({ name: n.name, path: n.path, isDir: false })
  }
  function select(n: Node) {
    setSelected(n.path)
  }
  function context(n: Node, x: number, y: number) {
    setSelected(n.path)
    setMenu({ node: n, x, y })
  }

  function smartDefaultExt(name: string, parentDir: string): string {
    if (/\.[A-Za-z0-9]+$/.test(name)) return name // has extension
    const lower = (parentDir + '/' + name).toLowerCase()
    if (lower.includes('map') || lower.endsWith('/map') || lower.endsWith('/ditamap')) return name + '.ditamap'
    if (lower.includes('.html') || lower.endsWith('/html')) return name + '.html'
    if (lower.includes('json') || lower.endsWith('/work')) return name + '.json'
    return name + '.dita'
  }
  function mimeFor(name: string) {
    const n = name.toLowerCase()
    if (n.endsWith('.json')) return 'application/json'
    if (n.endsWith('.html') || n.endsWith('.htm')) return 'text/html; charset=utf-8'
    if (n.endsWith('.xml') || n.endsWith('.dita') || n.endsWith('.ditamap')) return 'text/xml; charset=utf-8'
    return 'text/plain; charset=utf-8'
  }

  // --- actions (all refresh the UI immediately) ---
  async function newFileAt(targetDir: string) {
    const raw = prompt('New file name (e.g., topic, topic.dita, map.ditamap, index.html, data.json)')
    if (!raw) return
    const name = smartDefaultExt(raw.trim(), targetDir)
    const dest = (targetDir ? targetDir.replace(/\/$/, '') + '/' : '') + name
    await putFile(dest, '\n', mimeFor(name))
    await refreshPath(targetDir)
    onRefreshRoot?.()
    setSelected(dest)
  }

  async function newFolderAt(targetDir: string) {
    const name = prompt('New folder name')
    if (!name) return
    const dest = (targetDir ? targetDir.replace(/\/$/, '') + '/' : '') + name
    await mkdir(dest)
    await refreshPath(targetDir)
    onRefreshRoot?.()
    setSelected(dest)
  }

  async function doDelete(p: string) {
    if (!confirm(`Delete ${p}? This cannot be undone.`)) return
    await removePath(p)
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    await refreshPath(parent)
    onRefreshRoot?.()
    setSelected(undefined)
  }

  async function doRename(p: string) {
    const base = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    const cur = p.split('/').pop() || ''
    const name = prompt('Rename to:', cur)
    if (!name || name === cur) return
    const dst = base ? `${base}/${name}` : name
    await movePath(p, dst)
    await refreshPath(base || '')
    onRefreshRoot?.()
    setSelected(dst)
  }

  async function doPaste(targetDir: string) {
    if (!clip) return
    const name = clip.src.split('/').pop()!
    const dst = (targetDir ? targetDir.replace(/\/$/, '') + '/' : '') + name
    if (clip.mode === 'cut') await movePath(clip.src, dst)
    else await copyPath(clip.src, dst)
    setClip(null)
    await refreshPath(targetDir)
    onRefreshRoot?.()
    setSelected(dst)
  }

  function exportPath(n: Node) {
    if (n.isDir) downloadZip(n.path)
    else downloadFile(n.path)
  }

  async function handleImportFiles(targetDir: string, files: FileList) {
    for (const f of Array.from(files)) {
      const buf = await f.arrayBuffer()
      const dest = (targetDir ? targetDir.replace(/\/$/, '') + '/' : '') + f.name
      // safest generic content-type for arbitrary uploads
      await putFile(dest, new TextDecoder().decode(new Uint8Array(buf)), 'application/octet-stream')
    }
    await refreshPath(targetDir)
    onRefreshRoot?.()
  }

  async function handleImportFolders(targetDir: string, files: FileList) {
    for (const f of Array.from(files)) {
      const rel = (f as any).webkitRelativePath || f.name
      const dest = (targetDir ? targetDir.replace(/\/$/, '') + '/' : '') + rel.replace(/^\.?\//, '')
      const buf = await f.arrayBuffer()
      await putFile(dest, new TextDecoder().decode(new Uint8Array(buf)), 'application/octet-stream')
    }
    await refreshPath(targetDir)
    onRefreshRoot?.()
  }

  function itemsFor(n: Node): CtxItem[] {
    const dir = n.isDir ? n.path : n.path.split('/').slice(0, -1).join('/')
    return [
      { label: 'New File', onClick: () => newFileAt(n.isDir ? n.path : dir) },
      { label: 'New Folder', onClick: () => newFolderAt(n.isDir ? n.path : dir) },
      {
        label: 'Import Folders',
        onClick: () => {
          const el = dirInputRef.current!
          el.onchange = (e: any) => handleImportFolders(n.isDir ? n.path : dir, e.target.files)
          el.click()
        },
      },
      {
        label: 'Import Files',
        onClick: () => {
          const el = fileInputRef.current!
          el.onchange = (e: any) => handleImportFiles(n.isDir ? n.path : dir, e.target.files)
          el.click()
        },
      },
      { label: 'Export (File/Folder)', onClick: () => exportPath(n) },
      { dividerAbove: true, label: 'Cut', onClick: () => setClip({ mode: 'cut', src: n.path, isDir: n.isDir }) },
      { label: 'Copy', onClick: () => setClip({ mode: 'copy', src: n.path, isDir: n.isDir }) },
      { label: 'Paste', onClick: () => doPaste(n.isDir ? n.path : dir), disabled: !clip },
      { label: 'Rename', onClick: () => doRename(n.path) },
      { label: 'Delete', onClick: () => doDelete(n.path) },
      { label: 'Refresh', onClick: () => refreshPath(n.isDir ? n.path : dir) },
      { dividerAbove: true, label: 'Find/Replace in Files', onClick: () => alert('Find/Replace UI coming next') },
    ]
  }

  // --- resizer (window-level listeners only while dragging) ---
  function onResizeDown(e: React.MouseEvent) {
    dragRef.current = { dragging: true, startX: e.clientX, startW: width }
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', onResizeUp, { once: true })
    e.preventDefault()
  }
  function onResizeMove(e: MouseEvent) {
    if (!dragRef.current.dragging) return
    const dx = e.clientX - dragRef.current.startX
    const w = Math.max(200, Math.min(600, dragRef.current.startW + dx))
    setWidth(w)
  }
  function onResizeUp() {
    dragRef.current.dragging = false
    window.removeEventListener('mousemove', onResizeMove)
  }
  function render(nodes: Node[], level = 0): JSX.Element[] {
    return nodes.map((node) => (
      <div key={node.path}>
        <Row
          node={node}
          level={level}
          selectedPath={selected}
          onSelect={select}
          onToggle={toggle}
          onOpen={open}
          onContext={context}
        />
        {node.isDir && node.expanded && (
          node.loading
            ? <div style={{ paddingLeft: (level + 1) * 14, color: '#94a3b8', padding: '2px 8px' }}>Loading…</div>
            : (node.children && node.children.length
                ? render(node.children, level + 1)
                : <div style={{ paddingLeft: (level + 1) * 14, color: '#64748b', padding: '2px 8px' }}>(empty)</div>
              )
        )}
      </div>
    ))
  }


  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* panel */}
      <div
        style={{
          width,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 1,
          borderRight: '1px solid #263043',
        }}
      >
        <div style={{ padding: 6, borderBottom: '1px solid #263043', display: 'flex', gap: 6 }}>
          <button onClick={() => refetch()}>Refresh root</button>
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} multiple />
          {/* @ts-ignore Chromium folder picker */}
          <input ref={dirInputRef} type="file" style={{ display: 'none' }} webkitdirectory="true" />
        </div>
        {/* both-axis scroll; inner minWidth enables horizontal scrollbar when narrow */}
        <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
          <div style={{ minWidth: 260 }}>
            {isLoading ? <div style={{ padding: 8 }}>Loading…</div> : render(rootNodes)}
          </div>
        </div>
      </div>

      {/* handle */}
      <div
        onMouseDown={onResizeDown}
        style={{
          width: 6,
          cursor: 'col-resize',
          background: 'rgba(255,255,255,0.06)',
          borderRight: '1px solid #263043',
          userSelect: 'none',
        }}
      />

      {/* context menu via portal (no clipping) */}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={itemsFor(menu.node)} onClose={() => setMenu(null)} />}
    </div>
  )
}
