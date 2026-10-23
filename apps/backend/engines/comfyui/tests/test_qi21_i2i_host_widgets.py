"""Regression: force-input instructions must never consume a host widget value."""
import json
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
FILES = list((ENGINE / 'workflows').rglob('qi21-道劫-i2i.json')) + [
    ENGINE / 'my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json',
]


@pytest.mark.parametrize('path', FILES, ids=lambda path: path.name)
def test_instruction_is_a_wire_and_host_values_follow_promoted_controls(path):
    graph = json.loads(path.read_text())
    subgraph = next(s for s in graph['definitions']['subgraphs']
                    if any(n['type'] == 'MyQi21DaojieBase' for n in s['nodes']))
    host = next(n for n in graph['nodes'] if n['type'] == subgraph['id'])
    names = ['型选择', 'PE启用?', 'RGBA透明', '组装用途']
    values = ['人物', False, '自动', '自由出图']
    assert host['widgets_values'] == values
    assert host['widgets_values_named'] == dict(zip(names, values))
    assert subgraph['widgets'] == values
    instruction = next(i for i in host['inputs'] if i['name'] == '指令')
    assert 'widget' not in instruction
    instruction_slot = next(i for i, s in enumerate(subgraph['inputs']) if s['name'] == '指令')
    links = [link for link in subgraph['links']
             if link['origin_id'] == -10 and link['origin_slot'] == instruction_slot]
    assert any(link['target_id'] == 4014 and link['target_slot'] == 0 for link in links)
    if path.parent.name != 'subgraphs':
        link = next(link for link in graph['links'] if link[0] == instruction['link'])
        source = next(n for n in graph['nodes'] if n['id'] == link[1])
        assert '<image1>' in source['widgets_values'][0]
