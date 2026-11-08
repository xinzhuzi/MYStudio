"""Every acceleration output must own the wires listed on its slot."""
import json
from pathlib import Path

import pytest

COMFY = Path(__file__).resolve().parents[1]
NAMES = {
    'qi21-道劫-t2i.json', 'qi21-道劫-i2i.json',
    'qi21-道劫-加速子图.json', 'qi21-道劫-加速子图-i2i.json',
}
PATHS = sorted(
    path for directory in (COMFY / 'workflows', COMFY / 'my_nodes/subgraphs')
    for path in directory.rglob('*.json') if path.name in NAMES
)
assert len(PATHS) == 4


@pytest.mark.parametrize('path', PATHS, ids=lambda path: path.name)
def test_acceleration_output_wires_have_matching_origin(path):
    document = json.loads(path.read_text(encoding='utf-8'))
    graphs = [graph for graph in document['definitions']['subgraphs']
              if any(node['type'] == 'MyQi21SpeedSelect' for node in graph['nodes'])]
    assert len(graphs) == 1
    graph = graphs[0]
    links = {link['id']: link for link in graph['links']}
    for node in graph['nodes']:
        for slot_index, output in enumerate(node.get('outputs', [])):
            for link_id in output.get('links') or []:
                assert link_id in links, (node['id'], slot_index, link_id)
                link = links[link_id]
                assert (link['origin_id'], link['origin_slot']) == (node['id'], slot_index), (
                    path.name, node['id'], slot_index, link_id, link['origin_id'], link['origin_slot']
                )
