import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


def load_generator():
    path = Path(__file__).resolve().parents[1] / "build_daojie_chapter001_workflow.py"
    sys.path.insert(0, str(path.parent))
    try:
        spec = importlib.util.spec_from_file_location("chapter001_tts_runtime_path", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.pop(0)


class TtsRuntimePathTest(unittest.TestCase):
    def test_managed_python_executable_matches_current_platform(self):
        module = load_generator()
        runtime_dir = Path("/managed-storage/python")
        expected = runtime_dir / ("python.exe" if sys.platform == "win32" else "bin/python3")

        self.assertEqual(module.managed_python_executable_path(runtime_dir), expected)
        self.assertEqual(module.managed_python_executable_path(runtime_dir, "win32"), runtime_dir / "python.exe")
        self.assertEqual(module.managed_python_executable_path(runtime_dir, "darwin"), runtime_dir / "bin/python3")

    def test_starts_with_python_from_storage_runtime(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            storage_root = Path(temp) / "storage"
            python_bin = module.managed_python_executable_path(storage_root / "python")
            python_bin.parent.mkdir(parents=True)
            python_bin.write_bytes(b"")
            process = MagicMock()
            process.poll.return_value = None

            with (
                patch.object(module, "APP_SUPPORT", storage_root),
                patch.object(module, "health_check", side_effect=[False, True]),
                patch.object(module.subprocess, "Popen", return_value=process) as popen,
            ):
                self.assertIs(module.start_tts_backend(), process)

            command = popen.call_args.args[0]
            self.assertEqual(command[0], str(python_bin))
            self.assertEqual(popen.call_args.kwargs["env"]["MANYING_TTS_DATA_DIR"], str(storage_root / "tts-runtime"))

    def test_missing_storage_runtime_does_not_use_source_tree_fallback(self):
        module = load_generator()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            storage_root = root / "storage"
            source_tree = root / "backend"
            legacy_python = source_tree / "python" / "bin" / "python3.12"
            legacy_python.parent.mkdir(parents=True)
            legacy_python.write_bytes(b"")

            with (
                patch.object(module, "APP_SUPPORT", storage_root),
                patch.object(module, "BACKEND_ROOT", source_tree),
                patch.object(module, "APP_PYTHON", storage_root / "python" / "bin" / "python3.12", create=True),
                patch.object(module, "health_check", return_value=False),
                patch.object(module.subprocess, "Popen") as popen,
            ):
                with self.assertRaisesRegex(RuntimeError, "设置里的 Python 配置页点击开始配置，完成 TTS 依赖安装"):
                    module.start_tts_backend()

            self.assertTrue(legacy_python.exists())
            popen.assert_not_called()

    def test_existing_healthy_backend_does_not_require_runtime(self):
        module = load_generator()
        with (
            patch.object(module, "health_check", return_value=True),
            patch.object(module.subprocess, "Popen") as popen,
        ):
            self.assertIsNone(module.start_tts_backend())

        popen.assert_not_called()
