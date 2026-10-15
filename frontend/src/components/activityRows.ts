export interface RecordValue { id: string; status: string; created_at: string }
export interface AnimatedRow<T> {
  value: T
  phase: 'entering' | 'present' | 'completing' | 'leaving'
  deadline: number
  delay: number
}
export interface RowState<T> {
  rows: AnimatedRow<T>[]
  retired: Set<string>
  since: string | null
}
export type RowAction<T> = { type: 'sync'; values: T[]; serverTime: string; now: number } | { type: 'tick'; now: number }
export const isFinished = (value: RecordValue) => ['completed', 'cancelled', 'skipped'].includes(value.status)

export function reconcileRows<T extends RecordValue>(state: RowState<T>, action: RowAction<T>): RowState<T> {
  const retired = new Set(state.retired)
  if (action.type === 'tick') {
    const rows = state.rows.flatMap(row => {
      if (row.phase === 'present' || action.now < row.deadline) return [row]
      if (row.phase === 'leaving') { retired.add(row.value.id); return [] }
      const phase = row.phase === 'completing' ? 'leaving' : isFinished(row.value) ? 'completing' : 'present'
      return [{ ...row, phase, deadline: action.now + (phase === 'leaving' ? 550 : 1400) } as AnimatedRow<T>]
    })
    return { ...state, rows, retired }
  }

  const previous = new Map(state.rows.map(row => [row.value.id, row]))
  const rows: AnimatedRow<T>[] = []
  let inserted = 0
  for (const value of action.values) {
    const old = previous.get(value.id)
    previous.delete(value.id)
    if (!isFinished(value)) retired.delete(value.id)
    if (old) {
      if (!isFinished(value) && (old.phase === 'completing' || old.phase === 'leaving')) {
        rows.push({ value, phase: 'entering', deadline: action.now + 650, delay: 0 })
      } else if (isFinished(value) && old.phase === 'present') {
        rows.push({ ...old, value, phase: 'completing', deadline: action.now + 1400 })
      } else rows.push({ ...old, value })
    } else if (!isFinished(value) || (!retired.has(value.id) && state.since !== null && Date.parse(value.created_at) >= Date.parse(state.since))) {
      const delay = Math.min(inserted++, 6) * 70
      rows.push({ value, phase: 'entering', deadline: action.now + 650 + delay, delay })
    } else retired.add(value.id)
  }
  // A row can leave the API's recent-record window during a disconnected period.
  for (const old of previous.values()) {
    rows.push(old.phase === 'leaving' ? old : { ...old, phase: 'leaving', deadline: action.now + 550 })
  }
  return { rows, retired, since: state.since ?? action.serverTime }
}
