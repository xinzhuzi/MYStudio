"""Offline reliability checks for the Qwen hand-repair pipeline."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from PIL import Image, ImageChops, ImageDraw, ImageFilter


def load_pipeline():
    path = Path(__file__).with_name('hand_fix_pipeline_1026.py')
    spec = importlib.util.spec_from_file_location('hand_fix_pipeline_under_test', path)
    module = importlib.util.module_from_spec(spec)
    ultra = ModuleType('ultralytics')
    ultra.YOLO = Mock()
    with patch.dict(sys.modules, {'ultralytics': ultra}), \
            patch.object(sys, 'path', list(sys.path)), patch.dict('os.environ'):
        spec.loader.exec_module(module)
    return module


class HandFixPasteBackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pipeline = load_pipeline()

    def test_small_edge_crops_change_pixels(self):
        source = Image.new('RGB', (96, 96), 'blue')
        original = source.tobytes()
        repaired = Image.new('RGB', (64, 64), 'red')
        for box in ((0, 0, 44, 44), (52, 52, 96, 96), (0, 0, 1, 1),
                    (94, 93, 96, 96), (0, 0, 7, 5), (0, 0, 48, 48),
                    (0, 0, 1, 96)):
            with self.subTest(box=box):
                canvas = source.copy()
                self.pipeline.paste_back(canvas, repaired, box)
                changed = ImageChops.difference(canvas, source).getbbox()
                self.assertIsNotNone(changed)
                self.assertGreaterEqual(changed[0], box[0])
                self.assertGreaterEqual(changed[1], box[1])
                self.assertLessEqual(changed[2], box[2])
                self.assertLessEqual(changed[3], box[3])
                self.assertEqual(source.tobytes(), original)

    def test_large_crops_preserve_existing_feathering(self):
        source = Image.new('RGB', (300, 240), 'blue')
        repaired = Image.new('RGB', (64, 64), 'red')
        for box in ((0, 0, 96, 96), (10, 20, 266, 212)):
            with self.subTest(box=box):
                x0, y0, x1, y1 = box
                width, height = x1 - x0, y1 - y0
                mask = Image.new('L', (width, height), 0)
                ImageDraw.Draw(mask).rectangle(
                    [24, 24, width - 24, height - 24], fill=255)
                mask = mask.filter(ImageFilter.GaussianBlur(12))
                expected = source.copy()
                expected.paste(repaired.resize((width, height), Image.LANCZOS),
                               (x0, y0), mask)
                actual = source.copy()
                self.pipeline.paste_back(actual, repaired, box)
                self.assertEqual(actual.tobytes(), expected.tobytes())


class HandFixVerdictTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pipeline = load_pipeline()

    def test_unknown_verdict_cannot_be_clean(self):
        for response in ('', '   ', None, '(VL空)', '看不清', '指数=5',
                         '畸形=无', '指数=五,畸形=无', '指数=5,畸形=未知',
                         '指数=-1,畸形=无'):
            with self.subTest(response=response), patch.object(self.pipeline, 'vl', return_value=response):
                with self.assertRaisesRegex(ValueError, '判读'):
                    self.pipeline.judge('unused.png')

    def test_known_verdicts_still_classify(self):
        for text, bad in (('指数=5,畸形=无', False), ('指数=4,畸形=无', False),
                          ('指数=4,畸形=融合', True), ('指数=0,畸形=无', True),
                          ('指数=6,畸形=无', True), ('指数=7,畸形=无', True),
                          ('指数 = 5，畸形 = 无', False)):
            with self.subTest(text=text), patch.object(self.pipeline, 'vl', return_value=text):
                verdict, observed_bad = self.pipeline.judge('unused.png')
                self.assertEqual(observed_bad, bad)
                self.assertTrue(verdict)

    def run_offline(self, tmp, responses, repair_error=None, *,
                    detection_boxes=None, source_size=(96, 96), observations=None):
        source = tmp / 'input.png'
        Image.new('RGB', source_size, 'blue').save(source)
        original = source.read_bytes()
        out = tmp / 'out'
        (out / 'hand_crops').mkdir(parents=True)
        manifest = out / 'hand_fix_manifest.json'
        manifest.write_text('[{"previous": true}]')
        previous = manifest.read_bytes()
        tensor = SimpleNamespace()
        tensor.cpu = lambda: tensor
        tensor.tolist = lambda: (detection_boxes if detection_boxes is not None
                                 else [[30, 30, 60, 60]])
        detection = SimpleNamespace(boxes=SimpleNamespace(xyxy=tensor))
        detector = Mock(return_value=[detection])
        engine = ModuleType('engines.image_engine')
        engine.qwen21 = SimpleNamespace()
        repair = Mock(return_value=Image.new('RGB', (96, 96), 'red'), side_effect=repair_error)
        output = io.StringIO()
        verdicts = iter(responses)

        def respond(path, question):
            if observations is not None:
                with Image.open(path) as crop:
                    observations.append((Path(path).name, crop.copy()))
            return next(verdicts)

        with patch.dict(sys.modules, {'engines.image_engine': engine}), \
                patch.object(self.pipeline, 'OUT_DIR', str(out)), \
                patch.object(self.pipeline, 'YOLO', return_value=detector), \
                patch.object(self.pipeline, 'vl', side_effect=respond), \
                patch.object(self.pipeline, 'repair_once', repair), \
                contextlib.redirect_stdout(output):
            try:
                self.pipeline.main(str(source))
            except ValueError:
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(manifest.read_bytes(), previous)
                self.assertFalse((out / 'input_handfixed.png').exists())
                self.assertNotIn('完成:', output.getvalue())
                raise
        self.assertEqual(source.read_bytes(), original)
        return out, repair, output.getvalue()

    def test_initial_empty_response_stops_before_repair_or_success(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, '判读'):
                self.run_offline(Path(folder), [''])

    def test_empty_verification_does_not_publish_unverified_repair(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, '判读'):
                self.run_offline(Path(folder), ['指数=4,畸形=融合', ''])

    def test_valid_clean_hand_is_saved_without_repair(self):
        with tempfile.TemporaryDirectory() as folder:
            out, repair, output = self.run_offline(Path(folder), ['指数=5,畸形=无'])
            repair.assert_not_called()
            self.assertTrue((out / 'input_handfixed.png').is_file())
            self.assertIn('处置后干净1', output)
            self.assertEqual(len(json.loads((out / 'hand_fix_manifest.json').read_text())), 2)

    def test_failed_zero_finger_repair_is_not_counted_clean(self):
        with tempfile.TemporaryDirectory() as folder:
            out, _, output = self.run_offline(Path(folder), ['指数=0,畸形=无'], RuntimeError('offline failure'))
            self.assertIn('处置后干净0', output)
            hand = json.loads((out / 'hand_fix_manifest.json').read_text())[-1]['hands'][0]
            self.assertFalse(hand['clean'])
            self.assertFalse(hand['repaired'])

    def test_repair_is_clean_only_after_valid_verification(self):
        with tempfile.TemporaryDirectory() as folder:
            out, repair, output = self.run_offline(
                Path(folder), ['指数=4,畸形=融合', '指数=5,畸形=无'])
            repair.assert_called_once()
            self.assertIn('处置后干净1', output)
            hand = json.loads((out / 'hand_fix_manifest.json').read_text())[-1]['hands'][0]
            self.assertTrue(hand['clean'])
            self.assertTrue(hand['repaired'])

    def test_overwritten_hand_uses_final_canvas_verdict(self):
        good, bad = '指数=5,畸形=无', '指数=4,畸形=融合'
        for initially_bad in (False, True):
            for final_verdict, final_clean in ((bad, False), (good, True)):
                with self.subTest(initially_bad=initially_bad, final_clean=final_clean), \
                        tempfile.TemporaryDirectory() as folder:
                    responses = ([bad, good] if initially_bad else [good])
                    observations = []
                    out, repair, output = self.run_offline(
                        Path(folder), responses + [bad, good, final_verdict],
                        detection_boxes=[[40, 40, 100, 100], [100, 40, 160, 100]],
                        source_size=(240, 160), observations=observations)
                    hands = json.loads((out / 'hand_fix_manifest.json').read_text())[-1]['hands']
                    self.assertEqual(hands[0]['clean'], final_clean)
                    self.assertEqual(hands[0]['final_verify'], final_verdict)
                    self.assertEqual(hands[0]['judge'], bad if initially_bad else good)
                    if initially_bad:
                        self.assertEqual(hands[0]['verify'], good)
                    self.assertTrue(hands[1]['clean'])
                    self.assertNotIn('final_verify', hands[1])
                    self.assertEqual(repair.call_count, 1 + initially_bad)
                    self.assertEqual(len(observations), 4 + initially_bad)
                    self.assertIn(f'处置后干净{1 + final_clean}', output)
                    # The extra VL request must contain the saved final canvas pixels.
                    with Image.open(out / 'input_handfixed.png') as fixed:
                        encoded = io.BytesIO()
                        fixed.crop(hands[0]['box']).save(encoded, 'JPEG', quality=92)
                    with Image.open(io.BytesIO(encoded.getvalue())) as expected:
                        self.assertEqual(observations[-1][1].tobytes(), expected.tobytes())
                    self.assertNotEqual(observations[initially_bad][1].tobytes(),
                                        observations[-1][1].tobytes())

    def test_invalid_final_verdict_stops_output_and_manifest_append(self):
        good, bad = '指数=5,畸形=无', '指数=4,畸形=融合'
        for initially_bad in (False, True):
            for invalid in ('', None, '指数=5,畸形=未知', '指数=五,畸形=无'):
                with self.subTest(initially_bad=initially_bad, invalid=invalid), \
                        tempfile.TemporaryDirectory() as folder:
                    observations = []
                    responses = ([bad, good] if initially_bad else [good])
                    with self.assertRaisesRegex(ValueError, '判读'):
                        self.run_offline(
                            Path(folder), responses + [bad, good, invalid],
                            detection_boxes=[[40, 40, 100, 100], [100, 40, 160, 100]],
                            source_size=(240, 160), observations=observations)
                    self.assertEqual(len(observations), 4 + initially_bad)

    def test_disjoint_and_edge_touching_hands_need_no_extra_vl(self):
        good, bad = '指数=5,畸形=无', '指数=4,畸形=融合'
        for second_box in ([180, 40, 240, 100], [200, 40, 260, 100]):
            with self.subTest(second_box=second_box), tempfile.TemporaryDirectory() as folder:
                observations = []
                out, repair, _ = self.run_offline(
                    Path(folder), [good, bad, good],
                    detection_boxes=[[40, 40, 100, 100], second_box],
                    source_size=(320, 160), observations=observations)
                hands = json.loads((out / 'hand_fix_manifest.json').read_text())[-1]['hands']
                self.assertTrue(all(hand['clean'] for hand in hands))
                self.assertTrue(all('final_verify' not in hand for hand in hands))
                self.assertEqual(len(observations), 3)
                repair.assert_called_once()

    def test_overlap_without_later_paste_needs_no_extra_vl(self):
        with tempfile.TemporaryDirectory() as folder:
            observations = []
            out, repair, _ = self.run_offline(
                Path(folder), ['指数=5,畸形=无'] * 2,
                detection_boxes=[[40, 40, 100, 100], [100, 40, 160, 100]],
                source_size=(240, 160), observations=observations)
            hands = json.loads((out / 'hand_fix_manifest.json').read_text())[-1]['hands']
            self.assertTrue(all('final_verify' not in hand for hand in hands))
            self.assertEqual(len(observations), 2)
            repair.assert_not_called()

    def test_final_verification_does_not_exceed_two_redraws_per_hand(self):
        good, bad = '指数=5,畸形=无', '指数=4,畸形=融合'
        with tempfile.TemporaryDirectory() as folder:
            observations = []
            out, repair, output = self.run_offline(
                Path(folder), [bad, bad, good, bad, bad, good, bad],
                detection_boxes=[[40, 40, 100, 100], [100, 40, 160, 100]],
                source_size=(240, 160), observations=observations)
            hands = json.loads((out / 'hand_fix_manifest.json').read_text())[-1]['hands']
            self.assertFalse(hands[0]['clean'])
            self.assertTrue(hands[1]['clean'])
            self.assertEqual([hand['attempts'] for hand in hands], [2, 2])
            self.assertEqual([call.args[2] for call in repair.call_args_list],
                             [424242, 964242, 424243, 964243])
            self.assertEqual(len(observations), 7)
            self.assertIn('处置后干净1', output)


if __name__ == '__main__':
    unittest.main()
