import { useState } from 'react'
import type { Task, Step, System } from '../types'
import { labels, timeLabel } from '../types'
import { STEP_SVG } from './SvgAssets'
import { FlowLab } from './FlowLab'
import { api } from '../api'

export function ProgressBar({ value, status = 'running' }: { value: number; status?: string }) {
  return <div className={`progress-track progress-${status}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="步骤进度">
    <div className="progress-fill" style={{ width: `${value * 100}%` }}/>
  </div>
}

export function PipelineView({ task, system, act, busy }: {
  task: Task; system: System; act: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean
}) {
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  const current = task.steps.find(s => ['running', 'waiting_resource', 'retry_wait', 'failed'].includes(s.status))
  const selected = task.steps.find(s => s.id === selectedStep) ?? current ?? task.steps.find(s => s.status !== 'completed') ?? task.steps[5]
  const runtimes = system.workers.filter(w => w.fresh).flatMap(w => Object.values(w.runtime))
  const runtime = runtimes.find(r => r.step_id === selected.id)
  const done = task.steps.filter(s => s.status === 'completed').length
  const reusable = task.steps.filter(s => s.cached_result?.reused_from).length
  return <>
    <header className="task-heading"><div><span className="eyebrow">WORKFLOW / {task.id.slice(0, 8)}</span><h1>{task.name}</h1><p>6 个独立步骤 · PostgreSQL 持久化 · 可恢复执行</p></div>
      <div className="task-controls"><span className={`status status-${task.status}`}>{labels[task.status]}</span>
        {['pending', 'running'].includes(task.status) && <button disabled={busy} onClick={() => act(() => api.interrupt(task.id))}>Ⅱ 暂停任务</button>}
        {['paused', 'failed'].includes(task.status) && <button className="primary" disabled={busy} onClick={() => act(() => api.resume(task.id))}>↻ 从检查点恢复</button>}
        {!['completed', 'cancelled'].includes(task.status) && <button className="quiet" disabled={busy} onClick={() => act(() => api.cancel(task.id))}>取消</button>}
      </div>
    </header>
    <div className="metric-strip">
      <div><span>步骤完成</span><strong>{String(done).padStart(2, '0')}<small> / 06</small></strong></div>
      <div><span>结果复用</span><strong>{String(reusable).padStart(2, '0')}<small> 个步骤</small></strong></div>
      <div><span>执行尝试</span><strong>{String(task.steps.reduce((n, s) => n + s.attempts.length, 0)).padStart(2, '0')}<small> 次</small></strong></div>
      <div><span>恢复保障</span><strong className="metric-text">Checkpoint<small> + {system.lease_seconds}s 租约</small></strong></div>
    </div>
    <section className="pipeline-panel panel">
      <div className="section-heading"><div><span className="eyebrow">EXECUTION GRAPH</span><h3>动画素材处理管线</h3></div><button className="quiet" onClick={() => setSelectedStep(null)}>跟随当前步骤 ↗</button></div>
      <div className="step-grid">{task.steps.map((step, i) => {
        const Icon = STEP_SVG[step.name]
        const rt = runtimes.find(r => r.step_id === step.id)
        return <button key={step.id} onClick={() => setSelectedStep(step.id)} className={`step-node node-${step.status} ${selected.id === step.id ? 'selected' : ''}`} aria-pressed={selected.id === step.id}>
          <div className="node-top"><span className="node-number">0{i + 1}</span><span className={`tag ${step.requires_gpu ? 'gpu-tag' : ''}`}>{step.requires_gpu ? 'GPU' : 'CPU'}</span></div>
          <div className="node-icon">{Icon && <Icon/>}</div><strong>{step.display_name}</strong>
          <span className={`node-state status-${step.status}`}>{step.cached_result?.reused_from ? '↗ 结果复用' : labels[step.status]}</span>
          <ProgressBar value={rt?.progress ?? step.progress} status={step.status}/>
          <div className="node-bottom"><span>{Math.round((rt?.progress ?? step.progress) * 100)}%</span><span>{step.attempts.length > 0 ? `${step.attempts.length} 次尝试` : `${step.duration_seconds}s MOCK`}</span></div>
          {i < 5 && <span className={`node-connector ${step.status === 'completed' || step.status === 'running' ? 'flowing' : ''}`}>›</span>}
        </button>
      })}</div>
    </section>
    <FlowLab step={selected} runtime={runtime} mint={task.meta.style === 'mint'}/>
    <StepDetails step={selected} task={task} act={act} busy={busy}/>
  </>
}

function StepDetails({ step, task, act, busy }: { step: Step; task: Task; act: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const canInject = ['pending', 'running'].includes(task.status) && !['completed', 'skipped'].includes(step.status)
  return <section className="panel detail-panel">
    <div className="section-heading"><div><span className="eyebrow">STEP INSPECTOR / 0{step.order + 1}</span><h3>{step.display_name}<span className={`status status-${step.status}`}>{labels[step.status]}</span></h3></div>
      <div className="button-row">{canInject && <><button disabled={busy} onClick={() => act(() => api.injectFailure(task.id, step.id))}>⚡ 注入一次失败</button><button className="quiet danger" disabled={busy} onClick={() => act(() => api.injectFailure(task.id, step.id, step.failure_mode === 'always' ? 'clear' : 'always'))}>{step.failure_mode === 'always' ? '清除持续故障' : '持续故障'}</button></>}</div>
    </div>
    {step.error && <div className="inline-error">{step.error}{step.next_retry_at && <span> · 下次重试 {timeLabel(step.next_retry_at)}</span>}</div>}
    <div className="detail-stats"><span>持久化进度 <b>{Math.round(step.progress * 100)}%</b></span><span>检查点 <b>{step.checkpoint?.unit ?? 0} / 20</b></span><span>自动重试预算 <b>{Math.min(step.retry_count, step.max_retries)} / {step.max_retries}</b></span><span>指纹 <code title={step.idempotency_key ?? ''}>{step.idempotency_key?.slice(0, 14) ?? '依赖就绪后计算'}</code></span></div>
    <div className="attempt-table-wrap"><table><thead><tr><th>尝试</th><th>状态</th><th>Worker / 令牌</th><th>开始 → 结束</th><th>恢复位置</th><th>租约到期</th></tr></thead><tbody>
      {[...step.attempts].reverse().map(a => <tr key={a.id}><td>#{a.attempt_number}</td><td><span className={`status status-${a.status}`}>{labels[a.status]}</span>{a.error && <small className="attempt-error">{a.error}</small>}</td><td><code>{a.worker_id}</code><small>{a.owner_token?.slice(0, 12)}</small></td><td>{timeLabel(a.started_at)} → {timeLabel(a.ended_at)}</td><td>{a.resumed_from} / 20</td><td>{timeLabel(a.lease_expires_at)}</td></tr>)}
      {!step.attempts.length && <tr><td colSpan={6} className="empty-row">等待 Worker 领取，尚无执行尝试</td></tr>}
    </tbody></table></div>
    {step.artifacts.map(a => <a className="artifact-link" key={a.id} href={`/api/artifacts/${a.id}`} target="_blank" rel="noreferrer"><span>◈ {a.name}</span><code>SHA-256 {a.checksum.slice(0, 20)}…</code><span>{a.size_bytes.toLocaleString()} bytes ↗</span></a>)}
  </section>
}
