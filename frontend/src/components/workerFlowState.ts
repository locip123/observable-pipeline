import type { Runtime, Snapshot, Step } from '../types'

export type FlowNodeId = 'poll' | 'claim' | 'cache' | 'restore' | 'gpu' | 'compute' | 'checkpoint' | 'publish' | 'commit' | 'advance' | 'done' | 'lost' | 'recover' | 'retry' | 'manual'

export const flowNodes: { id: FlowNodeId; number: string; title: string; lines: string[]; detail: string; x: number; y: number; kind?: string }[] = [
  { id: 'poll', number: '01', title: '轮询工作 · 检查租约', lines: ['不断查找就绪步骤', '每轮检查有没有过期的执行'], detail: 'Worker 是独立进程，会持续扫描 PostgreSQL。先回收过期租约，再在有空闲执行名额时领取工作；没有工作就等待下一轮。一个进程可以同时处理多个任务。', x: 32, y: 70 },
  { id: 'claim', number: '02', title: '领取一个就绪步骤', lines: ['前序完成，才可以领取', '创建尝试、专属令牌与租约'], detail: '在短事务中锁定任务，确认前序产物就绪，创建新的 attempt、owner token 和租约。同一任务的步骤依次执行；多个 Worker 不会同时拥有同一次尝试。', x: 326, y: 70 },
  { id: 'cache', number: '03', title: '有现成结果可用吗？', lines: ['检查输入、版本与文件摘要', '命中就跳过本次计算'], detail: '只有文件存在且 SHA-256 校验通过的产物才会复用。缓存命中直接跳到 09 提交结果，不申请 GPU。上次已落盘、但未提交数据库的完整输出也可以被接管。', x: 620, y: 70, kind: 'decision' },
  { id: 'restore', number: '04', title: '确定从哪里继续', lines: ['检查点有效 → 从断点续跑', '无检查点 / 已损坏 → 从头算'], detail: '检查点保存已完成的工作单元。Worker 校验文件摘要和缓存指纹后确定起点；校验失败会记录 checkpoint_invalid，并仅从头计算当前步骤。', x: 914, y: 70 },
  { id: 'gpu', number: '05', title: '排队拿 GPU · 加载模型', lines: ['GPU 步骤：按请求顺序等待', '拿到独占名额后加载模型'], detail: 'CPU 步骤直接进入计算。GPU 步骤在缓存未命中后才申请名额，排队和模型加载期间也持续续租。当前 MOCK 使用一个独占 GPU 名额，加载约 1.2 秒。', x: 914, y: 296, kind: 'gpu' },
  { id: 'compute', number: '06', title: '分批计算 · 持续续租', lines: ['逐个处理 20 个工作单元', '内存进度随计算向前推进'], detail: '执行循环持续检查暂停、取消和执行资格，并约每 0.4 秒续租。内存进度可以领先数据库；崩溃时未持久化的这一小段工作需要重算。', x: 620, y: 296 },
  { id: 'checkpoint', number: '07', title: '保存一份可恢复进度', lines: ['每完成 4 个单元保存一次', '先写文件，再提交检查点引用'], detail: '检查点先写入产物卷并计算摘要，再将引用与进度提交 PostgreSQL。4、8、12、16、20 是持久化边界；不足 20 单元就回到 06 继续计算。', x: 326, y: 296 },
  { id: 'publish', number: '08', title: '把最终产物安全落盘', lines: ['临时文件 → 同步 → 原子替换', '完整文件写好，才提交成功'], detail: '先写唯一临时文件并 fsync，再原子替换为确定性输出路径。若落盘后进程退出，下次尝试可校验并接管完整输出，避免重复计算。', x: 32, y: 296 },
  { id: 'commit', number: '09', title: '确认资格 · 提交成功', lines: ['验证令牌和租约仍然有效', '保存产物引用、释放 GPU'], detail: '在同一个短事务中校验任务、步骤、attempt、令牌和租约，记录产物与成功历史并释放 GPU。失去资格的旧 Worker 不能覆盖新尝试，也不能把暂停或取消的任务写成成功。', x: 32, y: 514 },
  { id: 'advance', number: '10', title: '还有下一步吗？', lines: ['还有 → 让下一步骤就绪', '全部完成 → 结束当前任务'], detail: '成功事务会推进任务：仍有未完成步骤时，将下一步骤放入就绪队列，由某个有空闲名额的 Worker 再领取；所有步骤成功后才将任务标记 completed。', x: 326, y: 514, kind: 'decision' },
  { id: 'done', number: '11', title: '任务完成', lines: ['所有步骤与产物已持久化', '执行历史随时可以查询'], detail: '任务已经完成，产物与执行历史保留。再次提交相同输入时，可以复用校验通过的结果；当前 Worker 仍会继续轮询其他任务。', x: 620, y: 514, kind: 'terminal' },
  { id: 'lost', number: 'R1', title: '进程中断 / 计算出错', lines: ['崩溃：内存丢失，旧租约暂留', '持久化检查点与产物仍保留'], detail: '进程退出不等于步骤立即失败：数据库暂留运行状态和 GPU 占用，等待租约到期。普通计算错误能立即记录失败；心跳过期则只能判定上报不可用，不能假定进程已经退出。', x: 914, y: 790, kind: 'recovery' },
  { id: 'recover', number: 'R2', title: '记录失败 · 回收旧尝试', lines: ['租约到期 → 标记旧尝试中断', '释放 GPU，保留检查点与历史'], detail: '活跃 Worker 每轮扫描过期租约，重新加锁确认后把旧 attempt 标记 interrupted 并释放 GPU。普通计算错误直接记录 failed。全部 Worker 都停止时，需要先启动 Worker 才能扫描回收。', x: 620, y: 790, kind: 'recovery' },
  { id: 'retry', number: 'R3', title: '等待退避 · 重新排队', lines: ['按重试策略等待后再领取', '创建新尝试，重新校验检查点'], detail: '默认自动重试等待 2 / 4 / 8 秒，失败和租约过期共享重试预算。到期后由 Worker 重新领取，产生新的 attempt 和令牌；有效检查点继续使用，成功的前序步骤无需重算。', x: 326, y: 790, kind: 'recovery' },
  { id: 'manual', number: 'R4', title: '等待手动恢复', lines: ['重试耗尽，或用户主动暂停', '修复后点击「从检查点恢复」'], detail: '失败耗尽预算或主动暂停后，需要手动恢复。恢复会校验已成功产物，保留有效前序、重置本轮重试预算并排队。取消是终态，需要创建新任务。', x: 32, y: 790, kind: 'recovery' },
]

const phaseNodes: Record<string, FlowNodeId> = {
  cache_check: 'cache', cache_hit: 'cache', checkpoint_check: 'restore',
  waiting: 'gpu', allocating: 'gpu', allocated: 'gpu', computing: 'compute',
  checkpoint_save: 'checkpoint', publishing: 'publish', committing: 'commit',
}
const eventNodes: Record<string, FlowNodeId[]> = {
  step_started: ['claim'], checkpoint_invalid: ['restore'], checkpoint_saved: ['checkpoint'],
  resource_requested: ['gpu'], resource_allocating: ['gpu'], resource_allocated: ['gpu'],
  step_completed: ['publish', 'commit', 'advance'], step_cache_hit: ['cache', 'commit', 'advance'],
  step_lease_expired: ['lost', 'recover', 'retry'], step_retry_wait: ['lost', 'recover', 'retry'],
  step_failed: ['lost', 'recover', 'manual'], step_paused: ['manual'],
}

type FlowPathOptions = { requiresGpu?: boolean; reused?: boolean }

const flowGraph: Record<FlowNodeId, FlowNodeId[]> = {
  poll: ['claim'],
  claim: ['cache'],
  cache: ['restore', 'commit'],
  restore: ['gpu', 'compute'],
  gpu: ['compute', 'lost'],
  compute: ['checkpoint', 'lost'],
  checkpoint: ['compute', 'publish'],
  publish: ['commit'],
  commit: ['advance'],
  advance: ['done', 'poll'],
  done: [],
  lost: ['recover'],
  recover: ['retry', 'manual'],
  retry: ['poll'],
  manual: ['poll'],
}

/** Return at most one immediately preceding event for the active node. */
export function adjacentRecentNode(current: FlowNodeId | null, recent: Set<FlowNodeId>, options: FlowPathOptions = {}) {
  if (!current) return null
  const graph = Object.fromEntries(Object.entries(flowGraph).map(([id, next]) => [id, [...next]])) as Record<FlowNodeId, FlowNodeId[]>
  if (options.reused) graph.cache = ['commit']
  else if (options.requiresGpu) graph.restore = ['gpu']
  else graph.restore = ['compute']
  for (const [source, targets] of Object.entries(graph) as [FlowNodeId, FlowNodeId[]][]) {
    if (targets.includes(current) && recent.has(source)) return source
  }
  return null
}

/**
 * Build the only legal visual route between two observed phases. Polling can
 * miss several short-lived phases, so the UI animates through this route
 * instead of moving the active highlight directly to a distant node.
 */
export function flowPath(from: FlowNodeId | null, to: FlowNodeId, options: FlowPathOptions = {}) {
  if (!from || from === to) return from === to ? [to] : [to]
  const graph = Object.fromEntries(Object.entries(flowGraph).map(([id, next]) => [id, [...next]])) as Record<FlowNodeId, FlowNodeId[]>
  if (options.reused) graph.cache = ['commit']
  else if (options.requiresGpu) graph.restore = ['gpu']
  else graph.restore = ['compute']

  const queue: FlowNodeId[][] = [[from]]
  const visited = new Set<FlowNodeId>([from])
  while (queue.length) {
    const path = queue.shift()!
    const last = path.at(-1)!
    for (const next of graph[last]) {
      if (next === to) return [...path, next]
      if (!visited.has(next)) {
        visited.add(next)
        queue.push([...path, next])
      }
    }
  }
  return []
}

export function followingStep(steps: Step[]) {
  const ordered = [...steps].sort((a, b) => a.order - b.order)
  return ordered.find(s => s.status !== 'completed') ?? ordered.at(-1)
}

/** Status/attempt identity wins over asynchronous telemetry, including after a restart. */
export function deriveWorkerFlow(snapshot: Snapshot, step: Step | undefined, connected = true) {
  const { task, system, events } = snapshot
  const timestamp = Date.parse(system.server_time)
  const visited = new Set<FlowNodeId>()
  const recent = new Set<FlowNodeId>()
  const attempt = step?.attempts.reduce<Step['attempts'][number] | undefined>((last, item) => !last || item.attempt_number > last.attempt_number ? item : last, undefined)
  const worker = system.workers.find(w => w.id === attempt?.worker_id)
  const reported = step && worker?.runtime[step.id]
  const leaseValid = !!attempt?.lease_expires_at && Date.parse(attempt.lease_expires_at) > timestamp
  const runtime: Runtime | undefined = connected && worker?.fresh && worker.desired_state === 'running' && leaseValid
    && attempt?.status === 'running' && (step?.status === 'running' || step?.status === 'waiting_resource')
    && reported?.attempt_id === attempt.id && reported.task_id === task.id && reported.step_id === step.id ? reported : undefined
  let current: FlowNodeId | null = null
  let title = '等待步骤状态'
  let description = '选择任务后，将跟随 Worker 的真实上报与持久化事件。'
  const mark = (...ids: FlowNodeId[]) => ids.forEach(id => visited.add(id))
  const flash = (at: string, ids: FlowNodeId[]) => {
    const age = timestamp - Date.parse(at)
    if (connected && age >= -1000 && age < 2600) ids.forEach(id => recent.add(id))
  }

  if (step) {
    if (attempt) mark('poll', 'claim', 'cache')
    for (const event of events.filter(e => e.step_id === step.id)) {
      const ids = eventNodes[event.event_type] ?? []
      mark(...ids)
      flash(event.created_at, ids)
    }
    for (const entry of runtime?.phase_history ?? []) {
      const id = phaseNodes[entry.phase]
      if (id) { mark(id); flash(entry.at, [id]) }
    }
    if (step.resource_allocations.length) mark('restore', 'gpu')
    if (step.checkpoint) mark('restore', 'compute', 'checkpoint')
    const reused = !!step.cached_result?.reused_from
    if (step.status === 'completed') {
      mark('poll', 'claim', 'cache', 'commit', 'advance')
      if (!reused) mark('restore', 'compute', 'checkpoint', 'publish')
      const lastStep = !task.steps.some(s => s.order > step.order)
      current = task.status === 'completed' && lastStep ? 'done' : 'advance'
      if (current === 'done') mark('done')
      title = current === 'done' ? '全部步骤完成，产物已保存' : `${step.display_name}已完成`
      description = reused ? '本步骤校验后直接复用产物，跳过计算与 GPU 申请。' : '本步骤已成功提交，产物引用和执行历史已持久化。'
    } else if (task.status === 'cancelled' || step.status === 'skipped') {
      title = '任务已取消'
      description = '执行资格已失效，停止领取和计算；已有检查点与历史仍可查询。'
    } else if (step.status === 'paused' || step.status === 'failed') {
      current = 'manual'
      title = step.status === 'paused' ? '任务已暂停，等待手动恢复' : '自动重试已耗尽，等待手动恢复'
      description = `已保存 ${step.checkpoint?.unit ?? 0}/20 个工作单元；恢复时先校验产物和检查点。`
    } else if (step.status === 'retry_wait') {
      current = 'retry'
      const remaining = Math.max(0, Math.ceil((Date.parse(step.next_retry_at ?? '') - timestamp) / 1000))
      title = remaining > 0 ? `等待 ${remaining} 秒后重新领取` : '退避已结束，等待 Worker 重新领取'
      description = `本轮重试 ${step.retry_count}/${step.max_retries} · 检查点 ${step.checkpoint?.unit ?? 0}/20 · ${system.workers.some(w => w.fresh && w.desired_state === 'running') ? '新尝试会重新校验检查点。' : '需要启动 Worker 才能继续。'}`
    } else if (step.status === 'running' || step.status === 'waiting_resource') {
      const missingReport = !!attempt && !!worker?.heartbeat_at && !!attempt.heartbeat_at
        && Date.parse(worker.heartbeat_at) - Date.parse(attempt.heartbeat_at) >= 3000
      if (!leaseValid || !worker?.fresh || worker.desired_state !== 'running' || (!runtime && missingReport)) {
        current = 'lost'
        title = !leaseValid ? '旧租约已到期，等待 Worker 回收' : worker?.status === 'offline' ? '执行进程已退出，等待租约到期' : '执行上报不可用，等待确认 / 恢复'
        description = '当前不显示计算动画。已提交检查点保留；活跃 Worker 在租约到期后回收旧尝试和 GPU。'
      } else if (runtime) {
        current = phaseNodes[runtime.phase] ?? null
        if (['gpu', 'compute', 'checkpoint', 'publish', 'commit'].includes(current ?? '')) mark('restore')
        title = flowNodes.find(n => n.id === current)?.title ?? '正在同步执行阶段'
        description = current === 'compute' ? `内存进度 ${Math.round(runtime.progress * 100)}% · 已持久化 ${step.checkpoint?.unit ?? 0}/20 · 心跳与续租持续进行。`
          : current === 'gpu' ? runtime.phase === 'waiting' ? '正在等待空闲 GPU，排队期间仍持续续租。' : 'GPU 名额已锁定，正在加载模型 / 准备计算。'
          : current === 'restore' ? `检查点候选 ${step.checkpoint?.unit ?? 0}/20；校验通过后才会从这里继续。`
          : '当前节点来自该次尝试的 Worker 内存上报；短暂环节通过事件和阶段记录补充显示。'
      } else {
        title = '步骤已领取，等待本次尝试的阶段上报'
        description = '数据库已创建执行尝试，内存快照尚未跟上；收到匹配 attempt 的上报后点亮执行节点。'
      }
    } else if (step.status === 'queued') {
      const available = system.workers.some(w => w.fresh && w.desired_state === 'running')
      current = available ? 'poll' : null
      title = available ? '步骤已就绪，等待空闲 Worker 领取' : '步骤已就绪，等待 Worker 上线'
      description = '前序依赖已满足；Worker 会在下一轮有空闲执行名额时尝试原子领取。'
    } else {
      title = '等待前序步骤完成'
      description = '此步骤还没有就绪；自动跟随可查看当前正在推进的步骤。'
    }
  }
  if (!connected) {
    current = null
    recent.clear()
    title = '同步中断 · 显示上次已知状态'
    description = '已暂停实时节点高亮，连接恢复并收到新快照后继续。'
  }
  return { current, title, description, visited, recent, attempt, worker, runtime }
}
