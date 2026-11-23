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


MAIN_NAMES = {'qi21-道劫-t2i.json', 'qi21-道劫-i2i.json'}
MAIN_PATHS = [path for path in PATHS if path.name in MAIN_NAMES]


def _origin(link):
    """(连线号, 源节点, 源槽)——主图连线是数组形 [id, src, slot, dst, slot, type],子图连线是对象形。"""
    if isinstance(link, dict):
        return link['id'], link['origin_id'], link['origin_slot']
    return link[0], link[1], link[2]


@pytest.mark.parametrize('path', MAIN_PATHS, ids=lambda path: path.name)
def test_every_output_registration_matches_link_table(path):
    """主图与全部子图:每个节点输出口登记的连线都必须真实存在且以本口为源;每条非边界连线都必须登记在
    它的源输出口上。(1124 补:此前只查加速子图——两件主图 #8107 的 diagnostics 口各多登记了一条实际自
    image 口出发的连线 8267,漏网;真实前端打开-保存会自动清掉。)"""
    document = json.loads(path.read_text(encoding='utf-8'))
    graphs = [document, *document.get('definitions', {}).get('subgraphs', [])]
    for graph in graphs:
        links = {_origin(link)[0]: _origin(link) for link in graph.get('links', [])}
        registered = set()
        for node in graph.get('nodes', []):
            for slot_index, output in enumerate(node.get('outputs', [])):
                for link_id in output.get('links') or []:
                    registered.add((node['id'], slot_index, link_id))
                    assert link_id in links, (path.name, node['id'], slot_index, link_id)
                    assert links[link_id][1:] == (node['id'], slot_index), (
                        path.name, node['id'], slot_index, link_id, links[link_id]
                    )
        for link_id, (_, origin_id, origin_slot) in links.items():
            if origin_id < 0:  # 子图边界代理(-10 入口 / -20 出口),连线登记在子图自身的 inputs/outputs 上
                continue
            assert (origin_id, origin_slot, link_id) in registered, (path.name, link_id, origin_id, origin_slot)
