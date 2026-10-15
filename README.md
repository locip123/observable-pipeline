# Observable Task Pipeline

**让长任务的每一步都有迹可循：可观测、可恢复、可复用。**

本项目以动画素材处理为例，将一个长任务拆成六个独立持久化步骤。在同一个工作台中，可以查看任务进度、步骤依赖、执行尝试、检查点、GPU 资源分配和状态历史，并通过故障注入、暂停或进程崩溃，观察任务如何恢复执行。

项目采用 **React / TypeScript + FastAPI + PostgreSQL 16 + 独立 Python Worker**。当前为可运行的本机演示 MVP：动画处理算法、计算耗时与 GPU 使用 MOCK；数据库事务、执行子进程、检查点文件、SVG 产物与校验均真实运行。

## 项目演示

[观看介绍视频（MP4，约 59 秒）](./assert/video.mp4)。视频展示了六步处理管线、素材变化、GPU 分配、Worker 动态流程与数据库活动记录。点击下方预览图也可打开视频。

[![任务工作台：六步动画素材处理管线、实时进度与暂停控制](./assert/demo1.png)](./assert/video.mp4)

工作台左侧创建与切换任务，主区域展示六个步骤的状态、完成数量、结果复用次数及执行尝试；任务运行中可以暂停、恢复或取消。

## 核心能力

| 能力 | 项目中的实现 |
| --- | --- |
| 步骤可观测 | 分别查询任务、步骤、每次尝试、状态事件与产物，查看进度、Worker、令牌、心跳及租约 |
| 检查点续跑 | 每步包含 20 个 MOCK 工作单元，每完成 4 个单元持久化检查点；恢复时从已验证的检查点继续 |
| 自动重试 | 默认最多 3 次自动重试，按 2 / 4 / 8 秒退避；预算耗尽后支持手动恢复并保留历史 |
| 进程中断恢复 | 真实终止执行子进程，重新启动后回收过期租约、保留旧尝试并重新领取未完成步骤 |
| 结果复用 | 使用输入、上游产物摘要、步骤参数和版本生成指纹，文件通过 SHA-256 校验后才复用 |
| GPU 排队 | 两个 GPU 步骤共享一个 MOCK 独占名额，展示等待、模型加载、分配与释放；缓存命中时跳过资源申请 |
| 持久化历史 | PostgreSQL 保存业务状态与追加式事件；刷新浏览器或重启 API 后可重新查询执行记录 |

## 界面与功能

### 素材变化与步骤检查

以原创 SVG 小狐狸作为固定素材，直观看到抽帧、去背景、风格变化、合成与动画导出的处理过程。选择步骤后，可以对照内存进度与持久化进度，查看检查点位置、自动重试预算、执行尝试、所属 Worker 和租约到期时间。步骤成功后，预览切换为产物卷中的实际 SVG 文件。

![素材处理预览与步骤检查器：持久化进度、检查点、Worker 和尝试记录](./assert/demo2.png)

### GPU 资源分配与 Worker 动态流程

资源面板展示等待队列、设备占用、显存预留和当前任务的 GPU 分配记录。默认设备为 `gpu-0`，模拟容量 8 GB，每个 GPU 步骤预留 4096 MB，一次只允许一个尝试占用。页面中的显存条表示预留额度。

“流程动态展示”跟随当前步骤，呈现领取、缓存判断、检查点校验、资源等待、计算、保存与提交的过程，也展示中断后的租约回收、退避和重新领取路径。绿色节点表示当前环节，紫色表示刚发生的环节；可以切换观察步骤或点击节点查看说明。

![GPU 资源面板与 Worker 动态流程：设备分配、缓存判断及恢复路径](./assert/demo3.png)

### 数据状态与执行历史

活动表展示全局任务及其步骤的插入、状态更新、持久化进度与完成退出，并通过 `tasks.id → steps.task_id` 显示关联关系。完成或取消的记录退出活动视图后，数据库记录和执行历史仍然保留；暂停或失败的任务继续展示，便于恢复。

“数据与内存”中还可以查看 Worker 遥测和原始 JSON 快照，执行真实的子进程崩溃与重启；“执行历史”按事件序号查询状态变化，并支持加载更早记录。

![数据库活动视图：任务表、步骤表、关联关系与持久化检查点](./assert/demo4.png)

## 六步处理流程

同一任务按依赖顺序执行，不同任务可以并行。每个步骤独立记录状态、尝试、检查点和产物，使重试与结果复用以步骤为单位进行。

| 顺序 | 步骤 | 资源类型 | MOCK 演示内容 |
| --- | --- | --- | --- |
| 01 | 素材导入 | CPU | 读取内置素材，建立输入摘要 |
| 02 | 帧提取 | CPU | 展示帧序列与预处理结果 |
| 03 | 背景移除 | GPU | 展示前景与透明背景效果 |
| 04 | 风格迁移 | GPU | 根据星光紫 / 薄荷绿参数生成风格化结果 |
| 05 | 帧合成 | CPU | 展示处理帧的合成效果 |
| 06 | 动画导出 | CPU | 发布含动画的 SVG 文件 |

默认标准任务约 45 秒，也可选择约 2 分钟或约 1 小时的 MOCK 耗时来观察长时间运行。缓存命中会跳过计算，因此实际完成时间更短。

## 系统架构

```mermaid
flowchart LR
    UI[React / TypeScript 工作台] <-->|提交与查询| API[FastAPI]
    API <-->|短事务| DB[(PostgreSQL 16)]
    SUP[Worker 监督进程] -->|启动与监控| W[执行子进程]
    SUP <-->|进程控制状态| DB
    W <-->|领取 / 续租 / 检查点 / 提交| DB
    W -->|写入文件| FS[(artifacts 卷)]
    API -->|校验并读取产物| FS
```

API 接收请求并快速返回，耗时计算由独立 Worker 完成；两者通过 PostgreSQL 协调。PostgreSQL 是任务、步骤和历史的业务状态源，产物与检查点文件存放在持久卷中。Worker 默认最多并发执行 3 个步骤，执行内存与遥测副本不作为恢复依据。

Worker 使用行锁领取步骤，并为每次尝试创建 owner token 与租约。心跳、检查点和结果提交均校验执行资格，过期尝试无法覆盖新的执行状态。文件先落盘并校验，再在事务中发布产物引用与成功状态。

状态流转、故障场景、文件发布及小时级 / 真实 GPU 扩展见 [设计说明](./DESIGN.md)，技术选型背景见 [开源项目与技术栈调研](./题D-开源项目与技术栈调研.md)。

## 快速开始

安装并启动 Docker Desktop，确认 Docker Compose 可用，在项目根目录执行：

```sh
docker compose up --build
```

启动后访问：

| 地址 | 用途 |
| --- | --- |
| [http://localhost:5174](http://localhost:5174) | 任务工作台 |
| [http://localhost:8000/docs](http://localhost:8000/docs) | API 交互文档 |
| [http://localhost:8000/api/health](http://localhost:8000/api/health) | 服务与数据库健康检查 |

API 启动时执行 Alembic 迁移，健康后 Worker 自动开始领取步骤。数据库和产物分别保存在 `postgres_data`、`artifacts` 卷，普通停止或重启保留数据。

若本机已有 Vite 占用 5174，可只运行 `docker compose up -d --build api worker`，继续使用本机前端；整套 Compose 启动前先停止本机对应端口的开发服务。

停止服务可运行 `docker compose down`，下次执行启动命令即可继续使用已有数据。

## 演示路径

1. 创建任务：选择视觉风格与计算时长，点击“创建并运行”。标准任务约 45 秒，缓存命中会更快。点击步骤卡片可检查尝试、令牌、租约和实际 SVG 产物。
2. 单次失败：取消勾选“复用已验证的步骤结果”创建任务，选择正在计算的步骤，点“注入一次失败”。该次尝试变为失败，2 秒后自动重试；前序成功步骤保留。
3. 重试耗尽：点“持续故障”。默认初次尝试加 3 次自动重试，退避 2、4、8 秒，耗尽后任务失败。点“从检查点恢复”清除演示故障、重置本轮预算并继续，历史不删除。
4. 暂停与继续：点“暂停任务”，观察检查点保留、执行尝试中断与 GPU 释放。点“从检查点恢复”后只执行未完成步骤。
5. 进程崩溃：进入“数据与内存”，等有检查点后点“崩溃 Worker”。这会真实终止执行子进程，保留监督进程以接收重启命令。内存消失，数据库状态和 GPU 占用等待租约恢复。点“重启 Worker”，新进程扫描过期租约（默认 10 秒），保留旧尝试为 `interrupted`，退避后重新领取。所有 Worker 都停止时，恢复扫描也停止；重新启动后继续。
6. 结果复用：任务完成后点“相同输入再运行 · 验证复用”。六步产物校验通过时直接复用，GPU 步骤不申请设备；改变风格时前三步仍可复用，风格迁移及后续指纹改变。
7. GPU 排队：点侧栏“启动 GPU 排队演示”，创建两个禁用跨任务缓存的任务。观察一个 `gpu-0` 名额下的等待、加载模型、执行和释放。页面显示显存预留额度。
8. 长任务：选择“长任务 · 约 1h”并关闭缓存。请求仍立即返回；心跳独立于 20 个计算单元持续更新，可中途刷新页面、暂停或重启 Worker。

运行时可结合“流程动态展示”观察每次操作对应的路径；图内画布自动跟随亮起节点，完成后的步骤保留历史路径，API 断线时停止实时高亮。

“取消”为终态；若要重跑，创建新任务。崩溃按钮会影响该 Worker 上的全部运行任务。演示结束后应重启 Worker，让其恢复领取能力。

也可以在终端模拟整个 Worker 容器被杀死：

```sh
docker compose kill -s SIGKILL worker
docker compose up -d worker
```

如果此前使用页面主动崩溃，`desired_state=crashed` 会保留，需同时点击页面“重启 Worker”。

## 查询接口

| 接口 | 用途 |
| --- | --- |
| `POST /api/tasks` | 提交名称、素材标识、风格、耗时倍率、缓存开关、自动重试次数 |
| `GET /api/tasks?limit=50&offset=0` | 分页任务列表 |
| `GET /api/tasks/{id}` | 任务、步骤、尝试与产物 |
| `GET /api/tasks/{id}/snapshot` | 同一 PostgreSQL 读快照中的业务状态、事件、GPU 和 Worker 上报 |
| `GET /api/tasks/{id}/events?before=序号&limit=100` | 倒序历史，使用序号分页 |
| `POST /api/tasks/{id}/interrupt`、`resume`、`cancel` | 暂停、恢复、取消 |
| `POST /api/tasks/{id}/steps/{step_id}/inject-failure` | `mode=once/always/clear` 故障注入 |
| `POST /api/workers/{id}/crash`、`restart` | 执行子进程崩溃/重启 |
| `GET /api/system` | 设备、等待队列、Worker 心跳及内存上报 |
| `GET /api/activity` | 同一读快照中的全局活动任务、步骤与持久化进度；包含最近一分钟结束的任务以供退出动画使用 |
| `GET /api/artifacts/{id}` | 校验并读取 SVG 文件 |
| `GET /api/metrics` | 按状态聚合的任务、步骤、尝试计数与 GPU 名额指标 |

## 项目结构

```text
.
├── assert/                        # 介绍视频与界面截图
├── backend/
│   ├── src/pipeline/
│   │   ├── api/                   # FastAPI 请求、查询与控制接口
│   │   ├── worker/runtime.py      # 执行子进程与监督进程
│   │   ├── execution.py           # 状态流转、领取、重试与恢复事务
│   │   ├── storage.py             # 检查点、摘要校验与文件发布
│   │   ├── models.py              # 持久化模型
│   │   └── definition.py          # 六步管线定义
│   ├── migrations/                # Alembic 数据库迁移
│   └── tests/                     # PostgreSQL 集成测试
├── frontend/                      # React / TypeScript 工作台
├── compose.yaml                   # 数据库、API、Worker 与前端服务
├── DESIGN.md                      # 状态、恢复、缓存与扩展设计
└── AGENTS.md                      # 项目开发约定
```

## 实现范围

`source` 是内置 SVG 素材的版本标识，当前输入为固定素材，最终导出为含动画的 SVG。视频上传、真实 AI 推理、视频编码和真实 GPU 硬件采样属于后续扩展范围。页面显示 GPU 显存预留额度，不展示硬件利用率。

项目采用至少一次执行语义，通过租约、令牌与产物校验控制重复执行。任务提交目前没有请求幂等键；接入模型计费、上传或外部发布等副作用时，还需要下游幂等机制。完整约束见 [设计说明](./DESIGN.md)。

此项目面向本机演示，未实现登录与多租户隔离。在 API 进程环境中设置 `ENABLE_DEMO_CONTROLS=false` 可关闭故障注入和 Worker 崩溃 / 重启接口。

## 验证

前端使用 Node.js 22.12+（满足 Vite 和测试命令的版本要求），在项目根目录执行：

```sh
cd frontend
npm ci
npm test
npm run build
```

前端测试覆盖活动记录展示和 Worker 流程状态，构建同时检查 TypeScript 类型。

后端集成测试只使用独立 PostgreSQL 库 `pipeline_mvp_test`，会清空该测试库的业务表，拒绝在其他库名下执行。Windows PowerShell 示例（项目根目录）：

```powershell
docker compose up -d --wait db
docker compose exec db createdb -U pipeline pipeline_mvp_test # 仅首次
python -m venv .venv # 已有虚拟环境可跳过
.\.venv\Scripts\python.exe -m pip install -e './backend[test]'
$env:DATABASE_URL='postgresql+psycopg://pipeline:pipeline@127.0.0.1:5432/pipeline_mvp_test'
$env:ARTIFACT_DIR=Join-Path (Get-Location) 'artifacts/tests'
$env:PYTHONUTF8='1'
Set-Location backend
..\.venv\Scripts\alembic.exe upgrade head
..\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

测试覆盖依赖顺序、并发领取、步骤重试与预算、过期令牌、GPU 排队与回收、暂停/取消、跨任务缓存、损坏检查点与产物、孤立输出接管和真实子进程崩溃重启。测试完成后重新打开终端或还原 `DATABASE_URL` / `ARTIFACT_DIR`，再运行开发服务。

## VS Code 调试（Windows）

调试配置在本机运行 API、Worker 和 Vite，通过 Docker 启动 PostgreSQL。请安装 Python 3.11+、Node.js 22.12+ / npm、Docker Desktop 和 Edge，并在 VS Code 中打开项目根目录，安装工作区推荐的 Python 扩展。

1. 启动 Docker Desktop。如果之前运行了整套 Compose 服务，先执行 `docker compose stop api worker frontend`，释放 8000、5174 端口，并避免容器 Worker 同时领取任务。
2. 首次使用时，通过命令面板的 `Tasks: Run Task` 运行 `调试：初始化依赖`。该任务创建根目录下的 `.venv`，以可编辑模式安装后端，并执行前端的 `npm ci`。依赖变更后可重新运行。
3. 打开“运行和调试”（`Ctrl+Shift+D`），选择 `全栈调试（API + Worker + 前端）`，按 `F5`。配置会等待数据库健康、执行 `alembic upgrade head`，再启动 API、Worker 和前端浏览器调试。

前端地址为 <http://127.0.0.1:5174>，API 文档为 <http://127.0.0.1:8000/docs>。可在 `backend/src/pipeline/api/main.py`、`backend/src/pipeline/execution.py`、`backend/src/pipeline/worker/runtime.py` 或 `frontend/src/` 中设置断点。Worker 执行器是子进程，调试器需要启用子进程调试；长时间停在断点会使租约过期，可调大 `LEASE_SECONDS`。API 调试时未启用自动重载，修改 Python 代码后请重启相应调试会话。

只调试后端时，选择 `后端调试（API + Worker）`；单独启动 API 或 Worker 前，先运行 `调试：准备后端`。单独选择 `前端（Edge）` 会启动 Vite，访问任务功能仍需 API 运行。若使用 Chrome，可将前端配置的 `type` 从 `msedge` 改为 `chrome`。

联合调试配置的停止按钮会结束所有调试会话。Vite 后台任务和数据库会继续运行；可通过 `Tasks: Terminate Task` 停止前端，通过 `docker compose stop db` 停止数据库。

配置字段参考 [VS Code Python 调试文档](https://code.visualstudio.com/docs/python/debugging)和[浏览器调试文档](https://code.visualstudio.com/docs/nodejs/browser-debugging)。
