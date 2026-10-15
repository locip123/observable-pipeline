"""Supervisor and execution child; demo crash loses real process memory.

The supervisor never executes steps. New children recover through PostgreSQL.
"""
import logging
import multiprocessing
import os
import signal
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from pipeline import execution as state
from pipeline import storage
from pipeline.config import CONCURRENCY, POLL_SECONDS, SessionLocal, engine
from pipeline.models import Worker

log = logging.getLogger(__name__)


def run_step(work, memory, memory_lock):
    sid = work["step_id"]

    def update(**values):
        with memory_lock:
            memory[sid] = {**memory.get(sid, {}), **values}

    update(task_id=work["task_id"], step_id=sid, attempt_id=work["attempt_id"], name=work["name"],
           progress=0, unit=0, phase="cache_check", device=None, buffer_frames=0)
    try:
        if not state.pulse(work):
            return
        source = work.get("input_artifact")
        if source and not storage.valid(source.get("path", ""), source.get("checksum", "")):
            state.fail_work(work, "前序产物缺失或损坏；修复后手动恢复任务将重算失效依赖")
            return
        cached = work["cached"]
        if work["use_cache"] and cached and storage.valid(cached["path"], cached["checksum"]):
            state.complete(work, {k: cached[k] for k in ("path", "checksum", "size_bytes")}, cached["reused_from"])
            return
        output = storage.svg_output(work["order"], work["key"], work["style"])
        output_path = f"results/{work['key']}.svg"
        computed = (work["checkpoint"] or {}).get("unit") == 20
        if (work["use_cache"] or computed) and storage.valid(output_path, storage.digest(output)):
            state.complete(work, {"path": output_path, "checksum": storage.digest(output), "size_bytes": len(output)}, "orphan-output")
            return
        cp = work["checkpoint"]
        unit = cp["unit"] if cp and cp.get("cache_key") == work["key"] and storage.valid(cp["path"], cp["checksum"]) else 0
        if cp and not unit and not state.pulse(work, reset_checkpoint=True):
            return
        if work["gpu"]:
            while True:
                if not state.pulse(work):
                    return
                resource = state.gpu_tick(work)
                if resource.get("lost"):
                    return
                update(phase=resource["phase"], device=resource.get("device"), progress=unit / 20, unit=unit)
                if resource.get("device"):
                    break
                time.sleep(POLL_SECONDS)
        update(phase="computing", unit=unit, progress=unit / 20)
        for next_unit in range(unit + 1, 21):
            started = time.monotonic()
            unit_seconds = work["duration"] / 20
            while time.monotonic() - started < unit_seconds:
                if not state.pulse(work):
                    return
                fraction = min(1, (time.monotonic() - started) / unit_seconds)
                update(progress=(next_unit - 1 + fraction) / 20, buffer_frames=next_unit % 4,
                       unit=next_unit - 1)
                time.sleep(min(0.4, max(0.01, unit_seconds - (time.monotonic() - started))))
            update(unit=next_unit, progress=next_unit / 20, buffer_frames=next_unit % 4)
            if next_unit % 4 == 0:
                cp = storage.checkpoint(sid, work["attempt_id"], next_unit, work["key"])
                if not state.pulse(work, checkpoint=cp):
                    return
        update(phase="publishing", buffer_frames=0)
        artifact = storage.publish(output_path, output)
        state.complete(work, artifact)
    except Exception as exc:
        log.exception("Step %s failed", sid)
        try:
            state.fail_work(work, f"{type(exc).__name__}: {exc}")
        except Exception:
            log.exception("Cannot commit failure; lease recovery will take over")
    finally:
        with memory_lock:
            memory.pop(sid, None)


def execute(worker_id):
    engine.dispose()
    memory = {}
    memory_lock = threading.Lock()
    with SessionLocal.begin() as db:
        worker = db.get(Worker, worker_id)
        worker.boot_id = str(uuid.uuid4())
        worker.pid = os.getpid()
        worker.status = "online"
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = []
        while True:
            try:
                with SessionLocal.begin() as db:
                    worker = db.get(Worker, worker_id)
                    if worker.desired_state != "running":
                        os._exit(86)  # Deliberately no cleanup, just like a killed execution process.
                    worker.status = "online"
                    worker.heartbeat_at = state.now(db)
                    with memory_lock:
                        worker.runtime = {key: dict(value) for key, value in memory.items()}
                state.recover_expired()
                futures = [f for f in futures if not f.done()]
                if len(futures) < CONCURRENCY:
                    work = state.claim(worker_id)
                    if work:
                        futures.append(pool.submit(run_step, work, memory, memory_lock))
            except Exception:
                log.exception("Worker poll failed; retrying")
            time.sleep(POLL_SECONDS)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    worker_id = os.getenv("WORKER_ID", f"worker-{socket.gethostname()}")
    with SessionLocal.begin() as db:
        if db.get(Worker, worker_id) is None:
            db.add(Worker(id=worker_id, status="starting", desired_state="running", concurrency=CONCURRENCY, runtime={}))
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    process = None
    context = multiprocessing.get_context("spawn")
    try:
        while not stopping.is_set():
            try:
                with SessionLocal.begin() as db:
                    worker = db.get(Worker, worker_id)
                    if process is not None and not process.is_alive():
                        process.join()
                        process = None
                        worker.status = "offline"
                        worker.runtime = {}
                        worker.pid = None
                    if worker.desired_state == "running" and process is None:
                        worker.status = "starting"
                        db.commit()
                        process = context.Process(target=execute, args=(worker_id,))
                        process.start()
            except Exception:
                log.exception("Supervisor unavailable; retrying database")
            stopping.wait(POLL_SECONDS)
    finally:
        if process and process.is_alive():
            process.terminate()
            process.join(timeout=5)
            if process.is_alive():
                process.kill()


if __name__ == "__main__":
    main()
