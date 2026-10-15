import type { System, Step } from '../types'
import { labels, timeLabel } from '../types'

export function ResourcePanel({ system, steps }: { system: System; steps: Step[] }) {
  return <section className="panel resource-panel">
    <div className="section-heading"><div><span className="eyebrow">RESOURCE SCHEDULER</span><h3>GPU 资源分配</h3></div><span className="tag gpu-tag">MOCK · 独占名额</span></div>
    <div className="resource-flow">
      <div className="resource-stage"><span className="mini-label">01 / WAITING QUEUE</span><h4>等待队列 <span>{system.queue.filter(q => q.status === 'waiting').length}</span></h4>
        {system.queue.filter(q => q.status === 'waiting').map(q => <div key={q.id} className="queue-item"><strong>{q.task_name}</strong><span>{q.step_name} · 等待 {q.wait_seconds}s</span></div>)}
        {!system.queue.some(q => q.status === 'waiting') && <p className="empty-hint">当前没有等待 GPU 的步骤</p>}
      </div>
      <div className={`resource-wire ${system.queue.length ? 'is-active' : ''}`}><i/><span>按请求顺序<br/>原子领取 →</span></div>
      <div className="resource-stage"><span className="mini-label">02 / DEVICE ALLOCATION</span>{system.devices.map(d => {
        const allocation = system.queue.find(q => q.attempt_id === d.attempt_id)
        return <div key={d.id} className={`gpu-device ${d.attempt_id ? 'occupied' : ''}`}><div className="chip-drawing"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect x="14" y="14" width="36" height="36" rx="7" stroke="currentColor" strokeWidth="2"/><rect x="23" y="23" width="18" height="18" rx="3" fill="currentColor" opacity=".3"/>{[21, 32, 43].map(n => <path key={n} d={`M${n} 6V14M${n} 50V58M6 ${n}H14M50 ${n}H58`} stroke="currentColor" strokeWidth="2"/>)}</svg></div><div><strong>{d.id}<span className="tag">{d.attempt_id ? '占用 1 / 1' : '空闲 0 / 1'}</span></strong><p>{d.name}</p><small>{allocation ? `${labels[allocation.status]} · ${allocation.task_name}` : '可接受下一个 GPU 请求'}</small></div>
          <div className="memory-blocks">{Array.from({ length: 16 }, (_, i) => <i key={i} className={d.attempt_id && i < 8 ? 'used' : ''}/>)}</div><span className="mini-label">显存预留 {d.attempt_id ? '4096' : '0'} / {d.memory_mb} MB · 非实测利用率</span></div>
      })}</div>
      <div className={`resource-wire ${system.queue.some(q => q.status === 'allocated') ? 'is-active' : ''}`}><i/><span>计算完成<br/>释放名额 →</span></div>
      <div className="resource-stage"><span className="mini-label">03 / ALLOCATION HISTORY</span><h4>当前任务的 GPU 步骤</h4>{steps.filter(s => s.requires_gpu).map(s => {
        const a = s.resource_allocations.at(-1)
        return <div className="allocation-history" key={s.id}><strong>{s.display_name}</strong><span className={`status status-${a?.status ?? 'pending'}`}>{a ? labels[a.status] : '未请求'}</span><div className="allocation-phases">{['waiting', 'allocating', 'allocated', 'released'].map((p, i) => <i key={p} className={a && i <= ['waiting', 'allocating', 'allocated', 'released'].indexOf(a.status) ? 'reached' : ''}/>)}</div><small>{a ? `${timeLabel(a.requested_at)} → ${timeLabel(a.released_at)}` : '等待前序产物'}{a?.allocated_at && ` · 排队 ${((new Date(a.allocated_at).getTime() - new Date(a.requested_at).getTime()) / 1000).toFixed(1)}s`}</small></div>
      })}</div>
    </div>
  </section>
}
