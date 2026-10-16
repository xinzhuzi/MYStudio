#!/usr/bin/env python3
"""Verify persisted ten-type evidence; never generates or upgrades visual verdicts."""
import hashlib
import json
from pathlib import PureWindowsPath
from PIL import Image
import flux3_daojie_workflow as w


def check_sources():
    baseline=json.loads((w.TASK/'artifacts/source-hashes.json').read_text())
    drift_path=w.TASK/'reports/source-drift.json'
    drifts=json.loads(drift_path.read_text()) if drift_path.exists() else {}
    changed=[]
    for name,digest in baseline.items():
        current=hashlib.sha256((w.ROOT/name).read_bytes()).hexdigest()
        if current!=digest:
            record=drifts.get(name,{})
            assert record.get('original_sha256')==digest and record.get('observed_sha256')==current,name
            assert record.get('role')=='reference_only_not_execution_input',name
            changed.append(name)
    return changed


def verify():
    cases=json.loads((w.TASK/'artifacts/cases.json').read_text())
    rows=[]
    assert len(cases)==10 and len({c['type'] for c in cases})==10
    for case in cases:
        folder=w.TASK/'artifacts'/f"{case['index']:02d}"
        row={'index':case['index'],'type':case['type'],'generation_ok':False,'visual_ok':False}
        try:
            r=json.loads((folder/'receipt.json').read_text())
            for key,value in case.items():assert r[key]==value,('case mismatch',key)
            for stage,idkey in [('pe','pe_prompt_id'),('render','prompt_id')]:
                h=json.loads((folder/(stage+'-history.json')).read_text())
                s=json.loads((folder/(stage+'-submission.json')).read_text())
                request=json.loads((folder/(stage+'-prompt.json')).read_text())
                assert h['prompt'][1]==s['prompt_id']==r[idkey],stage+' id mismatch'
                assert h['status']['status_str']=='success' and h['status']['completed'],stage+' failed'
                assert h['prompt'][2]==request['prompt'],stage+' history payload mismatch'
                gui=w.expand_gui(request['extra_data']['extra_pnginfo']['workflow'])
                assert gui==w.api_graph(case),stage+' workflow mismatch'
                if stage=='pe':
                    pe=h;pg=request['prompt']
                    assert pg['400']['inputs']['value']==case['subject']
                    assert pg['4013']['inputs']['model']==w.MODEL
                    assert pg['4013']['inputs']['api_url']=='http://127.0.0.1:1234'
                    assert pg['4013']['inputs']['AI扩写开关'] is True
                else:render=h;rg=request['prompt']
            status=pe['outputs']['4013']['api_pe_status'][0]
            assert status=='AI扩写OK:'+w.MODEL and r['api_pe_status']==status
            for field,output in [('final_positive','4110'),('final_negative','4111')]:
                assert r[field]==pe['outputs'][output]['text'][0]
            assert r['expanded_positive']==pe['outputs']['4013']['api_pe_pos'][0]
            assert r['expanded_negative']==pe['outputs']['4013']['api_pe_neg'][0]
            expected=w.api_graph(case)
            if case['index']==1:
                assert rg==expected
                for field,output in [('final_positive','4110'),('final_negative','4111')]:
                    assert render['outputs'][output]['text'][0]==r[field]
            else:
                expected={k:v for k,v in expected.items() if k in rg}
                expected['4']['inputs']['text']=r['final_positive'];expected['5']['inputs']['text']=r['final_negative']
                expected['6']['inputs']['width']=case['width'];expected['6']['inputs']['height']=case['height']
                assert rg==expected,'render provenance mismatch'
            im=Image.open(folder/'image.png');im.load()
            assert im.mode==r['mode']=='RGB' and list(im.size)==r['size']==[case['width'],case['height']]
            assert hashlib.sha256((folder/'image.png').read_bytes()).hexdigest()==r['sha256']
            meta=render['outputs']['9']['images'];assert len(meta)==1
            path=PureWindowsPath(r['image_path'])
            assert path.name==meta[0]['filename'] and path.parent.parts[-2:]==('flux3','ten-types-1016')
            assert PureWindowsPath(meta[0]['subfolder']).parts==('flux3','ten-types-1016')
            row.update(generation_ok=True,visual_ok=r['visual_status']=='pass' and bool(r['visual_notes']),visual_status=r['visual_status'],visual_notes=r['visual_notes'],sha256=r['sha256'],prompt_id=r['prompt_id'])
        except Exception as error:
            row['error']=type(error).__name__+': '+str(error)
        rows.append(row)
    source_error=None
    try:changed=check_sources()
    except Exception as error:changed=[];source_error=str(error)
    report={'generation_ok':all(r['generation_ok'] for r in rows) and source_error is None,'visual_ok':all(r['visual_ok'] for r in rows),'gui_verified':False,'gui_note':'Live GUI load not tested; saved file/API contract tracked separately.','shared_sources_unchanged':not changed and source_error is None,'documented_reference_drift':changed,'source_error':source_error,'count':sum(r['generation_ok'] for r in rows),'types':rows}
    (w.TASK/'reports/final-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='types'},ensure_ascii=False))
    return report['generation_ok']
