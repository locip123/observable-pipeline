# 任务管线可观测 MVP

题 D 的项目骨架：FastAPI、PostgreSQL、独立 Python Worker、React/TypeScript。当前仅提供服务入口和健康检查；任务、步骤、恢复与页面功能尚未实现。

## 启动

```sh
docker compose up --build
```

启动后访问前端 <http://localhost:5174>、API 文档 <http://localhost:8000/docs>，或检查 <http://localhost:8000/api/health>。Worker 当前保持运行并打印占位日志，不领取任务。

系统边界与后续开发约定见 [AGENTS.md](./AGENTS.md)。
