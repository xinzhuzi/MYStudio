"""Offline single-stage production audit prepare/parse/probe. No sender, credentials or approval creation.

Policy profile: current source deployment defaults, actual hook callback, manager and
Anthropic body builder. Persisted user binding values are deliberately not read.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
sys.dont_write_bytecode = True
from director_chapter001_snapshot_1026 import verify_sources, PROJECT_ROOT

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research'
BASE = RESEARCH / 'chapter001-repair-1026'
STAGES = ('script', 'planning', 'storyboard')
SCRIPTS = ROOT / 'apps/build/scripts'
SNAP = BASE / 'snapshot-20261026T161314424840Z'
PREFIX = 'continue-audit-tool-review-1027-'
PRODUCTION_FILES = (
    'apps/frontend/lib/studio/daojie-generation-audit.ts',
    'apps/frontend/lib/ai/ai-manager.ts',
    'apps/frontend/lib/ai/config/store-adapter.ts',
    'apps/frontend/lib/ai/text-completion.ts',
    'apps/frontend/stores/ai/api-config-agent-deployments.ts',
    'apps/frontend/components/panels/studio/useScriptStageActions.ts',
    'apps/frontend/components/panels/studio/useProductionPlanningActions.ts',
    'apps/frontend/components/panels/studio/workflow-helpers.ts',
    'apps/frontend/lib/studio/director-plan.ts',
    'apps/frontend/lib/studio/storyboard-table.ts',
    'apps/frontend/config/vite.config.ts',
    'apps/frontend/config/vitest.setup.ts',
    'apps/build/scripts/director_chapter001_snapshot_1026.py',
    'apps/build/scripts/director_chapter001_corrected_audits_1027.py',
    'apps/build/scripts/director_chapter001_protocol_audits_1027.py',
    'apps/build/scripts/director_chapter001_production_audit_1027.py',
    'apps/build/scripts/director_chapter001_production_audit_1027.capture.ts',
    'apps/build/scripts/director_chapter001_production_audit_1027.test.ts',
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def encoded(value):
    # Identical bytes to the existing root-controlled sender's common.encoded().
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def load(file):
    return json.loads(Path(file).read_bytes())


def new_json(file, value):
    with Path(file).open('xb') as stream:
        stream.write(encoded(value))


def literals(file, names):
    assignments = {}
    for node in ast.parse(Path(file).read_text(encoding='utf-8')).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in names:
            assignments[node.targets[0].id] = ast.literal_eval(node.value)
    require(set(assignments) == set(names), 'source_constants_missing')
    return assignments


def scoped_folder(folder, must_exist=True):
    file = Path(folder).absolute()
    require(not any(part.is_symlink() for part in [file, *file.parents]), 'symlink_disallowed')
    resolved = file.resolve(strict=must_exist)
    require(resolved.is_relative_to(BASE.resolve()) and resolved != BASE.resolve(), 'audit_folder_scope')
    return resolved


def frozen_context(expected_helper, snapshot_file=None, snapshot_sha256=None):
    require(snapshot_file is not None and snapshot_sha256 is not None, 'reviewed_snapshot_required')
    reviewed = scoped_folder(snapshot_file)
    require(reviewed.name == 'snapshot.json' and reviewed.is_file(), 'reviewed_snapshot_file_required')
    require(sha(reviewed) == snapshot_sha256, 'reviewed_snapshot_hash_mismatch')
    corrected = literals(SCRIPTS / 'director_chapter001_corrected_audits_1027.py', ('FILES', 'HASHES'))
    prior = literals(SCRIPTS / 'director_chapter001_protocol_audits_1027.py', ('FROZEN', 'SOURCE_SHA'))
    for name, expected in prior['FROZEN'].items():
        require(sha(SNAP / name) == expected, 'frozen_snapshot_drift:' + name)
    snapshot = load(reviewed)
    require(snapshot['sourceSha256'] == prior['SOURCE_SHA'], 'source_hash_mismatch')
    require(snapshot['input'] == load(SNAP / 'input.json'), 'snapshot_input_mismatch')
    # Verify the reviewed file list against live bytes, including the manifest.
    # Equal chapterText/sourceBible never authorizes rebuilding this snapshot.
    verify_sources(snapshot, expected_root=PROJECT_ROOT)
    helper = ROOT / PRODUCTION_FILES[0]
    require(sha(helper) == expected_helper, 'helper_hash_drift')
    texts = {}
    for stage, name in corrected['FILES'].items():
        require(sha(BASE / name) == corrected['HASHES'][stage], 'corrected_output_drift:' + stage)
        texts[stage] = (BASE / name).read_text(encoding='utf-8')
    return {
        'helperSha256': expected_helper, 'sourceSha256': snapshot['sourceSha256'],
        'snapshotSha256': snapshot_sha256, 'reviewedSnapshotPath': str(reviewed),
        'snapshotFiles': {**prior['FROZEN'], 'snapshot.json': snapshot_sha256},
        'baselineSnapshotFiles': prior['FROZEN'],
        'outputs': corrected['HASHES'], 'correctedFiles': corrected['FILES'],
        'productionSourceHashes': {name: sha(ROOT / name) for name in PRODUCTION_FILES},
        'texts': texts, 'input': snapshot['input'],
    }


def response_success(meta, text):
    return meta.get('status') == 'received' and meta.get('stop_reason') == 'end_turn' and not meta.get('error') and bool(text.strip())


def check_upstream(stage, folders, context):
    needed = STAGES[:STAGES.index(stage)]
    require(all(name in folders for name in needed), 'upstream_folder_required')
    require(set(folders) == set(needed), 'unexpected_upstream_folder')
    receipts = {}
    for upstream in needed:
        folder = scoped_folder(folders[upstream])
        decision = load(folder / 'decision.json')
        require(decision.get('passed') is True, 'upstream_model_not_passed:' + upstream)
        primary = load(folder / 'primary-review.json')
        require(primary.get('passed') is True and primary.get('reviewer') == 'root', 'root_primary_required:' + upstream)
        frozen = load(folder / 'freeze.json')
        require(frozen['stage'] == upstream, 'upstream_stage_mismatch')
        for key, value in manifest_context(context).items():
            require(frozen.get(key) == value, 'upstream_context_drift:' + key)
        require(frozen.get('upstream') == receipts, 'upstream_chain_drift')
        actual = {key: sha(folder / name) for key, name in {
            'decisionSha256': 'decision.json', 'preparedSha256': 'prepared.json',
            'wireSha256': 'send/output.md', 'responseSha256': 'send/response.json',
            'freezeSha256': 'freeze.json',
        }.items()}
        parsed = load(folder / 'parse-receipt.json')
        for key, value in actual.items():
            require(parsed.get(key) == value, 'upstream_receipt_hash_mismatch:' + key)
            require(primary.get(key) == value, 'upstream_primary_hash_mismatch:' + key)
        require(primary.get('parseReceiptSha256') == sha(folder / 'parse-receipt.json'), 'upstream_primary_hash_mismatch:parseReceiptSha256')
        require(parsed.get('upstream') == receipts, 'upstream_chain_drift')
        for key in ('helperSha256', 'sourceSha256', 'snapshotSha256'):
            require(primary.get(key) == context[key], 'upstream_primary_hash_mismatch:' + key)
        require(primary.get('outputSha256') == context['outputs'][upstream], 'upstream_primary_output_mismatch')
        require(parsed.get('helperSha256') == context['helperSha256'], 'upstream_receipt_helper_drift')
        require(response_success(load(folder / 'send/response.json'), (folder / 'send/output.md').read_text()), 'upstream_response_not_complete')
        receipts[upstream] = {'folder': str(folder), **actual, 'primarySha256': sha(folder / 'primary-review.json'), 'freezeSha256': sha(folder / 'freeze.json'), 'parseReceiptSha256': sha(folder / 'parse-receipt.json')}
    return receipts


def bridge(job):
    tag = PREFIX + 'bridge-' + uuid.uuid4().hex
    input_file, output_file = RESEARCH / (tag + '-input.json'), RESEARCH / (tag + '-output.json')
    new_json(input_file, job)
    # Only the process execution environment is forwarded, never any caller credential env.
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL') if key in os.environ}
    env.update(DIRECTOR_PRODUCTION_AUDIT_INPUT=str(input_file), DIRECTOR_PRODUCTION_AUDIT_OUTPUT=str(output_file))
    command = ['npm', 'test', '--', 'build/scripts/director_chapter001_production_audit_1027.test.ts', '--maxWorkers', '1']
    run = subprocess.run(command, cwd=ROOT / 'apps', env=env, capture_output=True, text=True, timeout=180)
    new_json(RESEARCH / (tag + '-vitest.json'), {'command': command, 'cwd': 'apps', 'exitCode': run.returncode, 'stdout': run.stdout, 'stderr': run.stderr})
    require(run.returncode == 0, 'offline_bridge_failed:' + tag)
    return load(output_file), {'input': str(input_file), 'output': str(output_file), 'log': str(RESEARCH / (tag + '-vitest.json'))}


def make_job(stage, context):
    return {'stage': stage, 'input': context['input'], 'scriptText': context['texts']['script'], 'planRaw': context['texts']['planning'], 'outputText': context['texts'][stage]}


def manifest_context(context):
    return {key: value for key, value in context.items() if key not in ('texts', 'input', 'liveSnapshot')}


def execute(operation, stage, folder, helper_sha256, upstream=None, capture=bridge, snapshot_file=None, snapshot_sha256=None):
    context = frozen_context(helper_sha256, snapshot_file, snapshot_sha256)
    upstream = upstream or {}
    checked = check_upstream(stage, upstream, context)
    job = make_job(stage, context)
    if operation == 'probe':
        prepared, evidence = capture(job)
        require(frozen_context(helper_sha256, snapshot_file, snapshot_sha256) == context, 'context_changed_during_probe')
        return {'stage': stage, 'snapshotSha256': context['snapshotSha256'], 'evidence': evidence, 'maxTokens': prepared['request']['max_tokens'], 'temperature': prepared['request'].get('temperature'), 'thinking': prepared['request'].get('thinking'), 'ipcUndefinedKeys': prepared['ipcUndefinedKeys'], 'networkCalls': 0, 'projectWrites': 0}
    target = scoped_folder(folder, must_exist=operation == 'parse')
    if operation == 'prepare':
        require(not target.exists(), 'audit_directory_exists_no_retry')
        require(target.parent == BASE.resolve(), 'new_audit_folder_must_be_direct_child')
        prepared, evidence = capture(job)
        require(prepared.get('structurePassed') is True, 'production_structure_rejected')
        require(prepared['request']['max_tokens'] == prepared['ipcRequest']['maxTokens'], 'captured_token_drift')
        require(prepared['request']['model'] == 'glm-5.3', 'captured_model_mismatch')
        if stage == 'storyboard':
            require(prepared.get('totalDurationSeconds') == 180 and len(prepared['parsed']['rows']) == 18 and not prepared['parsed']['errors'], 'corrected_storyboard_not_18_rows_180_seconds')
        require(frozen_context(helper_sha256, snapshot_file, snapshot_sha256) == context and check_upstream(stage, upstream, context) == checked, 'context_changed_during_prepare')
        target.mkdir(exist_ok=False)
        new_json(target / 'job.json', job)
        new_json(target / 'prepared.json', prepared)
        with (target / 'request.json').open('xb') as stream:
            stream.write(encoded(prepared['request']))
        copied = {}
        with Path(context['reviewedSnapshotPath']).open('rb') as source, (target / 'snapshot.json').open('xb') as destination:
            shutil.copyfileobj(source, destination)
        copied['snapshot.json'] = sha(target / 'snapshot.json')
        for name in ('input.json', 'manuals.json'):
            with (SNAP / name).open('rb') as source, (target / name).open('xb') as destination:
                shutil.copyfileobj(source, destination)
            copied[name] = sha(target / name)
        for name in STAGES:
            destination = target / (name + '-corrected.md')
            with destination.open('xb') as stream:
                stream.write((BASE / context['correctedFiles'][name]).read_bytes())
            copied[destination.name] = sha(destination)
        for relative in PRODUCTION_FILES:
            destination = target / 'production-sources' / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as stream:
                stream.write((ROOT / relative).read_bytes())
            copied[str(destination.relative_to(target))] = sha(destination)
        copied.update({name: sha(target / name) for name in ('job.json', 'prepared.json', 'request.json')})
        require(all(copied[name] == value for name, value in context['snapshotFiles'].items()), 'snapshot_changed_while_copying')
        require(all(copied[name + '-corrected.md'] == context['outputs'][name] for name in STAGES), 'corrected_text_changed_while_copying')
        require(all(copied['production-sources/' + name] == value for name, value in context['productionSourceHashes'].items()), 'source_changed_while_copying')
        require(frozen_context(helper_sha256, snapshot_file, snapshot_sha256) == context and check_upstream(stage, upstream, context) == checked, 'context_changed_before_seal')
        new_json(target / 'freeze.json', {'schemaVersion': 'production-audit-1027/v1', 'stage': stage, **manifest_context(context), 'files': copied, 'upstream': checked, 'captureEvidence': evidence, 'requestSha256': hashlib.sha256(encoded(prepared['request'])).hexdigest(), 'automaticRetry': False, 'maximumSendCallsThisStage': 1, 'sendAuthorized': False, 'networkCalls': 0, 'projectWrites': 0})
        return {'stage': stage, 'folder': str(target), 'preparedSha256': sha(target / 'prepared.json'), 'freezeSha256': sha(target / 'freeze.json'), 'requestSha256': sha(target / 'request.json'), 'maxTokens': prepared['request']['max_tokens'], 'sendAuthorized': False, 'networkCalls': 0, 'projectWrites': 0}
    require(operation == 'parse', 'invalid_operation')
    require(not any((target / name).exists() for name in ('decision.json', 'parsed-audit.json', 'report.md', 'parse-receipt.json')), 'parse_exists_no_retry')
    freeze_sha256 = sha(target / 'freeze.json')
    frozen = load(target / 'freeze.json')
    require(frozen['stage'] == stage and all(frozen.get(key) == value for key, value in manifest_context(context).items()), 'prepared_context_drift')
    require(frozen['upstream'] == checked, 'prepared_upstream_drift')
    for name, expected in frozen['files'].items():
        file = (target / name).resolve(strict=True)
        require(file.is_relative_to(target) and sha(file) == expected, 'prepared_file_drift:' + name)
    require(load(target / 'job.json') == job, 'prepared_job_drift')
    sent = load(target / 'send/prepared.json')
    require(sent == load(target / 'prepared.json'), 'sent_request_differs_from_prepared')
    wire, metadata = target / 'send/output.md', target / 'send/response.json'
    original = {'wireSha256': sha(wire), 'responseSha256': sha(metadata), 'sentPreparedSha256': sha(target / 'send/prepared.json')}
    text, meta = wire.read_text(encoding='utf-8'), load(metadata)
    parsed, evidence = capture({**job, 'operation': 'parse', 'response': {'success': response_success(meta, text), 'text': text, 'error': meta.get('error') or (None if response_success(meta, text) else 'transport_terminal_rejected')}})
    review = parsed['review']
    require(isinstance(review.get('passed'), bool) and isinstance(review.get('report'), str), 'invalid_production_review')
    require(response_success(meta, text) or not review['passed'], 'failed_transport_cannot_pass')
    require(frozen_context(helper_sha256, snapshot_file, snapshot_sha256) == context and check_upstream(stage, upstream, context) == checked, 'context_changed_during_parse')
    require(original == {'wireSha256': sha(wire), 'responseSha256': sha(metadata), 'sentPreparedSha256': sha(target / 'send/prepared.json')}, 'original_wire_changed_during_parse')
    for name, expected in frozen['files'].items():
        require(sha(target / name) == expected, 'prepared_changed_during_parse:' + name)
    require(sha(target / 'freeze.json') == freeze_sha256, 'freeze_changed_during_parse')
    new_json(target / 'parsed-audit.json', parsed)
    new_json(target / 'decision.json', review)
    with (target / 'report.md').open('x', encoding='utf-8') as stream:
        stream.write(review['report'])
    new_json(target / 'parse-receipt.json', {**original, 'preparedSha256': sha(target / 'prepared.json'), 'decisionSha256': sha(target / 'decision.json'), 'freezeSha256': sha(target / 'freeze.json'), 'upstream': checked, 'helperSha256': helper_sha256, 'sourceSha256': context['sourceSha256'], 'snapshotSha256': context['snapshotSha256'], 'captureEvidence': evidence, 'networkCalls': 0, 'projectWrites': 0})
    return {'stage': stage, 'folder': str(target), 'passed': review['passed'], 'networkCalls': 0, 'projectWrites': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('prepare', 'parse', 'probe'))
    parser.add_argument('stage', choices=STAGES)
    parser.add_argument('--folder', type=Path, help='new direct child of chapter001-repair-1026; required for prepare/parse')
    parser.add_argument('--helper-sha256', required=True, help='reviewed exact production helper hash')
    parser.add_argument('--snapshot', type=Path, required=True, help='ROOT-reviewed immutable snapshot.json inside chapter001 evidence')
    parser.add_argument('--snapshot-sha256', required=True, help='Exact reviewed snapshot bytes; live source hash drift rejects all operations')
    parser.add_argument('--upstream-script', type=Path)
    parser.add_argument('--upstream-planning', type=Path)
    args = parser.parse_args()
    if args.operation != 'probe' and args.folder is None:
        parser.error('--folder required for prepare/parse')
    upstream = {name: value for name, value in {'script': args.upstream_script, 'planning': args.upstream_planning}.items() if value is not None}
    print(json.dumps(execute(args.operation, args.stage, args.folder, args.helper_sha256, upstream, snapshot_file=args.snapshot, snapshot_sha256=args.snapshot_sha256), ensure_ascii=False))


if __name__ == '__main__':
    main()
