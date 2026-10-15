export interface Attempt {
  id: string
  attempt_number: number
  status: 'running' | 'succeeded' | 'failed' | 'interrupted'
  worker_id: string | null
  owner_token: string | null
  heartbeat_at: string | null
  lease_expires_at: string | null
  resumed_from: number
  interrupt_requested: boolean
  started_at: string | null
  ended_at: string | null
  error: string | null
  logs: string[] | null
}
export interface ResourceAlloc {
  id: string
  attempt_id: string | null
  step_id: string
  resource_type: string
  resource_id: string | null
  status: 'waiting' | 'allocating' | 'allocated' | 'released'
  requested_at: string
  allocated_at: string | null
  released_at: string | null
}
export interface Artifact {
  id: string
  name: string
  path: string
  checksum: string
  cache_key: string
  size_bytes: number
  created_at: string
}
export type StepStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_resource' | 'retry_wait' | 'paused'
export interface Checkpoint { unit: number; path: string; checksum: string; size_bytes: number }
export interface Step {
  id: string
  name: string
  display_name: string
  order: number
  status: StepStatus
  requires_gpu: boolean
  max_retries: number
  retry_count: number
  progress: number
  duration_seconds: number
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  next_retry_at: string | null
  checkpoint: Checkpoint | null
  idempotency_key: string | null
  failure_mode: string | null
  cached_result: { checksum: string; reused_from: string | null; cache_key: string } | null
  attempts: Attempt[]
  artifacts: Artifact[]
  resource_allocations: ResourceAlloc[]
}
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
export interface TaskSummary {
  id: string
  name: string
  status: TaskStatus
  created_at: string
  completed_at: string | null
}
export interface Task extends TaskSummary {
  description: string | null
  started_at: string | null
  meta: { source: string; style: 'violet' | 'mint'; use_cache: boolean; duration_scale: number; max_retries: number }
  steps: Step[]
}
export interface StatusEvent {
  id: string
  sequence: number
  event_type: string
  step_id: string | null
  old_status: string | null
  new_status: string | null
  message: string | null
  meta: Record<string, unknown> | null
  created_at: string
}
export interface Runtime {
  task_id: string
  step_id: string
  attempt_id: string
  name: string
  phase: string
  progress: number
  unit: number
  device: string | null
  buffer_frames: number
}
export interface Worker {
  id: string
  boot_id: string | null
  status: string
  desired_state: string
  heartbeat_at: string | null
  pid: number | null
  concurrency: number
  fresh: boolean
  runtime: Record<string, Runtime>
}
export interface System {
  server_time: string
  lease_seconds: number
  workers: Worker[]
  devices: { id: string; name: string; memory_mb: number; attempt_id: string | null }[]
  queue: (ResourceAlloc & { task_id: string; task_name: string; step_name: string; wait_seconds: number })[]
}
export interface Snapshot {
  task: Task
  events: StatusEvent[]
  system: System
  counts: Record<string, number>
}
export interface ActivityTask extends TaskSummary {
  step_count: number
  completed_steps: number
}
export interface ActivityStep {
  id: string
  task_id: string
  task_name: string
  display_name: string
  order: number
  status: StepStatus
  created_at: string
  progress: number
  checkpoint_unit: number
  requires_gpu: boolean
  retry_count: number
}
export interface Activity {
  server_time: string
  tasks: ActivityTask[]
  steps: ActivityStep[]
}
export const labels: Record<string, string> = {
  pending: '等待依赖', queued: '已就绪', running: '执行中', completed: '已完成',
  failed: '失败', cancelled: '已取消', paused: '已暂停', skipped: '已取消',
  waiting_resource: '等待 GPU', retry_wait: '等待重试', succeeded: '成功', interrupted: '中断',
  waiting: '排队', allocating: '加载模型', allocated: '已分配', released: '已释放',
  computing: '计算中', publishing: '发布产物', cache_check: '检查缓存',
}
export const timeLabel = (value: string | null) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—'
