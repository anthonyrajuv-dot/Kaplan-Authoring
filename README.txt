# Kaplan LMS Builder — FileTree Edition (No Docker)

## Backend (FastAPI)
```powershell
cd apps\backend
python -m venv .venv
. .venv\Scripts\Activate.ps1
pip install -r requirements.txt
$Env:ALFRESCO_WEBDAV_BASE="https://kaplan.componize.com/alfresco/webdav/Sites/dita-repository/documentLibrary"
$Env:ALFRESCO_USERNAME="<username>"
$Env:ALFRESCO_PASSWORD="<password>"
$Env:CORS_ALLOW_ORIGINS="http://localhost:5173"
uvicorn app.main:app --reload --port 8000
```

Test: http://localhost:8000/api/health

## Frontend (Vite + React)
```powershell
cd apps\frontend
npm install
npm run dev
```
Open http://localhost:5173
