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


if __name__ == "__main__":
    unittest.main()
