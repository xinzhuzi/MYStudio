"""Offline request budget guards: no live ledger, credentials, transport or project writes."""
import importlib.util
import json
import tempfile
from contextlib import ExitStack
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.dont_write_bytecode = True
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('chapter001_send_under_test', SCRIPTS / 'director_chapter001_send_1026.py')
assert spec is not None and spec.loader is not None
sender = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sender)


class SenderBudgetTests(unittest.TestCase):
    def setUp(self):
        import director_chapter001_snapshot_1026 as snapshots
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        research = sender.common.RESEARCH
        self.root = Path(tempfile.mkdtemp(dir=research, prefix='continue-sender-enforcement-1027-fixture-')).resolve()
        self.base = self.root / 'evidence'; self.base.mkdir()
        self.snap = self.base / 'baseline'; self.snap.mkdir()
        scripts = self.root / 'scripts'; scripts.mkdir()
        self.project = self.root / 'project'; self.store = self.project / 'store/studio-workflow'; self.store.mkdir(parents=True)
        self.put(self.store / 'manifest.json', {'layout': 'studio-workflow-shards-v1', 'version': 1, 'activeChapterId': 'chapter-001', 'chapterIndex': [{'id': 'chapter-001'}], 'shards': ['core.json']})
        self.put(self.store / 'core.json', {'version': 1, 'state': {'seriesBible': {'projectId': snapshots.PROJECT_ID}, 'sourceBible': 'bible', 'novelChapters': [{'id': 'chapter-001', 'title': 'chapter', 'revision': 1, 'sourceId': 'fixture', 'sourceText': 'source'}]}})
        snapshot = snapshots.collect_snapshot(self.project, expected_root=self.project)
        self.put(self.snap / 'snapshot.json', snapshot); self.put(self.snap / 'input.json', snapshot['input']); self.put(self.snap / 'manuals.json', [])
        self.texts = {stage: stage + ' corrected offline' for stage in sender.audit.STAGES}
        outputs = {}
        for stage, text in self.texts.items():
            (self.base / (stage + '.md')).write_text(text); outputs[stage] = sender.audit.sha(self.base / (stage + '.md'))
        self.helper = self.root / 'helper.ts'; self.helper.write_text('offline helper')
        (scripts / 'director_chapter001_corrected_audits_1027.py').write_text('FILES = ' + repr({s: s + '.md' for s in sender.audit.STAGES}) + '\nHASHES = ' + repr(outputs))
        (scripts / 'director_chapter001_protocol_audits_1027.py').write_text('FROZEN = ' + repr({n: sender.audit.sha(self.snap / n) for n in ('snapshot.json', 'input.json', 'manuals.json')}) + '\nSOURCE_SHA = ' + repr(snapshot['sourceSha256']))
        for name, value in {'ROOT': self.root, 'BASE': self.base, 'SNAP': self.snap, 'SCRIPTS': scripts, 'PRODUCTION_FILES': ('helper.ts',), 'PROJECT_ROOT': self.project}.items():
            self.stack.enter_context(patch.object(sender.audit, name, value))
        self.stack.enter_context(patch.object(sender, 'ROOT', self.base))
        self.folder = self.base / 'reviewed-script'; self.folder.mkdir()
        self.ledger = sender.AcceptanceLedger('never-opened', 136)
        self.ledger.rows = [{'event': 'probe', 'call': n} for n in range(1, 137)]
        self.ledger.record = lambda row: self.ledger.rows.append(row)
        manager = MagicMock(); manager.__enter__.return_value = self.ledger
        self.manager = manager
        self.stack.enter_context(patch.object(sender, 'AcceptanceLedger', return_value=manager))
        self.transport = self.stack.enter_context(patch.object(sender.common, 'transport', return_value=('offline response', {'status': 'received', 'httpStatus': 200, 'systemic': False, 'stop_reason': 'end_turn'})))
        self.stack.enter_context(patch('builtins.print'))
        self.stack.enter_context(patch('socket.socket', side_effect=AssertionError('network_forbidden')))
        self.seal(16384)

    def put(self, file, value):
        file.write_bytes(sender.common.encoded(value))

    def seal(self, tokens):
        audit = sender.audit
        context = audit.frozen_context(audit.sha(self.helper), self.snap / 'snapshot.json', audit.sha(self.snap / 'snapshot.json'))
        self.put(self.folder / 'job.json', audit.make_job('script', context))
        self.put(self.folder / 'prepared.json', {'structurePassed': True, 'ipcRequest': {'maxTokens': tokens}, 'request': {'model': 'glm-5.3', 'max_tokens': tokens, 'system': 'offline', 'messages': []}})
        self.put(self.folder / 'request.json', audit.load(self.folder / 'prepared.json')['request'])
        copied = {}
        for name in context['snapshotFiles']:
            (self.folder / name).write_bytes((self.snap / name).read_bytes()); copied[name] = audit.sha(self.folder / name)
        for stage in audit.STAGES:
            name = stage + '-corrected.md'; (self.folder / name).write_text(self.texts[stage]); copied[name] = audit.sha(self.folder / name)
        file = self.folder / 'production-sources/helper.ts'; file.parent.mkdir(exist_ok=True)
        file.write_bytes(self.helper.read_bytes()); copied['production-sources/helper.ts'] = audit.sha(file)
        copied.update({name: audit.sha(self.folder / name) for name in ('job.json', 'prepared.json', 'request.json')})
        self.put(self.folder / 'freeze.json', {'schemaVersion': 'production-audit-1027/v1', 'stage': 'script', **audit.manifest_context(context), 'files': copied, 'upstream': {}, 'requestSha256': audit.sha(self.folder / 'request.json'), 'automaticRetry': False, 'maximumSendCallsThisStage': 1, 'sendAuthorized': False})
        self.approval = self.root / 'offline-approval-fixture.json'
        self.approval_data = {'schemaVersion': 'chapter001-send-approval/v1', 'operator': 'root', 'approved': True, 'stage': 'script', 'expectedCalls': 136, 'maxTokens': tokens, 'approvedMaxTokens': 65536 if type(tokens) is int and tokens > 16384 else 16384, **{key: audit.sha(self.folder / name) for key, name in {'freezeSha256': 'freeze.json', 'preparedSha256': 'prepared.json', 'requestSha256': 'request.json', 'snapshotSha256': 'snapshot.json'}.items()}}
        self.put(self.approval, self.approval_data); self.pin = audit.sha(self.approval)

    def call(self, **kwargs):
        options = {'approval_file': self.approval, 'approval_sha256': self.pin, 'approved_max_tokens': self.approval_data['approvedMaxTokens']}
        options.update(kwargs)
        sender.execute(self.folder / 'prepared.json', self.folder / 'snapshot.json', self.base / ('send-' + str(self.ledger.count)), self.ledger.count, 'offline-dummy', **options)

    def invoke(self, tokens, **kwargs):
        self.seal(tokens)
        # Budget checks retain their prior default, independently of approval fixture.
        approved = kwargs.pop('approved_max_tokens', 16384)
        if type(approved) is not int or type(tokens) is not int or not 1 <= tokens <= approved:
            self.approval_data['approvedMaxTokens'] = approved
            self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)
        self.call(dry_run=True, approved_max_tokens=approved, **kwargs)
        self.assertEqual(self.ledger.count, 136)
        self.transport.assert_not_called()

    def test_64k_requires_explicit_reviewed_cap(self):
        with self.assertRaisesRegex(sender.common.HarnessError, 'invalid_token_budget'):
            self.invoke(65536)
        self.invoke(65536, approved_max_tokens=65536)

    def test_existing_16k_guard_stays_default(self):
        self.invoke(16384)
        with self.assertRaisesRegex(sender.common.HarnessError, 'invalid_token_budget'):
            self.invoke(16385)

    def test_unapproved_or_noninteger_cap_rejected(self):
        for value in [True, '65536', 65536.0, 65537, 0, -1, 32768]:
            with self.subTest(value=value), self.assertRaisesRegex(sender.common.HarnessError, 'invalid_approved_token_cap'):
                self.invoke(4096, approved_max_tokens=value)

    def test_request_boolean_fraction_and_out_of_range_rejected(self):
        for value in [True, 65536.0, 65537, 0, -1, '4096']:
            with self.subTest(value=value), self.assertRaisesRegex(sender.common.HarnessError, 'invalid_token_budget'):
                self.invoke(value, approved_max_tokens=65536)

    def assert_rejected(self, **kwargs):
        before = list(self.ledger.rows)
        with self.assertRaises((sender.common.HarnessError, ValueError, FileNotFoundError, KeyError)):
            self.call(**kwargs)
        self.assertEqual(before, self.ledger.rows)
        self.transport.assert_not_called()

    def test_valid_pin_sends_exactly_once(self):
        self.call()
        self.transport.assert_called_once()
        self.assertEqual(self.ledger.count, 137)
        self.assertEqual(sum(row['event'] == 'attempt' for row in self.ledger.rows), 1)

    def test_no_approval_blocks_non_dry(self):
        self.assert_rejected(approval_file=None, approval_sha256=None, dry_run=False)

    def test_missing_approval_and_wrong_pin(self):
        self.assert_rejected(approval_file=self.root / 'absent.json')
        self.assert_rejected(approval_sha256='0' * 64)

    def test_mutated_approval(self):
        self.approval.write_bytes(self.approval.read_bytes() + b' ')
        self.assert_rejected()

    def test_mutated_all_frozen_files_reject_before_attempt(self):
        for name in ['freeze.json', 'prepared.json', 'request.json', 'snapshot.json', 'job.json', 'script-corrected.md', 'production-sources/helper.ts']:
            with self.subTest(name=name):
                self.seal(16384)
                file = self.folder / name
                file.write_bytes(file.read_bytes() + b' ')
                self.assert_rejected()

    def test_missing_all_frozen_files_reject_before_attempt(self):
        for name in ['freeze.json', 'prepared.json', 'request.json', 'snapshot.json', 'job.json']:
            with self.subTest(name=name):
                self.seal(16384)
                file = self.folder / name
                file.rename(file.with_name(file.name + '.retained-backup'))
                self.assert_rejected()

    def test_live_source_and_helper_mutation(self):
        for file in [self.store / 'manifest.json', self.helper, self.base / 'script.md']:
            with self.subTest(file=file.name):
                raw = file.read_bytes(); file.write_bytes(raw + b' ')
                self.assert_rejected(); file.write_bytes(raw)

    def test_source_race_under_ledger_lock(self):
        def enter():
            file = self.store / 'manifest.json'; file.write_bytes(file.read_bytes() + b' ')
            return self.ledger
        self.manager.__enter__.side_effect = enter
        self.assert_rejected()

    def test_approval_race_under_ledger_lock(self):
        def enter():
            self.approval.write_bytes(self.approval.read_bytes() + b' ')
            return self.ledger
        self.manager.__enter__.side_effect = enter
        self.assert_rejected()

    def test_approval_race_immediately_before_attempt(self):
        original = sender.common.persist
        def changed(*args):
            original(*args)
            self.approval.write_bytes(self.approval.read_bytes() + b' ')
        with patch.object(sender.common, 'persist', side_effect=changed):
            self.assert_rejected()

    def test_renamed_destination_does_not_spend_twice(self):
        self.call(); self.transport.reset_mock()
        self.approval_data['expectedCalls'] = 137
        self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)
        with self.assertRaisesRegex(sender.common.HarnessError, 'replacement_permit_required'):
            self.call()
        self.transport.assert_not_called(); self.assertEqual(self.ledger.count, 137)

    def test_request_hash_duplicate_from_any_destination_blocks(self):
        self.ledger.rows.append({'event': 'attempt', 'key': 'another-destination', 'call': 137, 'requestSha256': self.approval_data['requestSha256']})
        self.approval_data['expectedCalls'] = 137; self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)
        self.assert_rejected()

    def test_legacy_truncation_replacement_requires_separate_permit(self):
        old = self.base / 'legacy-audit'; old.mkdir(); send = old / 'send'; send.mkdir()
        request = {'model': 'glm-5.3', 'max_tokens': 4096, 'system': 'legacy', 'messages': []}
        self.put(send / 'prepared.json', {'parsedText': self.texts['script'], 'request': request})
        self.put(old / 'job.json', {'stage': 'script', 'outputText': self.texts['script']})
        self.ledger.rows[-1] = {'event': 'attempt', 'key': 'chapter001-repair-1026:legacy-audit/send', 'call': 136, 'requestSha256': sender.common.digest(sender.common.encoded(request))}
        self.ledger.rows.append({'event': 'response', 'key': 'chapter001-repair-1026:legacy-audit/send', 'call': 136, 'status': 'failed', 'systemic': False})
        self.pin_legacy_fixture([(self.ledger.rows[-2], send / 'prepared.json', old / 'job.json')])
        with self.assertRaisesRegex(sender.common.HarnessError, 'replacement_permit_required'):
            self.call()
        self.transport.assert_not_called(); self.assertEqual(self.ledger.count, 136)

    def test_explicit_separately_pinned_replacement_permit(self):
        old = self.base / 'legacy-permitted'; old.mkdir()
        request = {'model': 'glm-5.3', 'max_tokens': 4096, 'system': 'legacy', 'messages': []}
        self.put(old / 'prepared.json', {'request': request, 'parsedText': self.texts['script']})
        self.put(old / 'job.json', {'stage': 'script', 'outputText': self.texts['script']})
        row = {'event': 'attempt', 'call': 136, 'key': 'chapter001-repair-1026:legacy-permitted', 'requestSha256': sender.common.digest(sender.common.encoded(request))}
        self.ledger.rows[-1] = row
        self.pin_legacy_fixture([(row, old / 'prepared.json', old / 'job.json')])
        boundary = sender.validate_boundary(self.folder / 'prepared.json', self.folder / 'snapshot.json', 136, 16384, self.approval, self.pin)
        permit = self.root / 'offline-replacement-permit-fixture.json'
        self.put(permit, {'schemaVersion': 'chapter001-replacement-permit/v1', 'operator': 'root', 'approved': True, 'priorAttempts': sender.prior_spends(self.ledger, boundary), 'boundary': boundary['bindings'], 'expectedCalls': 136, 'maxTokens': 16384})
        self.approval_data['replacementPermit'] = {'path': str(permit), 'sha256': sender.audit.sha(permit)}
        self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)
        original = permit.read_bytes(); permit.write_bytes(original + b' ')
        self.assert_rejected()
        permit.write_bytes(original)
        self.call()
        self.transport.assert_called_once(); self.assertEqual(self.ledger.count, 137)
        self.assertEqual(self.ledger.rows[135], row)

    def pin_legacy_fixture(self, artifacts):
        self.legacy_entries = [{**{k: row[k] for k in ('call', 'key', 'requestSha256')},
            'preparedPath': str(prepared), 'preparedSha256': sender.audit.sha(prepared),
            'jobPath': str(job), 'jobSha256': sender.audit.sha(job),
            'stage': sender.audit.load(job)['stage'],
            'outputSha256': sender.common.digest(sender.audit.load(job)['outputText'])}
            for row, prepared, job in artifacts]
        self.legacy_manifest = self.root / 'offline-legacy-evidence-fixture.json'
        self.repin_legacy_fixture()

    def repin_legacy_fixture(self):
        self.put(self.legacy_manifest, {'schemaVersion': 'chapter001-legacy-evidence/v1', 'operator': 'root', 'attempts': self.legacy_entries})
        self.approval_data['legacyEvidenceManifest'] = {'path': str(self.legacy_manifest), 'sha256': sender.audit.sha(self.legacy_manifest)}
        self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)

    def legacy_pair_fixture(self, permit=False):
        self.ledger.rows = [{'event': 'probe', 'call': n} for n in range(1, 135)]
        artifacts = []
        for call in (135, 136):
            folder = self.base / ('legacy-' + str(call)); folder.mkdir()
            sent = folder / 'send'; sent.mkdir()
            request = {'model': 'glm-5.3', 'max_tokens': 4096, 'system': 'prior-' + str(call), 'messages': []}
            self.put(sent / 'prepared.json', {'request': request, 'parsedText': 'normalized representation of audited script'})
            self.put(folder / 'job.json', {'stage': 'script', 'outputText': self.texts['script']})
            row = {'event': 'attempt', 'call': call, 'key': 'chapter001-repair-1026:legacy-' + str(call) + '/send', 'requestSha256': sender.common.digest(sender.common.encoded(request))}
            self.ledger.rows.extend([row, {'event': 'response', 'call': call, 'key': row['key'], 'systemic': False}])
            artifacts.append((row, sent / 'prepared.json', folder / 'job.json'))
        self.pin_legacy_fixture(artifacts)
        boundary = sender.validate_boundary(self.folder / 'prepared.json', self.folder / 'snapshot.json', 136, 16384, self.approval, self.pin)
        self.legacy_conflicts = sender.prior_spends(self.ledger, boundary)
        self.assertEqual([r['call'] for r in self.legacy_conflicts], [135, 136])
        if permit:
            self.legacy_permit = self.root / 'offline-legacy-permit-fixture.json'
            self.put(self.legacy_permit, {'schemaVersion': 'chapter001-replacement-permit/v1', 'operator': 'root', 'approved': True, 'priorAttempts': self.legacy_conflicts, 'boundary': boundary['bindings'], 'expectedCalls': 136, 'maxTokens': 16384})
            self.approval_data['replacementPermit'] = {'path': str(self.legacy_permit), 'sha256': sender.audit.sha(self.legacy_permit)}
            self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)

    def test_legacy_missing_jobs_cannot_erase_both_conflicts(self):
        self.legacy_pair_fixture()
        approval = self.approval.read_bytes()
        for entry in self.legacy_entries:
            job = Path(entry['jobPath']); job.rename(job.with_name('job.retained-backup.json'))
        self.assert_rejected()
        self.assertEqual(self.approval.read_bytes(), approval)

    def test_legacy_changed_jobs_cannot_erase_both_conflicts(self):
        self.legacy_pair_fixture()
        approval = self.approval.read_bytes()
        for entry in self.legacy_entries:
            self.put(Path(entry['jobPath']), {'stage': 'script', 'outputText': 'unrelated output'})
        self.assert_rejected()
        self.assertEqual(self.approval.read_bytes(), approval)

    def test_legacy_missing_manifest_rejects_even_with_complete_permit(self):
        self.legacy_pair_fixture(permit=True)
        self.legacy_manifest.rename(self.legacy_manifest.with_suffix('.retained-backup'))
        self.assert_rejected()

    def test_legacy_changed_manifest_rejects_even_with_complete_permit(self):
        self.legacy_pair_fixture(permit=True)
        self.legacy_manifest.write_bytes(self.legacy_manifest.read_bytes() + b' ')
        self.assert_rejected()

    def test_legacy_unpinned_manifest_rejects(self):
        self.legacy_pair_fixture(permit=True)
        self.approval_data['legacyEvidenceManifest'] = None
        self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)
        self.assert_rejected()

    def test_legacy_partial_manifest_rejects(self):
        self.legacy_pair_fixture(permit=True)
        self.legacy_entries = self.legacy_entries[:1]; self.repin_legacy_fixture()
        self.assert_rejected()

    def test_legacy_reordered_manifest_rejects(self):
        self.legacy_pair_fixture(permit=True)
        self.legacy_entries.reverse(); self.repin_legacy_fixture()
        self.assert_rejected()

    def test_legacy_partial_replacement_permit_rejects(self):
        self.legacy_pair_fixture(permit=True)
        permit = sender.audit.load(self.legacy_permit); permit['priorAttempts'] = permit['priorAttempts'][:1]
        self.put(self.legacy_permit, permit)
        self.approval_data['replacementPermit']['sha256'] = sender.audit.sha(self.legacy_permit)
        self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)
        self.assert_rejected()

    def test_legacy_valid_complete_evidence_and_permit_sends_once(self):
        self.legacy_pair_fixture(permit=True)
        self.call(); self.transport.assert_called_once(); self.assertEqual(self.ledger.count, 137)

    def test_legacy_changed_prepared_rejects(self):
        self.legacy_pair_fixture(permit=True)
        file = Path(self.legacy_entries[0]['preparedPath']); file.write_bytes(file.read_bytes() + b' ')
        self.assert_rejected()

    def test_legacy_missing_prepared_rejects(self):
        self.legacy_pair_fixture(permit=True)
        file = Path(self.legacy_entries[0]['preparedPath']); file.rename(file.with_suffix('.retained-backup'))
        self.assert_rejected()

    def test_legacy_unrelated_output_still_requires_all_evidence(self):
        self.legacy_pair_fixture()
        for entry in self.legacy_entries:
            self.put(Path(entry['jobPath']), {'stage': 'planning', 'outputText': 'unrelated output'})
            entry['stage'] = 'planning'; entry['outputSha256'] = sender.common.digest('unrelated output')
            entry['jobSha256'] = sender.audit.sha(entry['jobPath'])
        self.repin_legacy_fixture()
        file = Path(self.legacy_entries[0]['jobPath']); file.rename(file.with_suffix('.retained-backup'))
        self.assert_rejected()

    def test_legacy_request_hash_must_match_ledger_even_when_manifest_repinned(self):
        self.legacy_pair_fixture()
        entry = self.legacy_entries[0]; file = Path(entry['preparedPath'])
        prepared = sender.audit.load(file); prepared['request']['system'] = 'altered historical request'
        self.put(file, prepared); entry['preparedSha256'] = sender.audit.sha(file)
        self.repin_legacy_fixture()
        with self.assertRaisesRegex(sender.common.HarnessError, 'legacy_request_drift'):
            self.call()
        self.transport.assert_not_called(); self.assertEqual(self.ledger.count, 136)

    def test_legacy_parsed_text_cannot_override_pinned_job_identity(self):
        self.legacy_pair_fixture()
        for entry in self.legacy_entries:
            file = Path(entry['preparedPath']); prepared = sender.audit.load(file)
            prepared['parsedText'] = self.texts['script']; self.put(file, prepared)
            entry['preparedSha256'] = sender.audit.sha(file)
            self.put(Path(entry['jobPath']), {'stage': 'planning', 'outputText': 'unrelated output'})
            entry.update(stage='planning', outputSha256=sender.common.digest('unrelated output'), jobSha256=sender.audit.sha(entry['jobPath']))
        self.repin_legacy_fixture()
        self.call(); self.transport.assert_called_once(); self.assertEqual(self.ledger.count, 137)

    def test_legacy_job_race_immediately_before_attempt_rejects(self):
        self.legacy_pair_fixture(permit=True)
        original = sender.common.persist
        def changed(*args):
            original(*args)
            file = Path(self.legacy_entries[-1]['jobPath']); file.write_bytes(file.read_bytes() + b' ')
        with patch.object(sender.common, 'persist', side_effect=changed):
            self.assert_rejected()

    def legacy_v2_fixture(self):
        # Exact historical destination/layout metadata; content is synthetic.
        layouts = [
            ('text-v1/script-generation', 'build', 'script', 'script-job.json'),
            ('text-v2/script-generation', 'build', 'script', 'script-job.json'),
            ('text-v3/script-audit', 'audit', 'script', 'bridge'),
            ('text-v3/audit-v2/response', 'audit', 'script', 'bridge'),
            ('text-v3/audit-v3/response', 'audit', 'script', 'bridge'),
            ('text-v3/audit-v4/response', 'audit', 'script', 'bridge'),
            ('text-v3/index-audit-v1/send', 'audit', 'script', 'job.json'),
            ('text-v3/index-audit-v2/send', 'audit', 'script', 'job.json'),
            ('text-v3/paragraph-audit-v1/send', 'audit', 'script', 'job.json'),
            ('text-v3/shape-audit-v1/send', 'audit', 'script', 'job.json'),
            ('planning-v1/send', 'build', 'planning', 'job.json'),
            ('planning-v2/audit-v2/send', 'audit', 'planning', 'job.json'),
            ('storyboard-v1/send', 'build', 'storyboard', 'job.json'),
            ('storyboard-v2/audit-v1/send', 'audit', 'storyboard', 'job.json'),
            ('storyboard-v2/audit-v2/send', 'audit', 'storyboard', 'job.json'),
            ('text-v4/audit-v1/send', 'audit', 'script', 'job.json'),
            ('text-v4/audit-kind-table-v1/send', 'audit', 'script', 'job.json'),
        ]
        self.ledger.rows = [{'event': 'probe', 'call': n} for n in range(1, 120)]
        self.legacy_entries = []
        for call, (destination, operation, stage, layout) in enumerate(layouts, 120):
            folder = self.base / destination; folder.mkdir(parents=True)
            raw_output = self.texts[stage] + ' "quoted" \\ path\r\n尾行\n\n'
            output_file = self.base / destination.split('/')[0] / (stage + '.md')
            job = {'operation': operation, 'stage': stage}
            if operation == 'audit':
                job['outputText'] = raw_output
                output_file.write_bytes(raw_output.encode())
                content = json.dumps({'stage': stage, 'outputToReview': raw_output}, ensure_ascii=False)
            else:
                job.update(scriptText='upstream', planRaw='plan')
                content = 'build synthetic upstream'
            job_file = folder.parent / layout
            if layout == 'bridge':
                job_file = folder.parent / 'bridge' / format(call, '032x') / 'input.json'
                job_file.parent.mkdir(parents=True)
            self.put(job_file, job)
            request = {'model': 'glm-5.3', 'max_tokens': 4096, 'system': str(call), 'messages': [{'role': 'user', 'content': content}]}
            if layout == 'bridge':
                self.put(job_file.parent / 'output.json', {'request': {**request, 'max_tokens': 16384}})
            self.put(folder / 'prepared.json', {'request': request, 'parsedText': raw_output.strip()})
            # A build response happens to equal the next reviewed identity; it is not an audit.
            (folder / 'output.md').write_text(self.texts[stage])
            row = {'event': 'attempt', 'call': call, 'key': 'chapter001-repair-1026:' + destination, 'requestSha256': sender.common.digest(sender.common.encoded(request))}
            self.ledger.rows.extend([row, {'event': 'response', 'call': call, 'key': row['key'], 'systemic': False}])
            self.legacy_entries.append({**{k: row[k] for k in ('call', 'key', 'requestSha256')}, 'operation': operation, 'stage': stage,
                'preparedPath': str(folder / 'prepared.json'), 'preparedSha256': sender.audit.sha(folder / 'prepared.json'),
                'jobPath': str(job_file), 'jobSha256': sender.audit.sha(job_file),
                'reviewedOutputPath': str(output_file) if operation == 'audit' else None,
                'outputSha256': sender.common.digest(raw_output) if operation == 'audit' else None})
        self.legacy_manifest = self.root / 'offline-v2-manifest-fixture.json'
        self.repin_v2()

    def repin_v2(self):
        self.put(self.legacy_manifest, {'schemaVersion': 'chapter001-legacy-evidence/v2', 'operator': 'root', 'attempts': self.legacy_entries})
        self.approval_data['legacyEvidenceManifest'] = {'path': str(self.legacy_manifest), 'sha256': sender.audit.sha(self.legacy_manifest)}
        self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)

    def v2_boundary(self):
        return sender.validate_boundary(self.folder / 'prepared.json', self.folder / 'snapshot.json', 136, 16384, self.approval, self.pin)

    def assert_v2_rejected(self):
        before = list(self.ledger.rows)
        destination = self.base / 'send-136'
        with self.assertRaises((sender.common.HarnessError, ValueError, FileNotFoundError, KeyError, TypeError)):
            self.call()
        self.assertEqual(before, self.ledger.rows)
        self.transport.assert_not_called()
        self.assertFalse(destination.exists())

    def test_v2_complete_real_shape_history_preserves_raw_identity(self):
        self.legacy_v2_fixture()
        verified = sender.verified_legacy_evidence(self.ledger, self.v2_boundary())
        self.assertEqual([v['call'] for v in verified.values()], list(range(120, 137)))
        self.assertEqual(sum(v['operation'] == 'build' for v in verified.values()), 4)
        self.assertEqual(sum(v['operation'] == 'audit' for v in verified.values()), 13)
        self.assertEqual(sender.prior_spends(self.ledger, self.v2_boundary()), [])
        self.call(dry_run=True)
        self.transport.assert_not_called(); self.assertEqual(self.ledger.count, 136)

    def test_v2_audit_identity_conflicts_and_build_response_is_not_identity(self):
        self.legacy_v2_fixture()
        boundary = self.v2_boundary()
        boundary['outputSha256'] = self.legacy_entries[-1]['outputSha256']
        conflicts = sender.prior_spends(self.ledger, boundary)
        self.assertEqual([r['call'] for r in conflicts], [122, 123, 124, 125, 126, 127, 128, 129, 135, 136])
        boundary['outputSha256'] = sender.common.digest(self.texts['script'])
        self.assertEqual(sender.prior_spends(self.ledger, boundary), [])

    def test_v2_build_exact_request_reuse_conflicts(self):
        self.legacy_v2_fixture()
        boundary = self.v2_boundary()
        boundary['bindings']['requestSha256'] = self.legacy_entries[0]['requestSha256']
        self.assertEqual([r['call'] for r in sender.prior_spends(self.ledger, boundary)], [120])
        with self.assertRaisesRegex(sender.common.HarnessError, 'replacement_permit_required'):
            sender.spend_key(self.ledger, boundary)

    def test_v2_partial_and_reordered_history_reject_before_write(self):
        self.legacy_v2_fixture()
        original = list(self.legacy_entries)
        self.legacy_entries = original[:-1]; self.repin_v2(); self.assert_v2_rejected()
        self.legacy_entries = list(reversed(original)); self.repin_v2(); self.assert_v2_rejected()

    def test_v2_missing_and_drifted_artifacts_reject_before_write(self):
        self.legacy_v2_fixture()
        for entry in (self.legacy_entries[0], self.legacy_entries[2], self.legacy_entries[-1]):
            for field in ('preparedPath', 'jobPath', 'reviewedOutputPath'):
                if entry[field] is None:
                    continue
                file = Path(entry[field]); original = file.read_bytes()
                with self.subTest(call=entry['call'], field=field, change='drift'):
                    file.write_bytes(original + b' '); self.assert_v2_rejected(); file.write_bytes(original)
                with self.subTest(call=entry['call'], field=field, change='missing'):
                    retained = file.with_name(file.name + '.retained'); file.rename(retained)
                    self.assert_v2_rejected(); retained.rename(file)

    def test_v2_unknown_operation_and_wrong_stage_reject_before_write(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[2]; job_file = Path(entry['jobPath']); original = dict(entry)
        job = sender.audit.load(job_file)
        for operation in ('unknown', 'build', None):
            with self.subTest(operation=operation):
                entry['operation'] = operation; self.repin_v2(); self.assert_v2_rejected()
        entry.update(original)
        for stage in ('unknown', 'planning'):
            with self.subTest(stage=stage):
                entry['stage'] = stage; self.repin_v2(); self.assert_v2_rejected()
        entry.update(original)
        job['operation'] = 'unknown'; self.put(job_file, job)
        entry['jobSha256'] = sender.audit.sha(job_file); self.repin_v2(); self.assert_v2_rejected()

    def test_v2_build_reviewed_identity_requires_explicit_nulls(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[0]
        for value in ('N/A', '', '0' * 64):
            with self.subTest(value=value):
                entry['outputSha256'] = value; self.repin_v2(); self.assert_v2_rejected()
        entry['outputSha256'] = None
        entry['reviewedOutputPath'] = str(Path(entry['preparedPath']).parent / 'output.md')
        self.repin_v2(); self.assert_v2_rejected()

    def test_v2_unknown_fields_and_missing_null_reject_before_write(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[0]
        original = dict(entry)
        entry['extra'] = 'unrecognized'; self.repin_v2(); self.assert_v2_rejected()
        self.legacy_entries[0] = {k: v for k, v in original.items() if k != 'outputSha256'}
        self.repin_v2(); self.assert_v2_rejected()

    def test_v2_scoped_path_swap_and_arbitrary_layout_reject(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[2]; original = dict(entry)
        for field, path in [('preparedPath', self.legacy_entries[3]['preparedPath']),
                            ('jobPath', self.legacy_entries[3]['jobPath']),
                            ('reviewedOutputPath', self.base / 'planning-v2/planning.md')]:
            with self.subTest(field=field):
                entry[field] = str(path); self.repin_v2(); self.assert_v2_rejected(); entry.update(original)
        arbitrary = Path(entry['jobPath']).parent / 'arbitrary.json'
        arbitrary.write_bytes(Path(entry['jobPath']).read_bytes())
        entry['jobPath'] = str(arbitrary); self.repin_v2(); self.assert_v2_rejected()
        entry.update(original)
        outside = self.root / 'outside-operation.json'; outside.write_bytes(Path(entry['jobPath']).read_bytes())
        entry['jobPath'] = str(outside); self.repin_v2(); self.assert_v2_rejected()

    def test_v2_symlink_file_and_bridge_parent_reject(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[2]
        file = Path(entry['jobPath']); retained = file.with_name('input.retained.json')
        file.rename(retained); file.symlink_to(retained)
        self.assert_v2_rejected()
        file.rename(file.with_name('symlink.retained')); retained.rename(file)
        bridge = file.parent; retained_bridge = bridge.with_name(bridge.name + '-retained')
        bridge.rename(retained_bridge); bridge.symlink_to(retained_bridge, target_is_directory=True)
        self.assert_v2_rejected()

    def test_v2_repin_cannot_change_ledger_bound_request(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[2]; file = Path(entry['preparedPath'])
        prepared = sender.audit.load(file); prepared['request']['max_tokens'] += 1
        self.put(file, prepared); entry['preparedSha256'] = sender.audit.sha(file)
        self.repin_v2(); self.assert_v2_rejected()

    def test_v2_job_and_reviewed_file_cannot_override_raw_request_identity(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[2]; file = Path(entry['jobPath']); job = sender.audit.load(file)
        job['outputText'] = job['outputText'].strip(); self.put(file, job)
        entry['jobSha256'] = sender.audit.sha(file)
        output = Path(entry['reviewedOutputPath']); output.write_bytes(job['outputText'].encode())
        entry['outputSha256'] = sender.audit.sha(output)
        self.repin_v2(); self.assert_v2_rejected()

    def test_v2_complete_separate_permit_and_partial_permit(self):
        self.legacy_v2_fixture()
        # Two final audits reviewed the current sealed text; retain all 17 rows.
        for entry in self.legacy_entries[-2:]:
            job_file = Path(entry['jobPath']); job = sender.audit.load(job_file)
            job['outputText'] = self.texts['script']; self.put(job_file, job)
            output_file = Path(entry['reviewedOutputPath']); output_file.write_bytes(self.texts['script'].encode())
            prepared_file = Path(entry['preparedPath']); prepared = sender.audit.load(prepared_file)
            prepared['request']['messages'][0]['content'] = json.dumps({'stage': 'script', 'outputToReview': self.texts['script']})
            self.put(prepared_file, prepared)
            entry.update(jobSha256=sender.audit.sha(job_file), outputSha256=sender.audit.sha(output_file),
                         preparedSha256=sender.audit.sha(prepared_file), requestSha256=sender.common.digest(sender.common.encoded(prepared['request'])))
            row = next(r for r in self.ledger.rows if r['event'] == 'attempt' and r['call'] == entry['call'])
            row['requestSha256'] = entry['requestSha256']
        self.repin_v2()
        boundary = self.v2_boundary()
        conflicts = sender.prior_spends(self.ledger, boundary)
        self.assertEqual([r['call'] for r in conflicts], [135, 136])
        self.assert_v2_rejected()
        permit = self.root / 'offline-v2-replacement-fixture.json'
        data = {'schemaVersion': 'chapter001-replacement-permit/v1', 'operator': 'root', 'approved': True,
                'priorAttempts': conflicts, 'boundary': boundary['bindings'], 'expectedCalls': 136, 'maxTokens': 16384}
        self.put(permit, data)
        boundary['approval']['replacementPermit'] = {'path': str(permit), 'sha256': sender.audit.sha(permit)}
        self.assertIn(':replacement:', sender.spend_key(self.ledger, boundary))
        data['priorAttempts'] = conflicts[:-1]; self.put(permit, data)
        self.approval_data['replacementPermit'] = {'path': str(permit), 'sha256': sender.audit.sha(permit)}
        self.repin_v2(); self.assert_v2_rejected()
        data['priorAttempts'] = conflicts; self.put(permit, data)
        self.approval_data['replacementPermit']['sha256'] = sender.audit.sha(permit)
        self.repin_v2(); self.call()
        self.transport.assert_called_once(); self.assertEqual(self.ledger.count, 137)

    def test_v2_build_request_reuse_rejects_execute_before_write(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[0]; file = Path(entry['preparedPath'])
        prepared = sender.audit.load(file)
        current = sender.audit.load(self.folder / 'prepared.json')
        current['request']['messages'] = prepared['request']['messages']
        self.put(self.folder / 'prepared.json', current); self.put(self.folder / 'request.json', current['request'])
        frozen = sender.audit.load(self.folder / 'freeze.json')
        for name in ('prepared.json', 'request.json'):
            frozen['files'][name] = sender.audit.sha(self.folder / name)
        frozen['requestSha256'] = sender.audit.sha(self.folder / 'request.json'); self.put(self.folder / 'freeze.json', frozen)
        self.approval_data.update(preparedSha256=sender.audit.sha(self.folder / 'prepared.json'),
                                  requestSha256=frozen['requestSha256'], freezeSha256=sender.audit.sha(self.folder / 'freeze.json'))
        prepared['request'] = sender.audit.load(self.folder / 'prepared.json')['request']
        self.put(file, prepared)
        entry.update(preparedSha256=sender.audit.sha(file), requestSha256=self.approval_data['requestSha256'])
        row = next(r for r in self.ledger.rows if r['event'] == 'attempt' and r['call'] == 120)
        row['requestSha256'] = entry['requestSha256']
        self.repin_v2()
        self.assertEqual([r['call'] for r in sender.prior_spends(self.ledger, self.v2_boundary())], [120])
        self.assert_v2_rejected()

    def test_v2_unclassifiable_audit_request_body_rejects_execute(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[2]; file = Path(entry['preparedPath'])
        prepared = sender.audit.load(file)
        row = next(r for r in self.ledger.rows if r['event'] == 'attempt' and r['call'] == 122)
        for content in ('not JSON', '[]', '{}', '{"stage":"planning","outputToReview":"wrong"}',
                        '{"stage":"script","outputToReview":null}'):
            with self.subTest(content=content):
                prepared['request']['messages'][0]['content'] = content
                self.put(file, prepared)
                entry.update(preparedSha256=sender.audit.sha(file), requestSha256=sender.common.digest(sender.common.encoded(prepared['request'])))
                row['requestSha256'] = entry['requestSha256']
                self.repin_v2(); self.assert_v2_rejected()

    def test_v2_reviewed_file_symlink_and_noncanonical_path_reject(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[2]; file = Path(entry['reviewedOutputPath'])
        retained = file.with_name(file.name + '.retained'); file.rename(retained); file.symlink_to(retained)
        self.assert_v2_rejected()
        file.rename(file.with_name('symlink.retained')); retained.rename(file)
        entry['reviewedOutputPath'] = str(file.parent) + '/../' + file.parent.name + '/' + file.name
        self.repin_v2(); self.assert_v2_rejected()

    def test_v2_build_cannot_hide_audit_body_identity(self):
        self.legacy_v2_fixture()
        entry = self.legacy_entries[0]; file = Path(entry['preparedPath']); prepared = sender.audit.load(file)
        prepared['request']['messages'][0]['content'] = json.dumps({'stage': 'script', 'outputToReview': self.texts['script']})
        self.put(file, prepared)
        entry.update(preparedSha256=sender.audit.sha(file), requestSha256=sender.common.digest(sender.common.encoded(prepared['request'])))
        row = next(r for r in self.ledger.rows if r['event'] == 'attempt' and r['call'] == 120)
        row['requestSha256'] = entry['requestSha256']; self.repin_v2(); self.assert_v2_rejected()

    def test_ceiling_156_blocks(self):
        self.ledger.rows = [{'event': 'probe', 'call': n} for n in range(1, 157)]
        self.approval_data['expectedCalls'] = 156; self.put(self.approval, self.approval_data); self.pin = sender.audit.sha(self.approval)
        with self.assertRaisesRegex(sender.common.HarnessError, 'call_limit_reached'):
            self.call()
        self.transport.assert_not_called(); self.assertEqual(self.ledger.count, 156)

    def test_dry_run_validates_same_boundary_without_attempt(self):
        before = list(self.ledger.rows); self.call(dry_run=True)
        self.assertEqual(before, self.ledger.rows); self.transport.assert_not_called()
        self.assert_rejected(dry_run=True, approval_file=None)

    def test_upstream_primary_chain_uses_real_gate(self):
        audit = sender.audit
        context = audit.frozen_context(audit.sha(self.helper), self.snap / 'snapshot.json', audit.sha(self.snap / 'snapshot.json'))
        upstream = self.folder
        self.put(upstream / 'decision.json', {'passed': True})
        sent = upstream / 'send'; sent.mkdir()
        (sent / 'output.md').write_text('model pass')
        self.put(sent / 'response.json', {'status': 'received', 'stop_reason': 'end_turn'})
        bindings = {key: audit.sha(upstream / name) for key, name in {'decisionSha256': 'decision.json', 'preparedSha256': 'prepared.json', 'wireSha256': 'send/output.md', 'responseSha256': 'send/response.json', 'freezeSha256': 'freeze.json'}.items()}
        self.put(upstream / 'parse-receipt.json', {**bindings, 'helperSha256': context['helperSha256'], 'upstream': {}})
        self.put(upstream / 'primary-review.json', {**bindings, **{k: context[k] for k in ('helperSha256', 'sourceSha256', 'snapshotSha256')}, 'passed': True, 'reviewer': 'root', 'outputSha256': context['outputs']['script'], 'parseReceiptSha256': audit.sha(upstream / 'parse-receipt.json')})
        receipts = audit.check_upstream('planning', {'script': upstream}, context)
        # Construct a second offline sealed fixture without invoking prepare/capture.
        import shutil
        target = self.base / 'reviewed-planning'; shutil.copytree(self.folder, target)
        self.folder = target
        self.put(target / 'job.json', audit.make_job('planning', context))
        frozen = audit.load(target / 'freeze.json'); frozen['stage'] = 'planning'; frozen['upstream'] = receipts; frozen['files']['job.json'] = audit.sha(target / 'job.json')
        self.put(target / 'freeze.json', frozen)
        self.approval_data.update(stage='planning', freezeSha256=audit.sha(target / 'freeze.json'))
        self.put(self.approval, self.approval_data); self.pin = audit.sha(self.approval)
        self.call(dry_run=True)
        for name in ('primary-review.json', 'parse-receipt.json', 'decision.json', 'freeze.json', 'prepared.json', 'send/output.md', 'send/response.json'):
            with self.subTest(upstream=name):
                file = upstream / name; original = file.read_bytes()
                file.write_bytes(original + b' ')
                self.assert_rejected(); file.write_bytes(original)
                retained = file.with_name(file.name + '.retained-backup'); file.rename(retained)
                self.assert_rejected(); retained.rename(file)


if __name__ == '__main__':
    unittest.main(verbosity=2)
