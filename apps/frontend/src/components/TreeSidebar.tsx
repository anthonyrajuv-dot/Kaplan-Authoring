import { useEffect, useRef, useState } from 'react'
import { useTree, TreeItem, mkdir, removePath, movePath, copyPath, downloadFile, downloadZip, getTree  } from '../services/files'
import ContextMenu, { type CtxItem } from './ContextMenu'

type Node = { path: string; name: string; isDir: boolean; expanded: boolean; children?: Node[]; loading?: boolean }
type Clipboard = { mode: 'cut' | 'copy'; src: string; isDir: boolean } | null

function labelStyle(): React.CSSProperties {
  return {
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
    color: '#e2e8f0'
  }
}

async function expandFolder(path: string) {
  try {
    const data = await getTree(path)   // ← uses API_BASE
    // update state with children...
  } catch (e) {
    console.error('Failed to load folder', path, e)
    alert(`Failed to load folder: ${path}`)
  }
}

function Row({
  node, level, selectedPath, onSelect, onToggle, onOpen, onContext
}: {
  node: Node; level: number; selectedPath?: string;
  onSelect: (n:Node)=>void; onToggle: (n:Node)=>void; onOpen: (n:Node)=>void;
  onContext: (n:Node, x:number, y:number)=>void;
}) {
  const isSel = selectedPath === node.path
  return (
    <div
      onClick={() => onSelect(node)}
      onDoubleClick={() => node.isDir ? onToggle(node) : onOpen(node)}
      onContextMenu={(e)=>{ e.preventDefault(); onContext(node, e.clientX, e.clientY) }}
      style={{
        paddingLeft: level*14,
        display:'flex',
        alignItems:'center',
        userSelect:'none',
        background: isSel ? 'rgba(56,189,248,0.14)' : 'transparent',
        color: '#e2e8f0'
      }}
      title={node.path}
    >
      {node.isDir
        ? <span title={node.expanded?'Collapse':'Expand'} onClick={(e)=>{ e.stopPropagation(); onToggle(node) }} style={{ width:14, cursor:'pointer', color:'#38bdf8', display:'inline-flex', justifyContent:'center' }}>{node.expanded ? '▾' : '▸'}</span>
        : <span style={{ width:14 }} />}
      <span style={labelStyle()} title={node.name}>
        {node.isDir ? <span style={{color:'#fbbf24'}}>📁</span> : <span style={{color:'#94a3b8'}}>📄</span>}{" "} {node.name}
      </span>
    </div>
  )
}

export default function TreeSidebar({
  onOpen, onRefreshRoot
}: { onOpen: (item: TreeItem)=>void; onRefreshRoot?: ()=>void }) {

  const rootPath = ''
  const { data, isLoading, refetch } = useTree(rootPath)
  const [rootNodes, setRootNodes] = useState<Node[]>([])
  const [width, setWidth] = useState(320)
  const [drag, setDrag] = useState(false)
  const dragRef = useRef<{ dragging: boolean; startX: number; startW: number }>({ dragging:false, startX:0, startW:0 })

  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [menu, setMenu] = useState<{x:number;y:number;node:Node}|null>(null)
  const [clip, setClip] = useState<Clipboard>(null)

  // inputs for import
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)

  // Build root from query
  useEffect(()=>{
    if (data) setRootNodes(data.map(d => ({ path:d.path, name:d.name, isDir:d.isDir, expanded:false })))
  }, [data])

  // ---- Helpers to (re)load children of a specific path (for instant UI) ----
  async function fetchChildren(path: string): Promise<Node[]> {
    let items = await getTree(path)
    items = items.filter(d => d.path !== path)
    return items.map(d => {
      const relative = d.path.startsWith(path + "/") ? d.path.slice(path.length + 1) : d.path
      const short = relative.split('/').pop() || d.name
      return { path: d.path, name: short, isDir: d.isDir, expanded: false }
    })
  }

  // find a node by path within the current tree
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
    // refresh children under 'path' if that node exists & is expanded; otherwise refresh root list
    if (!path) {
      // refresh root
      await refetch()
      return
    }
    const n = findNode(rootNodes, path)
    if (!n) {
      // if not found (e.g., newly created top-level), refresh root
      await refetch()
      return
    }
    if (!n.isDir) {
      // refresh parent instead
      const parent = path.split('/').slice(0,-1).join('/')
      return refreshPath(parent)
    }
    if (n.expanded) {
      n.loading = true; setRootNodes([...rootNodes])
      n.children = await fetchChildren(n.path)
      n.loading = false; setRootNodes([...rootNodes])
    }
  }

  // ---- Expand / collapse ----
  async function expandNode(n: Node){
    if (!n.isDir) return
    n.expanded = true
    if (!n.children){
      n.loading = true; setRootNodes([...rootNodes])
      n.children = await fetchChildren(n.path)
      n.loading = false; setRootNodes([...rootNodes])
    } else {
      setRootNodes([...rootNodes])
    }
  }
  function collapseNode(n: Node){
    n.expanded = false
    if (n.children) n.children.forEach(c => c.expanded = false)
    setRootNodes([...rootNodes])
  }
  function toggle(n: Node){ n.expanded ? collapseNode(n) : expandNode(n) }

  // ---- Selection / context / open ----
  function open(n: Node){ onOpen({ name:n.name, path:n.path, isDir:false }) }
  function select(n: Node){ setSelected(n.path) }
  function context(n: Node, x: number, y: number){ setSelected(n.path); setMenu({ node:n, x, y }) }

  // ---- Recursive renderer ----
  function render(list: Node[], level=0): JSX.Element[] {
    const rows: JSX.Element[] = []
    for (const n of list){
      rows.push(<Row key={n.path} node={n} level={level} selectedPath={selected}
                     onSelect={select} onToggle={toggle} onOpen={open} onContext={context}/>)
      if (n.isDir && n.expanded){
        if (n.loading) rows.push(<div key={n.path+'-loading'} style={{ paddingLeft:(level+1)*14, color:'#666' }}>Loading…</div>)
        else if (n.children?.length) rows.push(...render(n.children, level+1))
      }
    }
    return rows
  }  

  function smartDefaultExt(name: string, parentDir: string): string {
  if (/\.[A-Za-z0-9]+$/.test(name)) return name // already has an extension
  const lower = parentDir.toLowerCase() + '/' + name.toLowerCase()
  if (lower.includes('map') || lower.endsWith('/map') || lower.endsWith('/ditamap')) return name + '.ditamap'
  if (lower.includes('.html') || lower.includes('html/')) return name + '.html'
  if (lower.includes('json') || lower.endsWith('/work')) return name + '.json'
  // default for DITA authoring
  return name + '.dita'
}

// ---- Actions (all trigger refreshPath for instant UI) ----
async function newFileAt(targetDir: string){
  const raw = prompt('New file name (e.g., topic, topic.dita, map.ditamap, index.html, data.json)')
  if (!raw) return
  const name = smartDefaultExt(raw.trim(), targetDir)
  const dest = targetDir.replace(/\/$/,'') + '/' + name
  await fetch(`/api/files/content?path=${encodeURIComponent(dest)}`, {
    method:'PUT', headers:{'Content-Type':'text/plain; charset=utf-8'}, body:'\n'
  })
  await refreshPath(targetDir)
  onRefreshRoot?.()
  setSelected(dest)
}

  
  async function newFolderAt(targetDir: string){
    const name = prompt('New folder name')
    if (!name) return
    const dest = targetDir.replace(/\/$/,'') + '/' + name
    await mkdir(dest)
    await refreshPath(targetDir)           // << instant update
    onRefreshRoot?.()
    setSelected(dest)
  }
  async function doDelete(p: string){
    if (!confirm('Delete permanently?')) return
    await removePath(p)
    const parent = p.split('/').slice(0,-1).join('/')
    await refreshPath(parent)              // << instant update of parent
    onRefreshRoot?.()
    setSelected(undefined)
  }
  async function doRename(p: string){
    const base = p.split('/').slice(0,-1).join('/')
    const cur = p.split('/').pop() || ''
    const name = prompt('Rename to:', cur)
    if (!name || name === cur) return
    const dst = (base ? base + '/' : '') + name
    await movePath(p, dst)
    await refreshPath(base || '')          // << refresh parent or root
    onRefreshRoot?.()
    setSelected(dst)
  }
  async function doPaste(targetDir: string){
    if (!clip) return
    const name = clip.src.split('/').pop()!
    const dst = targetDir.replace(/\/$/,'') + '/' + name
    if (clip.mode === 'cut') await movePath(clip.src, dst)
    else await copyPath(clip.src, dst)
    setClip(null)
    await refreshPath(targetDir)           // << instant update
    onRefreshRoot?.()
    setSelected(dst)
  }
  function exportPath(n: Node){
    if (n.isDir) downloadZip(n.path); else downloadFile(n.path)
  }

  // Import files/folders
  async function handleImportFiles(targetDir: string, files: FileList){
    for (const f of Array.from(files)){
      const buf = await f.arrayBuffer()
      const dest = targetDir.replace(/\/$/,'') + '/' + f.name
      await fetch(`/api/files/content?path=${encodeURIComponent(dest)}`, {
        method:'PUT', headers:{'Content-Type':'text/plain; charset=utf-8'}, body: buf
      })
    }
    await refreshPath(targetDir)           // << instant update
    onRefreshRoot?.()
  }
  async function handleImportFolders(targetDir: string, files: FileList){
    for (const f of Array.from(files)){
      const rel = (f as any).webkitRelativePath || f.name
      const dest = targetDir.replace(/\/$/,'') + '/' + rel.replace(/^\.?\//,'')
      const buf = await f.arrayBuffer()
      await fetch(`/api/files/content?path=${encodeURIComponent(dest)}`, {
        method:'PUT', headers:{'Content-Type':'text/plain; charset=utf-8'}, body: buf
      })
    }
    await refreshPath(targetDir)           // << instant update
    onRefreshRoot?.()
  }

  function itemsFor(n: Node): CtxItem[] {
    const dir = n.isDir ? n.path : n.path.split('/').slice(0,-1).join('/')
    return [
      { label:'New File', onClick:()=>newFileAt(n.isDir ? n.path : dir) },
      { label:'New Folder', onClick:()=>newFolderAt(n.isDir ? n.path : dir) },
      { label:'Import Folders', onClick:()=>{ const el = dirInputRef.current!; el.onchange = (e:any)=>{ handleImportFolders(n.isDir?n.path:dir, e.target.files) }; el.click() } },
      { label:'Import Files', onClick:()=>{ const el = fileInputRef.current!; el.onchange = (e:any)=>{ handleImportFiles(n.isDir?n.path:dir, e.target.files) }; el.click() } },
      { label:'Export (File/Folder)', onClick:()=>exportPath(n) },
      { dividerAbove: true, label:'Cut', onClick:()=>setClip({ mode:'cut', src:n.path, isDir:n.isDir }) },
      { label:'Copy', onClick:()=>setClip({ mode:'copy', src:n.path, isDir:n.isDir }) },
      { label:'Paste', onClick:()=>doPaste(n.isDir ? n.path : dir), disabled: !clip },
      { label:'Rename', onClick:()=>doRename(n.path) },
      { label:'Delete', onClick:()=>doDelete(n.path) },
      { label:'Refresh', onClick:()=>refreshPath(n.isDir ? n.path : dir) },
      { dividerAbove: true, label:'Find/Replace in Files', onClick:()=>alert('Find/Replace UI coming next') },
    ]
  }

  // Resizer
  function onResizeDown(e: React.MouseEvent) {
    dragRef.current = { dragging: true, startX: e.clientX, startW: width }
    // attach to window while dragging
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

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden'}} onMouseMove={onResizeMove} onMouseUp={onResizeUp}>
      <div style={{ width, borderRight:'1px solid #ddd', display:'flex', flexDirection:'column', overflow:'hidden', position: 'relative', zIndex: 1 }}>
        <div style={{ padding:6, borderBottom:'1px solid #eee', display:'flex', gap:6}}>
          <button onClick={()=>refetch()}>Refresh root</button>
          {/* Hidden inputs used by Import actions */}
          <input ref={fileInputRef} type="file" style={{ display:'none' }} multiple />
          {/* @ts-ignore  - Chromium: folder picker */}
          <input ref={dirInputRef} type="file" style={{ display:'none' }} webkitdirectory="true" />
        </div>
        <div style={{ overflow:'auto', flex:1 }}>
          {isLoading ? <div style={{padding:8}}>Loading…</div> : render(rootNodes)}
        </div>
      </div>
      <div onMouseDown={onResizeDown} style={{ width:6, cursor:'col-resize', background:'#0f172a', borderRight: '1px solid #263043',  zIndex: 0, userSelect: 'none' }} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={itemsFor(menu.node)} onClose={()=>setMenu(null)} />}
    </div>
  )
}
