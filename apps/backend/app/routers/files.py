from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import PlainTextResponse
from fastapi.responses import StreamingResponse
from fastapi import Request
import io, zipfile, uuid, datetime as dt
from lxml import etree as ET2
import os, httpx, urllib.parse, xml.etree.ElementTree as ET
import json

BASE = os.getenv("ALFRESCO_WEBDAV_BASE", "").rstrip("/")
if not BASE:
    raise RuntimeError("ALFRESCO_WEBDAV_BASE not set")

def _auth():
    u = os.getenv("ALFRESCO_USERNAME")
    p = os.getenv("ALFRESCO_PASSWORD")
    if not u or not p:
        raise RuntimeError("ALFRESCO_USERNAME/ALFRESCO_PASSWORD not set")
    return (u, p)

def _client():
    return httpx.Client(auth=_auth(), timeout=30.0, follow_redirects=True)

def _join(path: str):
    return f"{BASE}/{path.lstrip('/')}"

def _normalize_href(href: str) -> str:
    # Convert to repo-relative path after /documentLibrary/, strip leading/trailing slashes
    rel = href.split('/documentLibrary/', 1)[-1] if '/documentLibrary/' in href else href
    return rel.lstrip('/').rstrip('/')

def _parse_propfind(xml_text: str, current_url: str):
    NS = {'d': 'DAV:'}
    root = ET.fromstring(xml_text)

    # Normalize current URL once (no trailing slash) for self-skip
    cur_norm = current_url[:-1] if current_url.endswith('/') else current_url

    seen = set()
    items = []
    for resp in root.findall('d:response', NS):
        href_el = resp.find('d:href', NS)
        if href_el is None:
            continue

        href = urllib.parse.unquote(href_el.text or '')
        href_norm = href[:-1] if href.endswith('/') else href

        # 1) Skip the container itself (self row)
        if href_norm == cur_norm:
            continue

        # 2) Compute repo-relative path; skip empty (the documentLibrary root)
        rel = _normalize_href(href)
        if rel == "":
            # Alfresco sometimes returns /documentLibrary as a child of itself — drop it
            continue

        prop = resp.find('d:propstat/d:prop', NS)
        if prop is None:
            continue

        is_dir = prop.find('d:resourcetype/d:collection', NS) is not None
        displayname = prop.find('d:displayname', NS)
        name = (displayname.text if displayname is not None else rel.split('/')[-1]) or rel

        key = (rel, is_dir)
        if key in seen:
            continue
        seen.add(key)

        items.append({'name': name, 'path': rel, 'isDir': bool(is_dir)})

    # Folders first, alphabetical
    items.sort(key=lambda x: (not x['isDir'], x['name'].lower()))
    return items

router = APIRouter(prefix="/files", tags=["files"])

@router.get("/base")
def base():
    # Gives the absolute WebDAV base so the frontend can show/copy full URLs
    return {"base": BASE}

@router.get("/tree")
def tree(path: str = Query(default='')):
    url = _join(path)
    with _client() as c:
        r = c.request("PROPFIND", url, headers={"Depth": "1"})
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        base_norm = url[:-1] if url.endswith('/') else url
        return _parse_propfind(r.text, base_norm)

@router.get("/content", response_class=PlainTextResponse)
def content(path: str):
    url = _join(path)
    with _client() as c:
        r = c.get(url)
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        try:
            return r.content.decode('utf-8')
        except UnicodeDecodeError:
            return "<<BINARY CONTENT (not UTF-8)>>"

@router.put("/content")
async def save(path: str, request: Request):
    """
    Create/overwrite a file (text or binary).
    Accepts empty body.
    Respects WebDAV lock token if provided via 'X-Lock-Token' header.
    """
    # ensure parent folders exist
    parts = path.strip("/").split("/")
    if len(parts) > 1:
        cur = ""
        with _client() as c:
            for p in parts[:-1]:
                cur = f"{cur}/{p}" if cur else p
                c.request("MKCOL", _join(cur))  # 201 or 405 is fine

    data = await request.body()
    content_type = request.headers.get("content-type", "application/octet-stream")
    token = request.headers.get("x-lock-token")  # from frontend

    headers = {"Content-Type": content_type}
    if token:
        # WebDAV expects 'If' header with token like (<opaquelocktoken:...>)
        headers["If"] = f"(<{token}>)"

    with _client() as c:
        r = c.put(_join(path), content=data, headers=headers)
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        return {"ok": True}



@router.post("/mkdir")
def mkdir(path: str):
    url = _join(path)
    with _client() as c:
        r = c.request("MKCOL", url)
        if r.status_code in (201, 405, 200, 301, 302):
            return {"ok": True}
        raise HTTPException(r.status_code, r.text)

@router.delete("")
def delete(path: str = Query(...)):
    url = _join(path)
    with _client() as c:
        r = c.delete(url)
        if r.status_code in (200, 204):
            return {"ok": True}
        if r.status_code == 404:
            raise HTTPException(404, "Not found")
        raise HTTPException(r.status_code, r.text)

@router.post("/move")
def move(src: str = Body(...), dst: str = Body(...)):
    """WebDAV MOVE (rename or move)."""
    src_url = _join(src)
    dst_url = _join(dst)
    with _client() as c:
        r = c.request("MOVE", src_url, headers={"Destination": dst_url, "Overwrite": "T"})
        if r.status_code in (201, 204):
            return {"ok": True}
        raise HTTPException(r.status_code, r.text)

@router.post("/copy")
def copy(src: str = Body(...), dst: str = Body(...)):
    """WebDAV COPY."""
    src_url = _join(src)
    dst_url = _join(dst)
    with _client() as c:
        r = c.request("COPY", src_url, headers={"Destination": dst_url, "Overwrite": "T"})
        if r.status_code in (201, 204):
            return {"ok": True}
        raise HTTPException(r.status_code, r.text)

@router.post("/format/xml")
async def format_xml(request: Request):
    """
    Pretty-print XML/DITA (robust, tolerant).
    - Strips insignificant whitespace, preserves content.
    """
    data = await request.body()
    try:
        parser = ET2.XMLParser(remove_blank_text=True, recover=True)
        root = ET2.fromstring(data, parser=parser)
        pretty = ET2.tostring(root, encoding="utf-8", pretty_print=True)
        return PlainTextResponse(pretty.decode("utf-8"), media_type="text/plain; charset=utf-8")
    except Exception as e:
        raise HTTPException(400, f"XML parse/format error: {e}")


DITA_ROOTS = {"topic","concept","task","reference","glossentry","map","bookmap"}
DITA_NS_URIS = {
    "http://dita.oasis-open.org/architecture/2005/",
    "http://dita.oasis-open.org/architecture/2005/dita",
    "urn:oasis:names:tc:dita:x:y",  # permissive catch
}

@router.post("/validate/dita")
async def validate_dita(request: Request):
    """
    Lightweight DITA validation:
    - Well-formed XML
    - Root element looks like a known DITA type (topic/task/map/...)
    - Warn if no @id on root
    Returns: { ok: bool, errors: [..], warnings: [..], root: 'task', ns: '...' }
    """
    data = await request.body()
    errors, warnings = [], []
    try:
        parser = ET2.XMLParser(recover=False)
        root = ET2.fromstring(data, parser=parser)
    except ET2.XMLSyntaxError as e:
        return JSONResponse({"ok": False, "errors": [str(e)], "warnings": []})

    tag = ET2.QName(root.tag)
    root_local = tag.localname
    ns = tag.namespace or ""

    if root_local not in DITA_ROOTS:
        warnings.append(f"Root element '{root_local}' is not a typical DITA root ({', '.join(sorted(DITA_ROOTS))}).")

    if ns and ns not in DITA_NS_URIS:
        warnings.append(f"Namespace '{ns}' is not a common DITA namespace.")

    if not root.get("id"):
        warnings.append("Root element has no @id.")

    # Quick link checks (common authoring pitfall)
    for el in root.xpath(".//*[@href]"):
        href = el.get("href") or ""
        if href.strip() == "":
            warnings.append("Empty @href attribute found.")

    return JSONResponse({"ok": len(errors) == 0, "errors": errors, "warnings": warnings, "root": root_local, "ns": ns})


@router.get("/download")
def download(path: str):
    with _client() as c:
        r = c.get(_join(path))
        if r.status_code >= 400: raise HTTPException(r.status_code, r.text)
        filename = path.split("/")[-1] or "download"
        return StreamingResponse(io.BytesIO(r.content),
            media_type=r.headers.get("Content-Type","application/octet-stream"),
            headers={"Content-Disposition": f"attachment; filename={filename}"})

@router.get("/zip")
def zip_folder(path: str):
    # Depth: infinity PROPFIND; then GET each file into a zip
    with _client() as c:
        pr = c.request("PROPFIND", _join(path), headers={"Depth":"infinity"})
        if pr.status_code >= 400: raise HTTPException(pr.status_code, pr.text)
        # reuse existing normalizer
        hrefs = []
        root = ET.fromstring(pr.text)
        NS = {'d':'DAV:'}
        base = _join(path)
        base_norm = base[:-1] if base.endswith('/') else base
        for resp in root.findall('d:response', NS):
            href_el = resp.find('d:href', NS)
            if href_el is None: continue
            href = urllib.parse.unquote(href_el.text or '')
            if href.rstrip('/') == base_norm:  # skip folder itself
                continue
            prop = resp.find('d:propstat/d:prop', NS)
            if prop is None: continue
            is_dir = prop.find('d:resourcetype/d:collection', NS) is not None
            if is_dir: continue
            rel = _normalize_href(href)  # repo-relative path
            hrefs.append(rel)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for rel in hrefs:
                gr = c.get(_join(rel))
                if gr.status_code == 200:
                    # store path inside zip relative to selected folder
                    inner = rel[len(path.strip("/"))+1:] if rel.startswith(path.strip("/")+"/") else rel
                    z.writestr(inner, gr.content)
        buf.seek(0)
        name = (path.split("/")[-1] or "export") + ".zip"
        return StreamingResponse(buf, media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={name}"})

@router.delete("")
def delete(path: str = Query(...)):
    with _client() as c:
        r = c.delete(_join(path))
        if r.status_code in (200,204): return {"ok": True}
        if r.status_code == 404: raise HTTPException(404, "Not found")
        raise HTTPException(r.status_code, r.text)

@router.post("/move")
def move(src: str = Body(...), dst: str = Body(...)):
    with _client() as c:
        r = c.request("MOVE", _join(src), headers={"Destination": _join(dst), "Overwrite":"T"})
        if r.status_code in (201,204): return {"ok": True}
        raise HTTPException(r.status_code, r.text)

@router.post("/copy")
def copy(src: str = Body(...), dst: str = Body(...)):
    with _client() as c:
        r = c.request("COPY", _join(src), headers={"Destination": _join(dst), "Overwrite":"T"})
        if r.status_code in (201,204): return {"ok": True}
        raise HTTPException(r.status_code, r.text)

def _owner_xml(owner: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8" ?>
<D:lockinfo xmlns:D="DAV:">
  <D:lockscope><D:exclusive/></D:lockscope>
  <D:locktype><D:write/></D:locktype>
  <D:owner>{owner}</D:owner>
</D:lockinfo>"""

@router.post("/lock")
def lock(path: str, owner: str = "unknown", timeout_seconds: int = 1800):
    """
    Request an exclusive write LOCK.
    Returns { token, owner, timeout }.
    """
    with _client() as c:
        r = c.request(
            "LOCK",
            _join(path),
            headers={"Timeout": f"Second-{timeout_seconds}", "Content-Type": "text/xml"},
            content=_owner_xml(owner).encode("utf-8"),
        )
        if r.status_code in (200, 201):
            # Extract token from response lockdiscovery
            try:
                root = ET2.fromstring(r.text.encode("utf-8"))
                token = root.xpath("//*[local-name()='locktoken']/*[local-name()='href']")[0].text
            except Exception:
                # Fallback: some servers return Lock-Token header
                token = r.headers.get("Lock-Token", "").strip("<>")
            return {"token": token, "owner": owner, "timeout": timeout_seconds}
        elif r.status_code == 423:
            raise HTTPException(423, "Resource locked.")
        else:
            raise HTTPException(r.status_code, r.text)

@router.post("/unlock")
async def unlock(path: str, request: Request, token: str | None = None):
    """
    Release a LOCK. Accepts the token via:
    - query param:    .../unlock?path=...&token=opaquelocktoken:...
    - JSON body:      {"token":"opaquelocktoken:..."}
    - text body:      "token=opaquelocktoken:..." or just "opaquelocktoken:..."
    This makes it compatible with navigator.sendBeacon (no custom headers).
    """
    # If not provided as query param, try body (JSON or text)
    if token is None:
        raw = await request.body()
        token = None
        # Try JSON
        try:
            if raw:
                j = json.loads(raw.decode("utf-8"))
                token = j.get("token")
        except Exception:
            pass
        # Try form-ish or plain text
        if not token and raw:
            s = raw.decode("utf-8", errors="ignore").strip()
            if s.startswith("token="):
                token = s.split("=", 1)[1].strip()
            elif s:
                token = s

    if not token:
        raise HTTPException(400, "Missing lock token")

    # Normalize token: UNLOCK needs header: Lock-Token: <opaquelocktoken:...>
    token_clean = token.strip().strip("<>").replace(" ", "")
    if not token_clean.startswith("opaquelocktoken:"):
        # Some servers already send the full schema; if not, assume it's the opaque token
        token_clean = f"opaquelocktoken:{token_clean}"

    with _client() as c:
        r = c.request("UNLOCK", _join(path), headers={"Lock-Token": f"<{token_clean}>"})
        if r.status_code in (204, 200):
            return {"ok": True}
        raise HTTPException(r.status_code, r.text)


@router.get("/lockinfo")
def lockinfo(path: str):
    """
    Return active lock info if any: { locked: bool, owner: str|None, token: str|None }
    """
    with _client() as c:
        r = c.request("PROPFIND", _join(path), headers={"Depth": "0",
            "Content-Type": "text/xml"}, content=b"""<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:"><D:prop><D:lockdiscovery/></D:prop></D:propfind>""")
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        root = ET2.fromstring(r.text.encode("utf-8"))
        active = root.xpath("//*[local-name()='activelock']")
        if not active:
            return {"locked": False, "owner": None, "token": None}
        owner = None
        owner_el = root.xpath("//*[local-name()='activelock']/*[local-name()='owner']")
        if owner_el:
            owner = "".join(owner_el[0].itertext()).strip()
        token = None
        token_el = root.xpath("//*[local-name()='activelock']/*[local-name()='locktoken']/*[local-name()='href']")
        if token_el:
            token = token_el[0].text.strip("<>")
        return {"locked": True, "owner": owner, "token": token}
