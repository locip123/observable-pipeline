import { useEffect, useReducer } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Activity } from '../types'
import { labels, timeLabel } from '../types'
import { isFinished, reconcileRows } from './activityRows'
import type { AnimatedRow, RecordValue, RowState } from './activityRows'

function useAnimatedRows<T extends RecordValue>(values: T[] | undefined, serverTime: string | undefined) {
  const [state, dispatch] = useReducer(reconcileRows<T>, { rows: [], retired: new Set<string>(), since: null } as RowState<T>)
  useEffect(() => {
    if (values && serverTime) dispatch({ type: 'sync', values, serverTime, now: Date.now() })
  }, [values, serverTime])
  const deadline = Math.min(...state.rows.filter(row => row.phase !== 'present').map(row => row.deadline))
  useEffect(() => {
    if (!Number.isFinite(deadline)) return
    const timer = setTimeout(() => dispatch({ type: 'tick', now: Date.now() }), Math.max(0, deadline - Date.now()))
    return () => clearTimeout(timer)
  }, [deadline])
  return state.rows
}

function RecordRow<T extends RecordValue>({ row, selected, children }: { row: AnimatedRow<T>; selected: boolean; children: ReactNode }) {
  return <div role="row" className={`record-shell record-${row.phase} ${selected ? 'record-selected' : ''}`} style={{ '--row-delay': `${row.delay}ms` } as CSSProperties}>
    <div className="record-clip"><div className="record-cells">{children}</div></div>
  </div>
}

function RecordStatus({ status, task = false }: { status: string; task?: boolean }) {
  return <span key={status} className={`record-status status-${status}`}><i/>{task && status === 'pending' ? '待领取' : labels[status] ?? status}<code>{status}</code></span>
}

function EmptyTable({ loading, steps = false }: { loading: boolean; steps?: boolean }) {
  return <div className="records-empty"><span aria-hidden="true">{loading ? '⋯' : '▤'}</span><strong>{loading ? '正在读取数据库…' : steps ? '没有待执行的步骤' : '没有进行中的任务'}</strong><p>{loading ? '任务与步骤来自同一个读快照' : steps ? '创建任务后，六个步骤会依次进入这里。' : '从左侧创建任务，观察一条记录的执行过程。'}</p></div>
}

export function ActivityTables({ activity, selected, choose }: { activity: Activity | null; selected: string | null; choose: (id: string) => void }) {
  const tasks = useAnimatedRows(activity?.tasks, activity?.server_time)
  const steps = useAnimatedRows(activity?.steps, activity?.server_time)
  const taskCount = activity?.tasks.filter(t => !isFinished(t)).length ?? 0
  const stepCount = activity?.steps.filter(s => !isFinished(s)).length ?? 0
  return <>
    <div className="database-toolbar"><span className="database-label"><span className="db-symbol" aria-hidden="true">▤</span><strong>PostgreSQL</strong><span>全局活动记录</span></span><div className="record-legend"><span><i className="legend-insert"/>插入</span><span><i className="legend-update"/>状态更新</span><span><i className="legend-exit"/>完成移出</span></div></div>
    <div className="database-lifecycle"><span><b>01</b> 创建任务与步骤</span><i>→</i><span><b>02</b> Worker 领取 · 更新状态与检查点</span><i>→</i><span><b>03</b> 完成后移出活动视图</span></div>
    <div className="activity-tables">
      <section className="record-table task-records" aria-labelledby="task-table-title"><header className="record-table-title"><div><span className="table-index">01</span><h4 id="task-table-title">任务表 <code>tasks</code></h4></div><span className="record-count"><b>{taskCount}</b> 条活动记录</span></header>
        <p className="table-description">一个任务，一条记录。点击任务可联动查看步骤。</p>
        <div className="record-scroll" tabIndex={0} role="region" aria-label="任务表滚动区域"><div role="table" aria-label="任务表" className="records-grid">
          <div role="row" className="record-columns"><span role="columnheader">任务 / 主键 ID</span><span role="columnheader">状态</span><span role="columnheader">完成步骤</span></div>
          <div role="rowgroup">{tasks.map(row => <RecordRow key={row.value.id} row={row} selected={row.value.id === selected}>
            <div role="cell" className="record-identity"><button title={row.value.name} onClick={() => choose(row.value.id)} aria-pressed={row.value.id === selected}>{row.value.name}</button><code title={row.value.id}>{row.value.id.slice(0, 8)}<span className="record-key">PK</span></code><small>{row.phase === 'entering' ? 'INSERT · 记录进入' : `创建于 ${timeLabel(row.value.created_at)}`}</small></div>
            <div role="cell"><RecordStatus status={row.value.status} task/></div>
            <div role="cell" className="record-progress"><strong key={row.value.completed_steps} className="value-flash">{row.value.completed_steps}<span> / {row.value.step_count}</span></strong><div className="record-meter"><i style={{ width: `${row.value.step_count ? row.value.completed_steps / row.value.step_count * 100 : 0}%` }}/></div><small>{isFinished(row.value) ? '即将移出视图' : '已完成 / 总步骤'}</small></div>
          </RecordRow>)}</div>
        </div>{!tasks.length && <EmptyTable loading={!activity}/>}</div>
        <footer className="record-table-footer"><code>tasks.id</code><span>主键关联右侧步骤的 task_id →</span></footer>
      </section>
      <section className="record-table step-records" aria-labelledby="step-table-title"><header className="record-table-title"><div><span className="table-index">02</span><h4 id="step-table-title">步骤表 <code>steps</code></h4></div><span className="record-count"><b>{stepCount}</b> 条活动记录</span></header>
        <p className="table-description">每个步骤独立保存状态；完成一条，平滑收起一条。</p>
        <div className="record-scroll" tabIndex={0} role="region" aria-label="步骤表滚动区域"><div role="table" aria-label="步骤表" className="records-grid">
          <div role="row" className="record-columns"><span role="columnheader">步骤 / 主键 ID</span><span role="columnheader">所属任务</span><span role="columnheader">状态</span><span role="columnheader">持久化进度</span></div>
          <div role="rowgroup">{steps.map(row => <RecordRow key={row.value.id} row={row} selected={row.value.task_id === selected}>
            <div role="cell" className="record-identity"><strong><span className="step-order">{String(row.value.order + 1).padStart(2, '0')}</span>{row.value.display_name}</strong><code title={row.value.id}>{row.value.id.slice(0, 8)}<span className="record-key">PK</span></code><small>{row.phase === 'entering' ? 'INSERT · 记录进入' : `${row.value.requires_gpu ? 'GPU' : 'CPU'}${row.value.retry_count ? ` · 重试 ${row.value.retry_count}` : ''}`}</small></div>
            <div role="cell" className="record-parent"><button title={row.value.task_name} onClick={() => choose(row.value.task_id)}><code>{row.value.task_id.slice(0, 8)}</code><span className="record-key">FK</span></button><small title={row.value.task_name}>{row.value.task_name}</small></div>
            <div role="cell"><RecordStatus status={row.value.status}/></div>
            <div role="cell" className="record-progress"><strong key={row.value.progress} className="value-flash">{Math.round(row.value.progress * 100)}<span>%</span></strong><div className="record-meter"><i style={{ width: `${row.value.progress * 100}%` }}/></div><small>{isFinished(row.value) ? '即将移出视图' : `检查点 ${row.value.checkpoint_unit} / 20`}</small></div>
          </RecordRow>)}</div>
        </div>{!steps.length && <EmptyTable loading={!activity} steps/>}</div>
        <footer className="record-table-footer"><code>steps.task_id → tasks.id</code><span>检查点随执行提交</span></footer>
      </section>
    </div>
    <p className="activity-footnote"><span>✓ 状态已持久化</span>完成或取消后仅移出此视图，数据库记录和执行历史仍保留；暂停、失败的记录保留，等待恢复。</p>
  </>
}
