import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { Snapshot } from '../types'
import { labels, timeLabel } from '../types'
import { adjacentRecentNode, deriveWorkerFlow, flowNodes, flowPath, followingStep } from './workerFlowState'
import type { FlowNodeId } from './workerFlowState'
import './workerFlow.css'

type Edge = { from: FlowNodeId; to: FlowNodeId; path: string; label?: string; x?: number; y?: number; branch?: 'reuse' | 'cpu' | 'recovery' }
const edges: Edge[] = [
  { from: 'poll', to: 'claim', path: 'M256 126H326' },
  { from: 'claim', to: 'cache', path: 'M550 126H620' },
  { from: 'cache', to: 'restore', path: 'M844 126H914', label: '未命中', x: 879, y: 111 },
  { from: 'cache', to: 'commit', path: 'M682 182V218H20V570H32', label: '命中 → 直接复用，跳过计算与 GPU', x: 398, y: 218, branch: 'reuse' },
  { from: 'restore', to: 'gpu', path: 'M1080 182V296', label: '需要 GPU', x: 1080, y: 242 },
  { from: 'restore', to: 'compute', path: 'M970 182V254H732V296', label: 'CPU 直接计算', x: 849, y: 254, branch: 'cpu' },
  { from: 'gpu', to: 'compute', path: 'M914 352H844', label: '就绪', x: 879, y: 337 },
  { from: 'compute', to: 'checkpoint', path: 'M620 352H550', label: '每 4 单元', x: 585, y: 337 },
  { from: 'checkpoint', to: 'compute', path: 'M438 408V450H732V408', label: '还没算完 → 继续下一批', x: 585, y: 450 },
  { from: 'checkpoint', to: 'publish', path: 'M326 352H256', label: '20 / 20', x: 291, y: 337 },
  { from: 'publish', to: 'commit', path: 'M144 408V514', label: '文件就绪', x: 144, y: 464 },
  { from: 'commit', to: 'advance', path: 'M256 570H326' },
  { from: 'advance', to: 'done', path: 'M550 570H620', label: '全完成', x: 585, y: 555 },
  { from: 'advance', to: 'poll', path: 'M438 626V680H8V126H32', label: '还有下一步 → 回到轮询，由空闲 Worker 领取', x: 295, y: 680 },
  { from: 'compute', to: 'lost', path: 'M844 382H874V730H1026V790', label: '执行环节出错 / 中断', x: 1012, y: 730, branch: 'recovery' },
  { from: 'lost', to: 'recover', path: 'M914 846H844', label: '出错 / 到期', x: 879, y: 831, branch: 'recovery' },
  { from: 'recover', to: 'retry', path: 'M620 846H550', label: '可重试', x: 585, y: 831, branch: 'recovery' },
  { from: 'recover', to: 'manual', path: 'M732 902V924H144V902', label: '预算耗尽 → 等待手动恢复', x: 585, y: 924, branch: 'recovery' },
  { from: 'retry', to: 'poll', path: 'M438 902V944H8V126H32', label: '退避到期 → 回到轮询（01）', x: 226, y: 944, branch: 'recovery' },
  { from: 'manual', to: 'poll', path: 'M144 902V960H8V126H32', label: '手动恢复 → 回到轮询（01）', x: 112, y: 960, branch: 'recovery' },
]

export function WorkerFlowPanel({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const [selection, setSelection] = useState('auto')
  const [inspecting, setInspecting] = useState<FlowNodeId | null>(null)
  const diagram = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const cameraTarget = useRef<FlowNodeId>('poll')
  const [camera, setCamera] = useState({ x: 0, y: 0 })
  const markerId = useId().replace(/:/g, '')
  const headingId = useId()
  const step = selection === 'auto' ? followingStep(snapshot.task.steps) : snapshot.task.steps.find(s => s.id === selection)
  const state = deriveWorkerFlow(snapshot, step, connected)
  const [displayCurrent, setDisplayCurrent] = useState<FlowNodeId | null>(() => state.current)
  const displayRef = useRef<FlowNodeId | null>(state.current)
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transitionQueue = useRef<FlowNodeId[]>([])
  const visualCurrent = connected ? displayCurrent : null
  const transitionPath = visualCurrent && state.current
    ? flowPath(visualCurrent, state.current, { requiresGpu: step?.requires_gpu, reused: !!step?.cached_result?.reused_from })
    : []
  const pendingPathNodes = new Set(transitionPath.slice(1))
  const transitionNext = transitionPath[1] ?? null
  const recentNode = adjacentRecentNode(visualCurrent, state.recent, { requiresGpu: step?.requires_gpu, reused: !!step?.cached_result?.reused_from })
  const queueNextPhase = useCallback(() => {
    transitionTimer.current = null
    const next = transitionQueue.current.shift()
    if (!next) return
    displayRef.current = next
    setDisplayCurrent(next)
    if (transitionQueue.current.length) transitionTimer.current = setTimeout(queueNextPhase, 360)
  }, [])
  useEffect(() => {
    if (!connected) {
      transitionQueue.current = []
      if (transitionTimer.current) clearTimeout(transitionTimer.current)
      transitionTimer.current = null
      return
    }
    if (!state.current) return
    if (state.current === displayRef.current && !transitionQueue.current.length) return
    const path = flowPath(displayRef.current, state.current, { requiresGpu: step?.requires_gpu, reused: !!step?.cached_result?.reused_from })
    if (!path.length) return
    transitionQueue.current = path.slice(1)
    if (!transitionTimer.current) transitionTimer.current = setTimeout(queueNextPhase, 80)
  }, [connected, queueNextPhase, state.current, step?.cached_result?.reused_from, step?.id, step?.requires_gpu])
  useEffect(() => () => { if (transitionTimer.current) clearTimeout(transitionTimer.current) }, [])
  const centerNode = useCallback((id?: FlowNodeId | null) => {
    if (id) cameraTarget.current = id
    const viewport = diagram.current
    const chart = canvas.current
    const node = chart?.querySelector<HTMLElement>(`[data-flow-node="${cameraTarget.current}"]`)
    if (!viewport || !chart || !node) return
    // Correct the current transform from the rendered rectangles. This remains
    // accurate while the previous camera move is still transitioning.
    const viewportRect = viewport.getBoundingClientRect()
    const nodeRect = node.getBoundingClientRect()
    const matrix = getComputedStyle(chart).transform.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number)
    const currentX = matrix?.[4] ?? 0
    const currentY = matrix?.[5] ?? 0
    const x = currentX + viewportRect.left + viewport.clientWidth / 2 - (nodeRect.left + nodeRect.width / 2)
    const y = currentY + viewportRect.top + viewport.clientHeight / 2 - (nodeRect.top + nodeRect.height / 2)
    setCamera(previous => previous.x === x && previous.y === y ? previous : { x, y })
  }, [])
  useLayoutEffect(() => {
    centerNode(visualCurrent)
  }, [centerNode, step?.id, visualCurrent])
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => centerNode())
    if (diagram.current) observer.observe(diagram.current)
    if (canvas.current) observer.observe(canvas.current)
    return () => observer.disconnect()
  }, [centerNode])
  const focusNode = flowNodes.find(n => n.id === (inspecting ?? state.current))
  const reused = !!step?.cached_result?.reused_from
  const historical = step?.status === 'completed'
  const warning = ['lost', 'recover', 'retry', 'manual'].includes(state.current ?? '')
  const skipped = (id: FlowNodeId) => !state.visited.has(id) && ((id === 'gpu' && !step?.requires_gpu) || (reused && ['restore', 'gpu', 'compute', 'checkpoint', 'publish'].includes(id)))
  const edgeActive = (edge: Edge) => {
    if (!connected || !state.visited.has(edge.from) || skipped(edge.to)) return false
    // A completed path stays readable, but does not pretend the Worker is still executing it.
    if (historical) return edge.from === recentNode && edge.to === visualCurrent
    if (edge.branch === 'reuse' && !reused && state.runtime?.phase !== 'cache_hit') return false
    if (edge.branch === 'cpu' && step?.requires_gpu) return false
    if (edge.from === 'cache' && edge.to === 'restore' && reused) return false
    if (edge.from === 'publish' && edge.to === 'commit' && reused) return false
    if (edge.to === 'claim' && edge.branch === 'recovery') return (state.attempt?.attempt_number ?? 0) > 1 && state.recent.has('claim')
    if (edge.from === 'advance' && edge.to === 'poll') return state.current === 'advance' && snapshot.task.status === 'running'
    if (transitionPath.length > 1) {
      return edge.from === visualCurrent && edge.to === transitionNext
    }
    return edge.from === recentNode && edge.to === visualCurrent
  }
  function locate() {
    centerNode(visualCurrent)
  }

  return <section className={`panel worker-flow-panel ${!connected ? 'flow-disconnected' : ''}`} aria-labelledby={headingId}>
    <div className="section-heading"><div><span className="eyebrow">WORKER / LIVE FLOW</span><h3 id={headingId}>流程动态展示 <span className="tag">跟随当前任务</span></h3><p className="worker-flow-intro">一个步骤怎样被领取、计算、保存，又怎样在中断后继续。</p></div>
      <label className="worker-flow-select">观察步骤<select value={selection} onChange={e => { setSelection(e.target.value); setInspecting(null) }}><option value="auto">自动跟随当前步骤</option>{snapshot.task.steps.map(s => <option key={s.id} value={s.id}>{String(s.order + 1).padStart(2, '0')} · {s.display_name} · {labels[s.status]}</option>)}</select></label>
    </div>
    <div className={`worker-flow-now ${warning || !connected ? 'is-waiting' : ''}`}>
      <span className="flow-now-icon" aria-hidden="true">{historical ? '✓' : warning || !connected ? 'Ⅱ' : '↳'}</span>
      <div className="flow-now-copy"><span>{step?.display_name ?? '等待步骤'}{state.attempt && ` · 尝试 #${state.attempt.attempt_number}`}<span className="flow-source">{!connected ? '上次快照' : historical ? '已提交结果' : state.runtime ? '实时上报' : '数据库状态'}</span></span><strong aria-live="polite">{state.title}</strong><p>{state.description}</p></div>
      <button className="quiet" disabled={!visualCurrent} onClick={locate}>居中当前节点 ↗</button>
    </div>
    <div className="worker-flow-legend"><div><span><i className="legend-current"/>当前环节</span><span><i className="legend-recent"/>刚发生</span><span><i className="legend-visited"/>历史已走过</span><span><i className="legend-recovery"/>等待 / 恢复</span></div><span>画布自动跟随当前节点 · 点击节点查看说明</span></div>
    <div className="worker-flow-scroll" ref={diagram} tabIndex={0} role="region" aria-label="Worker 运行流程图，自动移动画布使当前节点居中；节点按钮可查看详细说明">
      <div className="worker-flow-canvas" ref={canvas} style={{ transform: `translate(${camera.x}px, ${camera.y}px)` }}>
        <div className="flow-lane-label" style={{ top: 32 }}>01 — 04 <span>找工作，先确认能否复用</span></div>
        <div className="flow-lane-label" style={{ top: 756 }}>异常恢复支路 <span>保留已保存的成果，只重做未提交的部分</span></div>
        <svg className="worker-flow-wires" viewBox="0 0 1170 980" preserveAspectRatio="none" aria-hidden="true">
          <defs>{['idle', 'active', 'recovery'].map(kind => <marker key={kind} id={`${markerId}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" className={`flow-arrow-${kind}`} fill="none" strokeWidth="1.6"/></marker>)}</defs>
          {edges.map((edge, index) => {
            const active = edgeActive(edge)
            const kind = active ? 'active' : edge.branch === 'recovery' ? 'recovery' : 'idle'
            return <g key={index} className={`flow-edge ${active ? 'is-active' : ''} ${edge.branch ? `edge-${edge.branch}` : ''}`}><path d={edge.path} markerEnd={`url(#${markerId}-${kind})`}/>{edge.label && <text x={edge.x} y={edge.y} dy=".35em" textAnchor="middle">{edge.label}</text>}</g>
          })}
        </svg>
        {flowNodes.map(node => {
          const active = visualCurrent === node.id
          // A poll can report several completed events together. Hide those
          // future flashes while the active marker replays the legal route.
          const recent = recentNode === node.id && !active && !pendingPathNodes.has(node.id)
          const visited = state.visited.has(node.id)
          const skip = skipped(node.id)
          const badge = active ? historical ? '已完成' : warning ? '当前停留' : '当前环节' : recent ? '刚发生' : skip ? '跳过' : visited ? '已走过' : ''
          return <button key={node.id} data-flow-node={node.id} className={`worker-flow-node ${node.kind ? `flow-kind-${node.kind}` : ''} ${active ? 'flow-node-current' : ''} ${recent ? 'flow-node-recent' : ''} ${visited ? 'flow-node-visited' : ''} ${skip ? 'flow-node-skipped' : ''} ${inspecting === node.id ? 'flow-node-inspected' : ''} ${active && state.runtime && !warning ? 'flow-node-live' : ''}`} style={{ left: `${node.x / 1170 * 100}%`, top: node.y }} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) centerNode(node.id) }} onClick={() => setInspecting(inspecting === node.id ? null : node.id)} aria-pressed={inspecting === node.id} aria-label={`${node.number} ${node.title}${badge ? `，${badge}` : ''}。${node.lines.join('；')}`}>
            <span className="flow-node-top"><span className="flow-node-number">{node.kind === 'decision' ? '◇ ' : ''}{node.number}</span>{badge && <span className="flow-node-badge">{active && !historical && <i/>}{badge}</span>}</span><strong>{node.title}</strong><span className="flow-node-description">{node.lines.map(line => <span key={line}>{line}</span>)}</span>
          </button>
        })}
        <div className="flow-durable-note"><span>贯穿整个执行过程</span><strong>心跳续租，让执行资格持续有效</strong><p>PostgreSQL 保存状态与历史<br/>产物卷保存检查点与输出<br/>进程内存只保存当前计算缓冲</p></div>
      </div>
    </div>
    <div className="worker-flow-detail"><div><span className="flow-detail-icon">{focusNode?.number ?? 'i'}</span><div><strong>{focusNode?.title ?? '如何阅读这张流程图'}</strong><p>{focusNode?.detail ?? '按箭头阅读主流程；缓存命中走捷径，计算期间循环保存检查点，异常时进入下方恢复支路。绿色是当前快照中的环节，紫色短暂保留刚发生的事件，灰绿色表示本步骤的历史路径。'}</p></div></div>{inspecting && <button className="quiet" onClick={() => setInspecting(null)}>返回自动说明</button>}</div>
    <div className="worker-flow-footnote"><span>{state.attempt?.worker_id ?? '尚未分配 Worker'} · {state.worker?.pid ? `PID ${state.worker.pid}` : 'PID —'}</span><span>快照 {timeLabel(snapshot.system.server_time)} · 约 0.7 秒刷新 · 短暂环节保留 2.6 秒高亮</span></div>
  </section>
}
