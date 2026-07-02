from __future__ import annotations

import queue
import threading
import time

from .storage import RuntimeStore


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
            pass
        task_queue.task_done()


class RuntimeState:
    def __init__(self, store: RuntimeStore):
        self.store = store
        self.lock = threading.RLock()
        self.progress: dict[str, dict] = {}
        self.download_threads: dict[str, threading.Thread] = {}
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
