import { useEffect } from 'react'

export default function Modal({
  open, title, children, onClose
}: { open: boolean; title: string; children: React.ReactNode; onClose: ()=>void }) {
  useEffect(()=>{
    function onKey(e: KeyboardEvent){ if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return ()=>document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!open) return null
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.35)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000
    }}
      onClick={onClose}
    >
      <div
        onClick={e=>e.stopPropagation()}
        style={{ minWidth:420, maxWidth:720, background:'#fff', borderRadius:8,
                 boxShadow:'0 18px 50px rgba(0,0,0,.25)' }}
      >
        <div style={{ padding:'10px 14px', borderBottom:'1px solid #eee', fontWeight:700 }}>{title}</div>
        <div style={{ padding:16 }}>{children}</div>
        <div style={{ padding:'10px 14px', borderTop:'1px solid #eee', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  )
}
