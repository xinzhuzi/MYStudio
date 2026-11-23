"""Prepare/parse indexed-kind-table audits offline; never sends a request."""
import argparse
import hashlib
import json
from pathlib import Path
import director_chain_glm_1026 as chain
import director_chapter001_corrected_audits_1027 as corrected
from director_chapter001_snapshot_1026 import verify_sources

ROOT = Path(__file__).resolve().parents[3]
BASE = corrected.BASE
FILES = dict(corrected.FILES)
HASHES = dict(corrected.HASHES)
SOURCE_SHA = '79da99d9390a71010fa4a6b7949de19a6b963c549c0988d59ad784894bf7587b'
PROTOCOL = 'indexed-kind-table-v1'
HELPER = ROOT / 'apps/frontend/lib/studio/daojie-generation-audit.ts'
SNAP = BASE / 'snapshot-20261026T161314424840Z'
FROZEN = {'snapshot.json': 'ff124c79063216dc6669a034c858928aaecec51b84103ca77f2418a54e04be0f', 'input.json': '013a77dd0c6c88cdc32ce72f79c3c0d7ed99676b361361b6b0002bc783ee60bf', 'manuals.json': '83df183c4411a770976c30c09f1167abaebb177df94d89cefd34a111b5586f62'}


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def load(file):
    return json.loads(file.read_text(encoding='utf-8'))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def new_json(file, value):
    with file.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def helper_hash():
    return sha(HELPER)


def folder_for(stage):
    return (BASE / FILES[stage]).parent / 'audit-kind-table-v1'


def frozen_context():
    for name, expected in FROZEN.items():
        require(sha(SNAP / name) == expected, 'frozen_snapshot_drift:' + name)
    snapshot = load(SNAP / 'snapshot.json')
    require(snapshot['sourceSha256'] == SOURCE_SHA, 'source_hash_mismatch')
    verify_sources(snapshot)
    texts = {}
    for stage, name in FILES.items():
        require(sha(BASE / name) == HASHES[stage], 'corrected_output_drift:' + stage)
        texts[stage] = (BASE / name).read_text(encoding='utf-8')
    job = load(BASE / 'storyboard-v2/audit-v2/job.json')
    require(job['input'] == load(SNAP / 'input.json'), 'job_input_drift')
    require(job['manualFiles'] == load(SNAP / 'manuals.json'), 'job_manual_drift')
    return texts, job, snapshot, dict(FROZEN)


def check_upstream(stage):
    receipts = {}
    for upstream in list(FILES)[:list(FILES).index(stage)]:
        folder = folder_for(upstream)
        decision = load(folder / 'decision.json')
        primary = load(folder / 'primary-review.json')
        require(decision.get('passed') is True, 'upstream_model_not_passed:' + upstream)
        require(primary.get('passed') is True and primary.get('reviewer') == 'root', 'root_primary_required:' + upstream)
        require(primary.get('outputSha256') == HASHES[upstream], 'primary_output_hash_mismatch:' + upstream)
        require(primary.get('sourceSha256') == SOURCE_SHA, 'primary_source_hash_mismatch:' + upstream)
        require(primary.get('decisionSha256') == sha(folder / 'decision.json'), 'primary_decision_hash_mismatch:' + upstream)
        receipts[upstream] = {name: sha(folder / name) for name in ('decision.json', 'primary-review.json')}
    return receipts


def execute(operation, stage, expected_helper_sha256, bridge=chain.bridge):
    require(helper_hash() == expected_helper_sha256, 'helper_hash_drift')
    folder = folder_for(stage)
    if operation == 'prepare':
        require(not folder.exists(), 'audit_directory_exists_no_retry')
    else:
        require(not any((folder / name).exists() for name in ('decision.json', 'parsed-audit.json', 'report.md')), 'parse_exists_no_retry')
    texts, original, snapshot, frozen = frozen_context()
    upstream = check_upstream(stage)
    job = dict(original, operation='audit', stage=stage, scriptText=texts['script'], planRaw=texts['planning'], outputText=texts[stage])
    # Existing bridge writes only new, task-scoped UUID evidence directories.
    chain.ROOT = BASE.parent / 'chapter001-protocol-audit-runner-1027-bridge'
    if operation == 'prepare':
        prepared = bridge(job)
        require(prepared.get('structurePassed') is True, 'production_structure_rejected')
        request = prepared['request']
        require(PROTOCOL in json.dumps(request, ensure_ascii=False), 'production_protocol_not_ready')
        if stage == 'storyboard':
            require(prepared.get('totalDurationSeconds') == 180, 'production_duration_not_180')
            require(len(prepared['parsed']['rows']) == 18 and not prepared['parsed']['errors'], 'production_storyboard_not_18_valid_rows')
        require(helper_hash() == expected_helper_sha256, 'helper_changed_during_prepare')
        require(frozen_context()[3] == frozen and check_upstream(stage) == upstream, 'inputs_changed_during_prepare')
        folder.mkdir(exist_ok=False)
        new_json(folder / 'job.json', job)
        new_json(folder / 'prepared.json', prepared)
        new_json(folder / 'protocol.json', {'protocolVersion': PROTOCOL, 'helperSha256': expected_helper_sha256,
            'sourceSha256': SOURCE_SHA, 'outputs': HASHES, 'frozen': frozen, 'upstream': upstream,
            'jobSha256': sha(folder / 'job.json'), 'preparedSha256': sha(folder / 'prepared.json'),
            'initialCumulativeCalls': 135, 'ceiling': 156, 'maximumSendCallsThisSlice': 3,
            'maximumSendCallsThisStage': 1, 'expectedCallsBeforeSend': 135 + list(FILES).index(stage),
            'automaticRetry': False, 'networkCalls': 0, 'projectWrites': 0})
        return {'stage': stage, 'folder': str(folder), 'networkCalls': 0}
    protocol = load(folder / 'protocol.json')
    require(protocol['helperSha256'] == expected_helper_sha256 and protocol['protocolVersion'] == PROTOCOL, 'parse_helper_or_protocol_drift')
    require(protocol['outputs'] == HASHES and protocol['frozen'] == frozen and protocol['upstream'] == upstream, 'prepared_context_drift')
    require(sha(folder / 'job.json') == protocol['jobSha256'] and load(folder / 'job.json') == job, 'prepared_job_drift')
    require(sha(folder / 'prepared.json') == protocol['preparedSha256'], 'prepared_request_drift')
    wire = folder / 'send/output.md'
    metadata = folder / 'send/response.json'
    wire_hash, metadata_hash = sha(wire), sha(metadata)
    meta = load(metadata)
    parsed = bridge(dict(job, operation='parse-audit', reviewText=wire.read_text(encoding='utf-8'), responseSuccess=meta['status'] == 'received', responseError=meta.get('error')))
    require(helper_hash() == expected_helper_sha256, 'helper_changed_during_parse')
    require(frozen_context()[3] == frozen and check_upstream(stage) == upstream, 'inputs_changed_during_parse')
    require(sha(wire) == wire_hash and sha(metadata) == metadata_hash, 'wire_changed_during_parse')
    review = parsed['review']
    require(isinstance(review.get('passed'), bool) and isinstance(review.get('report'), str), 'invalid_production_review')
    new_json(folder / 'parsed-audit.json', parsed)
    with (folder / 'report.md').open('x', encoding='utf-8') as stream:
        stream.write(review['report'])
    new_json(folder / 'decision.json', review)
    new_json(folder / 'parse-receipt.json', {'helperSha256': expected_helper_sha256, 'wireSha256': wire_hash, 'responseSha256': metadata_hash, 'decisionSha256': sha(folder / 'decision.json'), 'networkCalls': 0, 'projectWrites': 0})
    return {'stage': stage, 'passed': review['passed'], 'folder': str(folder), 'networkCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('prepare', 'parse'))
    parser.add_argument('stage', choices=tuple(FILES))
    parser.add_argument('--helper-sha256', required=True, help='Exact reviewed production helper hash; refuse any drift')
    args = parser.parse_args()
    print(json.dumps(execute(args.operation, args.stage, args.helper_sha256), ensure_ascii=False))


if __name__ == '__main__':
    main()
