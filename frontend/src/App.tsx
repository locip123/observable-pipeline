import { useEffect, useState } from 'react'
import { api } from './api'
import type { Activity, Snapshot, System, Task, TaskSummary, StatusEvent } from './types'
import { labels, timeLabel } from './types'
import { PipelineView } from './components/PipelineView'
import { ResourcePanel } from './components/ResourcePanel'
import { WorkerFlowPanel } from './components/WorkerFlowPanel'
import { DataPanel } from './components/DataPanel'
import { EventLog } from './components/EventLog'
import { FoxScene } from './components/FlowLab'

export default function App() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [system, setSystem] = useState<System | null>(null)
  const [activity, setActivity] = useState<Activity | null>(null)
  const [older, setOlder] = useState<StatusEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [name, setName] = useState('星轨小狐狸')
  const [style, setStyle] = useState('violet')
  const [scale, setScale] = useState(1)
  const [useCache, setUseCache] = useState(false)
  const [revision, setRevision] = useState(0)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const [list, data, records] = await Promise.all([
          api.listTasks(controller.signal),
          selected ? api.snapshot(selected, controller.signal) : api.system(controller.signal),
          api.activity(controller.signal),
        ])
        if (disposed) return
        setTasks(list)
        setActivity(records)
        if ('task' in data) { setSnapshot(data); setSystem(data.system) } else setSystem(data)
        setConnectionError('')
        if (!selected && list.length) setSelected(list[0].id)
      } catch (err) {
        if (!disposed) setConnectionError(`无法同步 API：${err instanceof Error ? err.message : String(err)}。当前显示上次快照。`)
      } finally {
        if (!disposed) timer = setTimeout(poll, 700)
      }
    }
    poll()
    return () => { disposed = true; controller.abort(); clearTimeout(timer) }
  }, [selected, revision])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await fn(); setRevision(r => r + 1) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  function choose(id: string) { setSelected(id); setSnapshot(null); setOlder([]) }
  function showCreated(task: Task) {
    // Seed the committed creation response so even a fast cache hit has an entrance.
    setActivity(previous => ({
      server_time: previous?.server_time ?? task.created_at,
      tasks: [{ ...task, step_count: task.steps.length, completed_steps: task.steps.filter(s => s.status === 'completed').length }, ...(previous?.tasks.filter(t => t.id !== task.id) ?? [])],
      steps: [...task.steps.map(s => ({ ...s, task_id: task.id, task_name: task.name, checkpoint_unit: s.checkpoint?.unit ?? 0 })), ...(previous?.steps.filter(s => s.task_id !== task.id) ?? [])],
    }))
    choose(task.id)
  }
  async function create() {
    await act(async () => {
      const task = await api.createTask({ name: name.trim(), style, duration_scale: scale, use_cache: useCache })
      showCreated(task)
    })
  }
  async function contention() {
    await act(async () => {
      const source = `gpu-demo-${Date.now()}`
      const first = await api.createTask({ name: 'GPU 排队演示 · A', source: source + '-a', use_cache: false })
      showCreated(first)
      const second = await api.createTask({ name: 'GPU 排队演示 · B', source: source + '-b', use_cache: false, style: 'mint' })
      showCreated(second)
      choose(first.id)
    })
  }
  async function reuse() {
    if (!snapshot) return
    await act(async () => {
      const task = await api.createTask({ ...snapshot.task.meta, name: snapshot.task.name + ' · 复用', use_cache: true })
      showCreated(task)
    })
  }
  const current = snapshot?.task.id === selected ? snapshot : null
  const events = current ? [...new Map([...current.events, ...older].map(e => [e.id, e])).values()].sort((a, b) => b.sequence - a.sequence) : []
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-mark">◈</span><span>FRAME<span className="brand-light">WORK</span><small>可观测 AI 任务实验室</small></span></a>
      <div className="workspace-label"><span className="live-dot"/>LOCAL WORKSPACE <span>01</span></div>
      <form className="create-form" onSubmit={e => { e.preventDefault(); create() }}><label>新建动画任务<input value={name} onChange={e => setName(e.target.value)} placeholder="任务名称" maxLength={100}/></label>
        <div className="form-pair"><label>视觉风格<select value={style} onChange={e => setStyle(e.target.value)}><option value="violet">星光紫</option><option value="mint">薄荷绿</option></select></label><label>计算时长<select value={scale} onChange={e => setScale(Number(e.target.value))}><option value={1}>标准 · 约 45s</option><option value={3}>慢速 · 约 2m</option><option value={90}>长任务 · 约 1h</option></select></label></div>
        <label className="checkbox-label"><input type="checkbox" checked={useCache} onChange={e => setUseCache(e.target.checked)}/>复用已验证的步骤结果</label>
        <button className="primary create-button" disabled={busy || !name.trim()} type="submit">＋ 创建并运行</button>
      </form>
      <div className="nav-heading">执行记录 <span>{tasks.length}</span></div>
      <nav className="task-navigation" aria-label="任务列表">{tasks.map(t => <button key={t.id} className={`task-item ${selected === t.id ? 'active' : ''}`} onClick={() => choose(t.id)} aria-current={selected === t.id ? 'page' : undefined}><span className={`task-dot status-${t.status}`}/><span><strong>{t.name}</strong><small>{t.id.slice(0, 8)} · {timeLabel(t.created_at)}</small></span><span className={`list-status status-${t.status}`}>{labels[t.status]}</span></button>)}{!tasks.length && <p className="empty-hint">创建第一个任务，开始观察执行过程。</p>}</nav>
      <div className="demo-box"><span className="eyebrow">TRY A SCENARIO</span><h4>让恢复过程可见</h4><p>双任务争用同一 GPU，观察排队、分配与释放。</p><button disabled={busy} onClick={contention}>⇄ 启动 GPU 排队演示</button></div>
      <footer className="sidebar-footer"><span>● PostgreSQL 16</span><span>MOCK AI · MVP 1.0</span></footer>
    </aside>
    <main className="main-content"><div className="topbar"><span>工作空间 <span className="breadcrumb-sep">/</span> 动画素材处理</span><div><span className={`live-dot ${connectionError ? 'offline' : ''}`}/>{connectionError ? '同步中断' : '实时同步'}<span className="topbar-divider"/><span>{system?.workers.filter(w => w.fresh).length ?? 0} Worker 在线</span><a href="http://localhost:8000/docs" target="_blank" rel="noreferrer">API ↗</a></div></div>
      {(error || connectionError) && <div className="error-banner" role="alert"><span>{error || connectionError}</span>{error && <button onClick={() => setError('')}>关闭</button>}</div>}
      {!selected && <div className="welcome panel"><span className="eyebrow">LONG-RUNNING TASKS, MADE VISIBLE</span><h1>每一步，都有迹可循。</h1><p>从一只 SVG 小狐狸开始，探索长任务的执行、恢复与结果复用。</p><FoxScene active stage={5}/><button className="primary" disabled={busy || !name.trim()} onClick={create}>创建第一个任务 →</button></div>}
      {selected && !current && <div className="loading-state">正在读取 PostgreSQL 快照…</div>}
      {current && <><div className="workspace-tabs"><div role="tablist" aria-label="工作区视图">{[['overview', '流程总览'], ['state', '数据与内存'], ['history', '执行历史']].map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div><button className="quiet" disabled={busy || !current.task.steps.some(s => s.status === 'completed')} onClick={reuse}>↗ 相同输入再运行 · 验证复用</button></div>
        {tab === 'overview' && <><PipelineView key={current.task.id} task={current.task} system={current.system} act={act} busy={busy}/><ResourcePanel system={current.system} steps={current.task.steps}/><WorkerFlowPanel key={current.task.id} snapshot={current} connected={!connectionError}/></>}
      </>}
      {system && <div hidden={tab === 'history'}><DataPanel activity={activity} system={system} selected={selected} choose={choose} act={act} busy={busy}/></div>}
      {current && <>{(tab === 'overview' || tab === 'history') && <EventLog events={events} total={current.counts.status_events} busy={busy} loadMore={() => act(async () => {
          const before = events.at(-1)?.sequence
          const page = await api.getEvents(current.task.id, before)
          setOlder(previous => [...previous, ...page])
        })}/>}
        <div className="page-footnote"><span>数据库快照 {timeLabel(current.system.server_time)} · 当前任务 {current.task.id.slice(0, 8)}</span><span>至少一次执行 / 检查点恢复 / SHA-256 产物校验</span></div>
      </>}
    </main>
  </div>
}
