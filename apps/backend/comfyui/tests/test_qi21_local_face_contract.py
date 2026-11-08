"""Offline contracts for the Qwen2.1 crop-edit-and-blend face workflow."""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
WORKFLOW = next((ROOT / 'apps/backend/comfyui/workflows').rglob('qi21-道劫-换脸-局部重绘.json'))
SCRIPT = ROOT / 'apps/build/scripts/qi21_local_face_mask_repair_1027.py'
sys.path.insert(0, str(ROOT / '.agents/skills/node-graph/tools'))
from layout_check import check_workflow
from workflow_layout import est_size


class TestQi21LocalFaceContract(unittest.TestCase):
    def setUp(self):
        self.graph = json.loads(WORKFLOW.read_text(encoding='utf-8'))
        self.nodes = {node['id']: node for node in self.graph['nodes']}
        self.links = {edge[0]: edge for edge in self.graph['links']}

    def source(self, node_id, name):
        slot = next(slot for slot in self.nodes[node_id]['inputs'] if slot['name'] == name)
        edge = self.links[slot['link']]
        return edge[1], edge[2]

    def test_one_explicit_cpu_fp32_vae_serves_reference_encode_sample_and_decode(self):
        vae = self.nodes[3]
        values = ['texture_fix_vae_for_qwen_image_2.1_bf16.safetensors', 'cpu', 'fp32']
        self.assertEqual(vae['type'], 'VAELoaderKJ')
        self.assertEqual(vae['properties']['Node name for S&R'], vae['type'])
        self.assertEqual(vae['widgets_values'], values)
        self.assertEqual(vae['widgets_values_named'], dict(zip(('vae_name', 'device', 'weight_dtype'), values)))
        self.assertEqual([slot['name'] for slot in vae['inputs']], ['vae_name', 'device', 'weight_dtype'])
        for node_id in (31, 41, 50):
            self.assertEqual(self.source(node_id, 'vae'), (3, 0))

    def test_all_edges_register_exactly_at_both_endpoints_with_real_types(self):
        self.assertEqual(len(self.links), len(self.graph['links']))
        for node in self.nodes.values():
            for slot_index, slot in enumerate(node.get('inputs', [])):
                if slot.get('link') is not None:
                    edge = self.links[slot['link']]
                    self.assertEqual(edge[3:5], [node['id'], slot_index], (node['id'], slot['name'], edge))
                    self.assertNotIn('widget', slot, (node['id'], slot['name']))
            for slot_index, slot in enumerate(node.get('outputs', [])):
                actual = sorted(edge[0] for edge in self.links.values() if edge[1:3] == [node['id'], slot_index])
                self.assertEqual(sorted(slot.get('links') or []), actual)
        for edge in self.links.values():
            source = self.nodes[edge[1]]['outputs'][edge[2]]
            target = self.nodes[edge[3]]['inputs'][edge[4]]
            self.assertEqual(target.get('link'), edge[0])
            self.assertEqual(source['type'], edge[5])
            self.assertEqual(target['type'], edge[5])
        self.assertGreaterEqual(self.graph['last_node_id'], max(self.nodes))
        self.assertGreaterEqual(self.graph['last_link_id'], max(self.links))

    def test_two_references_reach_real_image_slots_and_conditioning_reaches_sampler(self):
        self.assertEqual(self.source(31, 'images.image_1'), (18, 0))
        self.assertEqual(self.source(18, 'image'), (17, 0))
        self.assertEqual(self.source(17, 'image'), (10, 0))
        self.assertEqual(self.source(31, 'images.image_2'), (13, 0))
        self.assertEqual(self.source(13, 'image'), (87, 0))
        self.assertEqual(self.source(87, 'source'), (11, 0))
        self.assertEqual(self.source(87, 'mask'), (86, 0))
        self.assertEqual(self.source(86, 'mask'), (11, 1))
        self.assertEqual(self.source(85, 'width'), (88, 0))
        self.assertEqual(self.source(85, 'height'), (88, 1))
        self.assertEqual(self.source(88, 'image'), (11, 0))
        self.assertEqual(self.nodes[85]['widgets_values_named']['color'], 16777215)
        self.assertEqual(self.source(40, 'positive'), (31, 0))
        self.assertEqual(self.source(40, 'negative'), (31, 1))
        self.assertEqual([slot['type'] for slot in self.nodes[31]['outputs']], ['CONDITIONING', 'CONDITIONING', 'LATENT'])
        self.assertEqual([slot['type'] for slot in self.nodes[31]['inputs'] if slot['name'].startswith('images.')], ['IMAGE', 'IMAGE'])

    def test_sampling_latent_is_encoded_from_the_actual_enlarged_crop(self):
        self.assertEqual(self.source(40, 'latent_image'), (84, 0))
        self.assertEqual(self.source(84, 'samples'), (41, 0))
        self.assertEqual(self.source(84, 'mask'), self.source(70, 'mask'))
        self.assertEqual(self.nodes[41]['type'], 'VAEEncode')
        self.assertEqual(self.source(41, 'pixels'), (18, 0))
        self.assertFalse(any(node['type'].startswith('EmptyLatent') for node in self.nodes.values()))
        self.assertEqual(self.nodes[40]['widgets_values'], [42, 'fixed', 20, 1, 'euler', 'simple', 1.0])
        self.assertEqual(self.nodes[80]['widgets_values'], ['bfs_head_v1.1_qwen_2.1.safetensors', 1.0])

    def test_feather_mask_and_exact_resize_match_the_original_crop_rectangle(self):
        width, height, x, y = self.nodes[17]['widgets_values']
        self.assertEqual(self.nodes[19]['widgets_values'][:2], [width, height])
        self.assertEqual(self.nodes[19]['widgets_values'][6], 1, 'divisible_by=32 silently shrinks 176 to 160')
        composite = self.nodes[70]
        self.assertEqual(composite['widgets_values'], [x, y, False])
        self.assertIn('resize_source', [slot['name'] for slot in composite['inputs']])
        self.assertNotIn('resize_to_batch', [slot['name'] for slot in composite['inputs']])
        feather_id, _ = self.source(70, 'mask')
        feather = self.nodes[feather_id]
        self.assertEqual(feather['type'], 'GrowMaskWithBlur')
        self.assertEqual(feather['widgets_values_named']['blur_radius'], 2.0)
        self.assertEqual(feather['widgets_values_named']['expand'], 0)
        mask_id, _ = self.source(feather_id, 'mask')
        self.assertEqual(self.nodes[mask_id]['type'], 'CreateShapeMask')
        values = self.nodes[mask_id]['widgets_values_named']
        self.assertEqual([values['frame_width'], values['frame_height']], [width, height])
        self.assertLess(values['shape_width'], width)
        self.assertLess(values['shape_height'], height)
        self.assertEqual(values['shape'], 'circle')
        self.assertEqual(self.source(70, 'destination'), (10, 0))
        self.assertEqual(self.source(70, 'source'), (19, 0))
        self.assertEqual(self.source(60, 'images'), (70, 0))

    def test_layout_has_real_sizes_and_does_not_add_wire_failures(self):
        for node in self.nodes.values():
            width, height = est_size(node)
            self.assertGreaterEqual(node['size'][0], width)
            self.assertGreaterEqual(node['size'][1], height)
        counts = check_workflow(self.graph)[0]['counts']
        self.assertLessEqual(counts['crossings'], 29)
        self.assertTrue(all(value == 0 for key, value in counts.items() if key != 'crossings'), counts)

    def test_note_states_selection_and_visual_acceptance_limits(self):
        notes = '\n'.join(node['widgets_values'][0] for node in self.nodes.values() if node['type'] == 'MarkdownNote')
        for text in ('CPU', 'FP32', '裁片', '羽化', '第二张', '坐标', '潜空间', '相似', '更换'):
            self.assertIn(text, notes)

    def test_white_matte_keeps_converted_width_height_in_positional_widget_slots(self):
        node = self.nodes[85]
        values = node['widgets_values']
        self.assertEqual(len(values), 4, 'converted INT widgets still occupy their serialized positions')
        self.assertEqual(values[-2:], [1, 16777215], 'frontend must load a single white matte')
        self.assertEqual(node['widgets_values_named']['color'], values[-1])

    def test_surgery_is_idempotent_and_refuses_an_unexpected_source(self):
        self.assertTrue(SCRIPT.is_file(), 'the guarded repair script is required')
        spec = importlib.util.spec_from_file_location('qi21_local_face_repair_1026', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        raw = WORKFLOW.read_bytes()
        self.assertEqual(module.patched_bytes(raw), raw)
        changed = copy.deepcopy(self.graph)
        changed['nodes'][0]['widgets_values'][0] = 'unexpected-model.safetensors'
        with self.assertRaises(ValueError):
            module.patched_bytes(json.dumps(changed, ensure_ascii=False).encode())


if __name__ == '__main__':
    unittest.main()
