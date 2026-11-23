"""One reviewed chapter-001 request per invocation; shared 156-call ledger, no retries."""
import argparse
import json
from pathlib import Path
import sys
import director_quality_glm_1025 as common
import director_chapter001_production_audit_1027 as audit
from director_chain_acceptance_1026 import AcceptanceLedger
from director_chapter001_snapshot_1026 import verify_sources

ROOT = common.RESEARCH / 'chapter001-repair-1026'

def read_scoped(file):
    path = Path(file).resolve(strict=True)
    common.require(path.is_relative_to(ROOT.resolve()), 'input_outside_chapter_evidence')
    return common.load_json(path)

def pinned_json(file: str | Path | None, expected_sha: str | None):
    if file is None:
        raise common.HarnessError('explicit_approval_pin_required')
    common.require(file is not None and isinstance(expected_sha, str) and len(expected_sha) == 64, 'explicit_approval_pin_required')
    path = Path(file).absolute()
    common.require(not any(part.is_symlink() for part in (path, *path.parents)), 'symlink_disallowed')
    path = path.resolve(strict=True)
    common.require(path.is_relative_to(common.RESEARCH.resolve()), 'approval_outside_task')
    raw = path.read_bytes()
    common.require(common.digest(raw) == expected_sha, 'approval_hash_mismatch')
    return json.loads(raw)


def validate_boundary(prepared_file, snapshot_file, expected, approved_max_tokens, approval_file, approval_sha256):
    # The CLI SHA is the root trust pin, not a cryptographic signature.
    approval = pinned_json(approval_file, approval_sha256)
    common.require(approval.get('schemaVersion') == 'chapter001-send-approval/v1' and approval.get('operator') == 'root' and approval.get('approved') is True, 'root_send_approval_required')
    common.require(type(expected) is int and type(approval.get('expectedCalls')) is int and approval['expectedCalls'] == expected, 'approval_call_count_mismatch')
    target = audit.scoped_folder(Path(prepared_file).parent)
    common.require(Path(prepared_file).resolve(strict=True) == target / 'prepared.json', 'prepared_path_mismatch')
    common.require(Path(snapshot_file).resolve(strict=True) == target / 'snapshot.json', 'snapshot_path_mismatch')
    frozen = audit.load(target / 'freeze.json')
    stage = frozen['stage']
    common.require(stage in audit.STAGES and frozen.get('schemaVersion') == 'production-audit-1027/v1', 'invalid_freeze_stage')
    bindings = {'stage': stage, 'freezeSha256': audit.sha(target / 'freeze.json'), 'preparedSha256': audit.sha(target / 'prepared.json'), 'requestSha256': audit.sha(target / 'request.json'), 'snapshotSha256': audit.sha(target / 'snapshot.json')}
    common.require(all(approval.get(k) == v for k, v in bindings.items()), 'approval_boundary_mismatch')
    context = audit.frozen_context(frozen['helperSha256'], frozen['reviewedSnapshotPath'], frozen['snapshotSha256'])
    common.require(all(frozen.get(k) == v for k, v in audit.manifest_context(context).items()), 'prepared_context_drift')
    upstream = audit.check_upstream(stage, {name: receipt['folder'] for name, receipt in frozen['upstream'].items()}, context)
    common.require(upstream == frozen['upstream'], 'prepared_upstream_drift')
    required_files = {'job.json', 'prepared.json', 'request.json', *context['snapshotFiles'], *(name + '-corrected.md' for name in audit.STAGES), *('production-sources/' + name for name in context['productionSourceHashes'])}
    common.require(set(frozen['files']) == required_files, 'incomplete_freeze_files')
    for name, digest in frozen['files'].items():
        file = audit.scoped_folder(target / name)
        common.require(file.is_relative_to(target) and audit.sha(file) == digest, 'prepared_file_drift:' + name)
    common.require(all(frozen['files'][name] == digest for name, digest in context['snapshotFiles'].items()), 'snapshot_copy_drift')
    common.require(all(frozen['files'][name + '-corrected.md'] == context['outputs'][name] for name in audit.STAGES), 'corrected_copy_drift')
    common.require(all(frozen['files']['production-sources/' + name] == digest for name, digest in context['productionSourceHashes'].items()), 'production_copy_drift')
    common.require(audit.load(target / 'job.json') == audit.make_job(stage, context), 'prepared_job_drift')
    prepared = audit.load(target / 'prepared.json')
    request = prepared['request']
    common.require(type(request['max_tokens']) is int and 1 <= request['max_tokens'] <= approved_max_tokens, 'invalid_token_budget')
    request_sha = common.digest(common.encoded(request))
    common.require((target / 'request.json').read_bytes() == common.encoded(request) and frozen['requestSha256'] == request_sha, 'prepared_request_drift')
    common.require(prepared.get('structurePassed') is True and prepared['ipcRequest']['maxTokens'] == request['max_tokens'], 'invalid_capture')
    common.require(type(approval.get('maxTokens')) is int and approval['maxTokens'] == request['max_tokens'] and approval.get('approvedMaxTokens') == approved_max_tokens, 'approval_token_mismatch')
    common.require(frozen.get('automaticRetry') is False and type(frozen.get('maximumSendCallsThisStage')) is int and frozen['maximumSendCallsThisStage'] == 1, 'freeze_retry_policy_mismatch')
    # sendAuthorized=False is frozen metadata; only the separate pinned approval grants permission.
    identity = common.digest(common.encoded({'stage': stage, 'sourceSha256': context['sourceSha256'], 'outputSha256': context['outputs'][stage]}))
    return {'approval': approval, 'bindings': bindings, 'identity': identity, 'outputSha256': context['outputs'][stage], 'prepared': prepared, 'preparedPath': str(target / 'prepared.json'), 'approvalSha256': approval_sha256}


def verified_legacy_evidence(ledger, boundary):
    # Root must inspect all historical artifacts and separately pin this manifest.
    # Never derive legacy identity from optional, unpinned parsedText/job lookups.
    rows = [row for row in ledger.rows if row['event'] == 'attempt'
            and row['key'].startswith('chapter001-repair-1026:')
            and not any(item['event'] == 'sender-boundary' and item.get('key') == row['key'] for item in ledger.rows)]
    if not rows:
        return {}
    pin = boundary['approval'].get('legacyEvidenceManifest')
    common.require(isinstance(pin, dict) and set(pin) == {'path', 'sha256'}, 'legacy_evidence_manifest_required')
    manifest = pinned_json(pin['path'], pin['sha256'])
    common.require(isinstance(manifest, dict) and manifest.get('schemaVersion') in ('chapter001-legacy-evidence/v1', 'chapter001-legacy-evidence/v2') and manifest.get('operator') == 'root', 'invalid_legacy_evidence_manifest')
    v2 = manifest['schemaVersion'] == 'chapter001-legacy-evidence/v2'
    if v2:
        common.require(set(manifest) == {'schemaVersion', 'operator', 'attempts'}, 'invalid_legacy_evidence_manifest')
    entries = manifest.get('attempts')
    fields = {'call', 'key', 'requestSha256', 'preparedPath', 'preparedSha256', 'jobPath', 'jobSha256', 'stage', 'outputSha256'}
    if v2:
        fields |= {'operation', 'reviewedOutputPath'}
    if not isinstance(entries, list):
        raise common.HarnessError('invalid_legacy_evidence_entries')
    common.require(all(isinstance(entry, dict) and set(entry) == fields and type(entry['call']) is int for entry in entries), 'invalid_legacy_evidence_entries')
    common.require([{k: entry[k] for k in ('call', 'key', 'requestSha256')} for entry in entries] ==
                   [{k: row[k] for k in ('call', 'key', 'requestSha256')} for row in rows], 'incomplete_ordered_legacy_evidence')
    verified = {}
    for row, entry in zip(rows, entries):
        folder = audit.scoped_folder(ROOT / row['key'].split(':', 1)[1])
        common.require(isinstance(entry['preparedPath'], str) and isinstance(entry['jobPath'], str), 'invalid_legacy_evidence_paths')
        prepared_file = audit.scoped_folder(entry['preparedPath'])
        job_file = audit.scoped_folder(entry['jobPath'])
        common.require(str(prepared_file) == entry['preparedPath'] and prepared_file == folder / 'prepared.json', 'legacy_prepared_path_mismatch')
        allowed_job = job_file in (folder / 'job.json', folder.parent / 'job.json')
        if v2:
            allowed_job = allowed_job or job_file in (folder / 'script-job.json', folder.parent / 'script-job.json')
            for parent in (folder, folder.parent):
                if job_file.is_relative_to(parent):
                    parts = job_file.relative_to(parent).parts
                    allowed_job = allowed_job or (len(parts) == 3 and parts[0] == 'bridge' and parts[2] == 'input.json'
                        and len(parts[1]) == 32 and all(c in '0123456789abcdef' for c in parts[1]))
        common.require(str(job_file) == entry['jobPath'] and allowed_job, 'legacy_job_path_mismatch')
        # Check exact bytes before parsing or classifying any output identity.
        prepared_raw, job_raw = prepared_file.read_bytes(), job_file.read_bytes()
        common.require(common.digest(prepared_raw) == entry['preparedSha256'], 'legacy_prepared_drift')
        common.require(common.digest(job_raw) == entry['jobSha256'], 'legacy_job_drift')
        prepared, job = json.loads(prepared_raw), json.loads(job_raw)
        common.require(isinstance(prepared, dict) and isinstance(prepared.get('request'), dict) and isinstance(job, dict), 'invalid_legacy_artifact_shape')
        common.require(common.digest(common.encoded(prepared['request'])) == row['requestSha256'], 'legacy_request_drift')
        common.require(entry['stage'] in audit.STAGES and job.get('stage') == entry['stage'], 'legacy_stage_mismatch')
        if not v2:
            common.require(isinstance(job.get('outputText'), str) and bool(job['outputText']) and common.digest(job['outputText']) == entry['outputSha256'], 'legacy_output_drift')
        else:
            operation = entry['operation']
            common.require(operation in ('build', 'audit') and job.get('operation') == operation, 'legacy_operation_mismatch')
            if operation == 'build':
                # A generated response is never a reviewed-output identity.
                common.require(entry['outputSha256'] is None and entry['reviewedOutputPath'] is None and 'outputText' not in job, 'legacy_build_review_identity_disallowed')
                messages = prepared['request'].get('messages')
                common.require(isinstance(messages, list) and bool(messages) and isinstance(messages[0], dict) and isinstance(messages[0].get('content'), str), 'invalid_legacy_build_body')
                try:
                    build_body = json.loads(messages[0]['content'])
                except json.JSONDecodeError:
                    build_body = None
                common.require(not isinstance(build_body, dict) or 'outputToReview' not in build_body, 'legacy_build_contains_audit_identity')
            else:
                messages = prepared['request'].get('messages')
                common.require(isinstance(messages, list) and bool(messages) and isinstance(messages[0], dict) and isinstance(messages[0].get('content'), str), 'invalid_legacy_audit_body')
                body = json.loads(messages[0]['content'])
                common.require(isinstance(body, dict) and body.get('stage') == entry['stage'], 'legacy_audit_stage_mismatch')
                output = body.get('outputToReview')
                if not isinstance(output, str):
                    raise common.HarnessError('legacy_audit_output_mismatch')
                common.require(bool(output) and output == job.get('outputText'), 'legacy_audit_output_mismatch')
                common.require(isinstance(entry['reviewedOutputPath'], str), 'invalid_legacy_reviewed_path')
                output_file = audit.scoped_folder(entry['reviewedOutputPath'])
                # Reviewed files can be shared by sibling audits of this version.
                version_root = ROOT / folder.relative_to(ROOT.resolve()).parts[0]
                common.require(str(output_file) == entry['reviewedOutputPath'] and output_file.is_relative_to(version_root), 'legacy_reviewed_path_mismatch')
                output_raw = output_file.read_bytes()
                common.require(output_raw == output.encode('utf-8') and common.digest(output_raw) == entry['outputSha256'], 'legacy_reviewed_output_drift')
        verified[row['key']] = entry
    return verified


def prior_spends(ledger, boundary):
    legacy = verified_legacy_evidence(ledger, boundary)
    conflicts = []
    for row in ledger.rows:
        if row['event'] != 'attempt':
            continue
        same = row.get('requestSha256') == boundary['bindings']['requestSha256']
        metadata = next((item for item in ledger.rows if item['event'] == 'sender-boundary' and item.get('key') == row['key']), None)
        prepared_sha = None
        if metadata:
            same = same or metadata['identity'] == boundary['identity'] or metadata['freezeSha256'] == boundary['bindings']['freezeSha256']
            prepared_sha = metadata['preparedSha256']
        elif row['key'].startswith('chapter001-repair-1026:'):
            entry = legacy[row['key']]
            prepared_sha = entry['preparedSha256']
            same = same or (entry.get('operation', 'audit') == 'audit' and entry['stage'] == boundary['bindings']['stage'] and entry['outputSha256'] == boundary['outputSha256'])
        if same:
            conflicts.append({'call': row['call'], 'key': row['key'], 'requestSha256': row['requestSha256'], 'preparedSha256': prepared_sha})
    return conflicts


def spend_key(ledger, boundary):
    conflicts = prior_spends(ledger, boundary)
    replacement = boundary['approval'].get('replacementPermit')
    key = 'chapter001-reviewed-stage:' + boundary['identity']
    if conflicts:
        common.require(isinstance(replacement, dict), 'replacement_permit_required')
        permit = pinned_json(replacement['path'], replacement['sha256'])
        common.require(permit.get('schemaVersion') == 'chapter001-replacement-permit/v1' and permit.get('operator') == 'root' and permit.get('approved') is True, 'root_replacement_permit_required')
        common.require(permit.get('priorAttempts') == conflicts and permit.get('boundary') == boundary['bindings'] and permit.get('expectedCalls') == ledger.count and permit.get('maxTokens') == boundary['prepared']['request']['max_tokens'], 'replacement_permit_mismatch')
        key += ':replacement:' + replacement['sha256']
    else:
        common.require(replacement is None, 'replacement_without_prior_attempt')
    common.require(not any(row.get('key') == key for row in ledger.rows), 'attempt_already_recorded_no_retry')
    return key


def execute(prepared_file, snapshot_file, destination, expected, key, dry_run=False, approved_max_tokens=16384, approval_file=None, approval_sha256=None):
    common.require(type(approved_max_tokens) is int and approved_max_tokens in (16384, 65536), 'invalid_approved_token_cap')
    boundary = validate_boundary(prepared_file, snapshot_file, expected, approved_max_tokens, approval_file, approval_sha256)
    prepared = boundary['prepared']
    request = prepared['request']
    common.require(request['model'] == 'glm-5.3', 'model_mismatch')
    common.require(type(approved_max_tokens) is int and approved_max_tokens in (16384, 65536), 'invalid_approved_token_cap')
    common.require(type(request['max_tokens']) is int and 1 <= request['max_tokens'] <= approved_max_tokens, 'invalid_token_budget')
    common.require(isinstance(request['system'], str) and isinstance(request['messages'], list), 'invalid_request')
    common.require('tools' not in request, 'tools_disallowed')
    folder = Path(destination).resolve()
    common.require(folder.is_relative_to(ROOT.resolve()) and folder != ROOT.resolve(), 'destination_scope')
    common.require(not folder.exists(), 'destination_exists_no_retry')
    with AcceptanceLedger(common.COMPARISON / 'ledger.jsonl', expected) as ledger:
        common.require(ledger.count < 156, 'call_limit_reached')
        common.require(validate_boundary(prepared_file, snapshot_file, expected, approved_max_tokens, approval_file, approval_sha256) == boundary, 'boundary_changed_under_lock')
        attempt_key = spend_key(ledger, boundary)
        if dry_run:
            print(json.dumps({'dryRun': True, 'calls': ledger.count, 'requestSha256': common.digest(common.encoded(request)), 'projectWrites': 0}))
            return
        common.require(bool(key), 'missing_stdin_key')
        common.persist(folder / 'prepared.json', prepared)
        common.require(validate_boundary(prepared_file, snapshot_file, expected, approved_max_tokens, approval_file, approval_sha256) == boundary, 'boundary_changed_before_attempt')
        common.require(spend_key(ledger, boundary) == attempt_key, 'spend_changed_before_attempt')
        attempt = ledger.attempt(attempt_key, common.digest(common.encoded(request)))
        ledger.record({'event': 'sender-boundary', 'key': attempt['key'], 'call': attempt['call'], 'identity': boundary['identity'], **boundary['bindings'], 'preparedPath': boundary['preparedPath'], 'approvalSha256': approval_sha256})
        output, meta = common.transport(request, key, 300)
        common.persist(folder / 'output.md', output)
        common.persist(folder / 'response.json', meta)
        ledger.record({'event': 'response', 'key': attempt['key'], 'call': attempt['call'], 'status': meta['status'], 'httpStatus': meta['httpStatus'], 'systemic': meta['systemic']})
        print(json.dumps({'call': ledger.count, 'status': meta['status'], 'httpStatus': meta['httpStatus'], 'stopReason': meta['stop_reason'], 'projectWrites': 0}), flush=True)
        common.require(meta['status'] == 'received', 'request_failed_stop_no_retry')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--expected-calls', required=True, type=int)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--approved-max-tokens', type=int, choices=(16384, 65536), default=16384, help='Explicit reviewed request cap; does not authorize a model call or retry')
    parser.add_argument('--approval', required=True, help='Separately root-reviewed send approval artifact; never created here')
    parser.add_argument('--approval-sha256', required=True, help='Exact root trust pin for approval bytes; required even for dry-run')
    args = parser.parse_args()
    key = '' if args.dry_run else sys.stdin.readline().strip()
    execute(args.prepared, args.snapshot, args.destination, args.expected_calls, key, args.dry_run, args.approved_max_tokens, args.approval, args.approval_sha256)

if __name__ == '__main__':
    main()
