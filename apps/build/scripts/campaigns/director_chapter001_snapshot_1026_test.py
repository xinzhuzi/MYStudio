"""Synthetic filesystem only; never opens the user project."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('snapshot', Path(__file__).with_name('director_chapter001_snapshot_1026.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
PID = '49dce4c1-64b1-42de-85c2-9f266698aec4'


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = self.root / 'store/studio-workflow'
        self.store.mkdir(parents=True)
        self.put('core.json', {'state': {'sourceBible': '设定', 'seriesBible': {'projectId': PID}, 'workflowConfig': {'directorManualId': 'Daojie_xianxia'}, 'unknown': {'keep': True}}, 'version': 11})
        self.put('chapters/chapter-001/novel.json', {'state': {'novelChapters': [{'id': 'chapter-001', 'title': '测试章', 'sourceText': '原文', 'revision': 3, 'sourceId': 'chapter-001'}]}, 'version': 11})
        self.put('chapters/chapter-002/sentinel.json', {'not': 'a shard: must never be opened'})
        self.manifest = {'layout': 'studio-workflow-shards-v1', 'version': 11, 'activeChapterId': 'chapter-001', 'shards': ['core.json', 'chapters/chapter-001/novel.json', 'chapters/chapter-002/sentinel.json'], 'chapterIndex': [{'id': f'chapter-{i:03}', 'title': str(i)} for i in range(1, 4126)]}
        self.put('manifest.json', self.manifest)

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, name, data):
        p = self.store / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data), encoding='utf8')

    def take(self):
        return M.collect_snapshot(self.root, expected_root=self.root)

    def test_wrong_project_refused(self):
        self.put('core.json', {'state': {'seriesBible': {'projectId': 'wrong'}}, 'version': 11})
        with self.assertRaisesRegex(ValueError, 'project'):
            self.take()

    def test_window_preserves_unknown_and_all_other_index_entries(self):
        before = (self.store / 'chapters/chapter-002/sentinel.json').read_bytes()
        snap = self.take()
        self.assertEqual(snap['envelope']['state']['unknown'], {'keep': True})
        self.assertEqual(len(snap['envelope']['state']['novelChapters']), 4125)
        self.assertEqual(snap['input']['chapterText'], '原文')
        self.assertEqual(len(snap['sourceFiles']), 3)
        self.assertEqual(before, (self.store / 'chapters/chapter-002/sentinel.json').read_bytes())

    def test_source_changes_refused(self):
        snap = self.take()
        self.put('core.json', {'state': {'changed': True}, 'version': 11})
        with self.assertRaisesRegex(ValueError, 'changed'):
            M.verify_sources(snap, expected_root=self.root)

    def test_wrong_root_refused(self):
        with self.assertRaisesRegex(ValueError, 'root'):
            M.collect_snapshot(self.root, expected_root=self.root / 'wrong')

    def test_manifest_symlink_escape_refused_before_read(self):
        outside = self.root / 'outside.json'
        outside.write_text('{}')
        (self.store / 'escape.json').symlink_to(outside)
        self.manifest['shards'].append('escape.json')
        self.put('manifest.json', self.manifest)
        with self.assertRaisesRegex(ValueError, 'scope'):
            self.take()


if __name__ == '__main__':
    unittest.main()
