import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import health, files

app = FastAPI(title="Kaplan LMS Builder API")

origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://anthonyrajuv-dot.github.io",
        "https://anthonyrajuv-dot.github.io/Kaplan-Authoring",
    ],
    allow_credentials=True,
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