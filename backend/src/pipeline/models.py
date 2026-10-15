import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer,
    String, Text, JSON, func, BigInteger, Identity,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class TaskStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    paused = "paused"


class StepStatus(str, enum.Enum):
    pending = "pending"
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    skipped = "skipped"
    waiting_resource = "waiting_resource"
    retry_wait = "retry_wait"
    paused = "paused"


class AttemptStatus(str, enum.Enum):
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    interrupted = "interrupted"


class ResourceStatus(str, enum.Enum):
    waiting = "waiting"
    allocating = "allocating"
    allocated = "allocated"
    released = "released"


def _uuid() -> str:
    return str(uuid.uuid4())


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[TaskStatus] = mapped_column(SAEnum(TaskStatus, native_enum=False), default=TaskStatus.pending)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    steps: Mapped[list["Step"]] = relationship("Step", back_populates="task", order_by="Step.order")
    events: Mapped[list["StatusEvent"]] = relationship("StatusEvent", back_populates="task", order_by="StatusEvent.created_at")


class Step(Base):
    __tablename__ = "steps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"))
    name: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(255))
    order: Mapped[int] = mapped_column(Integer)
    status: Mapped[StepStatus] = mapped_column(SAEnum(StepStatus, native_enum=False), default=StepStatus.pending)
    requires_gpu: Mapped[bool] = mapped_column(Boolean, default=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=3)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cached_result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=10)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    meta: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    task: Mapped["Task"] = relationship("Task", back_populates="steps")
    checkpoint: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    next_retry_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_mode: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    attempts: Mapped[list["StepAttempt"]] = relationship("StepAttempt", back_populates="step", order_by="StepAttempt.attempt_number")
    artifacts: Mapped[list["Artifact"]] = relationship("Artifact", back_populates="step")
    resource_allocations: Mapped[list["ResourceAllocation"]] = relationship("ResourceAllocation", back_populates="step")


class StepAttempt(Base):
    __tablename__ = "step_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("steps.id"))
    attempt_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[AttemptStatus] = mapped_column(SAEnum(AttemptStatus, native_enum=False), default=AttemptStatus.running)
    worker_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    interrupt_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    logs: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    owner_token: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resumed_from: Mapped[int] = mapped_column(Integer, default=0)

    step: Mapped["Step"] = relationship("Step", back_populates="attempts")


class StatusEvent(Base):
    __tablename__ = "status_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    sequence: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"))
    step_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("steps.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(100))
    old_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    new_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    meta: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped["Task"] = relationship("Task", back_populates="events")


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("steps.id"))
    name: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(1000))
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    meta: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    cache_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    step: Mapped["Step"] = relationship("Step", back_populates="artifacts")


class ResourceAllocation(Base):
    __tablename__ = "resource_allocations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("steps.id"))
    resource_type: Mapped[str] = mapped_column(String(50))
    resource_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[ResourceStatus] = mapped_column(SAEnum(ResourceStatus, native_enum=False), default=ResourceStatus.waiting)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    allocated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    attempt_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("step_attempts.id"), nullable=True)

    step: Mapped["Step"] = relationship("Step", back_populates="resource_allocations")


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    boot_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    desired_state: Mapped[str] = mapped_column(String(20), default="running")
    status: Mapped[str] = mapped_column(String(20), default="starting")
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    pid: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    concurrency: Mapped[int] = mapped_column(Integer, default=3)
    runtime: Mapped[dict] = mapped_column(JSON, default=dict)


class GpuDevice(Base):
    __tablename__ = "gpu_devices"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    memory_mb: Mapped[int] = mapped_column(Integer)
    attempt_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("step_attempts.id"), nullable=True)
