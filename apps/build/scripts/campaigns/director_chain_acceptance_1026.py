"""Authorized +42 acceptance: one stage at a time, no retries, no project writes."""
import argparse
from collections import Counter
import fcntl
import json
import os
from pathlib import Path
import sys
import time
import director_quality_glm_1025 as old
import director_chain_glm_1026 as chain

ROOT = old.COMPARISON / 'acceptance-42-1026'
CASES = ('P5', 'R3', 'P1', 'P3', 'R1', 'R2', 'R5')
CEILING = 156
START = 114

class AcceptanceLedger:
    def __init__(self, path, expected):
        self.path, self.expected = Path(path), expected
    def __enter__(self):
        self.stream = self.path.open('a+', encoding='utf-8')
        try:
            fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stream.seek(0)
            self.rows = [json.loads(line) for line in self.stream if line.strip()]
            calls = [row['call'] for row in self.rows if row['event'] in ('probe', 'attempt')]
            old.require(calls == list(range(1, len(calls) + 1)), 'ledger_sequence_invalid')
            old.require(self.count == self.expected and START <= self.count <= CEILING, 'unexpected_call_count')
            attempts = [row['key'] for row in self.rows if row['event'] == 'attempt']
            responses = [row['key'] for row in self.rows if row['event'] == 'response']
            old.require(len(set(attempts)) == len(attempts), 'duplicate_attempt')
            old.require(Counter(attempts) == Counter(responses), 'unfinished_attempt_no_retry')
            old.require(not any(row.get('systemic') for row in self.rows), 'systemic_failure_requires_review')
            return self
        except BaseException:
            self.stream.close()
            raise
    def __exit__(self, *unused):
        self.stream.close()
    @property
    def count(self):
        return sum(row['event'] in ('probe', 'attempt') for row in self.rows)
    def record(self, value):
        self.stream.seek(0, os.SEEK_END)
        self.stream.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + '\n')
        self.stream.flush()
        os.fsync(self.stream.fileno())
        self.rows.append(value)
    def attempt(self, key, request_hash):
        old.require(self.count < CEILING, 'call_limit_reached')
        old.require(not any(row.get('key') == key for row in self.rows), 'attempt_already_recorded_no_retry')
        row = {'event': 'attempt', 'key': key, 'call': self.count + 1, 'requestSha256': request_hash, 'timestamp': time.time()}
        self.record(row)
        return row

def bridge(job):
    chain.ROOT = ROOT
    return chain.bridge(job)

def prepare():
    old.require(not (ROOT / 'experiment.json').exists(), 'experiment_exists_no_overwrite')
    _, references = old.load_sources(old.RESEARCH / 'model-source-locations-canonical.json')
    hashes = old.load_json(old.RESEARCH / 'chain-final-production-source-hashes.json')
    old.require(all(old.digest((old.REPO / file).read_bytes()) == digest for file, digest in hashes.items()), 'production_source_drift')
    manuals = old.load_json(old.COMPARISON / 'chain-v10/manuals.json')
    old.require(all(old.digest((old.REPO / 'apps/frontend/assets/studio-manuals' / item['relativePath']).read_bytes()) == item['sha256'] for item in manuals), 'manual_drift')
    inputs = {}
    for case in CASES:
        value = old.load_json(chain.FROZEN / case / 'revised/sample-001/input-manifest.json')
        for field, hash_field in (('chapterText', 'inputSha256'), ('bibleContext', 'bibleSha256'), ('scopeConstraint', 'scopeSha256')):
            old.require(old.digest(value[field]) == value[hash_field], 'input_hash_mismatch')
        inputs[case] = value
    files = list(hashes) + ['apps/build/scripts/director_chain_requests_1026.test.ts', 'apps/build/scripts/director_chain_acceptance_1026.py']
    lock = {'initialCalls': START, 'maxCalls': CEILING, 'firstBatch': list(CASES[:2]), 'secondBatch': list(CASES[2:]), 'sourceReferences': references, 'model': 'glm-5.3', 'noRetry': True, 'realProjectWrites': False, 'codeHashes': {file: old.digest((old.REPO / file).read_bytes()) for file in files}}
    old.persist(ROOT / 'manuals.json', manuals)
    for case, value in inputs.items(): old.persist(ROOT / 'inputs' / (case + '.json'), value)
    # Probe builders before any network request, without storing credentials.
    result = bridge({'operation': 'build', 'stage': 'script', 'input': inputs['P5'], 'manualFiles': manuals})
    old.require(result['request']['model'] == 'glm-5.3', 'unexpected_model')
    old.persist(ROOT / 'experiment.json', lock)
    print(json.dumps({'prepared': True, 'apiCalls': 0, 'cases': len(inputs), 'sourceReferences': references}))

def require_primary(case, stage):
    folder = ROOT / 'chains' / case / stage
    audit = old.load_json(folder / 'audit/decision.json')
    primary = old.load_json(folder / 'primary-review.json')
    old.require(audit['passed'] is True and primary['passed'] is True, 'upstream_or_batch_primary_failed')
    old.require(primary['outputSha256'] == old.digest((folder / 'generation/output.md').read_bytes()), 'primary_output_hash_mismatch')
    return folder

def check_dependencies(case, stage):
    if case in CASES[2:]:
        for first in CASES[:2]:
            for prior in old.STAGES: require_primary(first, prior)
    index = old.STAGES.index(stage)
    values = {'scriptText': '', 'planRaw': ''}
    for prior in old.STAGES[:index]:
        folder = require_primary(case, prior)
        values['scriptText' if prior == 'script' else 'planRaw'] = (folder / 'generation/output.md').read_text()
    return values

def send(folder, prepared, ledger, key):
    old.persist(folder / 'prepared.json', prepared)
    attempt = ledger.attempt(ROOT.name + ':' + str(folder.relative_to(ROOT)), old.digest(old.encoded(prepared['request'])))
    text, metadata = old.transport(prepared['request'], key, 300)
    old.persist(folder / 'output.md', text)
    old.persist(folder / 'response.json', metadata)
    ledger.record({'event': 'response', 'key': attempt['key'], 'call': attempt['call'], 'status': metadata['status'], 'httpStatus': metadata['httpStatus'], 'systemic': metadata['systemic']})
    print(json.dumps({'stage': str(folder.relative_to(ROOT)), 'status': metadata['status'], 'calls': ledger.count}), flush=True)
    return text, metadata

def execute(case, stage, expected, key):
    lock = old.load_json(ROOT / 'experiment.json')
    old.require(all(old.digest((old.REPO / file).read_bytes()) == digest for file, digest in lock['codeHashes'].items()), 'frozen_code_drift')
    old.load_sources(old.RESEARCH / 'model-source-locations-canonical.json')
    folder = ROOT / 'chains' / case / stage
    old.require(not folder.exists(), 'stage_started_no_retry')
    upstream = check_dependencies(case, stage)
    job = {'operation': 'build', 'stage': stage, 'input': old.load_json(ROOT / 'inputs' / (case + '.json')), 'manualFiles': old.load_json(ROOT / 'manuals.json'), **upstream}
    with AcceptanceLedger(old.COMPARISON / 'ledger.jsonl', expected) as ledger:
        batch_attempts = sum(row['event'] == 'attempt' and row['key'].startswith(ROOT.name + ':chains/' + c + '/') for row in ledger.rows for c in (CASES[:2] if case in CASES[:2] else CASES[2:]))
        old.require(batch_attempts + 2 <= (12 if case in CASES[:2] else 30), 'batch_budget_exhausted')
        output, meta = send(folder / 'generation', bridge(job), ledger, key)
        passed, reason = False, 'generation_failed_or_truncated'
        if meta['status'] == 'received':
            sentinel = 'OFFLINE_PREFLIGHT_CALLBACK_REACHED'
            audit_job = {**job, 'outputText': output, 'operation': 'parse-audit', 'reviewText': sentinel, 'responseSuccess': False, 'responseError': sentinel}
            preflight = bridge(audit_job)
            old.persist(folder / 'preflight.json', preflight)
            deterministic_clear = sentinel in preflight['review']['report'] and preflight['structurePassed']
            if deterministic_clear:
                request = bridge({**job, 'outputText': output, 'operation': 'audit'})
                review_text, review_meta = send(folder / 'audit', request, ledger, key)
                reviewed = bridge({**audit_job, 'reviewText': review_text, 'responseSuccess': review_meta['status'] == 'received', 'responseError': review_meta.get('error')})
                decision = reviewed['review']
                old.persist(folder / 'audit/decision.json', decision)
                passed = decision['passed']
                reason = 'awaiting_primary_review' if passed else 'model_audit_rejected'
            else:
                reason = 'deterministic_preflight_rejected'
                old.persist(folder / 'audit/decision.json', {'passed': False, 'reason': reason, 'report': preflight['review']['report'], 'structurePassed': preflight['structurePassed'], 'parsed': preflight.get('parsed')})
        old.persist(folder / 'stage-status.json', {'passedModelAndStructure': passed, 'reason': reason, 'calls': ledger.count, 'primaryReviewRequiredBeforeDownstream': True, 'realMediaGeneration': False})
        print(json.dumps({'case': case, 'stage': stage, 'passedModelAndStructure': passed, 'reason': reason, 'calls': ledger.count}), flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare', action='store_true')
    mode.add_argument('--run-stage', action='store_true')
    parser.add_argument('--case', choices=CASES)
    parser.add_argument('--stage', choices=old.STAGES)
    parser.add_argument('--expected-calls', type=int)
    args = parser.parse_args()
    if args.prepare: return prepare()
    old.require(args.case is not None and args.stage is not None and args.expected_calls is not None, 'stage_arguments_required')
    key = sys.stdin.readline().strip()
    old.require(bool(key), 'missing_in_memory_key')
    execute(args.case, args.stage, args.expected_calls, key)

if __name__ == '__main__':
    main()
