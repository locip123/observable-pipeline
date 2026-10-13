# 题 D：开源项目与技术栈调研

调研日期：2026-10-13。目标是动画素材处理的长任务 MVP：步骤失败或进程中断后恢复、步骤状态和历史、结果复用、小时级扩展，以及 GPU 调度与可观测。下文只引用项目仓库、官方文档和规范；“建议”是基于这些资料对本题的推论。

## 值得参考的开源项目

| 项目 | 与题 D 直接相关的能力 | 本题可借鉴之处与边界 | 许可证、维护情况 |
| --- | --- | --- | --- |
| [Prefect 3](https://github.com/PrefectHQ/prefect) | Flow/Task run 分别有状态与状态历史，包括 `Scheduled`、`Running`、`Failed`、`Crashed`、`Cached`；任务支持重试、缓存键和持久化结果；服务端可管理全局并发限制。[状态](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/states.mdx) · [缓存](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/caching.mdx) · [并发](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/how-to-guides/workflows/global-concurrency-limits.mdx) | 最适合参考“任务实例”和“步骤实例”的状态模型。**缓存必须开启结果持久化**；默认缓存键包含 flow run ID，跨运行复用需选 `INPUTS` 或自定义键，还需把模型/参数版本纳入键。后一条是本题设计推论。[缓存文档](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/caching.mdx) | [Apache-2.0](https://github.com/PrefectHQ/prefect/blob/main/LICENSE)；[GitHub 仓库元数据](https://api.github.com/repos/PrefectHQ/prefect)显示未归档、近期有推送。 |
| [Temporal](https://github.com/temporalio/temporal) + [Temporal UI](https://github.com/temporalio/ui) | Workflow 的事件历史持久记录执行；Activity 默认按策略重试；长 Activity 可用 heartbeat 记录进度并在重试时取回检查点。UI 能按状态等筛选，查看事件时间线、父子关系、Workers 和待处理 Activities。[事件历史](https://docs.temporal.io/workflow-execution/event) · [重试](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/retry-policies.mdx) · [故障检测/heartbeat](https://docs.temporal.io/encyclopedia/detecting-activity-failures) · [Web UI](https://docs.temporal.io/web-ui) | 参考“不可变事件历史 + 当前状态投影”和进程崩溃后的恢复。Activity 是至少一次执行，官方要求幂等：Worker 做完但尚未报告结果时崩溃，可能重复执行。本题的渲染/上传步骤也要用稳定幂等键与产物校验。[Python 错误处理](https://github.com/temporalio/documentation/blob/main/docs/develop/python/best-practices/error-handling.mdx) | [服务端 MIT](https://github.com/temporalio/temporal/blob/main/LICENSE)、[UI MIT](https://github.com/temporalio/ui/blob/main/LICENSE)；两仓库[服务端元数据](https://api.github.com/repos/temporalio/temporal)及[UI 元数据](https://api.github.com/repos/temporalio/ui)显示未归档、近期有推送。旧版 [`temporalio/web`](https://github.com/temporalio/web) 已废弃，不宜参考。 |
| [Hatchet](https://github.com/hatchet-dev/hatchet) | Python SDK、持久任务与 DAG、步骤重试、Worker 标签/名额、实时运行 UI、日志、OpenTelemetry 和 Prometheus 指标；项目用 PostgreSQL 持久化任务运行及可观测数据。[仓库说明](https://github.com/hatchet-dev/hatchet) · [DAG 文档](https://docs.hatchet.run/v1/directed-acyclic-graphs) | 与题 D 最接近的现成产品参考，尤其适合看“GPU Worker 只接 GPU 步骤”和运行详情页的设计。完整平台直接接入会减少本题自行展示租约、历史和恢复规则的空间，这是基于题目重点的推论。其本地 CLI 运行要求 Linux/macOS/WSL 和 Docker。[本地运行说明](https://github.com/hatchet-dev/hatchet) | [MIT](https://github.com/hatchet-dev/hatchet/blob/main/LICENSE)；[GitHub 元数据](https://api.github.com/repos/hatchet-dev/hatchet)显示未归档、2026-10-13 有推送。 |
| [Kestra](https://github.com/kestra-io/kestra) | 执行详情含带时间戳的状态流转、任务拓扑、Gantt 耗时、按任务和级别筛选的日志、输入输出、任务指标及依赖关系。[执行 UI](https://kestra.io/docs/ui/executions) | 是本题“上游看得到什么”的最佳界面样例：列表 → 单次执行 → 失败节点 → 日志/重试/产物。其自定义 Dashboards 文档明确标为 **Enterprise Edition**，不可把它当作免费开源版能力。[Dashboard 文档](https://kestra.io/docs/ui/dashboard) | [Apache-2.0](https://github.com/kestra-io/kestra/blob/develop/LICENSE)；[仓库元数据](https://api.github.com/repos/kestra-io/kestra)显示未归档、近期有推送。 |
| [Argo Workflows](https://github.com/argoproj/argo-workflows) | Kubernetes 上用 DAG/Steps 编排容器；有工作流 UI、日志查看、步骤/工作流重试、归档和 Prometheus 指标；步骤 memoization 按输入键复用结果。[仓库说明](https://github.com/argoproj/argo-workflows) · [Memoization](https://argo-workflows.readthedocs.io/en/latest/memoization/) | 参考步骤级缓存及其约束：官方建议纯计算步骤，缓存按 key 命中；外部副作用仍需幂等。**依赖 Kubernetes**，对题目允许 MOCK、且不要求分布式调度的 MVP 属于后续扩展候选。[快速开始](https://github.com/argoproj/argo-workflows/blob/main/docs/quick-start.md) | [Apache-2.0](https://github.com/argoproj/argo-workflows/blob/main/LICENSE)；[仓库元数据](https://api.github.com/repos/argoproj/argo-workflows)显示未归档、近期有推送。 |
| [Ray](https://github.com/ray-project/ray) | Task/Actor 可声明 `num_gpus` 等资源，由调度器做资源准入；Dashboard 有 Jobs/Tasks/Actors 状态、日志、节点/Worker、GPU 分配和指标视图。[资源调度](https://docs.ray.io/en/latest/ray-core/scheduling/resources.html) · [Dashboard](https://docs.ray.io/en/latest/ray-observability/getting-started.html) | 参考 GPU 等待、分配与占用的可视化。Ray 的逻辑资源主要用于调度准入，文档明确说并不等于实际 CPU/GPU 用量限制；应另采集物理 GPU 指标。对于单机 MOCK，先记录 `required_gpu`、`assigned_gpu`、`queue_wait_ms` 即可，之后再考虑引入 Ray。[资源文档](https://docs.ray.io/en/latest/ray-core/scheduling/resources.html) | [Apache-2.0](https://github.com/ray-project/ray/blob/master/LICENSE)；[仓库元数据](https://api.github.com/repos/ray-project/ray)显示未归档、近期有推送。 |
| [Celery](https://github.com/celery/celery) | Python 任务队列提供 `chain`/`group`/`chord`、重试与可选的 `STARTED` 状态；`acks_late` 改为执行后确认消息，故障时可能重投递与重复执行。[Canvas](https://docs.celeryq.dev/en/stable/userguide/canvas.html) · [Tasks](https://docs.celeryq.dev/en/latest/userguide/tasks.html) | 可做简单异步执行层，但题目要求的**完整任务/步骤历史、缓存产物索引和崩溃恢复判定**仍需自己建模。晚确认任务必须幂等；尤其注意子进程被信号终止时，即使开启 `acks_late`，Celery 默认仍会确认消息，若要重投递需另看 `task_reject_on_worker_lost`。[Tasks](https://docs.celeryq.dev/en/latest/userguide/tasks.html) | 源码 [BSD-3-Clause](https://github.com/celery/celery/blob/main/LICENSE)（文档另有 CC BY-SA 许可）；[仓库元数据](https://api.github.com/repos/celery/celery)显示未归档、近期有推送。 |
| [Apache Airflow](https://github.com/apache/airflow) | Grid View 以“任务 × 运行”热力图呈现历史状态，Graph View 展示依赖和某次运行状态，任务实例页可看日志、输入输出和运行元数据；指标可发送到 StatsD 或 OpenTelemetry。[UI 概览](https://airflow.apache.org/docs/apache-airflow/stable/ui.html) · [指标](https://airflow.apache.org/docs/apache-airflow/stable/metrics.html) | 参考历史运行的对比界面。题 D 的用户触发、长耗时素材处理可只借鉴其可视化，不必为 MVP 引入完整 Airflow 调度服务（推论）。 | [Apache-2.0](https://github.com/apache/airflow/blob/main/LICENSE)；[仓库元数据](https://api.github.com/repos/apache/airflow)显示未归档、近期有推送。 |

## 组合建议（针对本题的推论）

### 主推荐：做一个可解释的最小管线

| 层 | 技术 | 本题中的职责 |
| --- | --- | --- |
| API | Python + FastAPI + Pydantic | 提交任务、查询任务/步骤/尝试历史、手动重试；HTTP 请求只写入任务，不执行耗时步骤。FastAPI 官方文档也将重计算列为适合独立进程的场景。[Background Tasks 说明](https://fastapi.tiangolo.com/tutorial/background-tasks/) |
| 状态与小规模队列 | PostgreSQL + SQLAlchemy/Alembic | 持久化 `jobs`、`step_runs`、`step_attempts`、追加式 `events` 和 `artifacts`。Worker 用短事务领取待执行步骤；PostgreSQL 官方明确 `FOR UPDATE SKIP LOCKED` 适合减少队列式表的多消费者锁竞争。[SELECT 文档](https://www.postgresql.org/docs/current/sql-select.html) |
| 执行 | 单独的 Python Worker 进程 | 执行可配置耗时/失败的 MOCK 步骤；领取步骤时写入租约与 `owner_token`，运行中续租，租约过期后重新领取。GPU 步骤用独立资源类型和并发名额模拟等待。 |
| 产物 | 持久化本地目录，扩展时改为共享对象存储 | 保存抽帧、生成帧、合成文件等产物；数据库只记 URI、校验摘要和复用指纹。跨主机执行前须改为共享存储。 |
| 页面 | React + TypeScript + Vite | 任务列表、步骤拓扑/时间线、每次尝试、错误和产物；每 1–2 秒轮询状态即可演示。 |
| 运行 | Docker Compose | 启动 API、Worker、PostgreSQL 和页面；为数据库及产物目录挂持久卷。 |

这套组合刻意让业务状态和恢复规则可见。步骤的 `READY → RUNNING → SUCCEEDED`、`RUNNING → RETRY_WAIT → READY`、`RUNNING → FAILED` 应写入事件历史；任务状态由步骤聚合。领取后立即提交事务，不把数据库锁保持到整个耗时计算结束。Worker 完成时按 `step_run_id + owner_token + attempt_no` 条件提交结果，防止租约已过期的旧 Worker 覆盖新尝试。进程崩溃后，租约过期只重跑未成功的步骤；已成功步骤用持久化产物继续。若步骤有外部副作用，还须让副作用本身接受稳定幂等键，不能只靠数据库令牌防重复。这里的租约、令牌和状态机是本题的实现建议，而非 PostgreSQL 自动提供的工作流语义。

结果复用键建议计算为 `hash(步骤名 + 输入产物摘要 + 参数 + 代码/模型版本)`。命中时验证产物仍存在且摘要匹配，再把本次步骤标为成功并记录 `reused_from`；发布产物先写临时位置，再原子改名或完成对象写入，最后提交成功状态。这样“产物已写入但数据库尚未提交”可在重试时检测并复用；“数据库显示成功但产物缺失”应视为损坏，禁止错误命中。步骤重试和整个新任务的跨运行复用都由这一规则覆盖。[Prefect 缓存设计参考](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/caching.mdx)

动画素材例子可切成“输入校验 → 抽帧/预处理（CPU）→ 关键帧生成（GPU）→ 插帧（GPU）→ 合成导出（CPU）”。独立步骤应有昂贵计算、可验证的持久产物和清晰的输入输出；无需把每个轻量函数都变成可恢复步骤。验收演示至少覆盖：步骤临时失败后自动重试、杀掉 Worker 后恢复且前序成功步骤不重算、同样输入的第二个任务命中产物缓存、两个 GPU MOCK 步骤在单个 GPU 名额下排队。页面应同时展示当前状态与每次尝试的时间、错误、重试原因和产物；只有当前状态而无尝试历史，无法解释恢复过程。

### 备选与扩展

1. **时间紧且允许引入工作流框架**：Prefect 3 + 自托管 UI 能较快给出步骤状态、日志、重试、缓存和并发限制；仍需定义动画素材的步骤边界、缓存键、产物持久化和 GPU 占用策略。Prefect 默认把结果存在本机 `~/.prefect/storage/`，跨机器 Worker 可靠复用要配置共享持久存储。[Prefect 缓存](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/caching.mdx)
2. **小时级/GPU 扩展**：把长步骤拆成可提交检查点的独立步骤（例如抽帧、逐帧生成、合成），记录 heartbeat/进度和租约到期，重启时只重跑未产出可验证结果的步骤；GPU Worker 队列按资源类型隔离，显示排队时长、分配设备、运行时长和 GPU 指标。Temporal 的 heartbeat 与 Ray 的资源准入提供两种参考；NVIDIA [DCGM Exporter](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/)可供真实 GPU 环境导出 Prometheus 指标。[Temporal heartbeat](https://docs.temporal.io/encyclopedia/detecting-activity-failures) · [Ray 资源](https://docs.ray.io/en/latest/ray-core/scheduling/resources.html)
3. **可观测数据分层**：数据库中的状态/尝试/产物引用负责恢复和上游查询；结构化日志用于逐步排障；低基数指标统计队列等待、步骤耗时、失败率、重试率、GPU 利用率；trace/span 关联一次任务及其步骤。OpenTelemetry 规范支持用 TraceId/SpanId 关联日志与追踪；Prometheus 每种 label 值组合会生成新时间序列，因此 `job_id`/`step_run_id` 更适合日志和 trace 属性，不宜做指标 label。[OTel 日志模型](https://opentelemetry.io/docs/specs/otel/logs/data-model/) · [上下文传播](https://opentelemetry.io/docs/concepts/context-propagation/) · [Prometheus 数据模型](https://prometheus.io/docs/concepts/data_model/)

## 技术选择的判断

本题的方案应能演示可核验的失败路径：某步骤失败后只重试该步骤、Worker 在产物写入前后分别崩溃时如何判定、缓存命中为何安全、GPU 排队和占用如何被上游看到。Prefect 可缩短实现时间；Temporal 的恢复语义最强但部署和概念更多；Argo/Ray 则适合真实 Kubernetes/GPU 集群阶段。上述取舍是根据各项目的能力及题目“不要求完整分布式调度系统、可 MOCK 计算”的范围作出的推论。[Prefect](https://github.com/PrefectHQ/prefect) · [Temporal](https://github.com/temporalio/temporal) · [Argo](https://github.com/argoproj/argo-workflows) · [Ray](https://github.com/ray-project/ray)

### LangChain / LangGraph 是否需要

**LangChain** 主要提供模型、工具和 Agent 循环的抽象；题 D 不要求真实 LLM 调用，固定的动画处理步骤因此不需要它。**LangGraph** 可以单独使用而无需 LangChain，它支持确定性步骤与 Agent 步骤混合、图状态 checkpoint 和故障后恢复，因此是合理备选，而不是本题的必需依赖。[LangGraph 官方概览](https://docs.langchain.com/oss/python/langgraph/overview)

若选择 LangGraph，应使用持久化的 `PostgresSaver`（内存 checkpointer 在进程重启后会丢失），并按可靠性要求选 `durability="sync"`；官方文档指出 `async` 模式在崩溃时有少量丢 checkpoint 的风险，`exit` 模式无法从运行中崩溃恢复。恢复以节点边界为单位：长 GPU 节点执行中崩溃会从该节点开头重跑；节点内检查点、外部副作用幂等和跨任务产物缓存仍由应用设计。GPU 名额/设备调度、任务与步骤的业务状态以及上游页面也仍需单独实现。这些是结合题目范围的设计推论。[Checkpointers 与持久化模式](https://docs.langchain.com/oss/python/langgraph/checkpointers) · [持久化存储选择](https://docs.langchain.com/oss/python/langgraph/persistence) · [LangGraph 步骤粒度与缓存边界](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)

因此，**固定管线 + MOCK AI** 延续上面的 PostgreSQL 状态机方案；若未来要做 LLM 动态决策、工具调用或人工介入，可把该 Agent 子流程放在 LangGraph，外层任务/产物/GPU 调度仍保持清晰的业务模型。[LangGraph 官方概览](https://docs.langchain.com/oss/python/langgraph/overview)
