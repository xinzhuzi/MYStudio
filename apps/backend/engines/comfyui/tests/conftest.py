"""Path bootstrap for comfyui tests.

Makes `from engines.comfyui import ...` work no matter which directory
pytest is invoked from (repo root vs `apps/backend`), by putting
`apps/backend` on sys.path. Same pattern as .trellis/scripts/tests/conftest.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[3]  # tests/ -> comfyui/ -> engines/ -> backend

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
