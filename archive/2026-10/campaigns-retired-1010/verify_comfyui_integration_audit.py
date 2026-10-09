"""Run scoped ComfyUI audit checks with isolated storage and a no-Git guard.

This verifies source contracts only. It does not build, install, restart an
engine, download models, or submit generation to a provider.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/09-20-comfyui-integration-deep-audit'
BACKEND_PATHS = [
    'apps/backend/engines/comfyui/tests',
    'apps/backend/engines/comfyui/my_nodes/tests',
    'apps/backend/tests/test_image_gen_server.py',
    'apps/backend/tests/test_comfyui_bridge.py',
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('check', choices=('backend', 'frontend', 'typecheck', 'lint'))
    args = parser.parse_args()
    output = TASK / 'research'
    env = os.environ.copy()
    started = time.time()
    with tempfile.TemporaryDirectory(prefix='manying-comfy-audit-') as temporary:
        env['MYSTUDIO_COMFYUI_HOME'] = temporary
        env['PYTHONPATH'] = str(ROOT / 'apps/backend')
        if args.check == 'backend':
            # CPython audit hooks run below subprocess mocks, so forbidden real
            # subprocess attempts are blocked while explicit test fakes still work.
            program = '''import json, os, pathlib, sys, traceback
import pytest
blocked = []
def guard(event, args):
    if event == "subprocess.Popen":
        executable, argv = args[:2]
        command = argv if isinstance(argv, (list, tuple)) else [argv]
        if pathlib.Path(str(executable)).name == "git" or any(str(x) == "git" for x in command[:2]):
            blocked.append({"test": os.environ.get("PYTEST_CURRENT_TEST"), "command": list(command)[:5]})
            raise RuntimeError("ComfyUI audit prohibits real Git subprocesses")
sys.addaudithook(guard)
code = pytest.main(sys.argv[1:])
print("AUDIT_BLOCKED_GIT=" + json.dumps(blocked, ensure_ascii=False))
sys.exit(int(code) or (1 if blocked else 0))
'''
            command = [sys.executable, '-c', program, *BACKEND_PATHS,
                       '-q', '-p', 'no:cacheprovider']
            cwd = ROOT
        else:
            command = {
                'frontend': ['npm', 'test', '--', 'comfy', 'storyboard-overview',
                             'storyboard-pipeline', 'LocalModelStudio', 'h3-shot-video-workflow'],
                'typecheck': ['npm', 'run', 'typecheck'],
                'lint': ['npm', 'run', 'lint'],
            }[args.check]
            cwd = ROOT / 'apps'
        completed = subprocess.run(command, cwd=cwd, env=env, text=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = output / f'final-{args.check}.log'
    log.write_text(completed.stdout, encoding='utf-8')
    metadata = {'check': args.check, 'exitCode': completed.returncode,
                'startedAt': started, 'durationSeconds': round(time.time() - started, 2),
                'log': str(log), 'cwd': str(cwd),
                'command': command if args.check != 'backend' else
                    ['python3', '-m', 'pytest', *BACKEND_PATHS, '-q', '-p', 'no:cacheprovider'],
                'backendGuard': args.check == 'backend'}
    (output / f'final-{args.check}.json').write_text(
        json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(completed.stdout, end='')
    print(json.dumps(metadata, ensure_ascii=False))
    return completed.returncode


if __name__ == '__main__':
    raise SystemExit(main())
