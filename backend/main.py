from fastapi import FastAPI

app = FastAPI(
    title="Farmish API",
    description="Environmental and agricultural insights for farm planning.",
    version="0.1.0",
)


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}