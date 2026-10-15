"""Run against a migrated, disposable PostgreSQL database named pipeline_mvp_test.

DATABASE_URL=.../pipeline_mvp_test python -m unittest discover -s tests -v
"""
import os
import subprocess
import sys
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, text

from pipeline import execution as state, storage
from pipeline.api.main import app
from pipeline.config import SessionLocal, engine
from pipeline.models import GpuDevice, Step, StepAttempt, Task, Worker
from pipeline.worker.runtime import run_step


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if engine.url.database != "pipeline_mvp_test":
            raise RuntimeError("Tests require disposable DATABASE_URL database pipeline_mvp_test")
        cls.client = TestClient(app)

    def setUp(self):
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE tasks, workers CASCADE"))
            connection.execute(text("INSERT INTO gpu_devices (id, name, memory_mb) VALUES ('gpu-0', 'MOCK GPU', 8192) ON CONFLICT (id) DO UPDATE SET attempt_id = NULL"))
        self.source = str(uuid.uuid4())

    def create(self, **kwargs):
        response = self.client.post("/api/tasks", json={"name": "测试素材", "source": self.source,
                                                        "duration_scale": 0.1, "use_cache": False, **kwargs})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def task(self, task_id):
        return self.client.get(f"/api/tasks/{task_id}").json()

    def finish(self, work):
        data = storage.svg_output(work["order"], work["key"], work["style"])
        result = storage.publish(f"results/{work['key']}.svg", data)
        self.assertTrue(state.complete(work, result))
        return result

    def due(self, step_id):
        with SessionLocal.begin() as db:
            db.get(Step, step_id).next_retry_at = state.now(db) - timedelta(seconds=1)

    def gpu_work(self, task):
        self.finish(state.claim("test-worker"))
        self.finish(state.claim("test-worker"))
        work = state.claim("test-worker")
        self.assertTrue(work["gpu"])
        self.assertEqual(work["task_id"], task["id"])
        return work

    def test_pipeline_dependencies_artifacts_and_event_pagination(self):
        task = self.create()
        self.assertEqual(task["steps"][0]["status"], "queued")
        for order in range(6):
            work = state.claim("test-worker")
            self.assertEqual(work["order"], order)
            self.assertIsNone(state.claim("other-worker"))
            self.finish(work)
        final = self.task(task["id"])
        self.assertEqual(final["status"], "completed")
        for step in final["steps"]:
            response = self.client.get(f"/api/artifacts/{step['artifacts'][0]['id']}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(storage.digest(response.content), step["artifacts"][0]["checksum"])
        snapshot = self.client.get(f"/api/tasks/{task['id']}/snapshot").json()
        self.assertEqual(snapshot["counts"]["step_attempts"], 6)
        page = self.client.get(f"/api/tasks/{task['id']}/events?limit=2").json()
        older = self.client.get(f"/api/tasks/{task['id']}/events?before={page[-1]['sequence']}&limit=2").json()
        self.assertGreater(page[-1]["sequence"], older[0]["sequence"])

    def test_activity_tables_include_all_active_tasks_and_retain_history(self):
        first = self.create()
        paused = self.create(name="暂停任务")
        self.client.post(f"/api/tasks/{paused['id']}/interrupt")
        work = state.claim("test-worker")
        cp = storage.checkpoint(work["step_id"], work["attempt_id"], 8, work["key"])
        state.pulse(work, checkpoint=cp)
        response = self.client.get("/api/activity")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual({t["id"] for t in data["tasks"]}, {first["id"], paused["id"]})
        self.assertEqual(len(data["steps"]), 12)
        running = next(s for s in data["steps"] if s["id"] == work["step_id"])
        self.assertEqual((running["checkpoint_unit"], running["progress"]), (8, 0.4))
        self.assertEqual(running["task_id"], first["id"])
        self.assertNotIn("attempts", running)
        self.finish(work)
        for _ in range(5):
            self.finish(state.claim("test-worker"))
        completed = next(t for t in self.client.get("/api/activity").json()["tasks"] if t["id"] == first["id"])
        self.assertEqual((completed["status"], completed["completed_steps"]), ("completed", 6))
        with SessionLocal.begin() as db:
            for task_id in (first["id"], paused["id"]):
                db.get(Task, task_id).updated_at = state.now(db) - timedelta(minutes=2)
        data = self.client.get("/api/activity").json()
        self.assertEqual([t["id"] for t in data["tasks"]], [paused["id"]])
        self.assertEqual(len(data["steps"]), 6)
        self.assertEqual(self.task(first["id"])["status"], "completed")
        self.assertTrue(self.client.get(f"/api/tasks/{first['id']}/events").json())

    def test_concurrent_claim_has_single_owner(self):
        self.create()
        barrier = threading.Barrier(2)
        def take(worker):
            barrier.wait()
            return state.claim(worker)
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(take, ["one", "two"]))
        self.assertEqual(sum(result is not None for result in results), 1)

    def test_transient_failure_backoff_checkpoint_resume(self):
        task = self.create()
        work = state.claim("test-worker")
        cp = storage.checkpoint(work["step_id"], work["attempt_id"], 8, work["key"])
        state.pulse(work, checkpoint=cp)
        self.client.post(f"/api/tasks/{task['id']}/steps/{work['step_id']}/inject-failure")
        self.assertFalse(state.pulse(work))
        step = self.task(task["id"])["steps"][0]
        self.assertEqual(step["status"], "retry_wait")
        self.assertEqual(step["progress"], 0.4)
        self.assertEqual(step["attempts"][0]["status"], "failed")
        self.assertIsNone(state.claim("test-worker"))
        self.due(work["step_id"])
        recovered = state.claim("test-worker")
        self.assertEqual(recovered["checkpoint"]["unit"], 8)
        self.assertEqual(recovered["attempt_number"], 2)
        self.finish(recovered)
        self.assertEqual(self.task(task["id"])["steps"][0]["attempts"][1]["resumed_from"], 8)

    def test_retry_exhaustion_and_manual_resume(self):
        task = self.create(max_retries=1)
        work = state.claim("test-worker")
        self.client.post(f"/api/tasks/{task['id']}/steps/{work['step_id']}/inject-failure", json={"mode": "always"})
        self.assertFalse(state.pulse(work))
        self.due(work["step_id"])
        second = state.claim("test-worker")
        self.assertFalse(state.pulse(second))
        self.assertEqual(self.task(task["id"])["status"], "failed")
        self.assertIsNone(state.claim("test-worker"))
        self.assertEqual(self.client.post(f"/api/tasks/{task['id']}/resume").status_code, 200)
        third = state.claim("test-worker")
        self.assertEqual(third["attempt_number"], 3)
        self.assertTrue(state.pulse(third))

    def test_expired_owner_cannot_renew_or_commit(self):
        task = self.create()
        old = state.claim("old-worker")
        with SessionLocal.begin() as db:
            db.get(StepAttempt, old["attempt_id"]).lease_expires_at = state.now(db) - timedelta(seconds=1)
        self.assertFalse(state.pulse(old))
        state.recover_expired()
        self.due(old["step_id"])
        new = state.claim("new-worker")
        self.assertNotEqual(old["token"], new["token"])
        output = storage.publish(f"results/{old['key']}.svg", storage.svg_output(old["order"], old["key"], old["style"]))
        self.assertFalse(state.complete(old, output))
        self.assertTrue(state.complete(new, output))
        attempts = self.task(task["id"])["steps"][0]["attempts"]
        self.assertEqual([a["status"] for a in attempts], ["interrupted", "succeeded"])

    def test_gpu_contention_release_and_cancel_fence(self):
        first = self.create()
        work = self.gpu_work(first)
        self.assertEqual(state.gpu_tick(work)["phase"], "allocating")
        second = self.create(source=self.source + "-second")
        other = self.gpu_work(second)
        self.assertEqual(state.gpu_tick(other)["phase"], "waiting")
        self.client.post(f"/api/tasks/{first['id']}/cancel")
        self.assertFalse(state.pulse(work))
        self.assertEqual(state.gpu_tick(other)["phase"], "allocating")
        self.assertEqual(self.task(first["id"])["status"], "cancelled")
        self.assertEqual(self.client.post(f"/api/tasks/{first['id']}/resume").status_code, 409)
        with SessionLocal() as db:
            self.assertEqual(db.get(GpuDevice, "gpu-0").attempt_id, other["attempt_id"])

    def test_gpu_reclaimed_only_after_lease_expiry(self):
        task = self.create()
        work = self.gpu_work(task)
        state.gpu_tick(work)
        state.recover_expired()
        with SessionLocal.begin() as db:
            self.assertEqual(db.get(GpuDevice, "gpu-0").attempt_id, work["attempt_id"])
            db.get(StepAttempt, work["attempt_id"]).lease_expires_at = state.now(db) - timedelta(seconds=1)
        state.recover_expired()
        with SessionLocal() as db:
            self.assertIsNone(db.get(GpuDevice, "gpu-0").attempt_id)

    def test_concurrent_gpu_requests_never_share_a_slot(self):
        first = self.gpu_work(self.create())
        second = self.gpu_work(self.create(source=self.source + "-second"))
        barrier = threading.Barrier(2)
        def request(work):
            barrier.wait()
            return state.gpu_tick(work)
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(request, [first, second]))
        self.assertEqual(sorted(r["phase"] for r in results), ["allocating", "waiting"])

    def test_missing_upstream_is_rejected_and_resume_repairs_chain(self):
        task = self.create(max_retries=0)
        artifact = self.finish(state.claim("worker"))
        work = state.claim("worker")
        storage.resolve(artifact["path"]).unlink()
        run_step(work, {}, threading.Lock())
        self.assertEqual(self.task(task["id"])["status"], "failed")
        self.client.post(f"/api/tasks/{task['id']}/resume")
        recovered = state.claim("worker")
        self.assertEqual(recovered["order"], 0)
        self.assertIsNone(recovered["checkpoint"])

    def test_pause_resume_retains_completed_steps(self):
        task = self.create()
        first = state.claim("worker")
        self.finish(first)
        work = state.claim("worker")
        cp = storage.checkpoint(work["step_id"], work["attempt_id"], 4, work["key"])
        state.pulse(work, checkpoint=cp)
        self.client.post(f"/api/tasks/{task['id']}/interrupt")
        self.assertFalse(state.pulse(work))
        self.assertIsNone(state.claim("worker"))
        self.client.post(f"/api/tasks/{task['id']}/resume")
        new = state.claim("worker")
        self.assertEqual(new["order"], 1)
        self.assertEqual(new["checkpoint"]["unit"], 4)
        self.assertEqual(len(self.task(task["id"])["steps"][0]["attempts"]), 1)

    def test_cross_task_cache_and_parameter_invalidation(self):
        first = self.create()
        for _ in range(6):
            self.finish(state.claim("worker"))
        second = self.create(use_cache=True)
        for _ in range(6):
            run_step(state.claim("worker"), {}, threading.Lock())
        final = self.task(second["id"])
        self.assertEqual(final["status"], "completed")
        self.assertTrue(all(s["cached_result"]["reused_from"] for s in final["steps"]))
        self.assertFalse(any(s["resource_allocations"] for s in final["steps"]))
        third = self.create(style="mint", use_cache=True)
        for _ in range(3):
            run_step(state.claim("worker"), {}, threading.Lock())
        changed = state.claim("worker")
        self.assertIsNone(changed["cached"])
        self.assertEqual(changed["task_id"], third["id"])

    def test_corrupt_artifact_checkpoint_and_orphan_recovery(self):
        task = self.create()
        work = state.claim("worker")
        result = self.finish(work)
        self.client.post(f"/api/tasks/{task['id']}/cancel")
        storage.resolve(result["path"]).write_bytes(b"broken")
        artifact_id = self.task(task["id"])["steps"][0]["artifacts"][0]["id"]
        self.assertEqual(self.client.get(f"/api/artifacts/{artifact_id}").status_code, 409)
        second = self.create(use_cache=True)
        work = state.claim("worker")
        cp = storage.checkpoint(work["step_id"], work["attempt_id"], 8, work["key"])
        state.pulse(work, checkpoint=cp)
        state.fail_work(work, "test crash")
        storage.resolve(cp["path"]).write_bytes(b"broken checkpoint")
        self.due(work["step_id"])
        work = state.claim("worker")
        run_step(work, {}, threading.Lock())
        step = self.task(second["id"])["steps"][0]
        self.assertEqual(step["status"], "completed")
        self.assertIsNone(step["cached_result"]["reused_from"])
        self.assertEqual(step["attempts"][-1]["resumed_from"], 0)
        next_work = state.claim("worker")
        orphan = storage.publish(f"results/{next_work['key']}.svg", storage.svg_output(next_work["order"], next_work["key"], next_work["style"]))
        run_step(next_work, {}, threading.Lock())
        self.assertEqual(self.task(second["id"])["steps"][1]["cached_result"]["reused_from"], "orphan-output")

    def test_disabled_cache_does_not_reuse_another_task_after_retry(self):
        first = self.create()
        self.finish(state.claim("worker"))
        self.client.post(f"/api/tasks/{first['id']}/cancel")
        second = self.create(use_cache=False)
        work = state.claim("worker")
        state.fail_work(work, "transient")
        self.due(work["step_id"])
        run_step(state.claim("worker"), {}, threading.Lock())
        step = self.task(second["id"])["steps"][0]
        self.assertEqual(step["status"], "completed")
        self.assertIsNone(step["cached_result"]["reused_from"])

    def test_real_process_crash_restart_and_checkpoint_recovery(self):
        worker_id = "integration-process"
        env = {**os.environ, "WORKER_ID": worker_id, "LEASE_SECONDS": "3"}
        process = subprocess.Popen([sys.executable, "-m", "pipeline.worker"], env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def wait_for(predicate, timeout=25):
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                result = predicate()
                if result:
                    return result
                time.sleep(0.15)
            self.fail("Timed out waiting for process recovery")
        try:
            task = self.create(duration_scale=1)
            wait_for(lambda: self.task(task["id"])["steps"][0]["progress"] >= 0.2)
            with SessionLocal() as db:
                original_pid = db.get(Worker, worker_id).pid
            self.client.post(f"/api/workers/{worker_id}/crash")
            def offline():
                with SessionLocal() as db:
                    worker = db.get(Worker, worker_id)
                    return worker.status == "offline" and worker.runtime == {}
            wait_for(offline)
            self.assertEqual(self.task(task["id"])["steps"][0]["attempts"][0]["status"], "running")
            self.client.post(f"/api/workers/{worker_id}/restart")
            wait_for(lambda: self.task(task["id"])["steps"][0]["status"] == "completed")
            final = self.task(task["id"])["steps"][0]
            self.assertEqual([a["status"] for a in final["attempts"]], ["interrupted", "succeeded"])
            self.assertGreaterEqual(final["attempts"][-1]["resumed_from"], 4)
            with SessionLocal() as db:
                self.assertNotEqual(db.get(Worker, worker_id).pid, original_pid)
            self.client.post(f"/api/workers/{worker_id}/crash")
            wait_for(offline)
        finally:
            process.terminate()
            process.wait(timeout=10)

    def test_request_validation_and_terminal_conflicts(self):
        self.assertEqual(self.client.post("/api/tasks", json={"name": "   "}).status_code, 422)
        task = self.create()
        self.assertEqual(self.client.post(f"/api/tasks/{task['id']}/resume").status_code, 409)
        self.assertEqual(self.client.get("/api/tasks/unknown/snapshot").status_code, 404)
        self.assertEqual(self.client.get("/api/health").json()["database"], "postgresql")


if __name__ == "__main__":
    unittest.main()
