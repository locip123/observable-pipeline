import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://pipeline:pipeline@127.0.0.1:5432/pipeline")
ARTIFACT_DIR = Path(os.getenv("ARTIFACT_DIR", str(Path(__file__).resolve().parents[3] / "artifacts"))).resolve()
LEASE_SECONDS = int(os.getenv("LEASE_SECONDS", "10"))
POLL_SECONDS = 0.4
CONCURRENCY = int(os.getenv("WORKER_CONCURRENCY", "3"))
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=8)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
