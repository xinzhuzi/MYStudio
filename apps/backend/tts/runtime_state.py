from __future__ import annotations

import logging
import queue
import threading
import time

from .storage import RuntimeStore

logger = logging.getLogger(__name__)


def _inference_worker(task_queue: queue.Queue):
    """Dedicated thread for MLX/TTS inference because MLX is not thread-safe."""
    while True:
        task = task_queue.get()
        if task is None:
            break
        fn, args = task
        try:
            fn(*args)
        except Exception:
            # 任务闭包内部已负责状态落库;这里兜底只补观测,防任务无声卡死无迹可查
            logger.exception("inference task crashed: %s", getattr(fn, "__name__", repr(fn)))
        task_queue.task_done()


class RuntimeState:
    def __init__(self, store: RuntimeStore):
        self.store = store
        self.lock = threading.RLock()
        self.progress: dict[str, dict] = {}
        self.download_threads: dict[str, threading.Thread] = {}
        self.download_cancel_events: dict[str, threading.Event] = {}
        self.generations: dict[str, dict] = {}
        self.inference_queue: queue.Queue = queue.Queue()
        self._inference_thread = threading.Thread(
            target=_inference_worker,
            args=(self.inference_queue,),
            daemon=True,
        )
        self._inference_thread.start()

    def set_progress(self, model_name: str, **updates):
        with self.lock:
            current = self.progress.get(model_name, {"model_name": model_name})
            current.update(updates)
            current["timestamp"] = int(time.time() * 1000)
            self.progress[model_name] = current
            return dict(current)

    def get_progress(self, model_name: str):
        with self.lock:
            progress = self.progress.get(model_name)
            return dict(progress) if progress else None

    def active_downloads(self):
        with self.lock:
            return [
                dict(task)
                for task in self.progress.values()
                if task.get("status") == "downloading"
            ]

    def download_cancel_event(self, model_name: str) -> threading.Event:
        """取(或建)该模型的下载取消事件;锁内 get-or-create 防双事件。"""
        with self.lock:
            event = self.download_cancel_events.get(model_name)
            if event is None:
                event = threading.Event()
                self.download_cancel_events[model_name] = event
            return event

    def cancel_download(self, model_name: str) -> bool:
        """置取消事件;返回 False 表示当前没有已注册的下载任务。"""
        with self.lock:
            event = self.download_cancel_events.get(model_name)
            if event is None:
                return False
            event.set()
            return True

    def start_generation(self, generation_id: str, profile_id: str, text: str):
        with self.lock:
            self.generations[generation_id] = {
                "task_id": generation_id,
                "profile_id": profile_id,
                "text": text,
                "status": "generating",
            }

    def finish_generation(self, generation_id: str, error: str | None = None):
        with self.lock:
            task = self.generations.get(generation_id)
            if not task:
                return
            if error:
                task["status"] = "failed"
                task["error"] = error
            else:
                self.generations.pop(generation_id, None)

    def active_generations(self):
        with self.lock:
            return [dict(task) for task in self.generations.values()]

    def is_generation_active(self, generation_id: str) -> bool:
        with self.lock:
            task = self.generations.get(generation_id)
            return bool(task and task.get("status") == "generating")
