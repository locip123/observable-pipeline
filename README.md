# 任务管线可观测 MVP

可运行的动画素材长任务 MVP：FastAPI、PostgreSQL 16、独立 Python Worker、React/TypeScript。六个步骤支持检查点续跑、自动退避重试、进程崩溃恢复和 SHA-256 校验后的结果复用。计算和 GPU 使用 MOCK，SVG 产物、数据库事务与执行子进程都是真实的。

## 启动

```sh
docker compose up --build
```

启动后访问前端 <http://localhost:5174>、API 文档 <http://localhost:8000/docs>，或检查 <http://localhost:8000/api/health>。API 启动时执行 Alembic 迁移，健康后 Worker 自动开始领取步骤。数据库和产物分别保存在 `postgres_data`、`artifacts` 卷，普通停止或重启保留数据。

若本机已有 Vite 占用 5174，可只运行 `docker compose up -d --build api worker`，继续使用本机前端；整套 Compose 启动前先停止本机对应端口的开发服务。

系统状态、失败场景、步骤划分和小时级/GPU 扩展见 [设计说明](./DESIGN.md)；后续开发约定见 [AGENTS.md](./AGENTS.md)。

## 演示路径

1. 创建任务：选择视觉风格与计算时长，点击“创建并运行”。标准任务约 45 秒，缓存命中会更快。点击步骤卡片可检查尝试、令牌、租约和实际 SVG 产物。
2. 单次失败：取消勾选“复用已验证的步骤结果”创建任务，选择正在计算的步骤，点“注入一次失败”。该次尝试变为失败，2 秒后自动重试；前序成功步骤保留。
3. 重试耗尽：点“持续故障”。默认初次尝试加 3 次自动重试，退避 2、4、8 秒，耗尽后任务失败。点“从检查点恢复”清除演示故障、重置本轮预算并继续，历史不删除。
4. 暂停与继续：点“暂停任务”，观察检查点保留、执行尝试中断与 GPU 释放。点“从检查点恢复”后只执行未完成步骤。
5. 进程崩溃：进入“数据与内存”，等有检查点后点“崩溃 Worker”。这会真实终止执行子进程，保留监督进程以接收重启命令。内存消失，数据库状态和 GPU 占用等待租约恢复。点“重启 Worker”，新进程扫描过期租约（默认 10 秒），保留旧尝试为 `interrupted`，退避后重新领取。所有 Worker 都停止时，恢复扫描也停止；重新启动后继续。
6. 结果复用：任务完成后点“相同输入再运行 · 验证复用”。六步产物校验通过时直接复用，GPU 步骤不申请设备；改变风格时前三步仍可复用，风格迁移及后续指纹改变。
7. GPU 排队：点侧栏“启动 GPU 排队演示”，创建两个禁用跨任务缓存的任务。观察一个 `gpu-0` 名额下的等待、加载模型、执行和释放。页面显示的是显存预留，未伪装为真实显卡利用率。
8. 长任务：选择“长任务 · 约 1h”并关闭缓存。请求仍立即返回；心跳独立于 20 个计算单元持续更新，可中途刷新页面、暂停或重启 Worker。

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

`source` 是内置 SVG 素材的版本标识；本 MVP 不包含用户视频上传或真实编码器。最终导出为含动画的 SVG。`ENABLE_DEMO_CONTROLS=false` 可关闭故障注入和 Worker 崩溃/重启接口。此项目面向本机演示，未实现登录与多租户隔离。

## 验证

前端：在 `frontend` 中运行 `npm ci`、`npm test`（Node.js 22.6+）、`npm run build`。活动表展示任务与步骤的插入、状态更新及完成退出；退出只影响展示，原始记录仍可在执行历史中查询。Worker 内存与崩溃/重启操作位于该版块下方的折叠区。

后端集成测试只使用独立 PostgreSQL 库 `pipeline_mvp_test`，会清空该测试库的业务表，拒绝在其他库名下执行。Windows PowerShell 示例（项目根目录）：

```powershell
docker compose up -d --wait db
docker compose exec db createdb -U pipeline pipeline_mvp_test # 仅首次
uv pip install --python .venv/Scripts/python.exe -e './backend[test]'
$env:DATABASE_URL='postgresql+psycopg://pipeline:pipeline@127.0.0.1:5432/pipeline_mvp_test'
$env:ARTIFACT_DIR=Join-Path (Get-Location) 'artifacts/tests'
$env:PYTHONUTF8='1'
Set-Location backend
..\.venv\Scripts\alembic.exe upgrade head
..\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

测试覆盖依赖顺序、并发领取、步骤重试与预算、过期令牌、GPU 排队与回收、暂停/取消、跨任务缓存、损坏检查点与产物、孤立输出接管和真实子进程崩溃重启。测试完成后重新打开终端或还原 `DATABASE_URL` / `ARTIFACT_DIR`，再运行开发服务。

## VS Code 调试（Windows）

调试配置在本机运行 API、Worker 和 Vite，通过 Docker 启动 PostgreSQL。请安装 Python 3.11+、Node.js/npm、Docker Desktop 和 Edge，并在 VS Code 中打开项目根目录，安装工作区推荐的 Python 扩展。

1. 启动 Docker Desktop。如果之前运行了整套 Compose 服务，先执行 `docker compose stop api worker frontend`，释放 8000、5174 端口，并避免容器 Worker 同时领取任务。
2. 首次使用时，通过命令面板的 `Tasks: Run Task` 运行 `调试：初始化依赖`。该任务创建根目录下的 `.venv`，以可编辑模式安装后端，并执行前端的 `npm ci`。依赖变更后可重新运行。
3. 打开“运行和调试”（`Ctrl+Shift+D`），选择 `全栈调试（API + Worker + 前端）`，按 `F5`。配置会等待数据库健康、执行 `alembic upgrade head`，再启动 API、Worker 和前端浏览器调试。

前端地址为 <http://127.0.0.1:5174>，API 文档为 <http://127.0.0.1:8000/docs>。可在 `backend/src/pipeline/api/main.py`、`backend/src/pipeline/execution.py`、`backend/src/pipeline/worker/runtime.py` 或 `frontend/src/` 中设置断点。Worker 执行器是子进程，调试器需要启用子进程调试；长时间停在断点会使租约过期，可调大 `LEASE_SECONDS`。API 调试时未启用自动重载，修改 Python 代码后请重启相应调试会话。

只调试后端时，选择 `后端调试（API + Worker）`；单独启动 API 或 Worker 前，先运行 `调试：准备后端`。单独选择 `前端（Edge）` 会启动 Vite，访问任务功能仍需 API 运行。若使用 Chrome，可将前端配置的 `type` 从 `msedge` 改为 `chrome`。

联合调试配置的停止按钮会结束所有调试会话。Vite 后台任务和数据库会继续运行；可通过 `Tasks: Terminate Task` 停止前端，通过 `docker compose stop db` 停止数据库。

配置字段参考 [VS Code Python 调试文档](https://code.visualstudio.com/docs/python/debugging)和[浏览器调试文档](https://code.visualstudio.com/docs/nodejs/browser-debugging)。
