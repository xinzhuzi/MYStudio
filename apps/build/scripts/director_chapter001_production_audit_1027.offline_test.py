"""Local stdlib tests. Temporary evidence is retained; no source/project writes or deletion."""
import importlib.util
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
FILE = Path(__file__).with_name('director_chapter001_production_audit_1027.py')
SPEC = importlib.util.spec_from_file_location('production_audit_1027', FILE)
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)

class AuditGates(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='director-production-audit-1027-test-')).resolve()
        self.context = {'helperSha256': 'helper', 'sourceSha256': 'source', 'snapshotSha256': 'snapshot', 'outputs': {'script': 'script', 'planning': 'planning', 'storyboard': 'storyboard'}}
        self.folder = self.base / 'upstream-script'
        self.folder.mkdir()
        for name, value in {
            'decision.json': {'passed': True, 'report': 'model pass'},
            'parse-receipt.json': {},
            'prepared.json': {'request': {'max_tokens': 1}},
            'freeze.json': {'stage': 'script', 'upstream': {}, **self.context},
        }.items():
            audit.new_json(self.folder / name, value)
        (self.folder / 'send').mkdir()
        (self.folder / 'send/output.md').write_text('original model wire')
        audit.new_json(self.folder / 'send/response.json', {'status': 'received', 'stop_reason': 'end_turn'})
        self.bindings = {key: audit.sha(self.folder / name) for key, name in {
            'decisionSha256': 'decision.json', 'preparedSha256': 'prepared.json',
            'wireSha256': 'send/output.md', 'responseSha256': 'send/response.json', 'freezeSha256': 'freeze.json',
        }.items()}
        receipt = {**self.bindings, 'helperSha256': 'helper', 'upstream': {}}
        (self.folder / 'parse-receipt.json').write_text(json.dumps(receipt))
        self.primary = {'parseReceiptSha256': audit.sha(self.folder / 'parse-receipt.json'), 'passed': True, 'reviewer': 'root', 'outputSha256': 'script', 'sourceSha256': 'source', 'snapshotSha256': 'snapshot', 'helperSha256': 'helper', **self.bindings}
        audit.new_json(self.folder / 'primary-review.json', self.primary)
        self.patch = patch.object(audit, 'BASE', self.base)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_requires_root_hash_bound_review(self):
        self.primary['reviewer'] = 'other'
        (self.folder / 'primary-review.json').write_text(json.dumps(self.primary))
        with self.assertRaisesRegex(ValueError, 'root_primary_required'):
            audit.check_upstream('planning', {'script': self.folder}, self.context)

    def test_model_failure_blocks_even_with_root_pass(self):
        (self.folder / 'decision.json').write_text('{"passed":false}')
        with self.assertRaisesRegex(ValueError, 'upstream_model_not_passed'):
            audit.check_upstream('planning', {'script': self.folder}, self.context)

    def test_wire_change_blocks_hash_bound_review(self):
        (self.folder / 'send/output.md').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'upstream_(receipt|primary)_hash_mismatch'):
            audit.check_upstream('planning', {'script': self.folder}, self.context)

    def test_matching_primary_and_model_pass_accept(self):
        self.assertIn('script', audit.check_upstream('planning', {'script': self.folder}, self.context))

    def test_changed_upstream_freeze_rejected(self):
        frozen = audit.load(self.folder / 'freeze.json'); frozen['upstream'] = {'script': 'changed chain'}
        (self.folder / 'freeze.json').write_bytes(audit.encoded(frozen))
        with self.assertRaisesRegex(ValueError, 'upstream_(receipt|primary)_hash_mismatch|upstream_chain_drift'):
            audit.check_upstream('planning', {'script': self.folder}, self.context)

    def test_missing_upstream_blocks(self):
        with self.assertRaisesRegex(ValueError, 'upstream_folder_required'):
            audit.check_upstream('storyboard', {'script': self.folder}, self.context)

    def test_truncation_cannot_be_promoted_by_received_status(self):
        self.assertFalse(audit.response_success({'status': 'received', 'stop_reason': 'max_tokens'}, '{}'))
        self.assertFalse(audit.response_success({'status': 'received', 'stop_reason': 'end_turn'}, ''))
        self.assertFalse(audit.response_success({'status': 'failed', 'stop_reason': 'end_turn'}, '{}'))
        self.assertTrue(audit.response_success({'status': 'received', 'stop_reason': 'end_turn'}, '{}'))


class AuditExecution(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='director-production-audit-1027-execute-')).resolve()
        self.base = self.root / 'evidence'
        self.base.mkdir()
        self.snap = self.root / 'baseline'
        self.snap.mkdir()
        (self.root / 'helper.ts').write_text('frozen helper')
        audit.new_json(self.snap / 'input.json', {'episodeId': 'chapter-001', 'chapterText': 'source'})
        audit.new_json(self.snap / 'manuals.json', [])
        texts = {name: name + ' text' for name in audit.STAGES}
        for name, text in texts.items():
            (self.base / (name + '.md')).write_text(text)
        live = {'source': 'current snapshot'}
        audit.new_json(self.snap / 'snapshot.json', live)
        snapshot_sha = hashlib.sha256(audit.encoded(live)).hexdigest()
        self.context = {'helperSha256': audit.sha(self.root / 'helper.ts'), 'sourceSha256': 'source', 'snapshotSha256': snapshot_sha,
            'reviewedSnapshotPath': str(self.snap / 'snapshot.json'), 'snapshotFiles': {'snapshot.json': snapshot_sha, 'input.json': audit.sha(self.snap / 'input.json'), 'manuals.json': audit.sha(self.snap / 'manuals.json')},
            'outputs': {name: audit.sha(self.base / (name + '.md')) for name in audit.STAGES},
            'correctedFiles': {name: name + '.md' for name in audit.STAGES}, 'productionSourceHashes': {'helper.ts': audit.sha(self.root / 'helper.ts')},
            'texts': texts, 'input': audit.load(self.snap / 'input.json'), 'liveSnapshot': live}
        for name, value in {'ROOT': self.root, 'BASE': self.base, 'SNAP': self.snap, 'PRODUCTION_FILES': ('helper.ts',)}.items():
            patcher = patch.object(audit, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(audit, 'frozen_context', return_value=self.context)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.target = self.base / 'new-script'

    def capture(self, job):
        if job.get('operation') == 'parse':
            return {'review': {'passed': job['response']['success'], 'report': job['response']['text']}}, {}
        return {'structurePassed': True, 'request': {'model': 'glm-5.3', 'max_tokens': 27}, 'ipcRequest': {'maxTokens': 27}}, {}

    def prepare(self):
        return audit.execute('prepare', 'script', self.target, self.context['helperSha256'], capture=self.capture)

    def send_fixture(self, meta=None):
        (self.target / 'send').mkdir()
        (self.target / 'send/prepared.json').write_bytes((self.target / 'prepared.json').read_bytes())
        (self.target / 'send/output.md').write_bytes(b'original model wire with whitespace \n')
        audit.new_json(self.target / 'send/response.json', meta or {'status': 'received', 'stop_reason': 'end_turn'})

    def test_prepare_seals_snapshot_sources_and_denies_reuse(self):
        result = self.prepare()
        self.assertFalse(result['sendAuthorized'])
        frozen = audit.load(self.target / 'freeze.json')
        self.assertEqual(audit.sha(self.target / 'snapshot.json'), self.context['snapshotSha256'])
        self.assertIn('production-sources/helper.ts', frozen['files'])
        self.assertFalse((self.target / 'primary-review.json').exists())
        with self.assertRaisesRegex(ValueError, 'audit_directory_exists_no_retry'):
            self.prepare()

    def test_parse_failed_transport_preserves_original_wire_and_false_decision(self):
        self.prepare()
        self.send_fixture({'status': 'failed', 'stop_reason': 'max_tokens', 'error': 'truncated'})
        original = (self.target / 'send/output.md').read_bytes()
        result = audit.execute('parse', 'script', self.target, self.context['helperSha256'], capture=self.capture)
        self.assertFalse(result['passed'])
        self.assertEqual((self.target / 'send/output.md').read_bytes(), original)
        self.assertFalse(audit.load(self.target / 'decision.json')['passed'])
        with self.assertRaisesRegex(ValueError, 'parse_exists_no_retry'):
            audit.execute('parse', 'script', self.target, self.context['helperSha256'], capture=self.capture)

    def test_parse_rejects_changed_prepared_request_before_parser(self):
        self.prepare()
        self.send_fixture()
        (self.target / 'prepared.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'prepared_file_drift'):
            audit.execute('parse', 'script', self.target, self.context['helperSha256'], capture=self.capture)
        self.assertFalse((self.target / 'decision.json').exists())

    def test_parse_rejects_original_sender_request_mismatch(self):
        self.prepare()
        self.send_fixture()
        (self.target / 'send/prepared.json').write_text('{"request":{}}')
        with self.assertRaisesRegex(ValueError, 'sent_request_differs_from_prepared'):
            audit.execute('parse', 'script', self.target, self.context['helperSha256'], capture=self.capture)

    def test_parse_rejects_freeze_changed_during_callback(self):
        self.prepare(); self.send_fixture()
        def changed(job):
            result = self.capture(job)
            if job.get('operation') == 'parse':
                (self.target / 'freeze.json').write_bytes((self.target / 'freeze.json').read_bytes() + b'\n')
            return result
        with self.assertRaisesRegex(ValueError, 'freeze_changed_during_parse'):
            audit.execute('parse', 'script', self.target, self.context['helperSha256'], capture=changed)
        self.assertFalse((self.target / 'decision.json').exists())

    def test_scope_escape_rejected_without_writes(self):
        with self.assertRaisesRegex(ValueError, 'audit_folder_scope'):
            audit.execute('prepare', 'script', self.root / 'escape', self.context['helperSha256'], capture=self.capture)
        self.assertFalse((self.root / 'escape').exists())

class ReviewedSnapshot(unittest.TestCase):
    """Exercise the real frozen-context loader and real source verifier on an isolated project."""
    def setUp(self):
        import director_chapter001_snapshot_1026 as snapshot_module
        self.root = Path(tempfile.mkdtemp(prefix='director-reviewed-snapshot-')).resolve()
        self.base = self.root / 'evidence'; self.base.mkdir()
        self.snap = self.base / 'baseline'; self.snap.mkdir()
        self.scripts = self.root / 'scripts'; self.scripts.mkdir()
        project = self.root / 'project'; store = project / 'store/studio-workflow'; store.mkdir(parents=True)
        manifest = {'layout': 'studio-workflow-shards-v1', 'version': 1, 'activeChapterId': 'chapter-001', 'chapterIndex': [{'id': 'chapter-001'}], 'shards': ['core.json']}
        audit.new_json(store / 'manifest.json', manifest)
        audit.new_json(store / 'core.json', {'version': 1, 'state': {'seriesBible': {'projectId': snapshot_module.PROJECT_ID}, 'sourceBible': 'bible', 'novelChapters': [{'id': 'chapter-001', 'title': 'chapter', 'revision': 1, 'sourceId': 'fixture', 'sourceText': 'source'}]}})
        snapshot = snapshot_module.collect_snapshot(project, expected_root=project)
        audit.new_json(self.snap / 'snapshot.json', snapshot)
        audit.new_json(self.snap / 'input.json', snapshot['input']); audit.new_json(self.snap / 'manuals.json', [])
        outputs = {}
        for stage in audit.STAGES:
            (self.base / (stage + '.md')).write_text(stage); outputs[stage] = audit.sha(self.base / (stage + '.md'))
        (self.root / 'helper.ts').write_text('helper')
        (self.scripts / 'director_chapter001_corrected_audits_1027.py').write_text('FILES = ' + repr({s: s + '.md' for s in audit.STAGES}) + '\nHASHES = ' + repr(outputs))
        (self.scripts / 'director_chapter001_protocol_audits_1027.py').write_text('FROZEN = ' + repr({n: audit.sha(self.snap / n) for n in ('snapshot.json', 'input.json', 'manuals.json')}) + '\nSOURCE_SHA = ' + repr(snapshot['sourceSha256']))
        for key, value in {'ROOT': self.root, 'BASE': self.base, 'SNAP': self.snap, 'SCRIPTS': self.scripts, 'PRODUCTION_FILES': ('helper.ts',), 'PROJECT_ROOT': project}.items():
            patcher = patch.object(audit, key, value); patcher.start(); self.addCleanup(patcher.stop)
        self.helper = audit.sha(self.root / 'helper.ts'); self.file = self.snap / 'snapshot.json'; self.hash = audit.sha(self.file)
        self.store = store

    def context(self):
        return audit.frozen_context(self.helper, self.file, self.hash)

    def test_requires_explicit_reviewed_snapshot(self):
        with self.assertRaisesRegex(ValueError, 'reviewed_snapshot_required'):
            audit.frozen_context(self.helper)

    def test_wrong_reviewed_hash_rejected(self):
        with self.assertRaisesRegex(ValueError, 'reviewed_snapshot_hash_mismatch'):
            audit.frozen_context(self.helper, self.file, '0' * 64)

    def test_same_input_does_not_allow_live_manifest_rebase(self):
        manifest = audit.load(self.store / 'manifest.json'); manifest['chapterIndex'].append({'id': 'chapter-002'})
        (self.store / 'manifest.json').write_bytes(audit.encoded(manifest))
        with self.assertRaisesRegex(ValueError, 'source changed'):
            self.context()

    def test_real_context_prepares_exact_reviewed_bytes(self):
        target = self.base / 'prepared-fixture'
        capture = lambda job: ({'structurePassed': True, 'request': {'model': 'glm-5.3', 'max_tokens': 65536}, 'ipcRequest': {'maxTokens': 65536}}, {})
        result = audit.execute('prepare', 'script', target, self.helper, capture=capture, snapshot_file=self.file, snapshot_sha256=self.hash)
        self.assertFalse(result['sendAuthorized'])
        self.assertEqual((target / 'snapshot.json').read_bytes(), self.file.read_bytes())
        frozen = audit.load(target / 'freeze.json')
        self.assertEqual(frozen['snapshotSha256'], self.hash)
        self.assertEqual(frozen['reviewedSnapshotPath'], str(self.file))

if __name__ == '__main__':
    unittest.main()
