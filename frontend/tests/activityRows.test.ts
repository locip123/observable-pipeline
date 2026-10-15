import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileRows } from '../src/components/activityRows.ts'
import type { RecordValue, RowState } from '../src/components/activityRows.ts'

const time = '2026-10-15T10:00:00Z'
const record = (id: string, status = 'running', created_at = time): RecordValue => ({ id, status, created_at })
const empty = (): RowState<RecordValue> => ({ rows: [], retired: new Set(), since: null })
const sync = (state: RowState<RecordValue>, values: RecordValue[], now: number) => reconcileRows(state, { type: 'sync', values, now, serverTime: time })
const tick = (state: RowState<RecordValue>, now: number) => reconcileRows(state, { type: 'tick', now })

test('completion stays visible, then collapses once despite repeated polling', () => {
  let state = sync(empty(), [record('task')], 0)
  assert.equal(state.rows[0].phase, 'entering')
  state = tick(state, 650)
  assert.equal(state.rows[0].phase, 'present')
  state = sync(state, [record('task', 'completed')], 700)
  assert.equal(state.rows[0].phase, 'completing')
  state = sync(state, [record('task', 'completed')], 1400)
  assert.equal(state.rows[0].deadline, 2100)
  state = tick(state, 2100)
  assert.equal(state.rows[0].phase, 'leaving')
  state = tick(state, 2650)
  assert.equal(state.rows.length, 0)
  state = sync(state, [record('task', 'completed')], 3000)
  assert.equal(state.rows.length, 0)
})

test('fast cache hits finish their entrance before leaving', () => {
  let state = sync(empty(), [record('step', 'queued')], 0)
  state = sync(state, [record('step', 'completed')], 50)
  assert.equal(state.rows[0].phase, 'entering')
  state = tick(state, 650)
  assert.equal(state.rows[0].phase, 'completing')
  assert.equal(state.rows[0].value.status, 'completed')
})

test('initial completed history stays hidden; new terminal records are still observable', () => {
  let state = sync(empty(), [record('old', 'completed')], 0)
  assert.equal(state.rows.length, 0)
  state = sync(state, [record('old', 'completed'), record('new', 'completed', '2026-10-15T10:00:01Z')], 1000)
  assert.deepEqual(state.rows.map(row => row.value.id), ['new'])
})

test('paused and failed records persist and invalidated completed steps can re-enter', () => {
  let state = sync(empty(), [record('paused', 'paused'), record('failed', 'failed'), record('step', 'completed')], 0)
  state = tick(state, 2000)
  assert.deepEqual(state.rows.map(row => row.phase), ['present', 'present'])
  state = sync(state, [record('paused', 'paused'), record('failed', 'failed'), record('step', 'queued')], 3000)
  assert.equal(state.rows[2].phase, 'entering')
  assert.equal(state.retired.has('step'), false)
})

test('cancelled rows leave; a restored step cancels its pending exit', () => {
  let state = tick(sync(empty(), [record('task'), record('step')], 0), 1000)
  state = sync(state, [record('task', 'cancelled'), record('step', 'completed')], 1100)
  state = tick(state, 2500)
  state = sync(state, [record('task', 'cancelled'), record('step', 'queued')], 2600)
  assert.equal(state.rows[1].phase, 'entering')
  state = tick(state, 3050)
  assert.deepEqual(state.rows.map(row => row.value.id), ['step'])
})

test('records missing after a long disconnect leave without inventing a completed status', () => {
  let state = tick(sync(empty(), [record('task')], 0), 650)
  state = sync(state, [], 100000)
  assert.equal(state.rows[0].phase, 'leaving')
  assert.equal(state.rows[0].value.status, 'running')
  assert.equal(tick(state, 100550).rows.length, 0)
})

test('new rows enter in order without restarting existing row animations', () => {
  let state = sync(empty(), [record('first')], 0)
  state = sync(state, [record('second'), record('third'), record('first')], 200)
  assert.deepEqual(state.rows.map(row => row.delay), [0, 70, 0])
  assert.equal(state.rows[2].deadline, 650)
})
