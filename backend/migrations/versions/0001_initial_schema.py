"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-14
"""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta", sa.JSON, nullable=True),
    )
    op.create_table(
        "steps",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("task_id", sa.String(36), sa.ForeignKey("tasks.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("order", sa.Integer, nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("requires_gpu", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("max_retries", sa.Integer, nullable=False, server_default="3"),
        sa.Column("retry_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("idempotency_key", sa.String(255), nullable=True),
        sa.Column("cached_result", sa.JSON, nullable=True),
        sa.Column("progress", sa.Float, nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Integer, nullable=False, server_default="10"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("meta", sa.JSON, nullable=True),
    )
    op.create_table(
        "step_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("step_id", sa.String(36), sa.ForeignKey("steps.id"), nullable=False),
        sa.Column("attempt_number", sa.Integer, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("worker_id", sa.String(255), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("interrupt_requested", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("logs", sa.JSON, nullable=True),
    )
    op.create_table(
        "status_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("task_id", sa.String(36), sa.ForeignKey("tasks.id"), nullable=False),
        sa.Column("step_id", sa.String(36), sa.ForeignKey("steps.id"), nullable=True),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("old_status", sa.String(50), nullable=True),
        sa.Column("new_status", sa.String(50), nullable=True),
        sa.Column("message", sa.Text, nullable=True),
        sa.Column("meta", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("step_id", sa.String(36), sa.ForeignKey("steps.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("path", sa.String(1000), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("checksum", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("meta", sa.JSON, nullable=True),
    )
    op.create_table(
        "resource_allocations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("step_id", sa.String(36), sa.ForeignKey("steps.id"), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="waiting"),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("allocated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta", sa.JSON, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("resource_allocations")
    op.drop_table("artifacts")
    op.drop_table("status_events")
    op.drop_table("step_attempts")
    op.drop_table("steps")
    op.drop_table("tasks")
