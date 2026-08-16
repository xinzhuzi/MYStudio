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


if __name__ == "__main__":
    unittest.main()
