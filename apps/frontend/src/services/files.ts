import axios from 'axios'
import { useQuery } from '@tanstack/react-query'

// ---- Runtime-switchable API base ----
const DEFAULT_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '')
const LS_KEY = 'apiBaseOverride'
let API_BASE = (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || DEFAULT_BASE

export function getApiBase() { return API_BASE }
export function setApiBase(next: string) {
  API_BASE = (next || DEFAULT_BASE).replace(/\/+$/, '')
  try { localStorage.setItem(LS_KEY, API_BASE) } catch {}
  http.defaults.baseURL = API_BASE
}

// (optional) quick debug in console: __api()
if (typeof window !== 'undefined') (window as any).__api = () => API_BASE

// Shared axios client
export const http = axios.create({ baseURL: API_BASE })

export type TreeItem = { name: string; path: string; isDir: boolean }

export async function getTree(path = '') {
  const { data } = await http.get('/files/tree', { params: { path } })
  return data as TreeItem[]
}

export function useTree(path: string) {
  return useQuery({
    queryKey: ['tree', path],
    queryFn: async () => (await http.get<TreeItem[]>('/files/tree', { params: { path } })).data
  })
}

export async function getFile(path: string) {
  const r = await http.get('/files/content', { params: { path }, responseType: 'text' })
  return r.data as string
}

export async function putFile(path: string, body: string, contentType='text/plain; charset=utf-8', lockToken?: string) {
  await http.put('/files/content', body, {
    params: { path },
    headers: { 'Content-Type': contentType, ...(lockToken ? {'X-Lock-Token': lockToken} : {}) }
  })
}

export async function mkdir(path: string) { await http.post('/files/mkdir', null, { params: { path } }) }
export async function removePath(path: string) { await http.delete('/files', { params: { path } }) }
export async function movePath(src: string, dst: string) { await http.post('/files/move', { src, dst }) }
export async function copyPath(src: string, dst: string) { await http.post('/files/copy', { src, dst }) }

// ✅ Use API_BASE here (these were hard-coded to /api/…)
export function downloadFile(path: string) {
  window.location.href = `${API_BASE}/files/download?path=${encodeURIComponent(path)}`
}
export function downloadZip(path: string) {
  window.location.href = `${API_BASE}/files/zip?path=${encodeURIComponent(path)}`
}

export async function getBase(): Promise<string> {
  const r = await http.get<{ base: string }>('/files/base')
  return r.data.base.replace(/\/+$/,'')
}

export async function formatXMLServer(text: string): Promise<string> {
  const r = await http.post('/files/format/xml', text, { headers: { 'Content-Type':'text/xml; charset=utf-8' } })
  return r.data as string
}

export async function validateDITA(text: string): Promise<{ok:boolean;errors:string[];warnings:string[];root?:string;ns?:string}> {
  const r = await http.post('/files/validate/dita', text, { headers: { 'Content-Type':'text/xml; charset=utf-8' } })
  return r.data
}

export async function lockPath(path: string, owner: string) {
  const r = await http.post('/files/lock', null, { params: { path, owner } })
  return r.data as {token:string, owner:string, timeout:number}
}
export async function unlockPath(path: string, token: string) {
  const r = await http.post('/files/unlock', { token }, { params: { path } })
  return r.data
}
export async function lockInfo(path: string) {
  const r = await http.get('/files/lockinfo', { params: { path } })
  return r.data as {locked:boolean;owner:string|null;token:string|null}
}
