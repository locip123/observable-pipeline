import type { Activity, Task, TaskSummary, StatusEvent, Snapshot, System } from './types'

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, opts)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `请求失败 (${res.status})`)
  }
  return res.json() as Promise<T>
}
const post = <T,>(path: string, body?: unknown) => req<T>(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})
export const api = {
  createTask: (body: { name: string; source?: string; style?: string; duration_scale?: number; use_cache?: boolean; max_retries?: number }) => post<Task>('/tasks', body),
  listTasks: (signal?: AbortSignal) => req<TaskSummary[]>('/tasks?limit=200', { signal }),
  activity: (signal?: AbortSignal) => req<Activity>('/activity', { signal }),
  snapshot: (id: string, signal?: AbortSignal) => req<Snapshot>(`/tasks/${id}/snapshot`, { signal }),
  system: (signal?: AbortSignal) => req<System>('/system', { signal }),
  getEvents: (id: string, before?: number) => req<StatusEvent[]>(`/tasks/${id}/events${before ? `?before=${before}` : ''}`),
  interrupt: (id: string) => post(`/tasks/${id}/interrupt`),
  resume: (id: string) => post(`/tasks/${id}/resume`),
  cancel: (id: string) => post(`/tasks/${id}/cancel`),
  injectFailure: (taskId: string, stepId: string, mode = 'once') => post(`/tasks/${taskId}/steps/${stepId}/inject-failure`, { mode }),
  worker: (id: string, action: 'crash' | 'restart') => post(`/workers/${encodeURIComponent(id)}/${action}`),
}
