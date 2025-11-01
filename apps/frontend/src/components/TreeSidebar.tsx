import { useEffect, useRef, useState } from 'react'
import ContextMenu, { type CtxItem } from './ContextMenu'
import DraggableDialog from './DraggableDialog'
import {
  getTree, type TreeItem,
  mkdir, putFile, removePath, movePath, copyPath,
  downloadFile, downloadZip
} from '../services/files'

type Node = {
  path: string
  name: string
  isDir: boolean
  expanded: boolean
  children?: Node[]
  loading?: boolean
}

type Clipboard = { mode:'cut'|'copy'; src:string; isDir:boolean } | null

type ModalState =
  | { kind: 'none' }
  | { kind: 'new-file'; dir: string; name: string }
  | { kind: 'new-folder'; dir: string; name: string }
  | { kind: 'rename'; path: string; name: string }
  | { kind: 'confirm-delete'; path: string; isDir: boolean }
  | { kind: 'import'; mode: 'files' | 'folders'; dir: string; items: ImportItem[]; busy?: boolean }

type ImportItem = { relPath: string; file: File }

export default function TreeSidebar({
  onOpen,
  onAction,
  canPaste,
  registerReload,
}: {
  onOpen: (item: TreeItem) => void
  onAction?: (a: { type:string; path:string; isDir:boolean }) => Promise<boolean|void> | boolean | void
  canPaste?: boolean
  registerReload?: (fn: (path: string)=>Promise<void>) => void
}) {
  // ----- state -----
  const [rootNodes, setRootNodes] = useState<Node[]>([])
  const [loadingRoot, setLoadingRoot] = useState(true)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [menu, setMenu] = useState<{ x:number; y:number; node:Node }|null>(null)
  const [panelWidth, setPanelWidth] = useState(300)
  const drag = useRef<{startX:number; startW:number; active:boolean}>({ startX:0, startW:0, active:false })
  const [clip, setClip] = useState<Clipboard>(null)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })

  // hidden pickers (fallback)
  const filesPickerRef = useRef<HTMLInputElement>(null)
  const dirPickerRef = useRef<HTMLInputElement>(null)

  // ----- initial load -----
  useEffect(() => {
    (async () => {
      setLoadingRoot(true)
      const items = await getTree('')
      setRootNodes(items.map(d => ({ path:d.path, name:d.name, isDir:d.isDir, expanded:false })))
      setLoadingRoot(false)
    })()
  }, [])

  // expose a reload(path) fn to parent (App)
  useEffect(() => {
    if (!registerReload) return
    registerReload(async (p: string) => { await refreshPath(p) })
  }, [registerReload, rootNodes])

  // ----- helpers -----
  async function fetchChildren(path: string): Promise<Node[]> {
    let items = await getTree(path)
    items = items.filter(d => d.path !== path)
    return items.map(d => {
      const relative = d.path.startsWith(path + '/') ? d.path.slice(path.length + 1) : d.path
      const short = relative.split('/').pop() || d.name
      return { path:d.path, name:short, isDir:d.isDir, expanded:false }
    })
  }

  function findNode(list: Node[], path: string): Node | undefined {
    for (const n of list) {
      if (n.path === path) return n
      if (n.children) {
        const f = findNode(n.children, path)
        if (f) return f
      }
    }
    return undefined
  }

  async function refreshPath(path: string) {
    if (!path) {
      setLoadingRoot(true)
      const items = await getTree('')
      setRootNodes(items.map(d => ({ path:d.path, name:d.name, isDir:d.isDir, expanded:false })))
      setLoadingRoot(false)
      return
    }
    const n = findNode(rootNodes, path)
    if (!n) return
    if (!n.isDir) {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
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
    }
    setRootNodes([...rootNodes])
  }
  function collapseNode(n: Node) {
    n.expanded = false
    if (n.children) n.children.forEach(c => c.expanded = false)
    setRootNodes([...rootNodes])
  }
  function toggle(n: Node) { n.expanded ? collapseNode(n) : expandNode(n) }

  function onRowClick(n: Node) { setSelected(n.path) }
  function onRowOpen(n: Node) { if (!n.isDir) onOpen({ name:n.name, path:n.path, isDir:false }) }
  function onRowCtx(n: Node, x:number, y:number) { setSelected(n.path); setMenu({ node:n, x, y }) }

  // ----- smart helpers -----
  function smartExt(name: string, parentDir: string) {
    if (/\.[A-Za-z0-9]+$/.test(name)) return name
    const low = (parentDir + '/' + name).toLowerCase()
    if (low.includes('map') || low.endsWith('/map') || low.endsWith('/ditamap')) return name + '.ditamap'
    if (low.includes('html') || low.endsWith('/html')) return name + '.html'
    if (low.includes('json') || low.endsWith('/work')) return name + '.json'
    return name + '.dita'
  }
  function mimeFor(n: string) {
    const s = n.toLowerCase()
    if (s.endsWith('.json')) return 'application/json'
    if (s.endsWith('.html') || s.endsWith('.htm')) return 'text/html; charset=utf-8'
    if (s.endsWith('.xml') || s.endsWith('.dita') || s.endsWith('.ditamap')) return 'text/xml; charset=utf-8'
    return 'application/octet-stream'
  }

  // ----- actions (new/rename/delete/export/paste) -----
  async function actNewFile(targetDir: string) { setModal({ kind: 'new-file', dir: targetDir, name: '' }) }
  async function actNewFolder(targetDir: string) { setModal({ kind: 'new-folder', dir: targetDir, name: '' }) }
  async function actDelete(p: string, isDir: boolean) { setModal({ kind: 'confirm-delete', path: p, isDir }) }
  async function actRename(p: string) {
    const cur = p.split('/').pop() || ''
    setModal({ kind: 'rename', path: p, name: cur })
  }
  async function actPaste(targetDir: string) {
    if (!clip) return
    const name = clip.src.split('/').pop()!
    const dst = (targetDir ? targetDir.replace(/\/$/, '') + '/' : '') + name
    if (clip.mode === 'cut') await movePath(clip.src, dst)
    else await copyPath(clip.src, dst)
    setClip(null)
    await refreshPath(targetDir)
    setSelected(dst)
  }
  function actExport(n: Node) { n.isDir ? downloadZip(n.path) : downloadFile(n.path) }

  // ----- IMPORT: drag-and-drop collector -----
  async function readDropped(dt: DataTransfer, mode: 'files' | 'folders'): Promise<ImportItem[]> {
    // Prefer directory traversal via webkitGetAsEntry for folders
    const items = dt.items ? Array.from(dt.items) : []
    const results: ImportItem[] = []

    async function traverseEntry(entry: any, prefix = ''): Promise<void> {
      if (!entry) return
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          entry.file((file: File) => {
            results.push({ relPath: prefix + file.name, file })
            resolve()
          })
        })
      } else if (entry.isDirectory) {
        const reader = entry.createReader()
        await new Promise<void>((resolve, reject) => {
          const acc: any[] = []
          const read = () => {
            reader.readEntries(async (entries: any[]) => {
              if (!entries.length) {
                // done
                for (const e of acc) {
                  await traverseEntry(e, prefix + entry.name + '/')
                }
                resolve()
                return
              }
              acc.push(...entries)
              read()
            }, reject)
          }
          read()
        })
      }
    }

    // If we have entries, we can preserve folder structure
    if (items.length && (items[0] as any).webkitGetAsEntry) {
      for (const it of items) {
        const entry = (it as any).webkitGetAsEntry()
        if (!entry) continue
        if (mode === 'files' && entry.isDirectory) {
          // skip directories in "files" mode
          continue
        }
        await traverseEntry(entry, '')
      }
      return results
    }

    // Fallback: use dt.files (structure may be lost)
    const files = dt.files ? Array.from(dt.files) : []
    for (const f of files) {
      const rel = (f as any).webkitRelativePath || f.name
      if (mode === 'files') {
        // ignore folder pseudo-entries
        if (rel.endsWith('/')) continue
        // only names (no dirs)
        results.push({ relPath: f.name, file: f })
      } else {
        // folders mode: keep relative path if present; else name
        results.push({ relPath: rel || f.name, file: f })
      }
    }
    return results
  }

  function onDropZoneEvents(e: React.DragEvent, setHover: (b:boolean)=>void) {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setHover(true)
    if (e.type === 'dragleave') setHover(false)
  }

  async function handleImportUpload(dir: string, items: ImportItem[]) {
    // create any intermediate folders for folder-mode paths
    for (const it of items) {
      const rel = it.relPath.replace(/^\.?\//, '')
      const dst = (dir ? dir.replace(/\/$/, '') + '/' : '') + rel
      // ensure parent dirs exist when rel contains folders
      const segs = dst.split('/')
      if (segs.length > 1) {
        for (let i = 1; i < segs.length - 1; i++) {
          const folder = segs.slice(0, i + 1).join('/')
          try { await mkdir(folder) } catch { /* ignore exists */ }
        }
      }
      const buf = await it.file.arrayBuffer()
      await putFile(dst, new Uint8Array(buf) as any, mimeFor(dst))
    }
    await refreshPath(dir)
    setSelected(undefined)
  }

  // ----- dispatcher -----
  async function dispatch(type: string, n: Node) {
    const dir = n.isDir ? n.path : (n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '')

    if (onAction) {
      try {
        const maybe = onAction({ type, path:n.path, isDir:n.isDir })
        const handled = maybe instanceof Promise ? await maybe : maybe
        if (handled === true) return
      } catch {}
    }

    switch (type) {
      case 'new-file': return actNewFile(dir || n.path)
      case 'new-folder': return actNewFolder(dir || n.path)
      case 'import-files': return setModal({ kind:'import', mode:'files', dir: (dir || n.path), items: [] })
      case 'import-folders': return setModal({ kind:'import', mode:'folders', dir: (dir || n.path), items: [] })
      case 'export': return actExport(n)
      case 'cut': return setClip({ mode:'cut', src:n.path, isDir:n.isDir })
      case 'copy': return setClip({ mode:'copy', src:n.path, isDir:n.isDir })
      case 'paste': return actPaste(n.isDir ? n.path : dir)
      case 'rename': return actRename(n.path)
      case 'delete': return actDelete(n.path, n.isDir)
      case 'refresh': return refreshPath(n.isDir ? n.path : dir)
    }
  }

  function itemsFor(n: Node): CtxItem[] {
    return [
      { label:'New File', onClick:()=>dispatch('new-file', n) },
      { label:'New Folder', onClick:()=>dispatch('new-folder', n) },
      { label:'Import Files', onClick:()=>dispatch('import-files', n) },
      { label:'Import Folders', onClick:()=>dispatch('import-folders', n) },
      { label:'Export (File/Folder)', onClick:()=>dispatch('export', n) },
      { dividerAbove:true, label:'Cut', onClick:()=>dispatch('cut', n) },
      { label:'Copy', onClick:()=>dispatch('copy', n) },
      { label:'Paste', onClick:()=>dispatch('paste', n), disabled: !clip && !canPaste },
      { label:'Rename', onClick:()=>dispatch('rename', n) },
      { label:'Delete', onClick:()=>dispatch('delete', n) },
      { label:'Refresh', onClick:()=>dispatch('refresh', n), dividerAbove:true },
    ]
  }

  // ----- resizer -----
  function onHandleDown(e: React.MouseEvent) {
    drag.current = { startX:e.clientX, startW:panelWidth, active:true }
    window.addEventListener('mousemove', onHandleMove)
    window.addEventListener('mouseup', onHandleUp, { once:true })
  }
  function onHandleMove(e: MouseEvent) {
    if (!drag.current.active) return
    const dx = e.clientX - drag.current.startX
    const w = Math.max(220, Math.min(640, drag.current.startW + dx))
    setPanelWidth(w)
  }
  function onHandleUp() {
    drag.current.active = false
    window.removeEventListener('mousemove', onHandleMove)
  }

  // ----- render -----
  function Row({ node, level }: { node:Node; level:number }) {
    const isSel = selected === node.path
    return (
      <div
        onClick={()=>onRowClick(node)}
        onDoubleClick={()=> node.isDir ? toggle(node) : onRowOpen(node)}
        onContextMenu={(e)=>{ e.preventDefault(); e.stopPropagation(); onRowCtx(node, e.clientX, e.clientY) }}
        style={{
          paddingLeft: level*14,
          display:'flex', alignItems:'center', gap:6,
          userSelect:'none',
          background: isSel ? 'rgba(56,189,248,0.14)' : 'transparent',
          color:'#e2e8f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'
        }}
        title={node.path}
      >
        {node.isDir
          ? <span onClick={(e)=>{ e.stopPropagation(); toggle(node) }} style={{ width:16, cursor:'pointer', color:'#38bdf8', display:'inline-flex', justifyContent:'center' }}>{node.expanded ? '▾' : '▸'}</span>
          : <span style={{ width:16 }} />
        }
        <span style={{ color: node.isDir ? '#fbbf24' : '#94a3b8' }}>{node.isDir ? '📁' : '📄'}</span>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{node.name}</span>
      </div>
    )
  }

  function render(nodes: Node[], level = 0): JSX.Element[] {
    return nodes.map(n => (
      <div key={n.path}>
        <Row node={n} level={level}/>
        {n.isDir && n.expanded && (
          n.loading
            ? <div style={{ paddingLeft:(level+1)*14, color:'#94a3b8', padding:'2px 8px' }}>Loading…</div>
            : (n.children && n.children.length
                ? render(n.children, level+1)
                : <div style={{ paddingLeft:(level+1)*14, color:'#64748b', padding:'2px 8px' }}>(empty)</div>
              )
        )}
      </div>
    ))
  }

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>
      {/* Sidebar panel */}
      <div style={{
        width: panelWidth,
        display:'flex', flexDirection:'column', overflow:'hidden',
        borderRight:'1px solid #263043', background:'rgba(11, 18, 35, 0.92)'
      }}>
        <div style={{ padding:6, borderBottom:'1px solid #263043', display:'flex', gap:6, alignItems:'center' }}>
          <button onClick={()=>refreshPath('')}>Refresh root</button>
          {/* hidden pickers as fallback */}
          <input ref={filesPickerRef} type="file" style={{ display:'none' }} multiple onChange={async (e:any)=>{
            const files = Array.from(e.target.files || []) as File[]
            setModal(m => m.kind==='import' ? { ...m, items: files.map(f => ({ relPath: f.name, file: f })) } : m)
          }}/>
          {/* @ts-ignore folder picker */}
          <input ref={dirPickerRef} type="file" style={{ display:'none' }} webkitdirectory="true" onChange={async (e:any)=>{
            const files = Array.from(e.target.files || []) as any[]
            const items: ImportItem[] = files
              .filter(f => !f.name.endsWith('/'))
              .map(f => ({ relPath: (f.webkitRelativePath || f.name).replace(/^\.?\//,''), file: f }))
            setModal(m => m.kind==='import' ? { ...m, items } : m)
          }}/>
        </div>

        {/* Scroll area — both axes, with stable horizontal bar */}
        <div style={{ flex:1, overflowX:'auto', overflowY:'auto' }}>
          <div style={{ width:'max-content', minWidth: panelWidth - 40 }}>
            {loadingRoot ? <div style={{ padding:8 }}>Loading…</div> : render(rootNodes)}
          </div>
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onHandleDown}
        style={{ width:6, cursor:'col-resize', background:'rgba(255,255,255,0.06)', borderRight:'1px solid #263043', userSelect:'none' }}
      />

      {/* Context menu (portal) */}
      {menu && (
        <ContextMenu
          x={menu.x} y={menu.y}
          items={itemsFor(menu.node)}
          onClose={()=>setMenu(null)}
        />
      )}

      {/* --- Dialogs --- */}
      {modal.kind === 'new-file' && (
        <DraggableDialog
          open
          title="New File"
          onClose={() => setModal({ kind: 'none' })}
          buttons={[
            { label: 'Cancel', onClick: () => setModal({ kind: 'none' }) },
            {
              label: 'Create', kind: 'primary',
              disabled: !modal.name.trim(),
              onClick: async () => {
                const name = smartExt(modal.name.trim(), modal.dir)
                const dst = (modal.dir ? modal.dir.replace(/\/$/, '') + '/' : '') + name
                await putFile(dst, '\n', mimeFor(name))
                await refreshPath(modal.dir)
                setSelected(dst)
                setModal({ kind: 'none' })
              }
            }
          ]}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Directory</div>
            <div style={{ padding: '6px 8px', border: '1px solid #334155', borderRadius: 6, background: 'rgba(2,6,23,0.2)' }}>
              {modal.dir || '(root)'}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>File name</div>
            <input
              autoFocus
              value={modal.name}
              onChange={(e) => setModal({ ...modal, name: e.target.value })}
              placeholder="topic, map.ditamap, index.html, data.json"
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0b1223', color: '#e2e8f0' }}
            />
          </div>
        </DraggableDialog>
      )}

      {modal.kind === 'new-folder' && (
        <DraggableDialog
          open
          title="New Folder"
          onClose={() => setModal({ kind: 'none' })}
          buttons={[
            { label: 'Cancel', onClick: () => setModal({ kind: 'none' }) },
            {
              label: 'Create', kind: 'primary',
              disabled: !modal.name.trim(),
              onClick: async () => {
                const name = modal.name.trim()
                const dst = (modal.dir ? modal.dir.replace(/\/$/, '') + '/' : '') + name
                await mkdir(dst)
                await refreshPath(modal.dir)
                setSelected(dst)
                setModal({ kind: 'none' })
              }
            }
          ]}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Parent directory</div>
            <div style={{ padding: '6px 8px', border: '1px solid #334155', borderRadius: 6, background: 'rgba(2,6,23,0.2)' }}>
              {modal.dir || '(root)'}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Folder name</div>
            <input
              autoFocus
              value={modal.name}
              onChange={(e) => setModal({ ...modal, name: e.target.value })}
              placeholder="NewFolder"
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0b1223', color: '#e2e8f0' }}
            />
          </div>
        </DraggableDialog>
      )}

      {modal.kind === 'rename' && (
        <DraggableDialog
          open
          title="Rename"
          onClose={() => setModal({ kind: 'none' })}
          buttons={[
            { label: 'Cancel', onClick: () => setModal({ kind: 'none' }) },
            {
              label: 'Rename', kind: 'primary',
              disabled: !modal.name.trim(),
              onClick: async () => {
                const base = modal.path.includes('/') ? modal.path.slice(0, modal.path.lastIndexOf('/')) : ''
                const dst = base ? `${base}/${modal.name.trim()}` : modal.name.trim()
                await movePath(modal.path, dst)
                await refreshPath(base || '')
                setSelected(dst)
                setModal({ kind: 'none' })
              }
            }
          ]}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Current path</div>
            <div style={{ padding: '6px 8px', border: '1px solid #334155', borderRadius: 6, background: 'rgba(2,6,23,0.2)' }}>
              {modal.path}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>New name</div>
            <input
              autoFocus
              value={modal.name}
              onChange={(e) => setModal({ ...modal, name: e.target.value })}
              placeholder="new-name.ext"
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0b1223', color: '#e2e8f0' }}
            />
          </div>
        </DraggableDialog>
      )}

      {/* IMPORT dialog (files / folders) */}
      {modal.kind === 'import' && (
        <DraggableDialog
          open
          title={modal.mode === 'files' ? 'Import Files' : 'Import Folders'}
          onClose={() => setModal({ kind: 'none' })}
          buttons={[
            { label: 'Cancel', onClick: () => setModal({ kind: 'none' }) },
            {
              label: modal.busy ? 'Uploading…' : 'Upload',
              kind: 'primary',
              disabled: modal.busy || !modal.items.length,
              onClick: async () => {
                setModal(m => ({ ...m, busy: true }))
                try {
                  await handleImportUpload(modal.dir, modal.items)
                  setModal({ kind: 'none' })
                } finally {
                  // no-op
                }
              }
            }
          ]}
        >
          <div style={{ display:'grid', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Target directory</div>
            <div style={{ padding: '6px 8px', border: '1px solid #334155', borderRadius: 6, background: 'rgba(2,6,23,0.2)' }}>
              {modal.dir || '(root)'}
            </div>

            <DropZone
              label={modal.mode === 'files'
                ? 'Drag files here (or click to choose)'
                : 'Drag folders here (or click to choose a folder)'
              }
              onPickFiles={() => filesPickerRef.current?.click()}
              onPickFolder={() => dirPickerRef.current?.click()}
              mode={modal.mode}
              onDrop={async (dt) => {
                const items = await readDropped(dt, modal.mode)
                if (!items.length) return
                setModal(m => ({ ...m, items }))
              }}
            />

            {modal.items.length > 0 && (
              <div style={{ maxHeight: '28vh', overflow: 'auto', border: '1px dashed #334155', borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                  {modal.items.length} item(s) ready to upload
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {modal.items.slice(0, 100).map((it, i) => (
                    <li key={i} style={{ whiteSpace: 'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.relPath}</li>
                  ))}
                </ul>
                {modal.items.length > 100 && (
                  <div style={{ color: '#94a3b8', marginTop: 6 }}>…and more</div>
                )}
              </div>
            )}
          </div>
        </DraggableDialog>
      )}
    </div>
  )
}

/* --------------------------- DropZone component --------------------------- */
function DropZone({
  label, onDrop, onPickFiles, onPickFolder, mode
}: {
  label: string
  onDrop: (dt: DataTransfer) => void | Promise<void>
  onPickFiles: () => void
  onPickFolder: () => void
  mode: 'files' | 'folders'
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onDragEnter={(e)=>{ e.preventDefault(); setHover(true) }}
      onDragOver={(e)=>{ e.preventDefault(); setHover(true) }}
      onDragLeave={(e)=>{ e.preventDefault(); setHover(false) }}
      onDrop={async (e)=>{ e.preventDefault(); setHover(false); await onDrop(e.dataTransfer) }}
      onClick={()=> mode==='files' ? onPickFiles() : onPickFolder()}
      style={{
        padding:'18px 14px', border:'2px dashed ' + (hover ? '#60a5fa' : '#334155'),
        background: hover ? 'rgba(59,130,246,0.08)' : 'rgba(2,6,23,0.2)',
        color:'#e2e8f0', textAlign:'center', cursor:'pointer', borderRadius:10
      }}
      title={label}
    >
      {label}
    </div>
  )
}
