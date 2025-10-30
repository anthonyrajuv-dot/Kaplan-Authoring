import { useEffect, useMemo, useRef, useState } from 'react'
import MenuBar from '../components/MenuBar'
import EnvSwitch from '../components/EnvSwitch'
import TreeSidebar from '../components/TreeSidebar'
import CodeEditor from '../components/CodeEditor'
import TabBar from '../components/TabBar'
import { detectLang, shortenHead, type Lang } from '../lib/text'
import { formatClient } from '../lib/pretty'
import {
  getFile,
  putFile,
  getBase,
  validateDITA,
  formatXMLServer,
  lockPath,
  unlockPath,
  lockInfo,
} from '../services/files'
import Modal from '../components/Modal'

type LockDialog = { open: boolean; path: string; owner: string | null }
type OpenDoc = {
  path: string
  name: string
  text: string
  lang: Lang
  url: string
  dirty?: boolean
  lockToken?: string
  readOnly?: boolean
  stale?: boolean
}

function readSavedToken(path: string): string | null {
  return localStorage.getItem(`lock:${path}`)
}
function writeSavedToken(path: string, token: string) {
  localStorage.setItem(`lock:${path}`, token)
}
function clearSavedToken(path: string) {
  localStorage.removeItem(`lock:${path}`)
}
function normalizeToken(t?: string | null) {
  return t ? t.replace(/[<>]/g, '').trim() : null
}
function beaconUnlock(path: string, token: string) {
  try {
    const body = new Blob([`token=${token}`], { type: 'text/plain' })
    navigator.sendBeacon(`/api/files/unlock?path=${encodeURIComponent(path)}`, body)
  } catch {}
}

const BC_NAME = 'kaplan-editor'
type BCMessage = { type: 'file-saved'; path: string; by: string; time: number }
function makeBroadcaster() {
  let bc: BroadcastChannel | null = null
  try {
    bc = new BroadcastChannel(BC_NAME)
  } catch {}
  function send(msg: BCMessage) {
    if (bc) bc.postMessage(msg)
    try {
      localStorage.setItem(`bc:${BC_NAME}`, JSON.stringify({ msg, nonce: Math.random(), t: Date.now() }))
    } catch {}
  }
  function listen(onMsg: (msg: BCMessage) => void) {
    const handler = (ev: MessageEvent) => onMsg(ev.data as BCMessage)
    const lsHandler = (ev: StorageEvent) => {
      if (ev.key === `bc:${BC_NAME}` && ev.newValue) {
        try {
          onMsg(JSON.parse(ev.newValue).msg)
        } catch {}
      }
    }
    if (bc) bc.addEventListener('message', handler)
    window.addEventListener('storage', lsHandler)
    return () => {
      if (bc) bc.removeEventListener('message', handler)
      window.removeEventListener('storage', lsHandler)
    }
  }
  return { send, listen }
}

export default function App() {
  const CURRENT_USER_ID = 'ARajuv'
  const [baseUrl, setBaseUrl] = useState<string>('')
  const [docs, setDocs] = useState<OpenDoc[]>([])
  const bus = useMemo(() => makeBroadcaster(), [])
  const [activePath, setActivePath] = useState<string | undefined>(undefined)
  const [toast, setToast] = useState<string | null>(null)
  const [lockDlg, setLockDlg] = useState<LockDialog>({ open: false, path: '', owner: null })

  useEffect(() => {
    getBase().then(setBaseUrl)
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 1400)
  }

  const active = docs.find((d) => d.path === activePath) ?? docs[0]

  // Broadcast: when any tab saves, mark others as stale / reload if clean
  useEffect(() => {
    return bus.listen((msg) => {
      if (msg.type !== 'file-saved') return
      let needsReload = false
      const targetPath = msg.path
      setDocs((prev) => {
        const next = prev.map((d) => {
          if (d.path !== targetPath) return d
          if (d.dirty) return { ...d, stale: true } // show banner
          needsReload = true // clean or readOnly: will reload
          return d
        })
        return next
      })
      if (needsReload) {
        ;(async () => {
          try {
            const fresh = await getFile(targetPath)
            setDocs((cur) =>
              cur.map((d) =>
                d.path === targetPath && (!d.dirty || d.readOnly) ? { ...d, text: fresh, stale: false, dirty: false } : d,
              ),
            )
          } catch {}
        })()
      }
    })
  }, [bus])

  // Refresh on focus for any clean+stale docs
  useEffect(() => {
    async function refreshCleanStale() {
      let targets: string[] = []
      setDocs((prev) => {
        targets = prev.filter((d) => d.stale && !d.dirty).map((d) => d.path)
        return prev
      })
      for (const p of targets) {
        try {
          const fresh = await getFile(p)
          setDocs((cur) => cur.map((d) => (d.path === p ? { ...d, text: fresh, stale: false, dirty: false } : d)))
        } catch {}
      }
    }
    function onFocus() {
      refreshCleanStale()
    }
    function onVis() {
      if (!document.hidden) refreshCleanStale()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Warn & unlock on close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (docs.some((d) => d.dirty)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [docs])
  useEffect(() => {
    function onPageHideOrUnload() {
      docs.forEach((d) => {
        if (d.lockToken && !d.readOnly) beaconUnlock(d.path, d.lockToken)
      })
    }
    window.addEventListener('pagehide', onPageHideOrUnload)
    window.addEventListener('beforeunload', onPageHideOrUnload)
    return () => {
      window.removeEventListener('pagehide', onPageHideOrUnload)
      window.removeEventListener('beforeunload', onPageHideOrUnload)
    }
  }, [docs])

  async function openFilePath(path: string) {
    const info = await lockInfo(path)
    const serverToken = normalizeToken(info.token)
    if (info.locked) {
      if (info.owner && info.owner.trim().toLowerCase() === CURRENT_USER_ID.toLowerCase()) {
        setLockDlg({ open: true, path, owner: `You (${info.owner}) in another tab/window` })
        const content = await getFile(path)
        openInTab(path, content, undefined, true) // read-only
        setActivePath(path)
        clearSavedToken(path)
        return
      }
      setLockDlg({ open: true, path, owner: info.owner || 'Another user' })
      const content = await getFile(path)
      openInTab(path, content, undefined, true) // read-only
      setActivePath(path)
      clearSavedToken(path)
      return
    }
    const locked = await lockPath(path, CURRENT_USER_ID)
    const token = normalizeToken(locked.token) || undefined
    if (token) writeSavedToken(path, token)
    const content = await getFile(path)
    openInTab(path, content, token, false)
    setActivePath(path)
  }

  async function refreshTab(path: string) {
    const doc = docs.find((d) => d.path === path)
    if (!doc) return
    if (doc.dirty) {
      const cont = confirm(`Discard unsaved changes and reload ${doc.name}?`)
      if (!cont) return
    }
    const fresh = await getFile(path)
    setDocs((cur) => cur.map((d) => (d.path === path ? { ...d, text: fresh, stale: false, dirty: false } : d)))
  }

  function openInTab(path: string, text: string, lockToken?: string, readOnly = false) {
    const name = path.split('/').pop() || path
    const lang = detectLang(path)
    const url = `${baseUrl}/${path}`.replace(/([^:])\/+/g, '$1/')
    setDocs((prev) => {
      const i = prev.findIndex((d) => d.path === path)
      if (i >= 0) {
        const next = prev.slice()
        next[i] = { ...next[i], text, lang, url, dirty: false, lockToken, readOnly }
        return next
      }
      return [...prev, { path, name, text, lang, url, dirty: false, lockToken, readOnly }]
    })
  }

  async function saveActive() {
    if (!active || active.readOnly) return
    if (!active.dirty) return
    await putFile(active.path, active.text, 'text/plain; charset=utf-8', active.lockToken)
    setDocs((ds) => ds.map((d) => (d.path === active.path ? { ...d, dirty: false, stale: false } : d)))
    bus.send({ type: 'file-saved', path: active.path, by: CURRENT_USER_ID, time: Date.now() })
  }

  function setDocText(path: string, text: string) {
    setDocs((ds) => ds.map((d) => (d.path === path ? { ...d, text, dirty: true } : d)))
  }

  function activate(path: string) {
    setActivePath(path)
  }

  async function close(path: string) {
    const doc = docs.find((d) => d.path === path)
    if (!doc) return
    if (doc.dirty && !doc.readOnly) {
      const saveIt = confirm(`Save changes to ${doc.name}?`)
      if (saveIt) {
        try {
          await putFile(doc.path, doc.text, 'text/plain; charset=utf-8', doc.lockToken)
        } catch {}
      }
    }
    if (doc.lockToken && !doc.readOnly) {
      try {
        await unlockPath(doc.path, doc.lockToken)
      } catch {
        beaconUnlock(doc.path, doc.lockToken)
      } finally {
        clearSavedToken(doc.path)
      }
    }
    setDocs((prev) => {
      const next = prev.filter((d) => d.path !== path)
      if (path === activePath) {
        setActivePath(next[0]?.path)
      }
      return next
    })
  }

  async function copyAbs(path: string) {
    const base = await getBase()
    const url = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
    await navigator.clipboard.writeText(url)
    showToast('Location Copied!')
  }

  async function formatActive() {
    if (!active || active.readOnly) return
    if (active.lang === 'html') setDocText(active.path, await formatClient(active.text, 'html'))
    else if (active.lang === 'json') setDocText(active.path, await formatClient(active.text, 'json'))
    else if (active.lang === 'xml') setDocText(active.path, await formatXMLServer(active.text))
  }

  async function validateActiveDITA() {
    if (!active) return
    const res = await validateDITA(active.text)
    const msg = [
      `Root: ${res.root || 'unknown'}`,
      res.errors.length ? `Errors:\n- ${res.errors.join('\n- ')}` : 'Errors: none',
      res.warnings.length ? `Warnings:\n- ${res.warnings.join('\n- ')}` : 'Warnings: none',
    ].join('\n\n')
    alert(msg)
  }

  const menus = [
    {
      title: 'File',
      items: [
        { label: 'Save', shortcut: 'Ctrl+S', onClick: saveActive, disabled: !active || active.readOnly },
        { label: 'Close Tab', shortcut: 'Ctrl+Q', onClick: () => active && close(active.path), disabled: !active },
      ],
    },
    { title: 'Edit', items: [{ label: 'Format & Indent', shortcut: 'Ctrl+I', onClick: formatActive, disabled: !active }] },
    { title: 'Find', items: [{ label: 'Find…', shortcut: 'Ctrl+F', onClick: () => {} }] },
    { title: 'Project', items: [{ label: 'Settings (stub)' }] },
    { title: 'DITA Maps', items: [{ label: 'Open Map (stub)' }] },
    { title: 'Options', items: [{ label: 'Preferences (stub)' }] },
    { title: 'Tools', items: [{ label: 'Validate DITA', onClick: validateActiveDITA, disabled: !active }] },
    { title: 'Document', items: [{ label: 'Format & Indent', shortcut: 'Ctrl+I', onClick: formatActive, disabled: !active }] },
    { title: 'Window', items: [{ label: 'Reload (F5)', onClick: () => location.reload() }] },
    { title: 'Help', items: [{ label: 'About', onClick: () => alert('Kaplan LMS Builder (prototype)') }] },
  ]

  // hotkeys
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        formatActive()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveActive()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q' && active) {
        e.preventDefault()
        close(active.path)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active])

  return (
    <div
      style={{
        background: '#0f172a',
        minHeight: '100vh',
        padding: '24px',
        boxSizing: 'border-box',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          background: 'rgba(11, 18, 35, 1)',
          borderRadius: '10px',
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '1800px',
          height: 'calc(100vh - 48px)',
          overflow: 'hidden',
          color: '#e2e8f0',
        }}
      >
        {/* Menubar */}
        <div
          style={{
            flex: '0 0 auto',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            backdropFilter: 'blur(10px)',
            background: 'rgba(11, 18, 35, 0.9)',
            borderBottom: '1px solid #263043',
          }}
        >
          <MenuBar menus={menus} rightSlot={<EnvSwitch />} />
        </div>

        {/* Body: Sidebar + Editor */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '280px 1fr', overflow: 'hidden' }}>
          {/* Sidebar area (container styles live here; panel styles inside TreeSidebar) */}
          <div
            style={{
              backdropFilter: 'blur(10px)',
              background: 'rgba(11, 18, 35, 0.92)',
              borderRight: '1px solid #263043',
              overflow: 'hidden',
              color: '#cbd5e1',
            }}
          >
            <TreeSidebar onOpen={(it) => openFilePath(it.path)} />
          </div>

          {/* Right side */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Tabs */}
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 9,
                backdropFilter: 'blur(10px)',
                background: 'rgba(11, 18, 35, 0.9)',
                borderBottom: '1px solid #263043',
              }}
            >
              <TabBar
                tabs={docs.map((d) => ({ path: d.path, name: d.name + (d.dirty ? '*' : ''), url: d.url }))}
                active={activePath}
                onActivate={activate}
                onClose={(p) => close(p)}
                onCopyUrl={copyAbs}
                onRefresh={refreshTab}
              />
            </div>

            {/* Path + Save */}
            <div
              style={{
                flex: '0 0 auto',
                padding: '4px 10px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: '#666', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {active ? shortenHead(active.url, 100) : '—'}
                {active?.readOnly ? ' (read-only)' : ''}
              </div>
              <button onClick={saveActive} disabled={!active || active.readOnly}>
                Save (Ctrl+S)
              </button>
            </div>

            {/* Editor */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                backdropFilter: 'blur(16px)',
                background: 'rgba(11, 18, 35, 1)',
                color: '#e2e8f0',
              }}
            >
              {active ? (
                <CodeEditor
                  key={active.path}
                  value={active.text}
                  language={active.lang}
                  onSave={saveActive}
                  onChange={(next) => setDocText(active.path, next)}
                />
              ) : (
                <div style={{ padding: 16, color: '#94a3b8' }}>Open a file from the left tree…</div>
              )}
            </div>
          </div>
        </div>

        {/* Lock modal */}
        <Modal
          open={lockDlg.open}
          title="File Locked"
          onClose={() => setLockDlg({ open: false, path: '', owner: null })}
        >
          <div style={{ lineHeight: 1.5 }}>
            <div>
              <strong>Path:</strong> {lockDlg.path}
            </div>
            <div>
              <strong>Locked by:</strong> {lockDlg.owner || 'Unknown'}
            </div>
            <div style={{ marginTop: 8, color: '#666' }}>
              The file is opened read-only. Close the other editor to release the lock, then refresh and try again.
            </div>
          </div>
        </Modal>

        {/* Toast */}
        {toast && (
          <div
            style={{
              position: 'absolute',
              right: 16,
              bottom: 16,
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.65)',
              color: '#fff',
              borderRadius: 8,
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}
