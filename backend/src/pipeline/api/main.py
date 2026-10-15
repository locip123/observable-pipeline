import os
from datetime import timedelta
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect, or_, select, text
from sqlalchemy.orm import Session, selectinload

from pipeline import execution as state, storage
from pipeline.config import LEASE_SECONDS, SessionLocal
from pipeline.definition import PIPELINE_STEPS, PIPELINE_VERSION
from pipeline.models import (
    Artifact, AttemptStatus, GpuDevice, ResourceAllocation, ResourceStatus,
    Step, StepAttempt, StepStatus, StatusEvent, Task, TaskStatus, Worker,
)

app = FastAPI(title="可观测 AI 任务管线", version="1.0.0")


def get_db():
    with SessionLocal() as db:
        yield db


def row(value):
    return {column.key: getattr(value, column.key) for column in inspect(type(value)).columns}


def task_data(task):
    return {**row(task), "steps": [{**row(step),
        "attempts": [row(a) for a in step.attempts],
        "artifacts": [row(a) for a in step.artifacts],
        "resource_allocations": [row(a) for a in sorted(step.resource_allocations, key=lambda a: a.requested_at)],
    } for step in task.steps]}


def find_task(db, task_id, lock=False):
    task = state.lock_task(db, task_id) if lock else db.scalar(select(Task).where(Task.id == task_id).options(
        selectinload(Task.steps).selectinload(Step.attempts),
        selectinload(Task.steps).selectinload(Step.artifacts),
        selectinload(Task.steps).selectinload(Step.resource_allocations)))
    if task is None:
        raise HTTPException(404, "任务不存在")
    return task


def demo_only():
    if os.getenv("ENABLE_DEMO_CONTROLS", "true").lower() != "true":
        raise HTTPException(403, "故障演示控制已关闭")


class CreateTaskBody(BaseModel):
    name: str = Field(min_length=1, max_length=100, pattern=r"\S")
    description: str | None = Field(default=None, max_length=1000)
    source: str = Field(default="fox-orbit-v1", min_length=1, max_length=100)
    style: Literal["violet", "mint"] = "violet"
    use_cache: bool = True
    duration_scale: float = Field(default=1, ge=0.1, le=600)
    max_retries: int = Field(default=3, ge=0, le=5)


class FailureBody(BaseModel):
    mode: Literal["once", "always", "clear"] = "once"


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "postgresql"}


@app.post("/api/tasks", status_code=201)
def create_task(body: CreateTaskBody, db: Session = Depends(get_db)):
    task = Task(id=state.uid(), name=body.name.strip(), description=body.description,
                status=TaskStatus.pending, meta={**body.model_dump(exclude={"name", "description"}),
                                                 "pipeline_version": PIPELINE_VERSION})
    db.add(task)
    db.flush()
    for order, (name, label, gpu, duration) in enumerate(PIPELINE_STEPS):
        db.add(Step(id=state.uid(), task_id=task.id, name=name, display_name=label, order=order,
                    requires_gpu=gpu, duration_seconds=max(1, round(duration * body.duration_scale)),
                    status=StepStatus.queued if order == 0 else StepStatus.pending,
                    max_retries=body.max_retries, retry_count=0, progress=0))
    state.emit(db, task.id, "task_created", "动画任务已创建：6 个独立持久化步骤", new="pending",
               meta={"source": body.source, "pipeline_version": PIPELINE_VERSION})
    db.commit()
    return task_data(find_task(db, task.id))


@app.get("/api/tasks")
def list_tasks(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    return [row(t) for t in db.scalars(select(Task).order_by(Task.created_at.desc()).offset(offset).limit(limit))]


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    return task_data(find_task(db, task_id))


@app.get("/api/activity")
def activity(db: Session = Depends(get_db)):
    db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
    timestamp = state.now(db)
    # Keep recent terminal rows long enough for clients to animate their departure.
    tasks = list(db.scalars(select(Task).where(or_(
        Task.status.notin_((TaskStatus.completed, TaskStatus.cancelled)),
        Task.updated_at >= timestamp - timedelta(minutes=1),
    )).order_by(Task.created_at.desc(), Task.id).options(selectinload(Task.steps))))
    return {"server_time": timestamp,
            "tasks": [{"id": t.id, "name": t.name, "status": t.status,
                       "created_at": t.created_at, "completed_at": t.completed_at,
                       "step_count": len(t.steps),
                       "completed_steps": sum(s.status == StepStatus.completed for s in t.steps)} for t in tasks],
            "steps": [{"id": s.id, "task_id": t.id, "task_name": t.name,
                       "display_name": s.display_name, "order": s.order, "status": s.status,
                       "created_at": s.created_at, "progress": s.progress,
                       "checkpoint_unit": (s.checkpoint or {}).get("unit", 0),
                       "requires_gpu": s.requires_gpu, "retry_count": s.retry_count}
                      for t in tasks for s in t.steps]}


@app.get("/api/tasks/{task_id}/events")
def get_events(task_id: str, before: int | None = None, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    find_task(db, task_id)
    query = select(StatusEvent).where(StatusEvent.task_id == task_id)
    if before is not None:
        query = query.where(StatusEvent.sequence < before)
    return [row(e) for e in db.scalars(query.order_by(StatusEvent.sequence.desc()).limit(limit))]


def system_data(db):
    timestamp = state.now(db)
    workers = []
    for worker in db.scalars(select(Worker).order_by(Worker.id)):
        fresh = bool(worker.heartbeat_at and (timestamp - worker.heartbeat_at).total_seconds() < 3)
        workers.append({**row(worker), "fresh": fresh and worker.status == "online",
                        "status": worker.status if fresh or worker.status == "offline" else "stale"})
    allocations = list(db.scalars(select(ResourceAllocation).where(ResourceAllocation.status != ResourceStatus.released)
                                 .order_by(ResourceAllocation.requested_at, ResourceAllocation.id)))
    return {"server_time": timestamp, "lease_seconds": LEASE_SECONDS, "workers": workers,
            "devices": [row(device) for device in db.scalars(select(GpuDevice).order_by(GpuDevice.id))],
            "queue": [{**row(a), "step_name": a.step.display_name, "task_id": a.step.task_id,
                       "task_name": a.step.task.name,
                       "wait_seconds": round(((a.allocated_at or timestamp) - a.requested_at).total_seconds(), 1)} for a in allocations]}


@app.get("/api/system")
def system(db: Session = Depends(get_db)):
    return system_data(db)


@app.get("/api/tasks/{task_id}/snapshot")
def snapshot(task_id: str, db: Session = Depends(get_db)):
    db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
    task = find_task(db, task_id)
    events = [row(e) for e in db.scalars(select(StatusEvent).where(StatusEvent.task_id == task_id)
                                       .order_by(StatusEvent.sequence.desc()).limit(100))]
    return {"task": task_data(task), "events": events, "system": system_data(db),
            "counts": {"tasks": 1, "steps": len(task.steps),
                       "step_attempts": sum(len(s.attempts) for s in task.steps),
                       "status_events": db.scalar(select(func.count()).select_from(StatusEvent).where(StatusEvent.task_id == task_id)),
                       "artifacts": sum(len(s.artifacts) for s in task.steps),
                       "resource_allocations": sum(len(s.resource_allocations) for s in task.steps)}}


@app.post("/api/tasks/{task_id}/interrupt")
def interrupt(task_id: str, db: Session = Depends(get_db)):
    task = find_task(db, task_id, lock=True)
    if task.status not in state.LIVE_TASKS:
        raise HTTPException(409, "仅执行中或待执行任务可暂停")
    state.stop_task(db, task)
    db.commit()
    return {"status": "paused"}


@app.post("/api/tasks/{task_id}/resume")
def resume(task_id: str, db: Session = Depends(get_db)):
    task = find_task(db, task_id, lock=True)
    if task.status not in (TaskStatus.failed, TaskStatus.paused):
        raise HTTPException(409, "仅暂停或失败任务可恢复；已取消任务为终态")
    invalid_from = len(task.steps)
    for step in task.steps:
        if step.status == StepStatus.completed:
            result = step.cached_result or {}
            if not result.get("path") or not storage.valid(result["path"], result.get("checksum", "")):
                invalid_from = min(invalid_from, step.order)
    for step in task.steps:
        if step.order >= invalid_from:
            step.cached_result = None
            step.checkpoint = None
            step.progress = 0
            state.step_state(db, step, StepStatus.pending, "artifact_invalid", "上游产物失效，重新计算依赖链")
        elif step.status != StepStatus.completed:
            state.step_state(db, step, StepStatus.pending, "step_resumed", "保留检查点，等待前序步骤")
        if step.status != StepStatus.completed:
            step.retry_count = 0
            step.next_retry_at = None
            step.error = None
            step.failure_mode = None
            step.completed_at = None
    task.completed_at = None
    state.task_state(db, task, TaskStatus.running, "task_resumed", "任务恢复，已验证的成功步骤直接保留")
    state.advance(db, task)
    db.commit()
    return {"status": "running"}


@app.post("/api/tasks/{task_id}/cancel")
def cancel(task_id: str, db: Session = Depends(get_db)):
    task = find_task(db, task_id, lock=True)
    if task.status in (TaskStatus.completed, TaskStatus.cancelled):
        raise HTTPException(409, "任务已结束")
    state.stop_task(db, task, cancel=True)
    db.commit()
    return {"status": "cancelled"}


@app.post("/api/tasks/{task_id}/steps/{step_id}/inject-failure", dependencies=[Depends(demo_only)])
def inject_failure(task_id: str, step_id: str, body: FailureBody = FailureBody(), db: Session = Depends(get_db)):
    task = find_task(db, task_id, lock=True)
    step = db.get(Step, step_id)
    if step is None or step.task_id != task.id:
        raise HTTPException(404, "步骤不存在")
    if task.status not in state.LIVE_TASKS or step.status in (StepStatus.completed, StepStatus.skipped):
        raise HTTPException(409, "该步骤无法注入故障")
    step.failure_mode = None if body.mode == "clear" else body.mode
    state.emit(db, task.id, "failure_injected", f"故障模式：{body.mode}", step, meta={"mode": body.mode})
    db.commit()
    return {"injected": True}


@app.post("/api/workers/{worker_id}/{action}", dependencies=[Depends(demo_only)])
def control_worker(worker_id: str, action: Literal["crash", "restart"], db: Session = Depends(get_db)):
    worker = db.get(Worker, worker_id)
    if worker is None:
        raise HTTPException(404, "Worker 不存在")
    worker.desired_state = "crashed" if action == "crash" else "running"
    # No step status is forged here: only lease expiry can recover crashed work.
    ids = list(db.scalars(select(Step.task_id).join(StepAttempt).where(
        StepAttempt.worker_id == worker_id, StepAttempt.status == AttemptStatus.running).distinct()))
    for task_id in ids:
        state.emit(db, task_id, f"worker_{action}_requested", "已请求终止执行进程" if action == "crash" else "已请求重启执行进程",
                   meta={"worker_id": worker_id})
    db.commit()
    return {"desired_state": worker.desired_state}


@app.get("/api/artifacts/{artifact_id}")
def artifact_file(artifact_id: str, db: Session = Depends(get_db)):
    artifact = db.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(404, "产物不存在")
    if not storage.valid(artifact.path, artifact.checksum or ""):
        raise HTTPException(409, "产物缺失或校验失败，不能复用")
    return FileResponse(storage.resolve(artifact.path), media_type="image/svg+xml",
                        headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})


@app.get("/api/metrics", response_class=PlainTextResponse)
def metrics(db: Session = Depends(get_db)):
    lines = []
    for model, name in ((Task, "pipeline_tasks"), (Step, "pipeline_steps"), (StepAttempt, "pipeline_attempts")):
        lines.extend(f'{name}{{status="{status.value}"}} {count}' for status, count in db.execute(
            select(model.status, func.count()).group_by(model.status)))
    lines.append(f'pipeline_gpu_slots_total {db.scalar(select(func.count()).select_from(GpuDevice))}')
    lines.append(f'pipeline_gpu_slots_used {db.scalar(select(func.count()).select_from(GpuDevice).where(GpuDevice.attempt_id.is_not(None)))}')
    return "\n".join(lines) + "\n"
