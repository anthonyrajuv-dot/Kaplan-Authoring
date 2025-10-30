// Single source of truth for API base at runtime
const DEFAULT_BASE = import.meta.env.VITE_API_BASE || '/api'
const LS_KEY = 'apiBaseOverride'

// Module state
let current = (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || DEFAULT_BASE
let listeners: Array<(base: string) => void> = []

export function getApiBase() {
  return current
}

export function setApiBase(base: string) {
  current = base.replace(/\/+$/, '') // trim trailing slashes
  try { localStorage.setItem(LS_KEY, current) } catch {}
  listeners.forEach((cb) => cb(current))
}

export function onApiBaseChange(cb: (base: string) => void) {
  listeners.push(cb)
  return () => { listeners = listeners.filter((x) => x !== cb) }
}

// Optional debug
if (typeof window !== 'undefined') {
  const u = new URL(window.location.href)
  const apiParam = u.searchParams.get('api')
  if (apiParam) {
    const map: Record<string, string> = {
      local: 'http://localhost:8000/api',
      remote: DEFAULT_BASE
    }
    const val = map[apiParam.toLowerCase()] || apiParam
    setApiBase(val)
  }
}

