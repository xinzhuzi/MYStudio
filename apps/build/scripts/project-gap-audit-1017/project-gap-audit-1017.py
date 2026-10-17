"""Verify the retained, positive regression probes; never regenerate old defect assertions."""
from pathlib import Path
import hashlib
import json

base = Path(__file__).resolve().parent
files = sorted(base.glob("*.test.ts"))
if len(files) != 4:
    raise SystemExit("Expected four retained audit regression test files")
print(json.dumps({"probes": [{"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}, indent=2))
