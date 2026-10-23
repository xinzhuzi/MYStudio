"""Finish current wording anchors; no deployment or engine operations."""
import json,hashlib,runpy
from pathlib import Path
from qi21_base_swap_tool import Tool,ROOT,MANUAL,SOURCE,TESTS
new=json.loads(SOURCE.read_text())['art_style_base']['positive_text']
neg=json.loads(SOURCE.read_text())['art_style_base']['negative_text']
tool=Tool({'out_dir':'qi21-anime-1018','positive_new':new,'positive_old':''})
ledger=json.loads((tool.out/'changes.json').read_text())
source_old=json.loads(Path(next(x['backup'] for x in ledger if x['path']==str(SOURCE))).read_text())
# Preserve evidence that the tree-vocabulary assertion already failed on the pre-edit source.
p=TESTS/'test_my_qi21_base.py';g=runpy.run_path(str(p));f=g['test_gongbi_chengshi_vocabulary_locked_per_type_family']
f.__globals__['CANON_BASES']=Path(next(x['backup'] for x in ledger if x['path']==str(SOURCE)))
try:
    f();baseline='passed'
except AssertionError as e:baseline='pre-existing failure: '+str(e)
(tool.out/'baseline-vocabulary-check.txt').write_text(baseline+'\n')
print(baseline)
for row in ledger:
    p=Path(row['path'])
    if '/workflows/' not in str(p) and '/subgraphs/' not in str(p):continue
    s=p.read_text();oldneg=source_old['art_style_base']['negative_text']
    if oldneg not in s:continue
    ns=s.replace(oldneg,neg)
    tool.ledger_write(p,ns.encode(),'预填风格负向词随源；解除赛璐璐禁项')
patches={
TESTS/'test_my_daojie_base.py':[
 ('# 衣物完整性拼合,锁B 行自带衣褶词汇;骨相/眉眼/发丝/衣色仍禁(未入锁B)','# 衣物状态与动漫五官、发束应用归类型；具体身份色锚仍由主体提供。'),
 ('for bad in ("骨相", "眉眼", "发丝", "衣色"):', 'assert "动漫式概括五官" in renwu and "清晰成组的发束" in renwu\n    for bad in ("骨相", "衣色"):'),
],
TESTS/'test_my_qi21_base.py':[
 ('TREE = ("勾线定形", "双勾填色")','TREE = ("细彩线定形", "双勾填色")'),
 ('assert "面部以细线勾勒" in types.get(zh, "")','assert "动漫式概括五官" in types.get(zh, "")'),
],
TESTS/'test_my_qi21_bases_text.py':[
 ('"画面洁净平整" in 风格','"数字绘画表面洁净平整" in 风格'),
],
TESTS/'test_qi21_style_type_separation.py':[
 ("assert '画面洁净平整，繁密细节处笔触交代清楚；动漫插画面貌' in data['art_style_base']['positive_text']", "assert data['art_style_base']['positive_text'].startswith('美术风格底座：国风二维动漫手绘插画。')\n    assert '简洁明暗色块' in data['art_style_base']['positive_text']"),
],
ROOT/'apps/backend/comfyui/tests/test_qwen21_workflow_contract.py':[
 ('and "细彩线勾勒" in lock_a','and "白描式线条塑形" in lock_a'),
 ('and "矿物色质感鲜泽通透" in lock_a','and "简洁明暗色块" in lock_a'),
],
}
for p,pairs in patches.items():
    s=p.read_text()
    for a,b in pairs:
        assert s.count(a)==1,(p,a,s.count(a));s=s.replace(a,b)
    tool.ledger_write(p,s.encode(),'画风语义断言随当前动漫规范；保留结构、状态和分层验证')
p=MANUAL/'ma_sync/lock-anchors.json';d=json.loads(p.read_text());lock=next(x for x in d['locks'] if x['name']=='成片主风格锁')
lock['manualAnchors']=[x.replace('写意气韵层用彩色矿物分染、罩染与克制泼墨处理','环境层用分层色面、适量分染与罩染处理') for x in lock['manualAnchors']]
lock['localRevision']='2026-10-18 动漫叙事画法随源；保留MA历史来源锚'
tool.ledger_write(p,(json.dumps(d,ensure_ascii=False,indent=2)+'\n').encode(),'叙事风格本地手册锚随新文案')
