import { useState } from 'react'
import type { Activity, System } from '../types'
import { labels, timeLabel } from '../types'
import { api } from '../api'
import { ProgressBar } from './PipelineView'
import { ActivityTables } from './ActivityTables'

export function DataPanel({ activity, system, selected, choose, act, busy }: { activity: Activity | null; system: System; selected: string | null; choose: (id: string) => void; act: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [raw, setRaw] = useState(false)
  return <section className="panel data-panel">
    <div className="section-heading"><div><span className="eyebrow">STATE OBSERVATORY</span><h3>看见数据如何流动</h3></div><button className="quiet" onClick={() => setRaw(!raw)}>{raw ? '关闭 JSON' : '查看原始 JSON ↗'}</button></div>
    <ActivityTables activity={activity} selected={selected} choose={choose}/>
    <details className="worker-inspector"><summary>Worker 内存与恢复演示<span>进程状态 · 崩溃 / 重启</span></summary>
      <div className="memory-state"><div className="state-title"><span className="ram-symbol">▥</span><div><h4>Worker 内存</h4><p>进程内缓冲 · 崩溃后丢失</p></div><span className="tag gpu-tag">VOLATILE</span></div>
        {!system.workers.length && <div className="empty-hint">尚无 Worker 注册，请启动 Worker 服务。</div>}
        {system.workers.map(worker => <div className="worker-card" key={worker.id}><div className="worker-top"><strong><span className={`live-dot ${worker.fresh ? '' : 'offline'}`}/>{worker.id}</strong><span className="tag">{worker.fresh ? '在线' : worker.status === 'offline' ? '进程已退出' : '上报已过期'}</span></div>
          <div className="worker-meta"><span>PID <b key={worker.pid} className="value-flash">{worker.pid ?? '—'}</b></span><span>BOOT <code>{worker.boot_id?.slice(0, 8) ?? '—'}</code></span><span>并发 {Object.keys(worker.runtime).length}/{worker.concurrency}</span></div>
          {worker.fresh ? Object.values(worker.runtime).map(runtime => <div key={runtime.step_id} className={`runtime-row ${runtime.task_id === selected ? 'current' : ''}`}><strong>{runtime.name}<span>{labels[runtime.phase] ?? runtime.phase}</span></strong><ProgressBar value={runtime.progress}/><div className="runtime-values"><span>内存进度 {Math.round(runtime.progress * 100)}%</span><span>缓冲 {runtime.buffer_frames} 帧</span><span>{runtime.device ?? 'CPU'}</span></div><small>task:{runtime.task_id.slice(0, 8)} · attempt:{runtime.attempt_id.slice(0, 8)}</small></div>) : <div className="memory-lost"><span>∅</span><p>{worker.status === 'offline' ? '执行进程已退出，内存已清空' : '心跳过期，无法确认当前内存状态'}</p><small>数据库检查点仍保留；新进程等待旧租约到期后恢复。</small></div>}
          {worker.fresh && !Object.keys(worker.runtime).length && <p className="empty-hint">执行进程空闲，等待可领取步骤。</p>}
          <div className="worker-actions"><span>最近上报 {timeLabel(worker.heartbeat_at)}</span>{worker.desired_state === 'running' ? <button className="danger" disabled={busy || !worker.fresh} onClick={() => act(() => api.worker(worker.id, 'crash'))}>⏻ 崩溃 Worker</button> : <button className="primary" disabled={busy || worker.status !== 'offline'} onClick={() => act(() => api.worker(worker.id, 'restart'))}>↻ 重启 Worker</button>}</div>
        </div>)}
        <div className="state-note">显示经数据库转发的内存快照，约 0.7 秒刷新。崩溃按钮影响该 Worker 的全部运行任务。</div>
      </div>
    </details>
    {raw && <pre className="json-inspector">{JSON.stringify({ ...activity, workers: system.workers }, null, 2)}</pre>}
  </section>
}
