#!/usr/bin/env python3
"""Read-only local card assembly probe; no model, image generation or service calls."""
from pathlib import Path
import ast
import importlib.util
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/daojie-type-docs-charsheet-1016'
NODES = ROOT / 'apps/backend/engines/comfyui/my_nodes/nodes'
SOURCE = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'


def main():
    spec = importlib.util.spec_from_file_location('charsheet_assembly_probe', NODES / 'my_qi21_api_pe.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = json.loads(SOURCE.read_text())
    card = next(t for t in data['types'] if t['zh'] == '设定卡')
    module._BASES_JSON = SOURCE
    def forbidden(*args, **kwargs):
        raise AssertionError('Network/model request forbidden in this probe')
    module._interruptible_urlopen = forbidden
    module._alive = forbidden
    subject_doc = next(p for p in (ROOT / 'docs/prompts').iterdir() if p.name == '道劫_类型主体句示例.md')
    sections = re.findall(r'^## (\d+)\.[^\n]*\n.*?^```[^\n]*\n(.*?)^```', subject_doc.read_text(), re.M | re.S)
    assert len(sections) == 10
    subject = next(body.strip() for number, body in sections if number == '10')
    outputs = {}
    for transparent in (False, True):
        result = module.MyQi21ApiPE().rewrite(
            正向提示词=subject, 类型句正向=card['positive_text'],
            类型句负向=card['negative_text'], 透明模式=transparent, AI扩写开关=False)
        key = 'transparent' if transparent else 'opaque'
        pos = result['result'][0]
        (OUT / f'card-actual-{key}-pe-off.txt').write_text(pos + '\n')
        outputs[key] = {'length': len(pos), 'transparent': result['result'][2],
                        'checks': {s: s in pos for s in ['标准站姿','取景范围与人物占比一致','卡面不再出现其他全身人物','数格细节特写']}}
    for s in ('标准站姿', '取景范围与人物占比一致', '卡面不再出现其他全身人物'):
        assert outputs['opaque']['checks'][s] is True
        assert outputs['transparent']['checks'][s] is False
    # Existing parser import, no generators executed.
    sys.path.insert(0, str(NODES))
    parser_spec = importlib.util.spec_from_file_location('subject_examples_probe', ROOT / 'apps/build/scripts/daojie_subject_overlap.py')
    parser = importlib.util.module_from_spec(parser_spec)
    parser_spec.loader.exec_module(parser)
    parsed = parser.doc_sentences()
    assert len(parsed) == 10
    result = {'source': str(SOURCE.relative_to(ROOT)), 'card_default_transparent': card['rgba_default'],
              'type_positive_length': len(card['positive_text']), 'rgba_positive_length': len(card['rgba_positive']),
              'pe_off_assembly': outputs, 'existing_doc_parser_count': len(parsed),
              'model_requests': 0, 'image_generation_requests': 0}
    (OUT / 'card-assembly-probe.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
