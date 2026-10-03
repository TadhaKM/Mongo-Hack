from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.db.indexes import ensure_indexes
from app.db.mongodb import get_db
from app.api.properties import router as properties_router
from app.api.analysis import router as analysis_router
from app.api.agent import router as agent_router
from app.api.system import router as system_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_indexes()
    yield

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
app.include_router(properties_router)
app.include_router(analysis_router)
app.include_router(agent_router)
app.include_router(system_router)

@app.get("/health", tags=["system"])
def health():
    try:
        get_db().command("ping")
        return {"status": "ok", "mongodb": "ok"}
    except Exception as exc:
        return {"status": "degraded", "mongodb": "error", "detail": str(exc)}
