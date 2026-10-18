"""Change only prompt string leaves; preserve every graph link and rendering parameter."""
from pathlib import Path
import hashlib,json
from qi21_base_swap_tool import Tool,ROOT,MANUAL,SOURCE,TESTS,TS_CONTRACT_TEST
new=json.loads(SOURCE.read_text())['art_style_base']['positive_text']
tool=Tool({'out_dir':'qi21-anime-1018','positive_new':new,'positive_old':''})
oldshort='美术风格底座：中式手绘，中国工笔淡彩与白描线条的二维手绘游戏插画，带彩色连环画的概括造型感。细彩线勾勒轮廓与结构，线条细稳连贯；平整分层的清晰色面塑形，色面边界清晰锐利；矿物色质感鲜泽通透，多色相并陈、主次分明、饱和度适中；画面洁净平整，繁密细节处笔触交代清楚。'
oldlong=oldshort[:-1]+'；动漫插画面貌：线条兼具动漫的利落与厚实的笔意，富有表现力与节奏感；设色在清淡雅致的基础上适度提升对比度与饱和度，色彩明快而有张力；画面布局富有动感，笔触充满活力，整体呈现兼具国风底蕴与动漫插画趣味的画面。'
records=[]
for root in [ROOT/'apps/backend/engines/comfyui/workflows',ROOT/'apps/backend/engines/comfyui/my_nodes/subgraphs']:
    for p in root.rglob('*.json'):
        s=p.read_text()
        if '美术风格底座：中式手绘' not in s:continue
        d=json.loads(s);count=0
        def replace(x,at=''):
            global count
            if isinstance(x,str) and x.startswith('美术风格底座：中式手绘'):
                assert x in (oldshort,oldlong),(p,at,x)
                records.append({'file':str(p.relative_to(ROOT)),'field':at,'before':x,'after':new});count+=1
                return new
            if isinstance(x,dict):return {k:replace(v,at+'.'+k) for k,v in x.items()}
            if isinstance(x,list):return [replace(v,at+f'[{i}]') for i,v in enumerate(x)]
            return x
        nd=replace(d)
        assert count in (1,2),(p,count)
        # Use exact serialized scalar substitution, avoiding any unrelated formatting or topology change.
        ns=s.replace(json.dumps(oldlong,ensure_ascii=False),json.dumps(new,ensure_ascii=False)).replace(json.dumps(oldshort,ensure_ascii=False),json.dumps(new,ensure_ascii=False))
        assert json.loads(ns)==nd
        assert p.read_text()==s,'Concurrent workflow edit'
        tool.ledger_write(p,ns.encode(),'仅风格预填文本叶值；拓扑、控件位序与采样参数不变')
assert len({r['file'] for r in records})==6
(tool.out/'workflow-fields.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
# Update explicit migration fingerprints and semantic style expectations only.
p=TESTS/'test_my_qi21_prompt_assembly.py';s=p.read_text();assert s.count('"532e321ce7d3fdb1"')==1
s=s.replace('"532e321ce7d3fdb1"','"'+hashlib.sha256(new.encode()).hexdigest()[:16]+'"')
tool.ledger_write(p,s.encode(),'风格迁移指纹随新稿')
p=TESTS/'test_qi21_style_boundary_1016.py';s=p.read_text()
a="for word in ['中国工笔淡彩', '二维手绘', '工笔', '白描', '连环画', '线条细稳连贯',\n                 '平整分层的清晰色面', '色面边界清晰锐利', '矿物色质感鲜泽通透', '多色相并陈', '主次分明',\n                 '繁密细节处笔触交代清楚',\n                 '画面洁净平整']:"
b="assert text.startswith('美术风格底座：国风二维动漫手绘插画。')\n    assert '赛璐璐' not in base['negative_text'] and '动漫' not in base['negative_text']\n    for word in ['二维动漫', '工笔', '白描', '连环画', '线条细稳连贯',\n                 '平整分层的清晰色面', '简洁明暗色块', '主色统领', '辅色呼应',\n                 '点睛色突出', '数字绘画表面洁净平整']:"
assert a in s;s=s.replace(a,b).replace("'远景', '时段', '光源', '光照', '留白']","'远景', '时段', '光源', '光照', '构图', '布局', '留白']")
tool.ledger_write(p,s.encode(),'动漫主次与风格职责边界回归断言')
p=TS_CONTRACT_TEST;s=p.read_text()
a='中国工笔重彩与白描线条的二维手绘游戏插画';assert a in s
s=s.replace(a,'国风二维动漫手绘插画')
a='画面洁净平整，繁密细节处笔触交代清楚。';assert a in s
s=s.replace(a,'平整分层的清晰色面与简洁明暗色块塑形')
a='62c3195a32930835380eb32f9b616003dddf74b911f08ada1374eb1f1a2bf8fd';assert s.count(a)==1
s=s.replace(a,json.loads((MANUAL/'ma_sync/runtime-contract.json').read_text())['contractSha256'])
tool.ledger_write(p,s.encode(),'前端运行时合同指纹与画风语义同步')
print('workflow string leaves',len(records),'files',len({r['file'] for r in records}))
