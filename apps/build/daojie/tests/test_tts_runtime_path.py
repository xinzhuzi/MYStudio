import importlib.util
import os
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
    def test_storage_config_resolves_project_assets_and_runtime_roots(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            user_data = root / "user-data"
            storage_root = root / "storage"
            user_data.mkdir()
            storage_root.mkdir()
            (user_data / "storage-config.json").write_text(
                '{"basePath": "' + str(storage_root) + '"}',
                "utf-8",
            )

            with patch.dict(os.environ, {
                "MYSTUDIO_USER_DATA_DIR": str(user_data),
                "MYSTUDIO_PROJECT_ID": "project-from-env",
            }, clear=False):
                module = load_generator()

            self.assertEqual(module.USER_DATA_DIR, user_data)
            self.assertEqual(module.STORAGE_BASE_PATH, storage_root)
            self.assertEqual(module.PROJECT, storage_root / "projects" / "_p" / "project-from-env")
            self.assertEqual(module.ASSET_DB, storage_root / "assets" / "assets.db")
            self.assertEqual(module.PYTHON_RUNTIME_DIR, storage_root / "python")
            self.assertEqual(module.TTS_RUNTIME_DIR, storage_root / "TTS" / "runtime")
            self.assertEqual(module.TTS_MODELS_DIR, storage_root / "TTS" / "model")

    def test_storage_config_resolves_project_by_name_without_fixed_project_id(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            user_data = root / "user-data"
            storage_root = root / "storage"
            projects_root = storage_root / "projects"
            user_data.mkdir()
            projects_root.mkdir(parents=True)
            (user_data / "storage-config.json").write_text(
                '{"basePath": "' + str(storage_root) + '"}',
                "utf-8",
            )
            (projects_root / "mystudio-project-store.json").write_text(
                '{"state": {"projects": [{"id": "project-from-name", "name": "道劫"}]}}',
                "utf-8",
            )

            with patch.dict(os.environ, {
                "MYSTUDIO_USER_DATA_DIR": str(user_data),
            }, clear=True):
                module = load_generator()

            self.assertEqual(module.PROJECT, storage_root / "projects" / "_p" / "project-from-name")

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
                patch.object(module, "PYTHON_RUNTIME_DIR", storage_root / "python"),
                patch.object(module, "TTS_RUNTIME_DIR", storage_root / "TTS" / "runtime"),
                patch.object(module, "TTS_MODELS_DIR", storage_root / "TTS" / "model"),
                patch.object(module, "health_check", side_effect=[False, True]),
                patch.object(module.subprocess, "Popen", return_value=process) as popen,
            ):
                self.assertIs(module.start_tts_backend(), process)

            command = popen.call_args.args[0]
            self.assertEqual(command[0], str(python_bin))
            self.assertEqual(popen.call_args.kwargs["env"]["MANYING_TTS_DATA_DIR"], str(storage_root / "TTS" / "runtime"))

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
                patch.object(module, "PYTHON_RUNTIME_DIR", storage_root / "python"),
                patch.object(module, "BACKEND_ROOT", source_tree),
                patch.object(module, "APP_PYTHON", storage_root / "python" / "bin" / "python3.12", create=True),
                patch.object(module, "health_check", return_value=False),
                patch.object(module.subprocess, "Popen") as popen,
            ):
                with self.assertRaisesRegex(RuntimeError, "设置里的本地配置页的 Python 运行环境区块点击开始配置，完成 TTS 依赖安装"):
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
