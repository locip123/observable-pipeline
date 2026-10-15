import assert from 'node:assert/strict'
import test from 'node:test'
import { adjacentRecentNode, deriveWorkerFlow, flowPath, followingStep } from '../src/components/workerFlowState.ts'
import type { Snapshot, StatusEvent, Step } from '../src/types.ts'

const at = '2026-10-15T10:00:00Z'
function fixture(): Snapshot {
  const step: Step = {
    id: 's1', name: 'import', display_name: '素材导入', order: 0, status: 'running', requires_gpu: false,
    max_retries: 3, retry_count: 0, progress: 0.4, duration_seconds: 20, error: null, created_at: at,
    started_at: at, completed_at: null, next_retry_at: null, checkpoint: { unit: 8, path: 'cp', checksum: 'sha', size_bytes: 50 },
    idempotency_key: null, failure_mode: null, cached_result: null, artifacts: [], resource_allocations: [],
    attempts: [{ id: 'a1', attempt_number: 1, status: 'running', worker_id: 'w1', owner_token: 'token',
      heartbeat_at: at, lease_expires_at: '2026-10-15T10:00:10Z', resumed_from: 4, interrupt_requested: false,
      started_at: at, ended_at: null, error: null, logs: [] }],
  }
  return {
    task: { id: 't1', name: 'test', status: 'running', created_at: at, completed_at: null, started_at: at, description: null,
      meta: { source: 'fox', style: 'mint', use_cache: false, duration_scale: 1, max_retries: 3 }, steps: [step] },
    system: { server_time: at, lease_seconds: 10, devices: [], queue: [], workers: [{ id: 'w1', boot_id: 'boot', status: 'online',
      desired_state: 'running', heartbeat_at: at, pid: 123, concurrency: 3, fresh: true,
      runtime: { s1: { task_id: 't1', step_id: 's1', attempt_id: 'a1', name: '素材导入', phase: 'computing', progress: 0.55, unit: 11, device: null, buffer_frames: 3 } } }] },
    events: [], counts: {},
  }
}
function event(type: string, created_at = at): StatusEvent {
  return { id: type, sequence: 1, event_type: type, step_id: 's1', old_status: null, new_status: null, message: null, meta: null, created_at }
}
const derive = (snapshot: Snapshot, connected = true) => deriveWorkerFlow(snapshot, snapshot.task.steps[0], connected)

test('computing shows current telemetry, while committed checkpoints flash without moving the worker backwards', () => {
  const snapshot = fixture()
  snapshot.events = [event('checkpoint_saved')]
  const flow = derive(snapshot)
  assert.equal(flow.current, 'compute')
  assert.ok(flow.recent.has('checkpoint'))
  assert.equal(flow.runtime?.progress, 0.55)
  assert.match(flow.description, /8\/20/)
})

test('waiting and model loading stay on the GPU branch, then move into computation', () => {
  const snapshot = fixture()
  const step = snapshot.task.steps[0]
  step.requires_gpu = true
  step.status = 'waiting_resource'
  for (const phase of ['waiting', 'allocating', 'allocated']) {
    snapshot.system.workers[0].runtime.s1.phase = phase
    assert.equal(derive(snapshot).current, 'gpu')
  }
  snapshot.system.workers[0].runtime.s1.phase = 'computing'
  step.status = 'running'
  assert.equal(derive(snapshot).current, 'compute')
})

test('phase history preserves short checkpoint validation/save phases and expires highlights by server time', () => {
  const snapshot = fixture()
  snapshot.system.workers[0].runtime.s1.phase_history = [
    { phase: 'checkpoint_check', at }, { phase: 'checkpoint_save', at },
  ]
  let flow = derive(snapshot)
  assert.ok(flow.recent.has('restore'))
  assert.ok(flow.recent.has('checkpoint'))
  snapshot.system.server_time = '2026-10-15T10:00:04Z'
  flow = derive(snapshot)
  assert.equal(flow.recent.size, 0)
  assert.ok(flow.visited.has('restore'))
})

test('fast cache hit observed only after completion follows the shortcut without inventing computation', () => {
  const snapshot = fixture()
  const step = snapshot.task.steps[0]
  step.status = 'completed'
  step.checkpoint = null
  step.cached_result = { checksum: 'sha', cache_key: 'key', reused_from: 'other-step' }
  step.attempts[0].status = 'succeeded'
  snapshot.task.status = 'completed'
  snapshot.events = [event('step_cache_hit')]
  const flow = derive(snapshot)
  assert.equal(flow.current, 'done')
  assert.equal(flow.runtime, undefined)
  assert.ok(flow.recent.has('cache') && flow.recent.has('commit'))
  for (const id of ['restore', 'gpu', 'compute', 'publish'] as const) assert.equal(flow.visited.has(id), false)
})

test('stale/offline workers and expired leases never appear as computing even with retained telemetry', () => {
  for (const reason of ['stale', 'offline', 'crash', 'lease']) {
    const snapshot = fixture()
    const worker = snapshot.system.workers[0]
    if (reason === 'stale') worker.fresh = false
    if (reason === 'offline') { worker.fresh = false; worker.status = 'offline' }
    if (reason === 'crash') worker.desired_state = 'crashed'
    if (reason === 'lease') snapshot.system.server_time = '2026-10-15T10:00:11Z'
    assert.equal(derive(snapshot).current, 'lost', reason)
    assert.equal(derive(snapshot).runtime, undefined, reason)
  }
})

test('old attempt telemetry is ignored after re-claim, and fresh telemetry follows the new attempt', () => {
  const snapshot = fixture()
  const old = snapshot.task.steps[0].attempts[0]
  old.status = 'interrupted'
  snapshot.task.steps[0].attempts.unshift({ ...old, id: 'a2', attempt_number: 2, status: 'running' })
  assert.equal(derive(snapshot).current, null)
  snapshot.system.workers[0].runtime.s1.attempt_id = 'a2'
  snapshot.system.workers[0].runtime.s1.phase = 'checkpoint_check'
  assert.equal(derive(snapshot).current, 'restore')
})

test('restarted process without the old execution waits for recovery rather than claiming to compute', () => {
  const snapshot = fixture()
  snapshot.system.workers[0].runtime = {}
  snapshot.system.workers[0].heartbeat_at = '2026-10-15T10:00:04Z'
  snapshot.system.server_time = '2026-10-15T10:00:04Z'
  assert.equal(derive(snapshot).current, 'lost')
})

test('retry, exhausted budget, pause and cancellation override stale in-memory execution', () => {
  for (const [status, current] of [['retry_wait', 'retry'], ['failed', 'manual'], ['paused', 'manual'], ['skipped', null]] as const) {
    const snapshot = fixture()
    snapshot.task.steps[0].status = status
    snapshot.task.steps[0].next_retry_at = '2026-10-15T10:00:02Z'
    const flow = derive(snapshot)
    assert.equal(flow.current, current)
    assert.equal(flow.runtime, undefined)
  }
})

test('API disconnect clears live/recent highlights but retains confirmed history', () => {
  const snapshot = fixture()
  snapshot.events = [event('checkpoint_saved')]
  const flow = derive(snapshot, false)
  assert.equal(flow.current, null)
  assert.equal(flow.recent.size, 0)
  assert.equal(flow.runtime, undefined)
  assert.ok(flow.visited.has('checkpoint'))
})

test('automatic following respects step order and never lets another task drive the current flow', () => {
  const snapshot = fixture()
  const first = snapshot.task.steps[0]
  const second = { ...first, id: 's2', order: 1, status: 'pending' } as Step
  snapshot.task.steps = [second, first]
  assert.equal(followingStep(snapshot.task.steps)?.id, 's1')
  first.status = 'completed'
  assert.equal(followingStep(snapshot.task.steps)?.id, 's2')
  first.status = 'running'
  snapshot.system.workers[0].runtime.s1.task_id = 'other-task'
  assert.equal(deriveWorkerFlow(snapshot, first).runtime, undefined)
})

test('missed polling phases are replayed through adjacent nodes instead of jumping', () => {
  assert.deepEqual(flowPath('poll', 'compute', { requiresGpu: false }), ['poll', 'claim', 'cache', 'restore', 'compute'])
  assert.deepEqual(flowPath('poll', 'compute', { requiresGpu: true }), ['poll', 'claim', 'cache', 'restore', 'gpu', 'compute'])
  assert.deepEqual(flowPath('compute', 'advance'), ['compute', 'checkpoint', 'publish', 'commit', 'advance'])
  assert.deepEqual(flowPath('advance', 'claim'), ['advance', 'poll', 'claim'])
  assert.deepEqual(flowPath('cache', 'advance', { reused: true }), ['cache', 'commit', 'advance'])
  assert.deepEqual(flowPath('compute', 'retry'), ['compute', 'lost', 'recover', 'retry'])
  assert.deepEqual(flowPath('retry', 'claim'), ['retry', 'poll', 'claim'])
  assert.deepEqual(flowPath('manual', 'claim'), ['manual', 'poll', 'claim'])
})

test('stale backward phase has no legal path and is ignored by the visual transition queue', () => {
  assert.deepEqual(flowPath('publish', 'gpu'), [])
  assert.deepEqual(flowPath('done', 'compute'), [])
})

test('a burst of persisted events exposes only the adjacent predecessor as a recent visual node', () => {
  assert.equal(adjacentRecentNode('advance', new Set(['publish', 'commit', 'advance'])), 'commit')
  assert.equal(adjacentRecentNode('done', new Set(['publish', 'commit', 'advance'])), 'advance')
  assert.equal(adjacentRecentNode('commit', new Set(['cache', 'commit', 'advance'])), 'cache')
  assert.equal(adjacentRecentNode('compute', new Set(['restore', 'gpu', 'compute']), { requiresGpu: true }), 'gpu')
  assert.equal(adjacentRecentNode('retry', new Set(['lost', 'recover', 'retry'])), 'recover')
})
