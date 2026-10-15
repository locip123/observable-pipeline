import { useState } from 'react'
import type { StatusEvent } from '../types'
import { labels, timeLabel } from '../types'

export function EventLog({ events, total, loadMore, busy }: { events: StatusEvent[]; total: number; loadMore: () => void; busy: boolean }) {
  const [filter, setFilter] = useState('all')
  const visible = events.filter(e => filter === 'all' || (filter === 'recovery' ? /fail|retry|lease_expired|resum|restart|crash|interrupt|paus/.test(e.event_type) : /resource/.test(e.event_type)))
  return <section className="event-log panel"><div className="section-heading"><div><span className="eyebrow">APPEND-ONLY EVENT HISTORY</span><h3>执行历史 <span className="tag">{total} 条持久化事件</span></h3></div><select aria-label="筛选历史" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">所有事件</option><option value="recovery">失败与恢复</option><option value="gpu">GPU 调度</option></select></div>
    <div className="event-list" aria-label="执行历史">{visible.map(ev => <details className={`event-item ${/fail|expired|crash/.test(ev.event_type) ? 'event-warning' : ''}`} key={ev.id}>
      <summary><time>{timeLabel(ev.created_at)}</time><span className="event-dot"/><div><strong>{ev.message ?? ev.event_type}</strong><span className="event-transition">{ev.old_status && `${labels[ev.old_status] ?? ev.old_status} → `}{ev.new_status && (labels[ev.new_status] ?? ev.new_status)}<code>{ev.event_type}</code></span></div><span className="event-sequence">#{ev.sequence}</span></summary>
      <pre>{JSON.stringify({ sequence: ev.sequence, step_id: ev.step_id, created_at: ev.created_at, meta: ev.meta }, null, 2)}</pre>
    </details>)}{!visible.length && <p className="empty-hint">暂无符合筛选条件的事件</p>}</div>
    {events.length < total && <button disabled={busy} onClick={loadMore}>加载更早的事件（已加载 {events.length} / {total}）</button>}
  </section>
}
