# 题 D 项目架构

目标是以动画素材处理为例，构建可查询步骤状态与执行历史、可从失败或进程中断后恢复、可复用结果的长任务管线。设计状态、恢复、缓存或 GPU 能力时，先读 [技术调研](./题D-开源项目与技术栈调研.md)。

## 服务边界

| 位置 | 职责 |
| --- | --- |
| `backend/src/pipeline/api/` | FastAPI 接收请求、返回任务与步骤状态；耗时步骤交给 Worker。 |
| `backend/src/pipeline/worker/` | 独立进程领取并执行步骤，负责重试、续租与中断恢复。 |
| PostgreSQL（`db`） | 任务、步骤、每次尝试、状态事件与产物元数据的持久化真相源。 |
| `backend/migrations/` | Alembic 数据库迁移；模型基类位于 `pipeline.db`。 |
| `frontend/` | React/TypeScript 查询 API，展示任务、步骤和执行历史。 |
| `artifacts` 卷 | 持久化步骤产物；数据库只保存引用与校验信息。 |

API 与 Worker 使用同一个 `backend` Python 包，通过 PostgreSQL 协调，不通过进程内队列共享状态。未来的 GPU 步骤以资源需求和 Worker 名额表达，状态界面需呈现等待、分配与执行信息。

当前已实现六步 SVG MOCK 管线、检查点、租约恢复、重试、产物复用与 GPU 名额。修改状态流转、恢复或产物发布时，先读 [设计说明](./DESIGN.md)。事务逻辑集中在 `pipeline.execution`，执行与监督进程在 `pipeline.worker.runtime`，文件发布在 `pipeline.storage`。

新增 ORM 模型后，在 `migrations/env.py` 导入其模块以供 Alembic 识别。新增功能时保持 API 请求短暂、Worker 可重启，并让状态变化与执行历史可查询。集成测试使用独立 PostgreSQL 库 `pipeline_mvp_test`，会清空测试业务表；运行命令见 README。
