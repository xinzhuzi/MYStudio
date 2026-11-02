from __future__ import annotations

import unittest
from pathlib import Path


class RequirementsContractTests(unittest.TestCase):
    def test_tts_http_runtime_dependencies_are_declared(self):
        requirements = {
            line.strip().split("[", 1)[0].split("=", 1)[0].split(">", 1)[0].strip()
            for line in (Path(__file__).parents[1] / "requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }

        self.assertIn("fastapi", requirements)
        self.assertIn("uvicorn", requirements)

    def test_chapter_qc_vad_dependency_carries_the_torch_guard(self):
        lines = [
            line.strip()
            for line in (Path(__file__).parents[1] / "requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        vad = [line for line in lines if line.split(";", 1)[0].strip().split("==")[0].strip() == "silero-vad"]
        self.assertEqual(len(vad), 1, vad)
        # silero-vad 依赖 torch;无标记会让 Intel Mac(清单里没有 torch 档)白拉一份 torch
        self.assertEqual(
            vad[0].split(";", 1)[1].strip(),
            'sys_platform != "darwin" or platform_machine == "arm64"',
        )

    def test_face_qc_opencv_is_declared_exactly_once(self):
        lines = [
            line.strip()
            for line in (Path(__file__).parents[1] / "requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        names = [
            line.split(";", 1)[0].split("[", 1)[0].split("=", 1)[0].split(">", 1)[0].strip()
            for line in lines
        ]
        # 1102 人脸可判读度(face_qc/worker.py)与 uncloth 的 ximgproc 都吃 contrib-headless;
        # 普通 opencv-python 提供同名 cv2 模块,两份并存会在 site-packages 里互相覆盖。
        self.assertEqual(names.count("opencv-contrib-python-headless"), 1, names)
        self.assertNotIn("opencv-python", names)

    def test_remote_ssh_paramiko_is_declared_exactly_once(self):
        lines = [
            line.strip()
            for line in (Path(__file__).parents[1] / "requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        names = [
            line.split(";", 1)[0].split("[", 1)[0].split("=", 1)[0].split(">", 1)[0].strip()
            for line in lines
        ]
        # 1103 远端 SSH 模块(remote_ssh/)的同步客户端;恰一条(重复声明会让
        # 装机链 .deps-hash 口径漂移)。无平台标记:双机(macOS/Windows)同清单。
        self.assertEqual(names.count("paramiko"), 1, names)


if __name__ == "__main__":
    unittest.main()
