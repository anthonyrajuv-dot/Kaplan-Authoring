export type Lang = 'xml'|'html'|'json'|'text'

export function detectLang(path: string): Lang {
  const p = path.toLowerCase()
  if (p.endsWith('.dita') || p.endsWith('.ditamap') || p.endsWith('.xml')) return 'xml'
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'html'
  if (p.endsWith('.json') || p.endsWith('work.json')) return 'json'
  return 'text'
}

export function shortenHead(s: string, max = 88): string {
  if (s.length <= max) return s
  const tail = s.slice(-Math.floor(max*0.75))
  return '…' + tail
}

/** Simple formatter for XML/HTML/JSON (no heavy deps) */
export function formatText(content: string, lang: Lang): string {
  try {
    if (lang === 'json') return JSON.stringify(JSON.parse(content), null, 2)
    if (lang === 'xml' || lang === 'html') return prettyXml(content)
  } catch {}
  return content
}

// naive XML/HTML pretty-printer (good enough for DITA/markup)
function prettyXml(xml: string): string {
  // insert line breaks between tags, then indent
  const reg = /(>)(<)(\/*)/g
  xml = xml.replace(reg, '$1\n$2$3')
  let indent = 0
  return xml.split('\n').map(line => {
    line = line.trim()
    if (!line) return ''
    if (line.match(/^<\/\w/)) indent = Math.max(indent - 1, 0)
    const pad = '  '.repeat(indent)
    if (line.match(/^<\w[^>]*[^/]>.*$/)) indent += 1
    return pad + line
  }).join('\n')
}
