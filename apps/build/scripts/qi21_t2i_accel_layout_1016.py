#!/usr/bin/env python3
"""Hash-guarded, layout-only surgery for the t2i acceleration definition."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-16-qi21-defaults-install'
sys.path.insert(0, str(ROOT / '.agents/skills/node-graph/tools'))
checker = importlib.import_module('layout_check')

TARGET_ID = 'e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e'
PREFIX = '道劫·加速子图·①Turbo 支路'
NODE_IDS = {7010,7011,7012,7014,7015,7016,7017,7018,7019,7020,
            7021,7022,7023,7024,7026,7027,7028,7029,7030,7031}
POSITIONS = {
    '7011':[1500,1800], '7012':[3700,1800], '7015':[6300,1800],
    '7014':[300,2600], '7010':[3700,3300], '7016':[300,80],
    '7017':[850,1100], '7018':[850,1400], '7019':[2300,1800],
    '7020':[1500,2300], '7021':[2300,2300], '7022':[4400,2100],
    '7023':[4400,1600], '7024':[5300,1800], '7026':[1500,3300],
    '7027':[850,500], '7028':[1500,500], '7029':[2300,500],
    '7030':[2300,850], '7031':[3700,500],
}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def definition(document):
    matches = [(index,graph) for index,graph in enumerate(document['definitions']['subgraphs'])
               if graph['id'] == TARGET_ID]
    assert len(matches) == 1
    index,graph = matches[0]
    assert graph['name'] == '道劫·加速子图'
    assert {node['id'] for node in graph['nodes']} == NODE_IDS
    assert len([node for node in graph['nodes'] if node['type'] == 'MyQi21SpeedSelect']) == 1
    return index,graph


def frozen(document):
    result = copy.deepcopy(document)
    _,graph = definition(result)
    graph.pop('groups')
    for node in graph['nodes']:
        for key in ('pos','size','title'):
            node.pop(key,None)
        if node['id'] == 7016:
            assert node['type'] == 'Note'
            node['widgets_values'][0] = '<allowed Note text>'
            node['widgets_values_named']['text'] = '<allowed Note text>'
    for side in ('inputs','outputs'):
        for item in graph[side]:
            item.pop('pos',None)
    for side in ('inputNode','outputNode'):
        graph[side].pop('bounding',None)
    return result


def spans(text):
    decoder = json.JSONDecoder()
    result = {}

    def visit(offset,path):
        while text[offset].isspace():
            offset += 1
        start = offset
        if text[offset] == '{':
            offset += 1
            while True:
                while text[offset].isspace() or text[offset] == ',':
                    offset += 1
                if text[offset] == '}':
                    offset += 1
                    break
                key,offset = decoder.raw_decode(text,offset)
                while text[offset].isspace() or text[offset] == ':':
                    offset += 1
                offset = visit(offset,path+(key,))
        elif text[offset] == '[':
            offset += 1
            index = 0
            while True:
                while text[offset].isspace() or text[offset] == ',':
                    offset += 1
                if text[offset] == ']':
                    offset += 1
                    break
                offset = visit(offset,path+(index,))
                index += 1
        else:
            _,offset = decoder.raw_decode(text,offset)
        result[path] = (start,offset)
        return offset

    visit(0,())
    return result


def metrics(graph):
    return checker.check_scope('sub:'+graph['name'],graph['nodes'],
                               list(checker._iter_links(graph['links'])),graph,
                               groups=graph['groups'])


def transform(document,positions):
    result = copy.deepcopy(document)
    _,graph = definition(result)
    note = next(node for node in graph['nodes'] if node['id'] == 7016)
    explanations = []
    titles = {7011:'[7011] viggle LoRA',7012:'[7012] viggle前段采样',7014:'[7014] seed单源',
              7017:'[7017] 共用噪声',7018:'[7018] euler采样器',7019:'[7019] viggle引导',
              7020:'[7020] 动态σ表',7021:'[7021] σ切分7+2',7022:'[7022] 底模引导',
              7023:'[7023] 续采零噪声',7024:'[7024] viggle后段采样',7026:'[7026] 原生Fix',
              7027:'[7027] 共用Fix',7028:'[7028] Turbo LoRA',
              7029:'[7029] Turbo引导',7030:'[7030] 官方8步σ',7031:'[7031] Turbo采样'}
    for node in graph['nodes']:
        node['pos'] = positions[str(node['id'])][:]
        if len(node.get('title','')) > 20:
            explanations.append(node['title'])
            node['title'] = titles[node['id']]
        assert len(node['title']) <= 20
    if len(graph['groups']) == 5:
        explanations.extend(group['title'] for group in graph['groups'])
        graph['groups'] = copy.deepcopy(graph['groups'][:4])
    for group,title,members in zip(graph['groups'],
        ('①Turbo 8步','②viggle 双段与汇流','③原生出图','④共用控制'),
        ({7028,7029,7030,7031},{7011,7019,7020,7021,7012,7023,7022,7024,7015},
         {7026,7010},{7014,7017,7018,7027})):
        nodes = [node for node in graph['nodes'] if node['id'] in members]
        left = min(node['pos'][0] for node in nodes)-30
        top = min(node['pos'][1] for node in nodes)-50
        right = max(node['pos'][0]+max(node['size'][0],checker.est_size(node)[0]) for node in nodes)+30
        bottom = max(node['pos'][1]+max(node['size'][1],checker.est_size(node)[1]) for node in nodes)+30
        group['title'] = title
        group['bounding'] = [left,top,right-left,bottom-top]
    if explanations:
        text = note['widgets_values'][0]+'\n\n布局前标题说明（原文保留）：\n'+'\n'.join(explanations)
        note['widgets_values'][0] = text
        note['widgets_values_named']['text'] = text
    for index,item in enumerate(graph['inputs']):
        item['pos'] = [104,424+index*20]
    graph['inputNode']['bounding'] = [80,400,128,168]
    selector = next(node for node in graph['nodes'] if node['id'] == 7015)
    output_x = selector['pos'][0]+selector['size'][0]+180
    graph['outputs'][0]['pos'] = [output_x,selector['pos'][1]+25]
    graph['outputNode']['bounding'] = [output_x-24,selector['pos'][1]+1,128,68]
    assert frozen(document) == frozen(result)
    assert len(graph['groups']) <= 4
    assert all(len(group['title']) <= 20 for group in graph['groups'])
    original_groups = {group['id']:group for group in definition(document)[1]['groups']}
    for group in graph['groups']:
        assert {key:value for key,value in group.items() if key not in ('title','bounding')} == {
            key:value for key,value in original_groups[group['id']].items() if key not in ('title','bounding')}
    return result


def render(original,before,after):
    index,old_graph = definition(before)
    _,new_graph = definition(after)
    prefix = ('definitions','subgraphs',index)
    changes: list[tuple[tuple[str | int, ...], Any]] = [(prefix+('groups',),new_graph['groups'])]
    for node_index,(old,new) in enumerate(zip(old_graph['nodes'],new_graph['nodes'])):
        for key in ('pos','size','title','widgets_values','widgets_values_named'):
            if old.get(key) != new.get(key):
                assert key not in ('widgets_values','widgets_values_named') or old['id'] == 7016
                changes.append((prefix+('nodes',node_index,key),new[key]))
    for side in ('inputs','outputs'):
        for slot,item in enumerate(new_graph[side]):
            changes.append((prefix+(side,slot,'pos'),item['pos']))
    for side in ('inputNode','outputNode'):
        changes.append((prefix+(side,'bounding'),new_graph[side]['bounding']))
    locations = spans(original)
    patches = []
    for path,value in changes:
        start,end = locations[path]
        if json.loads(original[start:end]) == value:
            continue
        line_start = original.rfind('\n',0,start)+1
        indentation = len(original[line_start:])-len(original[line_start:].lstrip(' '))
        replacement = json.dumps(value,ensure_ascii=False,indent=2).replace('\n','\n'+' '*indentation)
        patches.append((start,end,replacement,path))
    cursor = 0
    pieces = []
    unchanged = []
    for start,end,replacement,path in sorted(patches):
        assert start >= cursor
        chunk = original[cursor:start]
        pieces.extend((chunk,replacement))
        unchanged.append(digest(chunk.encode()))
        cursor = end
    pieces.append(original[cursor:])
    unchanged.append(digest(original[cursor:].encode()))
    rendered = ''.join(pieces)
    assert json.loads(rendered) == after
    return rendered,{'changed_paths':[list(patch[3]) for patch in patches],
                     'untouched_chunk_sha256':unchanged,'untouched_bytes_preserved':True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    args = parser.parse_args()
    paths = []
    for directory in ('workflows','my_nodes/subgraphs'):
        matches = [path for path in (ROOT/'apps/backend/comfyui'/directory).rglob('*.json')
                   if path.name.startswith('qi21-') and (PREFIX in path.read_text() or
                      (TARGET_ID in path.read_text() and '①Turbo 8步' in path.read_text()))]
        assert len(matches) == 1,(directory,matches)
        paths.extend(matches)
    positions = POSITIONS
    prepared = []
    report = {'files':[],'applied':args.apply}
    for path in paths:
        raw = path.read_bytes()
        before = json.loads(raw)
        after = transform(before,positions)
        _,old_graph = definition(before)
        _,new_graph = definition(after)
        old_metrics,new_metrics = metrics(old_graph),metrics(new_graph)
        assert new_metrics['counts']['crossings'] <= old_metrics['counts']['crossings']
        assert all(count == 0 for key,count in new_metrics['counts'].items() if key != 'crossings'),new_metrics
        assert transform(after,positions) == after,'not idempotent'
        text,proof = render(raw.decode(),before,after)
        assert render(text,after,after)[0] == text,'not byte-idempotent'
        entry = {'path':str(path.relative_to(ROOT)),'before_sha256':digest(raw),
                 'after_sha256':digest(text.encode()),'before':old_metrics,'after':new_metrics,
                 'semantic_projection_sha256':digest(json.dumps(frozen(before),sort_keys=True,ensure_ascii=False).encode()),
                 'after_semantic_projection_sha256':digest(json.dumps(frozen(after),sort_keys=True,ensure_ascii=False).encode()),
                 'semantic_projection_equal':frozen(before)==frozen(after),
                 'idempotent':True,'byte_proof':proof}
        prepared.append((path,raw,text,after))
        report['files'].append(entry)
    first = definition(prepared[0][3])[1]
    second = definition(prepared[1][3])[1]
    assert first == {key:value for key,value in second.items() if key in first}
    report['source_blueprint_matching'] = True
    if args.apply:
        backup = TASK/'backups/layout-1016'
        backup.mkdir(parents=True,exist_ok=True)
        for path,raw,text,after in prepared:
            snapshot = backup/(digest(raw)+'.json')
            if not snapshot.exists():
                with snapshot.open('xb') as handle:
                    handle.write(raw)
            assert snapshot.read_bytes() == raw
        assert all(path.read_bytes() == raw for path,raw,_,_ in prepared),'concurrent modification'
        for path,raw,text,after in prepared:
            assert path.read_bytes() == raw,'concurrent modification immediately before write'
            if text.encode() != raw:
                path.write_bytes(text.encode())
        assert all(path.read_bytes() == text.encode() for path,raw,text,after in prepared)
        manifest = backup/'manifest.json'
        if not manifest.exists():
            manifest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    evidence = TASK/'evidence'
    evidence.mkdir(exist_ok=True)
    name = 'layout-1016-applied.json' if args.apply else 'layout-1016-check.json'
    (evidence/name).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'applied':args.apply,'metrics':[entry['after']['counts'] for entry in report['files']],
                      'proof':str((evidence/name).relative_to(ROOT))},ensure_ascii=False))


if __name__ == '__main__':
    main()
