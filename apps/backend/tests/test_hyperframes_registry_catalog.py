"""hyperframes_registry catalog 双路径回归(08-28)。

背景:打包布局里 builder 把 frontend/assets/hyperframes-registry 打平到
Resources/hyperframes-registry,Python 侧只认 dev 路径导致装机包 catalog
空载、adapter.py 策展 fail-fast 断言误炸(08-22 起装机版 video-use worker)。
TS 侧 hyperframes-worker.ts 一直是双路径;本测试钉住 Python 侧两种布局都可用。
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = BACKEND_ROOT / "video_use" / "hyperframes_registry.py"


def _load_module_copy(module_dest: Path, sim_name: str):
    """把模块文件复制到模拟布局位再 import,让 __file__ 相对解析命中模拟树。"""
    module_dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MODULE_PATH, module_dest)
    spec = importlib.util.spec_from_file_location(sim_name, module_dest)
    module = importlib.util.module_from_spec(spec)
    sys.modules[sim_name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(sim_name, None)
        raise
    return module


class HyperframesRegistryCatalogPathTest(unittest.TestCase):
    def test_dev_layout_loads_repo_catalog(self) -> None:
        from video_use.hyperframes_registry import HYPERFRAMES_REGISTRY_TEMPLATES, catalog_path

        resolved = catalog_path()
        self.assertIsNotNone(resolved)
        # 仓库 checkout(dev 布局)应命中 frontend/assets 下的真 catalog
        self.assertTrue(str(resolved).endswith("frontend/assets/hyperframes-registry/catalog.json"))
        self.assertGreaterEqual(len(HYPERFRAMES_REGISTRY_TEMPLATES), 300)

    def test_packaged_layout_loads_flattened_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            resources = Path(tmp)
            module_dest = resources / "backend" / "video_use" / "hyperframes_registry.py"
            catalog_dir = resources / "hyperframes-registry"
            catalog_dir.mkdir()
            (catalog_dir / "catalog.json").write_text(
                json.dumps({"items": [{"name": "smoke-fx", "tags": ["fx"]}]}),
                encoding="utf-8",
            )
            module = _load_module_copy(module_dest, "hyperframes_registry_packaged_sim")
            try:
                self.assertEqual(module.HYPERFRAMES_REGISTRY_TEMPLATES, ("hy:smoke-fx",))
                self.assertTrue(str(module.catalog_path()).endswith("hyperframes-registry/catalog.json"))
            finally:
                sys.modules.pop("hyperframes_registry_packaged_sim", None)

    def test_missing_catalog_returns_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            module_dest = Path(tmp) / "backend" / "video_use" / "hyperframes_registry.py"
            module = _load_module_copy(module_dest, "hyperframes_registry_missing_sim")
            try:
                self.assertIsNone(module.catalog_path())
                self.assertEqual(module.HYPERFRAMES_REGISTRY_TEMPLATES, ())
            finally:
                sys.modules.pop("hyperframes_registry_missing_sim", None)


if __name__ == "__main__":
    unittest.main()
