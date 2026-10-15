"""Small, deterministic MOCK artifacts. All paths are relative to the shared volume."""
import hashlib
import json
import os
import uuid
from pathlib import Path

from pipeline.config import ARTIFACT_DIR


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fingerprint(value) -> str:
    return digest(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def resolve(path: str) -> Path:
    result = (ARTIFACT_DIR / path).resolve()
    if not result.is_relative_to(ARTIFACT_DIR):
        raise ValueError("Artifact path outside storage")
    return result


def valid(path: str, checksum: str) -> bool:
    try:
        return digest(resolve(path).read_bytes()) == checksum
    except (OSError, ValueError):
        return False


def publish(path: str, data: bytes) -> dict:
    target = resolve(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        with temp.open("wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, target)
        if os.name == "posix":
            fd = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        temp.unlink(missing_ok=True)
    return {"path": path, "checksum": digest(data), "size_bytes": len(data)}


def checkpoint(step_id: str, attempt_id: str, unit: int, key: str) -> dict:
    data = json.dumps({"unit": unit, "cache_key": key, "mock_frames": list(range(unit))}).encode()
    return {**publish(f"checkpoints/{step_id}/{attempt_id}-{unit}.json", data), "unit": unit, "cache_key": key}


def svg_output(order: int, key: str, style: str) -> bytes:
    color = "#ad8dff" if style == "violet" else "#63d8ad"
    background = '<rect width="640" height="360" fill="#17293c"/>' if order < 2 or order >= 4 else ''
    frames = ''
    for i in range(3 if order == 1 or order == 4 else 1):
        x = 145 + i * 170 if order in (1, 4) else 320
        frames += f'''<g transform="translate({x},180)">
        <g><ellipse cy="90" rx="65" ry="9" fill="#12222d" opacity=".2"/>
        <path d="M-60 30 Q-90 0 -60 -15 Q-38 -5 -32 14" fill="{color}"/>
        <path d="M-40 -20 L-40 -75 L-10 -52 Q15 -62 34 -48 L59 -69 L54 -10 Q70 54 0 65 Q-60 50 -40 -20" fill="{color}"/>
        <path d="M-26 0 Q0 -20 30 0 L15 36 L-12 36Z" fill="#f5eee2"/>
        <circle cx="-17" cy="-12" r="5" fill="#17293c"/><circle cx="26" cy="-12" r="5" fill="#17293c"/>
        <path d="M0 10l8 0-4 5Z" fill="#17293c"/>
        {'<animateTransform attributeName="transform" type="translate" values="0 0;0 -14;0 0" dur="1.6s" repeatCount="indefinite"/>' if order == 5 else ''}
        </g></g>'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
    <title>MOCK animation stage {order + 1}</title><desc>cache key: {key}</desc>
    {background}{frames}<text x="24" y="330" fill="#8195a8" font-family="monospace" font-size="12">STAGE {order + 1:02d} / SVG MOCK OUTPUT</text></svg>'''.encode()
