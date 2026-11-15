import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routes.data import router as data_router
from backend.routes.crops import router as crops_router
from backend.routes.terrain import router as terrain_router

app = FastAPI(
    title="loam API",
    description="Environmental and agricultural insights for farm planning.",
    version="0.1.0",
)

allowed_origins = [
    origin.strip()
    for origin in os.environ.get(
        "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Accept", "Content-Type"],
)

app.include_router(data_router, prefix="/api/data", tags=["data"])
app.include_router(terrain_router, prefix="/api/data", tags=["data"])
app.include_router(crops_router, prefix="/api/crops", tags=["crops"])


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}