import { useEffect, useMemo, useState } from 'react'
import MenuBar from '../components/MenuBar'
import EnvSwitch from '../components/EnvSwitch'
import TreeSidebar from '../components/TreeSidebar'
import CodeEditor from '../components/CodeEditor'
import TabBar, { type Tab } from '../components/TabBar'
import { detectLang, shortenHead, formatText, type Lang } from '../lib/text'
import { formatClient } from '../lib/pretty'
import { getFile, putFile, getBase, validateDITA, formatXMLServer, lockPath, unlockPath, lockInfo } from '../services/files'
import Modal from '../components/Modal'

// Identify the current user for locks (you can pull real auth later)
const CURRENT_USER_ID = "ARajuv"

type LockDialog = { open: boolean; path: string; owner: string | null }

type OpenDoc = {
  path: string; name: string; text: string; lang: Lang; url: string;
  dirty?: boolean; lockToken?: string; readOnly?: boolean; stale?: boolean
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
function normalizeToken(t?: string | null) { return t ? t.replace(/[<>]/g,'').trim() : null }

function sameOwner(a?: string | null, b?: string | null) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

function beaconUnlock(path: string, token: string) {
  try {
    const body = new Blob([`token=${token}`], { type: 'text/plain' })
    // Use same-origin relative URL so CORS isn’t an issue
    navigator.sendBeacon(`/api/files/unlock?path=${encodeURIComponent(path)}`, body)
  } catch {
    // Best effort; ignore errors
  }
}

// --- Cross-tab messaging (BroadcastChannel with localStorage fallback) ---
const BC_NAME = 'kaplan-editor';

type BCMessage =
  | { type: 'file-saved'; path: string; by: string; time: number };

function makeBroadcaster() {
  let bc: BroadcastChannel | null = null;
  try { bc = new BroadcastChannel(BC_NAME); } catch { /* Safari < 16, older Edge */ }

  function send(msg: BCMessage) {
    if (bc) bc.postMessage(msg);
    // Fallback for browsers / environments without BroadcastChannel
    try {
      localStorage.setItem(`bc:${BC_NAME}`, JSON.stringify({ msg, nonce: Math.random(), t: Date.now() }));
    } catch {}
  }

  function listen(onMsg: (msg: BCMessage) => void) {
    const handler = (ev: MessageEvent) => onMsg(ev.data as BCMessage);
    const lsHandler = (ev: StorageEvent) => {
      if (ev.key === `bc:${BC_NAME}` && ev.newValue) {
        try { onMsg(JSON.parse(ev.newValue).msg); } catch {}
      }
    };
    if (bc) bc.addEventListener('message', handler);
    window.addEventListener('storage', lsHandler);
    return () => {
      if (bc) bc.removeEventListener('message', handler);
      window.removeEventListener('storage', lsHandler);
    };
  }

  return { send, listen };
}


export default function App(){
  const [baseUrl, setBaseUrl] = useState<string>('')
  const [docs, setDocs] = useState<OpenDoc[]>(() => []); // ensure array, not undefined    
  const CURRENT_USER_ID = "ARajuv";
  const bus = useMemo(() => makeBroadcaster(), []);  
  useEffect(()=>{ getBase().then(setBaseUrl) }, [])
  const [activePath, setActivePath] = useState<string | undefined>(undefined)
  const active = docs.find(d => d.path === activePath) ?? docs[0]

  // Listen for file-saved messages:
  useEffect(() => {
    return bus.listen((msg) => {
      if (msg.type !== 'file-saved') return;
      // Step 1: mark dirty docs as stale, and detect which clean/open docs need reloading
      let needsReload = false;
      let targetPath = msg.path;
      
      setDocs((prev) => {
        if (!Array.isArray(prev)) return []; // safety guard
        //if (msg.by === CURRENT_USER_ID) return prev; // ignore own broadcast

        const next = prev.map((d) => {
          if (d.path !== targetPath) return d;
          // If this tab has local edits, DO NOT overwrite; show banner
          if (d.dirty) return { ...d, stale: true };
          if (d.readOnly) {
            // We'll reload this in step 2
            needsReload = true;
            return d;
          }
          if (!d.dirty) {
            // Clean — we’ll reload silently in step 2
            needsReload = true;
            return d;
          }
          // Has local edits → mark stale and show banner
          return { ...d, stale: true };
        });        
        return next;
      });
      // Step 2: do the async reload (only for clean/readOnly docs)
      if (needsReload) {
        (async () => {
          try {
            const fresh = await getFile(targetPath);
            setDocs((cur) => {
              if (!Array.isArray(cur)) return [];
              return cur.map((d) =>
                d.path === targetPath && (!d.dirty || d.readOnly)
                  ? { ...d, text: fresh, stale: false, dirty: false }
                  : d
              );
            });
          } catch {
            /* ignore */
          }
        })();
      }
    });
  }, [bus]);

  // Also refresh when tab regains focus (handy if a save happened while backgrounded):
  useEffect(() => {
    async function refreshCleanStale() {
      // Snapshot which docs need reload
      let targets: string[] = [];
      setDocs((prev) => {
        if (!Array.isArray(prev)) return [];
        targets = prev.filter((d) => d.stale && !d.dirty).map((d) => d.path);
        return prev; // no sync change here
      });

      // Reload each target sequentially (or in parallel if you prefer)
      for (const p of targets) {
        try {
          const fresh = await getFile(p);
          setDocs((cur) => {
            if (!Array.isArray(cur)) return [];
            return cur.map((d) =>
              d.path === p ? { ...d, text: fresh, stale: false, dirty: false } : d
            );
          });
        } catch {
          /* ignore */
        }
      }
    }

    function onFocus() {
      refreshCleanStale();
    }

    function onVis() {
      if (!document.hidden) refreshCleanStale();
    }

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);





// Warn on browser refresh/close if any dirty
  useEffect(()=>{
    const handler = (e: BeforeUnloadEvent) => {
      if (docs.some(d => d.dirty)) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [docs])

// You already warn on unload for dirty docs; now actually unlock them:  
  useEffect(()=>{
    function onPageHideOrUnload() {
      // Fire-and-forget unlocks for all our held locks
      docs.forEach(d => {
        if (d.lockToken && !d.readOnly) {
          beaconUnlock(d.path, d.lockToken)
        }
      })
    }
    window.addEventListener('pagehide', onPageHideOrUnload)
    window.addEventListener('beforeunload', onPageHideOrUnload)
    return () => {
      window.removeEventListener('pagehide', onPageHideOrUnload)
      window.removeEventListener('beforeunload', onPageHideOrUnload)
    }
  }, [docs])


  async function openFilePath(path: string){
  // Always check server lock first
  const info = await lockInfo(path)
  const serverToken = normalizeToken(info.token)

  if (info.locked) {
    // If locked by me (maybe another tab), DO NOT reuse token for editing.
    // Open read-only and show dialog.
    if (info.owner && info.owner.trim().toLowerCase() === CURRENT_USER_ID.toLowerCase()) {
      setLockDlg({ open:true, path, owner: `You (${info.owner}) in another tab/window` })
      const content = await getFile(path)
      openInTab(path, content, undefined, true) // read-only
      setActivePath(path)
      // ensure we don't keep any local token for this path
      clearSavedToken(path)
      return
    }
    // Locked by someone else
    setLockDlg({ open:true, path, owner: info.owner || 'Another user' })
    const content = await getFile(path)
    openInTab(path, content, undefined, true) // read-only
    setActivePath(path)
    clearSavedToken(path)
    return
  }

  // Not locked: acquire lock for this tab
  const locked = await lockPath(path, CURRENT_USER_ID)
  const token = normalizeToken(locked.token) || undefined
  if (token) writeSavedToken(path, token)
  const content = await getFile(path)
  openInTab(path, content, token, false) // editable
  setActivePath(path)
}

  async function refreshTab(path: string){
    const doc = docs.find(d => d.path === path)
    if (!doc) return
    if (doc.dirty) {
      const cont = confirm(`Discard unsaved changes and reload ${doc.name}?`)
      if (!cont) return
    }
    const fresh = await getFile(path)
    setDocs(cur => cur.map(d => d.path===path ? { ...d, text:fresh, stale:false, dirty:false } : d))
  }


const [lockDlg, setLockDlg] = useState<LockDialog>({ open:false, path:'', owner:null })

  function openInTab(path: string, text: string, lockToken?: string, readOnly=false) {
    const name = path.split('/').pop() || path
    const lang = detectLang(path)
    const url = `${baseUrl}/${path}`.replace(/([^:])\/+/g,'$1/')
    setDocs(prev => {
      const i = prev.findIndex(d => d.path === path)
      if (i >= 0) {
        const next = prev.slice()
        next[i] = { ...next[i], text, lang, url, dirty:false, lockToken, readOnly }
        return next
      }
      return [...prev, { path, name, text, lang, url, dirty:false, lockToken, readOnly }]
    })
  }

  // Broadcast from the saving tab
  async function saveActive(){
    if (!active || active.readOnly) return;
    if (!active.dirty) return                    // <- guard: only save if user edited
    await putFile(active.path, active.text, 'text/plain; charset=utf-8', active.lockToken);
    setDocs(ds => ds.map(d => d.path===active.path ? { ...d, dirty:false, stale:false } : d));
    bus.send({ type: 'file-saved', path: active.path, by: CURRENT_USER_ID, time: Date.now() });
    console.log("sent file-saved", active.path);    
  }


  function setActiveText(val: string){
    if (!active || active.readOnly) return
    setDocs(ds => ds.map(d => d.path===active.path ? { ...d, text: val, dirty:true } : d))
  }

  function activate(path: string) {
    setActivePath(path)
  }


  async function close(path: string){
    const doc = docs.find(d => d.path===path)
    if (!doc) return

    if (doc.dirty && !doc.readOnly) {
      const saveIt = confirm(`Save changes to ${doc.name}?`)
      if (saveIt) {
        try { await putFile(doc.path, doc.text, 'text/plain; charset=utf-8', doc.lockToken) } catch {}
      } else {
        // user chose not to save; continue closing
      }
    }
    if (doc.lockToken && !doc.readOnly) {
      try { await unlockPath(doc.path, doc.lockToken) } catch { beaconUnlock(doc.path, doc.lockToken) }
      finally { clearSavedToken(doc.path) }
    }
    setDocs(prev => {
      const next = prev.filter(d => d.path !== path)
      // choose neighbor or first
      if (path === activePath) {
        setActivePath(next.length ? next[Math.max(0, Math.min(next.length - 1, next.findIndex(d => d.path > path) - 1))]?.path ?? next[0]?.path : undefined)
      }
      return next
    })
  }


  function copyAbs(path: string){
    const url = `${baseUrl}/${path}`.replace(/([^:])\/+/g,'$1/')
    navigator.clipboard?.writeText(url)
  }

  function setDocText(path: string, text: string) {
    setDocs(ds => ds.map(d => d.path === path ? { ...d, text, dirty: true } : d))
  }


  // ---- format & validate ----
  async function formatActive(){
    if (!active || active.readOnly) return
    if (active.lang === 'html') setActiveText(await formatClient(active.text, 'html'))
    else if (active.lang === 'json') setActiveText(await formatClient(active.text, 'json'))
    else if (active.lang === 'xml') setActiveText(await formatXMLServer(active.text))
  }

  async function validateActiveDITA(){
    if (!active) return
    const res = await validateDITA(active.text)
    const msg = [
      `Root: ${res.root || 'unknown'}`,
      res.errors.length ? `Errors:\n- ${res.errors.join('\n- ')}` : 'Errors: none',
      res.warnings.length ? `Warnings:\n- ${res.warnings.join('\n- ')}` : 'Warnings: none'
    ].join('\n\n')
    alert(msg)
  }  

  // ---- Menus (restored full set + new actions) ----
  const menus = [
    { title:'File', items:[
      { label:'Save', shortcut:'Ctrl+S', onClick:saveActive, disabled:!active || active.readOnly },
      { label:'Close Tab', shortcut:'Ctrl+Q', onClick:()=>active && close(active.path), disabled:!active },
    ]},
    { title:'Edit', items:[
      { label:'Format & Indent', shortcut:'Ctrl+I', onClick:formatActive, disabled:!active },
    ]},
    { title:'Find', items:[ { label:'Find…', shortcut:'Ctrl+F', onClick:()=>{} } ]},
    { title:'Project', items:[ { label:'Settings (stub)' } ]},
    { title:'DITA Maps', items:[ { label:'Open Map (stub)' } ]},
    { title:'Options', items:[ { label:'Preferences (stub)' } ]},
    { title:'Tools', items:[ { label:'Validate DITA', onClick:validateActiveDITA, disabled:!active } ]},
    { title:'Document', items:[
      { label:'Format & Indent', shortcut:'Ctrl+I', onClick:formatActive, disabled:!active },
    ]},
    { title:'Window', items:[ { label:'Reload (F5)', onClick:()=>location.reload() } ]},
    { title:'Help', items:[ { label:'About', onClick:()=>alert('Kaplan LMS Builder (prototype)') } ]},
  ]

  // hotkeys
  useEffect(()=>{
    function onKey(e: KeyboardEvent){
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='i'){ e.preventDefault(); formatActive() }
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveActive() }
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='q' && active){ e.preventDefault(); close(active.path) }
    }
    document.addEventListener('keydown', onKey)
    return ()=>document.removeEventListener('keydown', onKey)
  }, [active])

  return (
    // Outer background wrapper
    <div
      style={{
        background: '#0f172a',          // full background
        minHeight: '100vh',
        padding: '24px',                // margins around app
        boxSizing: 'border-box',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      {/* Inner App Container */}
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
        {/* === Frosted Glass Menubar === */}
        <div
          style={{
            flex: '0 0 auto',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            backdropFilter: 'blur(10px)',       // frosted effect
            background: 'rgba(11, 18, 35, 0.9)',
            borderBottom: '1px solid #263043',
          }}
        >
          <MenuBar menus={menus} rightSlot={<EnvSwitch />} />
        </div>

        {/* === Sidebar + Main Editor === */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '280px 1fr',
            overflow: 'hidden'
          }}
        >
          {/* Sidebar (scrollable independently) */}
          {/* Frosted Sidebar */}
          <div
            style={{
              backdropFilter: 'blur(10px)',
              background: 'rgba(11, 18, 35, 0.92)',   // a touch lighter
              borderRight: '1px solid #263043',
              overflowY: 'auto',
              color: '#cbd5e1'
            }}
          >
            <TreeSidebar onOpen={(it) => openFilePath(it.path)} />
          </div>

          {/* === Main Right Area === */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              overflow: 'hidden'
            }}
          >
            {/* === Frosted Glass TabBar === */}
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
                tabs={docs.map((d) => ({
                  path: d.path,
                  name: d.name + (d.dirty ? '*' : ''),
                  url: d.url,
                }))}
                active={activePath}
                onActivate={activate}
                onClose={(p) => close(p)}
                onCopyUrl={copyAbs}
                onRefresh={refreshTab}
              />
            </div>

            {/* === File Path Bar & Save === */}
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
              <div
                style={{
                  fontSize: 12,
                  color: '#666',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {active ? shortenHead(active.url, 100) : '—'}
                {active?.readOnly ? ' (read-only)' : ''}
              </div>
              <button onClick={saveActive} disabled={!active || active.readOnly}>
                Save (Ctrl+S)
              </button>
            </div>

            {/* === Frosted Editor Area (scrolls independently) === */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                backdropFilter: 'blur(16px)',
                background: 'rgba(11, 18, 35, 1)', // dark translucent blue-gray
                color: '#e2e8f0'
              }}
            >
              {active ? (
                <CodeEditor 
                  key={active.path} // ← remount per file
                  value={active.text}                  
                  language={active.lang}
                  onSave={saveActive}
                  onChange={(next) => setDocText(active.path, next)} // ← path-bound
                />
              ) : (
                <div style={{ padding: 16, color: '#94a3b8' }}>
                  Open a file from the left tree…
                </div>
              )}
            </div>
          </div>
        </div>

        {/* === Lock Info Modal === */}
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
              The file is opened read-only. Close the other editor to release the
              lock, then refresh and try again.
            </div>
          </div>
        </Modal>
      </div>
    </div>
  )

}

