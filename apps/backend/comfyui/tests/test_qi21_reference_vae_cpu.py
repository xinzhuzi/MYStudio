"""Prevent the verified local reference-encoding VAE color regression."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
COMFY = ROOT / 'apps/backend/comfyui'
NAMES = ('qi21-道劫-i2i.json', 'qi21-edit.json')
VAE = 'texture_fix_vae_for_qwen_image_2.1_bf16.safetensors'
sys.path.insert(0, str(ROOT / 'apps/build/scripts'))
from qwen21_bridge_template_build import flatten_canvas


@pytest.mark.parametrize('name', NAMES)
def test_reference_vae_is_shared_cpu_fp32_with_matching_widgets(name):
    graph = json.loads(next((COMFY / 'workflows').rglob(name)).read_text())
    node = next(n for n in graph['nodes'] if n['id'] == 3)
    assert node['type'] == 'VAELoaderKJ'
    assert node['properties']['Node name for S&R'] == 'VAELoaderKJ'
    assert node['widgets_values'] == [VAE, 'cpu', 'fp32']
    assert node['widgets_values_named'] == dict(zip(('vae_name', 'device', 'weight_dtype'), node['widgets_values']))
    assert [slot['name'] for slot in node['inputs']] == ['vae_name', 'device', 'weight_dtype']
    assert all(slot['link'] is None and slot['widget']['name'] == slot['name'] for slot in node['inputs'])
    assert node['size'][1] >= 120
    edges = [edge for edge in graph['links'] if edge[1] == 3]
    assert sorted(edge[0] for edge in edges) == sorted(node['outputs'][0]['links'])
    nodes = {n['id']: n for n in graph['nodes']}
    schemas = json.loads((COMFY / 'tests/fixtures/qi21_object_info_snapshot.json').read_text())
    api = flatten_canvas(graph, schemas)
    consumers = {n['class_type'] for n in api.values() if n['inputs'].get('vae') == ['3', 0]}
    assert {'TextEncodeQwenImage21', 'VAEDecode'} <= consumers
    assert all(nodes[e[3]]['inputs'][e[4]]['link'] == e[0] for e in edges)


def test_app_i2i_template_uses_identical_cpu_loader():
    graph = json.loads(next((COMFY / 'workflows').rglob('qwen21-道劫-i2i-api.json')).read_text())['graph']
    assert graph['3'] == {'class_type': 'VAELoaderKJ', 'inputs': {'vae_name': VAE, 'device': 'cpu', 'weight_dtype': 'fp32'}}
    consumers = [node['class_type'] for node in graph.values() if node['inputs'].get('vae') == ['3', 0]]
    assert {'TextEncodeQwenImage21', 'VAEDecode'} <= set(consumers)
