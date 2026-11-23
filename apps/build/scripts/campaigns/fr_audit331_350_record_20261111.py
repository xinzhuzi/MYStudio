"""Register331-350 historical evidence once, retaining all existing drafts."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';lp=r/'fr-volumes-current-20261110.json';c=json.loads(lp.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(331,351):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];p=Path(z['path']);raw=p.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':assert cd[n]['files'][role]['path']==str(p) and cd[n]['files'][role]['sha256']==h and len(raw)==z['bytes']==cd[n]['files'][role]['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(p),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='ef74c25f93e7fb41bc8f972a341c6767e28dd35add7b596c0f9b7da702959846'
paths=[Path(x) for x in subprocess.check_output(['fd','--hidden','--no-ignore','--max-depth','1','--type','f','^chapter(33[1-9]|34[0-9]|350)[-.]',str(r)],text=True).splitlines()];backups=sorted(p.name for p in paths if p.name.endswith('.before-approved-fix-1109b.bak'));assert len(backups)==5
extra=['chapters322-324-325-335-349-approved-fixes-1109.md','chapters329-331-independent-audit-1109.md','chapters332-334-independent-audit-1109.md','chapters335-337-independent-audit-1109.md','chapters338-340-independent-audit-1109.md','chapters341-343-independent-audit-1109.md','chapters344-346-independent-audit-1109.md','chapters347-349-independent-audit-1109.md','chapters350-352-independent-audit-1109.md'];names=sorted([p.name for p in paths if p.name not in backups]+extra);assert len(names)==284 and len(set(names))==284
base={Path(bd[n]['files'][role]['path']).name for n in range(331,351) for role in ['screenplay','director-plan','storyboard']};draft_names=set(base);base.update(f'chapter{n}-source-map-1104.md' for n in range(331,351));base.update(f'chapter{n}-revision-review.md' for n in range(331,351));assert len(base)==100 and base.issubset(names)
records=[]
for name in names+backups:
 raw=(r/name).read_bytes();records.append({'basename':name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
evidence=records[:284];support=[x for x in evidence if x['basename'] not in base];support224=[x for x in evidence if x['basename'] not in draft_names];backup_records=records[284:];assert len(support)==184 and len(support224)==224
digests={}
for label,rows,expected in [('evidence284',evidence,'b0df85c10169b8f2e040816a9a1ce6f3e8ba118ef0efa731c1dfa54c50a9498a'),('support184',support,'a14264e8d6a2825fd87e7325350fe9e6e23d61dfe3ec8cb04630a43866c7e2ba'),('support224',support224,'0dc1f1bcbda60b25c6505ae7fd827e8232e29f653f47af16f8eef6000fee5dad'),('backup5',backup_records,'f18442a9b4fb48cb1424f31933c2194fe53d76b9cb22b106ea2c8967350b7672')]:
 v=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in rows).encode()).hexdigest();assert v==expected,(label,v);digests[label]=v
versions=[2,2,2,3,2,2,2,2,3,2,3,4,3,3,3,4,3,3,3,3];counts=[798,1177,1181,1043,830,1079,1099,1082,1086,1046,1045,1533,1166,1237,1443,1095,1198,912,939,826];latest=[];latest_h=[];latest_s=[]
for n,v,count in zip(range(331,351),versions,counts):
 hn=f'chapter{n}-mainfresh-handoff-v{v}.json';sn=f'chapter{n}-mainfresh-structure-v2.json';hj=json.loads((r/hn).read_text());sj=json.loads((r/sn).read_text());assert hj['summary']['pass'] and hj['summary']['checks']==count and hj['source_sha256']==bs[n]['sha256'];assert 'Does not replace independent content review' in hj['scope'] or 'not independent semantic review' in hj['scope'] or (n==340 and hj['scope']=='Main fresh paper verification independent from renderer; no independent semantic review, actual speech, dynamic or production validation inferred.')
 sf=next(x for x in sj['chapters'] if x['chapter']==n)['files'];roles=['screenplay','director-plan','storyboard'];hm=[role for role in roles if hj['current_sha256'][role]!=bd[n]['files'][role]['sha256']];sm=[role for role in roles if sf[role]['sha256']!=bd[n]['files'][role]['sha256']];expected=roles if n==349 else (['screenplay','storyboard'] if n==335 else []);assert hm==sm==expected
 latest.append({'chapter':n,'handoff':hn,'structure':sn,'handoff_checks':count,'mismatched_roles':hm,'independent_content_review':False});latest_h.append(next(x for x in evidence if x['basename']==hn));latest_s.append(next(x for x in evidence if x['basename']==sn))
for label,rows,expected in [('latest_handoff20',latest_h,'457ff891a1c0b724f324014bf9cc67a5c99981fd6169fdf0e15dbcc61ec4e30d'),('latest_structure20',latest_s,'a9cecdb0d3400820fa055b1fd6cbddaf43cabc45c05c6b04286a1e9758489359')]:
 v=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in rows).encode()).hexdigest();assert v==expected;digests[label]=v
report=r/'fr-history-evidence-331-350-20261111.md';fresh=r/'fr-history-331-350-mainfresh-20261111.json';assert not report.exists() and not fresh.exists()
metrics=[(10,159,1999),(10,236,2740),(10,239,2660),(10,211,2380),(10,170,1865),(10,220,2314),(10,226,2409),(10,222,2304),(10,225,2435),(12,214,2251),(12,210,2327),(12,293,3064),(12,228,2483),(13,243,2658),(10,275,2934),(9,207,2215),(12,232,2514),(10,178,2040),(11,186,2145),(11,177,2026)]
notes='''六书文/制度因果/教学来信/秤药价/撑柱尾声保留；329-331 audit17：0503揭秤、0604八十块、1013炼八视听未明，未有全覆盖证明
旧物代价/论争/九点五人三步/苏援手旧事保留；332-334 audit7-8：0113/0209信息声、130标注对白未判逐字完整
寻泉风险/土回望序/触泉三经/回林尾保留；同audit12：0242不告同伴、1001不敢筑基、1004-1005死因承载待核
影卫亡者忆/窥视代价/分网告别物保留；同audit17：0409报名、0514机制承载待核
拆器三题/爆后揭线/工具伦理/拜师锁扣保留，0413获批已修；335-337 audit8：记忆画错时间仍开放，导演13千万练未同步
立足修盘/断锉袭击/认亲毒发/诊治三日散网保留；同audit3/12-13：仅关键段，十场未完，断锉重持与1001冷热待核
试拳认人/酒话身世/平等汤/修罗场/星菇果保留；同audit17-18：逐场三稿源已核未核邻章，搭帘星图匿名声开放
数根教学/苦药旧忆/藤草动作/水苦生计/赠花解剑保留；338-340 audit7：0604灵气逐年薄、0605追问依据及完整覆盖待核
催化残像/47滴/天道问答/飞刀反伤/父母忆保留；同audit3/12-13：对白旁白只抽核，0815药泥铁锈来源仅说明
盐汤双碗/敬镇合十/账条末挪筐保留；同audit17：裂碗已入筐又室内四碗、灯灭无交代及暗挪筐无声待核
库银名册/A-B后果/三栏/宁忆/三钥137滴保留；341-343 audit7-8：0917年龄三月、1219总137滴承载未明，邻章未核
药价三赌/寒晶拆骰/分药身份/夜谈铜钱保留；同audit12-13：阿贵服药与1204、药量源缝待裁，不自行补服药
索引补偿/取证代价/末页撤离/47点三简gamma尾保留；同audit17-18：换班暗码声音、1216边听跨镜声开放
分路迁庙/关口断碑/烫伤旧影/三路传讯保留；344-346 audit3/7：原文全读三稿重点抽检，1308骂声1312脱鞋开放
半再半药量/三清全述/临终未尽/合葬三土/盘查豆浆保留；同audit3/12：导演仅定点，0901问话画面到0902已答待核
教牌小熊/七局牌面/47铜/赌徒心未读纸保留；同audit3/17-18：逐场三稿源交接已核，0330牌声0507/0601/0615规则开放，不添规则
复测听距/开洞五盖水/同行忆/预叙回暮尾保留；347-349 audit3/7：逐场已核，0901-0907预叙回暮缺可辨转换
古碑全文/三推演/退步守棚新刻/两脚拆棚返程保留；同audit12-13：逐场已核，0706闭眼0711现看鲁0714睁眼与信息承载待核
火灾五救/手伤旧灾/折价雀死/告示尾保留，喊娘与孩子性别获批已修；同audit17-18其余源缝开放，无修后独审及新fresh
血契药路/熊伤两掌/幼熊忆/裂芯和弦尾保留；350-352 audit3/7-9：逐场已核，0106动机、0311-0321顺排128秒与十息、入熊记忆过渡开放'''.splitlines();assert len(notes)==20
text='''# 第一卷331—350历史证据对账（2026-11-11）

只读探子 `/root/fr_history_331_350`（Rawls the 2nd）终报由主落盘。20章已有主线程核源、五组修订、历史程序核验及11月9日独立意见；无需从初稿重做。但旧独审均有开放项，部分覆盖不全，未见当前SHA绑定的全覆盖独立通过与后续fresh完整链。保持已修，补当前全文独审；不能把现有审阅当从未做，也不能只修局部即称全章通过。

唯一执行入口均chapterNNN-polished-storyboard-1104.md:1及同章三稿；无其他替代表，旧40/48镜不相加。下表为本轮只读解析的现预算及历史开放线索；需在后续全文独审按现源声画判断，不直接将旧疑问当新确诊。

|章|场／镜／秒|沿用成果与独审缺口|
|---|---|---|
'''
for n,m,note in zip(range(331,351),metrics,notes):text+=f'|{n}|{m[0]}／{m[1]}／{m[2]}|{note}|\n'
text+='''
表内audit均为同范围chaptersXXX-YYY-independent-audit-1109.md，revision为chapterNNN-revision-review.md；331—343主要3/5/7，344—350主要5/7/9，最后段仍留源缝。汇总声称三位只读审阅者，但无个人agent ID及输入SHA，不能补造全覆盖认证。历史fresh作者为主线程；331 scope:14明确不替独审，339起亦明说not independent semantic review。

## 已批准修正与过期验证

335当前剧本245/分镜71已按批准改为“日复一日敲击成千上万块废品”；主亲读原119确为成千上万次/块。导演13及source-map27仍“古法灯准3倍千万练”，没有后续同步记录，现盘确认未同步，留待本章修复，不重复申请或重写已改句。349剧本357/359/461、分镜86/122、导演21已落实喊娘和“五岁的孩子”；主核源111/137、当前分镜和导演，吻合获批记录。两章补丁均未有独立修后通过链。

最新handoff版本逐章331→350为2/2/2/3/2/2/2/2/3/2/3/4/3/3/3/4/3/3/3/3；structure均v2。主核18章三稿全匹配，335仅导演匹配，349三稿全失配；即每类报告共55/60角色匹配、5角色过期，20源匹配。不能把最新文件名当当前通过。历史JSON没有exit_code，revision记录exit0，未重跑历史fresh。

20份write-state finished虽true，四角色SHA均早于现盘；revision已记末修与元数据在后，禁重放旧write-state。旧总账4796—5302中的models_unavailable是历史；336/339/344为partial独审，335/349为获批已修其他开放。旧coverage2500—2658、resume2679—2837初稿预算已被现稿替代。

## 本轮身份核验

探子只读起尾probe实际exit0，2026-11-10T16:52:58.362998Z至16:57:33.332269Z的80输入/284证据/5顶层备份指纹均未变。主独立重算80输入、284证据、184支持、224扣三稿支持、5备份与20+20最新报告聚合全部匹配，详[主身份核验](fr-history-331-350-mainfresh-20261111.json)。主另点验335—337/347—349审阅全文、335导演13/map27及分镜71、349分镜86/122及导演21、原335:119与349:111/137、339/342/349报告scope及SHA。

284件＝275本范围非备份章件＋9汇总（含共享chapter336-355-current-status-1110.md）；184支持扣60三稿/20map/20revision，224支持只扣60三稿。9汇总与全部逐件身份保存在JSON，5备份仅顶层获批前件，未读备份子目录。80输入按331→350每章source→screenplay→director-plan→storyboard，以chapter TAB role TAB absolute_path TAB sha256 TAB bytes LF作UTF8聚合；证据按basename排序，以basename TAB sha256 TAB bytes LF聚合，源字节为当前实读值。

主首次登记probe因340报告使用“no independent semantic review”的准确措辞而非另外两类表述，scope断言exit1；当时尚未创建报告或写共享台账。亲读340原字段后限定增加该准确句，重跑身份核验后才登记，不将首跑报为通过。

本轮对账不作20章全文语义审阅，不代主签内容fresh；TTS、桌读、动态排演、生成、试剪、观众及生产未验。下一历史批351—370。
'''
backup=r/('fr-audit331-350-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for p in [lp,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(p,backup/p.name)
report.write_text(text);fresh.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'digests':digests,'inputs':inputs,'evidence_files':evidence,'support_files':support,'preserved_top_level_backups':backup_records,'latest_report_identity':latest,'latest_matching_roles_per_kind':55,'latest_mismatched_roles_per_kind':5,'reviewer':'/root/fr_history_331_350','boundary':'Historical identity only; current full content review and main fresh still required.'},ensure_ascii=False,indent=2)+'\n')
for n,m in zip(range(331,351),metrics):cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-11',evidence_audit=report.name,evidence_audit_scope='284 evidence files and5 backups;80 inputs/184 supports checked; no full semantic rereview.',historical_execution_metrics={'scenes':m[0],'shots':m[1],'seconds':m[2],'source':report.name,'not_content_acceptance':True},historical_independent_coverage_incomplete_or_not_passed=True,historical_current_fresh_mismatched_roles=next(x['mismatched_roles'] for x in latest if x['chapter']==n),next_action='Preserve existing revisions and approved fixes; complete current full independent content review and main fresh. Do not rerun historical repairs or audit.')
cd[335]['preserved_open_finding']='director-plan:13 and source-map:27 still 千万练; approved screenplay/storyboard fix retained; resolve at chapter335 content work.'
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(331,351)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='31 reusable chapters;020 repair and021 full review active;historical001-258/271-350 registered;next history351-370. Completed work skipped.';lp.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|331—350历史证据|对账完成；主80输入/284证据/184支持/5备份与20最新报告身份核验通过|[对账报告](research/fr-history-evidence-331-350-20261111.md)、[主身份核验](research/fr-history-331-350-mainfresh-20261111.json)|保留已修；335导演旧缩记待修，335/349旧fresh过期；补全章独审；下批351—370|\n'+anchor,1);a='历史001—258、271—330已登记，311—330主80输入及所有支持件聚合核验通过；331—350由 `/root/fr_history_331_350` 只读历史对账在途；';assert a in s;s=s.replace(a,'历史001—258、271—350已登记，331—350主80输入/284证据/184支持/5备份聚合核验通过；下一历史批351—370；');p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']=c['next_action'];p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'prd.md';s=p.read_text();a='020全文独审已落盘并进入两项局修；021全文独审、331—350历史对账在途。';assert a in s;p.write_text(s.replace(a,'020全文独审已落盘并进入两项局修；021全文独审在途；331—350历史对账及主身份核验已登记，下一历史批351—370。'))
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();s+='\n331—350历史对账及主80输入/284证据/184支持/5备份和最新报告身份核验已登记，已完成不重扫；下一历史批351—370。335导演旧缩记留待本章内容修复，已批准其他替换沿用。020局修、021全文独审仍在途。\n';p.write_text(s)
print(json.dumps({'pass':True,'historical_registered':[331,350],'input_checks':80,'evidence_files':284,'support_files':184,'backup_files':5,'latest_full_matches':18,'latest_matched_roles':55,'stale_fresh':[335,349]},ensure_ascii=False))
