"""Transactional transitions; lock order: task -> step/attempt -> device.

Artifact IO and computation run outside these transactions. Every worker write
checks the attempt identity, owner token, current status and database lease.
"""
import uuid
from datetime import timedelta

from sqlalchemy import func, select

from pipeline.config import LEASE_SECONDS, SessionLocal
from pipeline.definition import PIPELINE_VERSION
from pipeline.models import (
    Artifact, AttemptStatus, GpuDevice, ResourceAllocation, ResourceStatus,
    Step, StepAttempt, StepStatus, StatusEvent, Task, TaskStatus,
)
from pipeline.storage import fingerprint

ACTIVE = (StepStatus.running, StepStatus.waiting_resource)
LIVE_TASKS = (TaskStatus.pending, TaskStatus.running)


def uid():
    return str(uuid.uuid4())


def now(db):
    return db.scalar(select(func.clock_timestamp()))


def emit(db, task_id, kind, message, step=None, old=None, new=None, meta=None):
    db.add(StatusEvent(id=uid(), task_id=task_id, step_id=step.id if step else None,
                       event_type=kind, message=message, old_status=old, new_status=new, meta=meta))


def step_state(db, step, status, kind, message, meta=None):
    old = step.status.value
    step.status = status
    emit(db, step.task_id, kind, message, step, old, status.value, meta)


def task_state(db, task, status, kind, message):
    old = task.status.value
    task.status = status
    emit(db, task.id, kind, message, old=old, new=status.value)


def lock_task(db, task_id):
    return db.scalar(select(Task).where(Task.id == task_id).with_for_update())


def release(db, attempt):
    timestamp = now(db)
    for device in db.scalars(select(GpuDevice).where(GpuDevice.attempt_id == attempt.id).with_for_update()):
        device.attempt_id = None
    for allocation in db.scalars(select(ResourceAllocation).where(
        ResourceAllocation.attempt_id == attempt.id,
        ResourceAllocation.status != ResourceStatus.released,
    )):
        allocation.status = ResourceStatus.released
        allocation.released_at = timestamp
        emit(db, attempt.step.task_id, "resource_released", "GPU 请求已释放，名额可被下一步骤领取",
             attempt.step, meta={"device": allocation.resource_id, "attempt_id": attempt.id})


def advance(db, task):
    if task.status not in LIVE_TASKS:
        return
    steps = list(db.scalars(select(Step).where(Step.task_id == task.id).order_by(Step.order)))
    if all(s.status == StepStatus.completed for s in steps):
        task.completed_at = now(db)
        task_state(db, task, TaskStatus.completed, "task_completed", "全部步骤完成，产物已持久化")
    elif any(s.status == StepStatus.failed for s in steps):
        task.completed_at = now(db)
        task_state(db, task, TaskStatus.failed, "task_failed", "步骤已耗尽自动重试次数，可手动恢复")
    else:
        step = next(s for s in steps if s.status != StepStatus.completed)
        if step.status == StepStatus.pending:
            step_state(db, step, StepStatus.queued, "step_ready", "前序产物就绪，步骤进入队列")


def fail(db, task, step, attempt, message, interrupted=False):
    attempt.status = AttemptStatus.interrupted if interrupted else AttemptStatus.failed
    attempt.ended_at = now(db)
    attempt.error = message
    release(db, attempt)
    step.error = message
    step.progress = (step.checkpoint or {}).get("unit", 0) / 20
    step.retry_count += 1
    if step.retry_count <= step.max_retries:
        delay = min(2 ** step.retry_count, 30)
        step.next_retry_at = now(db) + timedelta(seconds=delay)
        step_state(db, step, StepStatus.retry_wait, "step_lease_expired" if interrupted else "step_retry_wait",
                   f"{message}；{delay} 秒后从检查点重试", {"attempt_id": attempt.id, "retry_in": delay})
    else:
        step_state(db, step, StepStatus.failed, "step_failed", message + "；自动重试已耗尽")
    advance(db, task)


def recover_expired():
    with SessionLocal() as db:
        ids = list(db.scalars(select(Step.task_id).join(StepAttempt).where(
            StepAttempt.status == AttemptStatus.running,
            StepAttempt.lease_expires_at < func.clock_timestamp(),
        ).distinct()))
    for task_id in ids:
        with SessionLocal.begin() as db:
            task = lock_task(db, task_id)
            for step in db.scalars(select(Step).where(Step.task_id == task_id, Step.status.in_(ACTIVE))):
                attempt = db.scalar(select(StepAttempt).where(
                    StepAttempt.step_id == step.id, StepAttempt.status == AttemptStatus.running))
                if attempt and attempt.lease_expires_at < now(db):
                    fail(db, task, step, attempt, "执行进程租约到期", interrupted=True)


def claim(worker_id):
    with SessionLocal.begin() as db:
        tasks = db.scalars(select(Task).where(Task.status.in_(LIVE_TASKS)).order_by(Task.created_at)
                           .with_for_update(skip_locked=True))
        for task in tasks:
            advance(db, task)
            if task.status not in LIVE_TASKS:
                continue
            step = db.scalar(select(Step).where(Step.task_id == task.id, Step.status != StepStatus.completed)
                             .order_by(Step.order).limit(1))
            if step.status == StepStatus.retry_wait and step.next_retry_at <= now(db):
                step_state(db, step, StepStatus.queued, "step_ready", "退避结束，重新进入队列")
            if step.status != StepStatus.queued:
                continue
            if task.status == TaskStatus.pending:
                task.started_at = now(db)
                task_state(db, task, TaskStatus.running, "task_started", "Worker 已领取任务")
            previous = db.scalar(select(Step).where(Step.task_id == task.id, Step.order == step.order - 1))
            source = (task.meta or {}).get("source", "fox-orbit-v1")
            previous_hash = (previous.cached_result or {}).get("checksum") if previous else fingerprint(source)
            params = {"style": (task.meta or {}).get("style", "violet")} if step.order >= 3 else {}
            key = fingerprint([PIPELINE_VERSION, step.name, previous_hash, params])
            step.idempotency_key = key
            number = (db.scalar(select(func.max(StepAttempt.attempt_number)).where(StepAttempt.step_id == step.id)) or 0) + 1
            attempt = StepAttempt(id=uid(), step_id=step.id, attempt_number=number,
                                  worker_id=worker_id, owner_token=uid(), status=AttemptStatus.running,
                                  heartbeat_at=now(db), lease_expires_at=now(db) + timedelta(seconds=LEASE_SECONDS),
                                  resumed_from=(step.checkpoint or {}).get("unit", 0), logs=[])
            db.add(attempt)
            step.started_at = step.started_at or now(db)
            step.next_retry_at = None
            step.error = None
            step_state(db, step, StepStatus.running, "step_started", f"{step.display_name}：尝试 #{number}",
                       {"worker_id": worker_id, "attempt_id": attempt.id, "resumed_from": attempt.resumed_from})
            db.flush()
            cached = db.scalar(select(Artifact).where(Artifact.cache_key == key).order_by(Artifact.created_at.desc()).limit(1))
            return {"task_id": task.id, "step_id": step.id, "attempt_id": attempt.id,
                    "token": attempt.owner_token, "key": key, "order": step.order, "name": step.display_name,
                    "duration": step.duration_seconds, "gpu": step.requires_gpu,
                    "checkpoint": step.checkpoint, "attempt_number": number,
                    "input_artifact": previous.cached_result if previous else None,
                    "style": params.get("style", "mint"),
                    "use_cache": (task.meta or {}).get("use_cache", True),
                    "cached": {"path": cached.path, "checksum": cached.checksum, "size_bytes": cached.size_bytes,
                               "reused_from": cached.step_id} if cached else None}


def owned(db, work):
    task = lock_task(db, work["task_id"])
    step = db.get(Step, work["step_id"])
    attempt = db.get(StepAttempt, work["attempt_id"])
    if (task.status not in LIVE_TASKS or step.status not in ACTIVE
            or attempt.status != AttemptStatus.running or attempt.owner_token != work["token"]
            or attempt.lease_expires_at <= now(db)):
        return None
    return task, step, attempt


def pulse(work, checkpoint=None, reset_checkpoint=False):
    with SessionLocal.begin() as db:
        context = owned(db, work)
        if not context:
            return False
        task, step, attempt = context
        if step.failure_mode in ("once", "always"):
            if step.failure_mode == "once":
                step.failure_mode = None
            fail(db, task, step, attempt, "演示注入：模拟计算失败")
            return False
        attempt.heartbeat_at = now(db)
        attempt.lease_expires_at = now(db) + timedelta(seconds=LEASE_SECONDS)
        if reset_checkpoint:
            step.checkpoint = None
            step.progress = 0
            attempt.resumed_from = 0
            emit(db, task.id, "checkpoint_invalid", "检查点校验失败，当前步骤从头执行", step)
        if checkpoint:
            step.checkpoint = checkpoint
            step.progress = checkpoint["unit"] / 20
            attempt.logs = (attempt.logs or [])[-19:] + [f"checkpoint={checkpoint['unit']}/20 sha256={checkpoint['checksum'][:12]}"]
            emit(db, task.id, "checkpoint_saved", f"检查点 {checkpoint['unit']}/20 已写入产物卷并提交 PostgreSQL", step,
                 meta={"checkpoint": checkpoint, "attempt_id": attempt.id})
        return True


def gpu_tick(work):
    with SessionLocal.begin() as db:
        context = owned(db, work)
        if not context:
            return {"lost": True}
        task, step, attempt = context
        allocation = db.scalar(select(ResourceAllocation).where(ResourceAllocation.attempt_id == attempt.id))
        if allocation is None:
            allocation = ResourceAllocation(id=uid(), step_id=step.id, attempt_id=attempt.id,
                                            resource_type="gpu", status=ResourceStatus.waiting,
                                            meta={"required_memory_mb": 4096})
            db.add(allocation)
            step_state(db, step, StepStatus.waiting_resource, "resource_requested", "请求 GPU：1 个独占名额 / 4096 MB 显存")
            db.flush()
        if allocation.status == ResourceStatus.waiting:
            first = db.scalar(select(ResourceAllocation.id).where(ResourceAllocation.status == ResourceStatus.waiting)
                              .order_by(ResourceAllocation.requested_at, ResourceAllocation.id).limit(1))
            device = db.scalar(select(GpuDevice).where(GpuDevice.attempt_id.is_(None), GpuDevice.memory_mb >= 4096)
                               .order_by(GpuDevice.id).with_for_update(skip_locked=True).limit(1)) if first == allocation.id else None
            if device:
                device.attempt_id = attempt.id
                allocation.resource_id = device.id
                allocation.status = ResourceStatus.allocating
                allocation.allocated_at = now(db)
                emit(db, task.id, "resource_allocating", f"已锁定 {device.id}，加载 MOCK 模型", step,
                     meta={"device": device.id, "queue_wait_seconds": (now(db) - allocation.requested_at).total_seconds()})
        elif allocation.status == ResourceStatus.allocating and (now(db) - allocation.allocated_at).total_seconds() >= 1.2:
            allocation.status = ResourceStatus.allocated
            step_state(db, step, StepStatus.running, "resource_allocated", f"{allocation.resource_id} 分配完成，开始计算")
        return {"device": allocation.resource_id if allocation.status == ResourceStatus.allocated else None,
                "phase": allocation.status.value}


def complete(work, artifact, reused_from=None):
    with SessionLocal.begin() as db:
        context = owned(db, work)
        if not context:
            return False
        task, step, attempt = context
        if step.failure_mode in ("once", "always"):
            if step.failure_mode == "once":
                step.failure_mode = None
            fail(db, task, step, attempt, "演示注入：结果提交前失败")
            return False
        step.progress = 1
        step.completed_at = now(db)
        step.cached_result = {**artifact, "reused_from": reused_from, "cache_key": work["key"]}
        step.error = None
        attempt.status = AttemptStatus.succeeded
        attempt.ended_at = now(db)
        db.add(Artifact(id=uid(), step_id=step.id, name=f"{step.name}.svg", cache_key=work["key"],
                        path=artifact["path"], checksum=artifact["checksum"], size_bytes=artifact["size_bytes"],
                        meta={"reused_from": reused_from, "media_type": "image/svg+xml"}))
        release(db, attempt)
        step_state(db, step, StepStatus.completed, "step_cache_hit" if reused_from else "step_completed",
                   "校验通过，直接复用已有产物" if reused_from else "步骤完成，SVG 产物已提交",
                   {"checksum": artifact["checksum"], "reused_from": reused_from, "attempt_id": attempt.id})
        advance(db, task)
        return True


def fail_work(work, message):
    with SessionLocal.begin() as db:
        context = owned(db, work)
        if context:
            fail(db, *context, message)


def stop_task(db, task, cancel=False):
    for step in task.steps:
        if step.status == StepStatus.completed:
            continue
        for attempt in step.attempts:
            if attempt.status == AttemptStatus.running:
                attempt.status = AttemptStatus.interrupted
                attempt.error = "用户取消" if cancel else "用户暂停"
                attempt.interrupt_requested = True
                attempt.ended_at = now(db)
                release(db, attempt)
        step.progress = (step.checkpoint or {}).get("unit", 0) / 20
        step_state(db, step, StepStatus.skipped if cancel else StepStatus.paused,
                   "step_cancelled" if cancel else "step_paused", "已取消" if cancel else "已暂停，保留持久化检查点")
    task_state(db, task, TaskStatus.cancelled if cancel else TaskStatus.paused,
               "task_cancelled" if cancel else "task_paused", "任务取消" if cancel else "任务暂停，旧执行令牌已失效")
    if cancel:
        task.completed_at = now(db)
