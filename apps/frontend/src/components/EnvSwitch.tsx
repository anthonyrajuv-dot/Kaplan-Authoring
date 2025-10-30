import { useEffect, useMemo, useState } from 'react'
import { getApiBase, setApiBase } from '../services/files'

export default function EnvSwitch({
  remote = import.meta.env.VITE_API_BASE || '',
  local = 'http://localhost:8000/api'
}: { remote?: string; local?: string }) {

  const [mode, setMode] = useState<'Remote'|'Local'|'Custom'>(() => {
    const cur = getApiBase()
    if (cur === remote) return 'Remote'
    if (cur === local) return 'Local'
    return 'Custom'
  })
  const [custom, setCustom] = useState(() => {
    const cur = getApiBase()
    return (cur !== remote && cur !== local) ? cur : ''
  })
  const current = useMemo(() => mode==='Remote' ? remote : mode==='Local' ? local : custom, [mode, remote, local, custom])

  useEffect(() => { if (current) setApiBase(current) }, [current])

  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#94a3b8' }}>
      <span style={{color:'#e2e8f0'}}>API:</span>
      <select value={mode} onChange={e=>setMode(e.target.value as any)}
              style={{ background:'transparent', color:'#e2e8f0', border:'1px solid #263043', borderRadius:6, padding:'2px 6px' }}>
        <option value="Remote">Remote</option>
        <option value="Local">Local</option>
        <option value="Custom">Custom</option>
      </select>
      {mode==='Custom' && (
        <input value={custom} onChange={e=>setCustom(e.target.value)} placeholder="https://host/api"
               style={{ width:260, background:'transparent', color:'#e2e8f0',
                        border:'1px solid #263043', borderRadius:6, padding:'2px 6px' }}/>
      )}
      <button onClick={async ()=>{
        const u = current.replace(/\/+$/,'') + '/healthz'
        try { const r = await fetch(u, { cache:'no-store' }); alert(r.ok ? '✓ Health OK' : `✕ ${r.status} ${r.statusText}`) }
        catch(e:any){ alert('✕ ' + (e?.message || 'Network error')) }
      }}>Test</button>
      <span style={{ opacity:.8, maxWidth:320, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={current}>
        {current}
      </span>
    </div>
  )
}
