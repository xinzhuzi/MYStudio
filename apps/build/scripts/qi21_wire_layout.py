"""Guarded, idempotent coordinate-only t2i wire/layout repair (2026-10-22).

The reviewed search reduced 49 crossing pairs to 31 and removed both wire
occlusions. Remaining fixed-slot/topology crossings are reported, not hidden.
No node type, input/output slot, link, widget, or execution parameter changes.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'.agents/skills/node-graph/tools'))
import layout_check as lc

PLAN = {'main': {'positions': {3: [1110, 1085], 401: [3060, 2650], 5: [5562.387342831741, 1416], 6: [2384, 2465], 7: [5090, 1675], 4015: [3060, 1505]}, 'groups': {2: [960.7207617592857, 1035, 589.1410567907785, 1013.5728425781258], 3: [1670, 1455, 1897, 1805], 4: [3870, 1625, 1560, 1085], 5: [5526.713955331739, 1366, 1480.9497520183113, 1936.0942642431482], 6: [7250, 1660, 1868.110753766723, 1577.361462459863]}}, '96937bbe-99d1-4f16-a06c-d86b57815d91': {'positions': {4010: [980, 2140], 4013: [1750, 1640], 4100: [815, 80], 4014: [2500, 1640], 4031: [530, 1140], 4032: [980, 1640]}, 'groups': {}, 'output_x': 2900}, 'e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e': {'positions': {7022: [4400.0, 1650.0], 7023: [4400.0, 1465.0], 7030: [2300.0, 1065.0], 7034: [870.0, 1775.0]}, 'groups': {91: [1470, 450, 2590, 783.0], 92: [1470, 1415.0, 5240, 1095.0], 93: [1470, 3250, 2562.317397441997, 494], 94: [270, 1050, 900.0, 1748]}}, 'f0a844a8-9bf5-4c71-8af5-f1c9f17c0324': {'positions': {501: [1500, 130], 502: [1500, 510], 7402: [300, 950]}, 'groups': {}}, 'b7da105a-0610-4b8e-9a2c-3d4f5e6a7b81': {'positions': {7506: [300.0, 395.0], 7508: [790.0, 615.0], 7507: [790.0, 385.0], 7509: [1330.0, 205.0], 7510: [1880.0, 810.0]}, 'groups': {}}}


def semantic_content(wf):
    result=copy.deepcopy(wf)
    for graph in [result]+result.get('definitions',{}).get('subgraphs',[]):
        for node in graph.get('nodes',[]):node.pop('pos',None)
        for group in graph.get('groups',[]):group.pop('bounding',None)
        for slot in graph.get('inputs',[])+graph.get('outputs',[]):slot.pop('pos',None)
    return result


def repair(wf):
    result=copy.deepcopy(wf)
    for index,graph in enumerate([result]+result['definitions']['subgraphs']):
        spec=PLAN['main' if index==0 else graph['id']]
        nodes={n['id']:n for n in graph['nodes']}
        assert set(spec['positions']).issubset(nodes)
        for nid,pos in spec['positions'].items():nodes[nid]['pos']=copy.deepcopy(pos)
        groups={g['id']:g for g in graph.get('groups',[])}
        for gid,bounding in spec['groups'].items():groups[gid]['bounding']=copy.deepcopy(bounding)
        if 'output_x' in spec:
            for slot in graph['outputs']:slot['pos'][0]=spec['output_x']
    assert semantic_content(wf)==semantic_content(result),'Non-layout field changed'
    nodes={n['id']:n for n in result['nodes']}
    assert nodes[503]['pos']==[8000,2280]
    prompt=result['definitions']['subgraphs'][0]
    note=next(n for n in prompt['nodes'] if n['id']==4100)
    peers=[n for n in prompt['nodes'] if n['id']!=4100]
    left=min(n['pos'][0] for n in peers)
    right=max(n['pos'][0]+lc.est_size(n)[0] for n in peers)
    assert note['size']==[1330,440] and note['pos']==[(left+right-1330)/2,80]
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true')
    options=parser.parse_args()
    path=Path(subprocess.check_output(['fd','-a','^qi21-道劫-t2i.json$',str(ROOT/'apps/backend/engines/comfyui/workflows')],text=True).strip())
    raw=path.read_bytes();wf=json.loads(raw);updated=repair(wf)
    before=lc.check_workflow(wf);after=lc.check_workflow(updated)
    assert [s['counts']['crossings'] for s in after]==[12,2,15,0,2]
    for old,new in zip(before,after):
        assert old['name']==new['name']
        for key in lc.CHECK_KEYS:
            assert new['counts'][key]<=old['counts'][key],(new['name'],key)
            if key!='crossings':assert new['counts'][key]==0,(new['name'],key)
    assert repair(updated)==updated,'Not idempotent'
    pending=[(path,raw,updated)]
    blueprints=[]
    for sg in updated['definitions']['subgraphs']:
        matches=[]
        for bp in (ROOT/'apps/backend/engines/comfyui/my_nodes/subgraphs').glob('*.json'):
            data=json.loads(bp.read_bytes())
            if any(s['id']==sg['id'] for s in data.get('definitions',{}).get('subgraphs',[])):
                matches.append((bp,data))
        assert len(matches)==1,(sg['name'],[str(x[0]) for x in matches])
        bp,data=matches[0];bpraw=bp.read_bytes();assert json.loads(bpraw)==data
        candidate=copy.deepcopy(data)
        old=next(s for s in data['definitions']['subgraphs'] if s['id']==sg['id'])
        old_host=next(s for s in wf['definitions']['subgraphs'] if s['id']==sg['id'])
        # Blueprint link ids/category/notes have existing independent metadata;
        # patch only the reviewed geometry, preserving that metadata verbatim.
        target=next(s for s in candidate['definitions']['subgraphs'] if s['id']==sg['id'])
        spec=PLAN[sg['id']]
        source_nodes={n['id']:n for n in old_host['nodes']}
        target_nodes={n['id']:n for n in target['nodes']}
        for nid,pos in spec['positions'].items():
            assert target_nodes[nid]['pos']==source_nodes[nid]['pos'], 'Blueprint geometry drift: '+str(bp)
            target_nodes[nid]['pos']=copy.deepcopy(pos)
        target_groups={g['id']:g for g in target.get('groups',[])}
        source_groups={g['id']:g for g in old_host.get('groups',[])}
        for gid,bounding in spec['groups'].items():
            assert target_groups[gid]['bounding']==source_groups[gid]['bounding']
            target_groups[gid]['bounding']=copy.deepcopy(bounding)
        if 'output_x' in spec:
            for slot in target['outputs']:slot['pos'][0]=spec['output_x']
        assert semantic_content(data)==semantic_content(candidate)
        pending.append((bp,bpraw,candidate));blueprints.append(str(bp))
    baseline_path=ROOT/'apps/output/bak/qi21-wire-layout-1022'/(path.stem+'-f66479573b61.json')
    baseline_raw=baseline_path.read_bytes() if baseline_path.exists() else raw
    baseline=lc.check_workflow(json.loads(baseline_raw))
    report={'source':str(path),'before_sha256':hashlib.sha256(baseline_raw).hexdigest(),
            'before':baseline,'after':after,'blueprints':blueprints,
            'execution_content_unchanged':True,'seedvr2_host_position':[8000,2280],
            'note4100':{'width':1330,'x':815,'y':80},'applied':False}
    if options.apply:
        assert all(p.read_bytes()==old for p,old,_ in pending),'Concurrent write detected'
        backup=ROOT/'apps/output/bak/qi21-wire-layout-1022'
        backup.mkdir(parents=True,exist_ok=True)
        for p,old,new in pending:
            if json.loads(old)==new:continue
            digest=hashlib.sha256(old).hexdigest()[:12]
            bp=backup/(p.stem+'-'+digest+'.json')
            if not bp.exists():shutil.copy2(p,bp)
            assert p.read_bytes()==old,'Concurrent write detected: '+str(p)
            p.write_text(json.dumps(new,ensure_ascii=False,indent=2)+'\n')
            assert json.loads(p.read_bytes())==new
        report['applied']=True
    report['after_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    output=ROOT/'apps/output/automation/qi21-wire-layout-1022.json'
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'applied':report['applied'],'crossings_before':[s['counts']['crossings'] for s in before],
                      'crossings_after':[s['counts']['crossings'] for s in after],
                      'occlusions_after':[s['counts']['occlusion'] for s in after],
                      'report':str(output)},ensure_ascii=False))


if __name__=='__main__':main()
