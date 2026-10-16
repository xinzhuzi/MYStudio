#!/usr/bin/env python3
"""Run a task-owned UTF-8 Python snippet over Windows SSH without codepage damage."""
from __future__ import annotations
import argparse
import base64
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--code-file', type=Path, help='UTF-8 Python file; otherwise read stdin')
    parser.add_argument('--timeout', type=int, default=30)
    args = parser.parse_args()
    code = args.code_file.read_text(encoding='utf-8') if args.code_file else sys.stdin.read()
    if not code.strip():
        parser.error('Python source is empty')
    payload = base64.b64encode(code.encode('utf-8')).decode('ascii')
    ps = ("$env:PYTHONIOENCODING='utf-8'; & 'D:\\Python312\\python.exe' -c "
          '"import base64,sys;exec(base64.b64decode(sys.stdin.buffer.read()))"')
    encoded = base64.b64encode(ps.encode('utf-16-le')).decode('ascii')
    result = subprocess.run(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6',
         'zbj@192.168.0.101', 'powershell -NoProfile -EncodedCommand ' + encoded],
        input=payload.encode('ascii'), capture_output=True, timeout=args.timeout,
    )
    sys.stdout.write(result.stdout.decode('utf-8-sig', errors='replace'))
    sys.stderr.write(result.stderr.decode('utf-8-sig', errors='replace'))
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
