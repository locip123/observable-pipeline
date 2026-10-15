"""Durable checkpoints, fenced leases, worker telemetry and bounded GPU slots."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("status_events", sa.Column("sequence", sa.BigInteger(), sa.Identity(), nullable=False))
    op.create_unique_constraint("uq_status_events_sequence", "status_events", ["sequence"])
    op.add_column("steps", sa.Column("checkpoint", sa.JSON(), nullable=True))
    op.add_column("steps", sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("steps", sa.Column("failure_mode", sa.String(30), nullable=True))
    op.add_column("step_attempts", sa.Column("owner_token", sa.String(36), nullable=True))
    op.add_column("step_attempts", sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("step_attempts", sa.Column("resumed_from", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("artifacts", sa.Column("cache_key", sa.String(64), nullable=True))
    op.add_column("resource_allocations", sa.Column("attempt_id", sa.String(36), sa.ForeignKey("step_attempts.id"), nullable=True))
    op.create_index("ix_artifacts_cache_key", "artifacts", ["cache_key"])
    op.create_index("ix_steps_task_order", "steps", ["task_id", "order"])
    op.create_index("ix_attempts_lease", "step_attempts", ["status", "lease_expires_at"])
    op.create_index("ix_events_task_time", "status_events", ["task_id", "created_at"])
    op.create_table("workers",
        sa.Column("id", sa.String(255), primary_key=True),
        sa.Column("boot_id", sa.String(36)),
        sa.Column("desired_state", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("pid", sa.Integer()),
        sa.Column("concurrency", sa.Integer(), nullable=False),
        sa.Column("runtime", sa.JSON(), nullable=False))
    op.create_table("gpu_devices",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("memory_mb", sa.Integer(), nullable=False),
        sa.Column("attempt_id", sa.String(36), sa.ForeignKey("step_attempts.id")))
    op.execute("INSERT INTO gpu_devices (id, name, memory_mb) VALUES ('gpu-0', 'MOCK GPU · 8 GB', 8192)")


def downgrade():
    op.drop_constraint("uq_status_events_sequence", "status_events", type_="unique")
    op.drop_column("status_events", "sequence")
    op.drop_table("gpu_devices")
    op.drop_table("workers")
    op.drop_index("ix_events_task_time", "status_events")
    op.drop_index("ix_attempts_lease", "step_attempts")
    op.drop_index("ix_steps_task_order", "steps")
    op.drop_index("ix_artifacts_cache_key", "artifacts")
    for table, columns in {
        "resource_allocations": ["attempt_id"], "artifacts": ["cache_key"],
        "step_attempts": ["resumed_from", "heartbeat_at", "owner_token"],
        "steps": ["failure_mode", "next_retry_at", "checkpoint"],
    }.items():
        for column in columns:
            op.drop_column(table, column)
