"""Record completed 034 full review and stage only missing work, never replay repair."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil
root=Path(__file__).resolve().parents[3]
t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md']
old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
c=next(x for x in d['volume1']['chapters'] if x['chapter']==34)
assert c['status']=='current_full_review_in_progress'
for v in [*c['files'].values(),c['execution_support']]:assert hashlib.sha256(Path(v['path']).read_bytes()).hexdigest()==v['sha256'],v['path']
report=r/'chapter034-independent-full-20261111.md';assert not report.exists()
report.write_text('''# 034全文独审与主核源裁决

`/root/fr034_full_review` 只读全文审阅完成，由主转存；pass=false，2组P2、1组P3。三组已由主逐项读源及目标窗证实，不重复全文初审。
S为baseline第34章原著；SP/DP/SB为chapter034-polished-{screenplay,director-plan,storyboard}-1102.md；I为chapter034-integrated-storyboard-1109.md；C/M/S分别为control/morning/south-road原表。

1. **P2 突破动机缺少实际载体**：源155—169“仇恨着实不够”→不甘同伴白白流血→若死在庙里则同伴的血/三十万人死算什么→接受下一息丹田炸开的代价。SP83起08仅闪回、咽血、合掌；C17—C19及I78—85声栏只有吞咽/碰撞/摩擦。补源内短内心声或明确归属旁白并给足窗口，使不甘与认代价实际可听见；保留三气未稳，不把普通痛苦闪回等同具体动机。
2. **P2 油纸包肉时点错置**：源229仅“把油纸包扎紧”，233才上火，253才将剩下一小块獐肉塞进油纸并放药篓旁。SP135、M15（原表23）、I113提前写包肉，SP157/M24（原表32）/I122只放包。M15恢复不指定内容的扎包；M24补烤后塞剩肉→放篓旁。同步三稿/原表/I及道具接力表第8行。不得断言生肉、两个包必相同、肉总数或最终携带人。
3. **P3 承重原话与先后**：源257“天道灵气本无特质。清和浊，是世家划出来的。”→259混土→265“我的道，就是要先包容这一潭浑水”。SP167、S02/S08、I125/131删前提并改“我要先容下”，SP又先混土后合成发言。主裁恢复承重原句与上述顺序，声音实际落表并核时；不把制作说明当播放事实。

## 覆盖与原有正确项

审阅者完整读源299行、SP197/DP68/SB46、I160及五原表全部非表说明；五表134镜的镜号/单元/秒/画面/声音670字段与I全等。邻章只核033:246—309、035:1—65，三源与baseline SHA一致；12输入起止SHA相同。主已核源147—181、219—271和SP75—95/123—177及C/M/S相应窗，另亲读完整道具接力表。
只读Python exit0：22/28/32/25/27镜，175/221/257/201/217秒，总134镜1071秒，单镜7—10秒；旧14单元545秒独立。引号声38镜，峰C27/S16各28字/10秒=2.8字/秒，纯纸面指标。
仇恨催蓝气→松仇恨设红障、郁未完成封气海、巫未催符、鲁半里外、二层有限、先起身后揣肉已正确；已批准三项历史修复保留，不重做。肉总数、两次油纸是否同包、最终携带人/药篓接力与34→35两日不擅补。原著/source-map只读。

## 修复授权与完成门

仅三组及必要同步，作者独占三稿、control/morning/south-road三表、I、prop-continuity-sheet及必要continuity-audit，共九份；opening/breath-crisis原表只读。先读后改，copy2备份，保留原声音/动作；必要纸面扩窗已授权，单镜5—15秒，原545/1071账作历史不得强塞。新增声应有说话人/源依据；新单元预算与原执行表预算分别核算。作者交回全部差异、输入/源/脚本SHA、时长及有意义负例证据；不同审阅者审全部差异后主fresh关闭。
这是离线文本审阅；真实TTS、桌读、动态、素材、安全执行、观众和195秒生产门均未验，父L3仍blocked。44闭合章及第一卷历史对账不重复。
''')
c.update(status='targeted_repair_ready',current_independent_pass=False,reviewer='/root/fr034_full_review',writer=None,owner=None,p2_groups_open=2,p3_groups_open=1,primary_findings_verified=True,next_action='Full review completed and primary verified three groups. Repair only these and required synchronization; preserve prior fixes. Independent all-difference review and primary fresh follow; no full-review replay.')
c.setdefault('evidence',[]).append(report.name)
c['capacity_decision']={'status':'primary_approved_necessary_paper_expansion','date':'2026-11-11','reason':'Restore source-grounded motivation and full dialogue in playable windows; old545/1071 are independent historical budgets.'}
summary='当前44章闭合（001—032、259—270），现SHA与证据直接复用。033八组定点修复在途；034全文独审已完成并落盘，2P2/1P3经主核源属实，只接三组修复；035仅补缺少的现稿全文独审。已完成初审、修复及全卷历史对账不重复。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='44 closed reusable.033 repair active;034 full review recorded, three verified groups ready for targeted repair;035 next missing full review. No completed-work replay.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action']
out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1
 lines[hits[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
out[paths[-1]]=old[paths[-1]].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
b=r/('fr-stage034-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print(json.dumps({'recorded_full_review':34,'closed_chapters':44,'five_documents_synced':True,'report':str(report)},ensure_ascii=False))
