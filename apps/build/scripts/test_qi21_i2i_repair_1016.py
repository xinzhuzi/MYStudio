"""Focused saved-canvas contracts; no engine or generation required."""
from __future__ import annotations

import copy
import importlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
repair = importlib.import_module('qi21_i2i_repair_1016')


class I2IRepairContracts(unittest.TestCase):
    def setUp(self) -> None:
        self.documents = [json.loads(path.read_bytes()) for path in repair.paths()]

    def test_prompt_definition_and_host_mirror(self) -> None:
        repair.validate(self.documents)
        source = repair.graph(self.documents[0], repair.PROMPT_ID)
        self.assertEqual(len(source['nodes']), 14)
        self.assertEqual([item['name'] for item in source['outputs']], ['prompt', '画幅W', '画幅H', 'negative'])
        self.assertEqual(len(repair.host(self.documents[1], repair.PROMPT_ID)['inputs']), 8)

    def test_host_output_drift_is_rejected(self) -> None:
        repair.host(self.documents[1], repair.PROMPT_ID)['outputs'][0]['name'] = 'stale'
        with self.assertRaises(AssertionError):
            repair.validate(self.documents)

    def test_widget_promotion_drift_is_rejected(self) -> None:
        promoted = next(item for item in repair.host(self.documents[1], repair.PROMPT_ID)['inputs']
                        if item['name'] == 'PE启用?')
        promoted['widget'] = {'name': 'stale'}
        with self.assertRaises(AssertionError):
            repair.validate(self.documents)

    def test_definition_drift_is_rejected(self) -> None:
        repair.graph(self.documents[1], repair.PROMPT_ID)['nodes'][0]['mode'] = 4
        with self.assertRaises(AssertionError):
            repair.validate(self.documents)

    def test_semantic_freeze_rejects_sampler_or_link_change(self) -> None:
        original = self.documents[0]
        changed = copy.deepcopy(original)
        target = repair.graph(changed, repair.ACCEL_ID)
        next(node for node in target['nodes'] if node['id'] == 7030)['widgets_values'][0] = '0'
        self.assertNotEqual(repair.frozen(original, 0), repair.frozen(changed, 0))
        changed = copy.deepcopy(original)
        repair.graph(changed, repair.ACCEL_ID)['links'][0]['target_slot'] = 7
        self.assertNotEqual(repair.frozen(original, 0), repair.frozen(changed, 0))

    def test_layout_and_note_contracts(self) -> None:
        results = repair.validate(self.documents)
        for measured in results:
            self.assertLessEqual(measured['counts']['crossings'], 11)
            self.assertTrue(all(value == 0 for key, value in measured['counts'].items() if key != 'crossings'))
        for document in (self.documents[0], self.documents[2]):
            target = repair.graph(document, repair.ACCEL_ID)
            note = next(node for node in target['nodes'] if node['type'] == 'Note')
            self.assertIn(repair.SIGMA_NOTE, note['widgets_values'][0])
            self.assertEqual(note['widgets_values'][0], note['widgets_values_named']['text'])
            target['nodes'].remove(note)
            repair.layout(target, repair.POSITIONS)
            rebuilt_note = next(node for node in target['nodes'] if node['type'] == 'Note')
            for explanation in (repair.SIGMA_NOTE, 'viggle 7+2步', '原生40步'):
                self.assertIn(explanation, rebuilt_note['widgets_values'][0])

    def test_transform_and_serialization_are_idempotent(self) -> None:
        repeated = copy.deepcopy(self.documents)
        repair.synchronize(repeated[1], repeated[0])
        for document in (repeated[0], repeated[2]):
            repair.layout(repair.graph(document, repair.ACCEL_ID), repair.POSITIONS)
        self.assertEqual(repeated, self.documents)
        for path, document in zip(repair.paths(), self.documents):
            raw = path.read_bytes()
            self.assertEqual(repair.render(raw, document, document)[0], raw)

    def test_check_cli_does_not_write(self) -> None:
        targets = repair.paths()
        before = [(path.read_bytes(), path.stat().st_mtime_ns) for path in targets]
        assert repair.__file__ is not None
        completed = subprocess.run([sys.executable, str(Path(repair.__file__)), '--check'],
                                   capture_output=True, text=True, check=True)
        self.assertTrue(json.loads(completed.stdout)['read_only'])
        self.assertEqual(before, [(path.read_bytes(), path.stat().st_mtime_ns) for path in targets])


if __name__ == '__main__':
    unittest.main()
