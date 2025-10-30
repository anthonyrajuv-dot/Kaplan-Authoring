import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import health, files

app = FastAPI(title="Kaplan LMS Builder API")

ALLOWED_ORIGINS = [
    "http://localhost:5173",                                  # local Vite dev
    "https://anthonyrajuv-dot.github.io",                     # GitHub Pages domain
    "https://anthonyrajuv-dot.github.io/Kaplan-Authoring"     # (often not needed, but fine)
]

origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,          # set False if you never use cookies/auth
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(files.router,  prefix="/api")

@app.get("/healthz")
def healthz(): return {"ok": True}

# also expose under /api for frontend testers
@app.get("/api/healthz")
def healthz_api():
    return {"ok": True}