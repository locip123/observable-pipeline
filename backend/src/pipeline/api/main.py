from fastapi import FastAPI

app = FastAPI(title="Observable Task Pipeline")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
