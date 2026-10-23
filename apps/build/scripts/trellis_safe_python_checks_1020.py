"""Run approved verification domains with an explicit no-Git process guard."""
import json
import os
import runpy
import shlex
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[3]


def forbid_git(event, args):
    if event == 'subprocess.Popen':
        executable, command = args[0], args[1]
        tokens = shlex.split(command) if isinstance(command, str) else list(command or [])
        if Path(str(executable)).name == 'git' or any(Path(str(x)).name == 'git' for x in tokens):
            raise PermissionError('POLICY_BLOCKED_NO_GIT: subprocess was prevented before execution')
    if event in ('os.system', 'os.exec', 'os.posix_spawn'):
        text = ' '.join(str(x) for x in args)
        if any(Path(token).name == 'git' for token in shlex.split(text)):
            raise PermissionError('POLICY_BLOCKED_NO_GIT: process was prevented before execution')


sys.addaudithook(forbid_git)
mode = sys.argv[1]
os.chdir(root / 'apps')
sys.path.insert(0, str(root / 'apps/backend'))
os.environ['PYTHONPATH'] = str(root / 'apps/backend')
if mode in ('engines', 'my_nodes', 'chapter_video', 'build_scripts'):
    import pytest
    paths = {
        'engines': ['backend/comfyui/tests'],
        'my_nodes': ['backend/comfyui/my_nodes/tests'],
        'chapter_video': ['build/chapter_video/tests', '--deselect=build/chapter_video/tests/test_continuity_pilot_attempt_ledger.py::ContinuityPilotAttemptLedgerTest::test_full_chapter_dry_run_reports_all_43_blocked_without_network', '--deselect=build/chapter_video/tests/test_continuity_pilot_attempt_ledger.py::ContinuityPilotAttemptLedgerTest::test_paid_attempt_metadata_reaches_the_gpt_request_config'],
        'build_scripts': ['build/scripts/test_build_voice_clone_library.py', 'build/scripts/test_daojie_ma_sync_check.py', 'build/scripts/test_mix_voice_audio.py'],
    }
    sys.path.insert(0, str(root))
    sys.exit(pytest.main(paths[mode] + ['-q']))
if mode == 'backend_unittest':
    import unittest
    suite = unittest.defaultTestLoader.discover('backend/tests')
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
if mode == 'hygiene-safe':
    import importlib.util
    scripts = root / 'apps/build/scripts'
    sys.path.insert(0, str(scripts))
    spec = importlib.util.spec_from_file_location('checked_hygiene', scripts / 'hygiene_gate.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    results = []
    for check in module.build_checks('darwin'):
        if check['name'] == 'scripts-hygiene':
            results.append({'name':check['name'], 'status':'blocked', 'reason':'scripts_hygiene.py invokes git check-ignore; user prohibits Git'})
            continue
        if check.get('skip_reason'):
            results.append({'name':check['name'], 'status':'skipped', 'reason':check['skip_reason']})
            continue
        saved = sys.argv
        sys.argv = check['cmd'][1:]
        code = 0
        try:
            runpy.run_path(str(sys.argv[0]), run_name='__main__')
        except SystemExit as error:
            code = error.code or 0
        except Exception as error:
            code = 1
            print(type(error).__name__, str(error))
        finally:
            sys.argv = saved
        results.append({'name':check['name'], 'status':'passed' if code == 0 else 'failed', 'exitCode':code})
    report = {'ok':False, 'policy':'no-git; scripts-hygiene blocked', 'checks':results}
    (root / '.trellis/tasks/10-20-trellis-audit-remediation/research/hygiene-safe-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))
    sys.exit(1 if any(x['status']=='failed' for x in results) else 78)
raise SystemExit('unknown verification domain')
