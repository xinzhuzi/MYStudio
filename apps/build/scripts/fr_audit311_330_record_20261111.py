"""Record historical identity evidence once; do not rerun repairs or content review."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';lp=r/'fr-volumes-current-20261110.json'
c=json.loads(lp.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(311,331):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];p=Path(z['path']);raw=p.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':assert cd[n]['files'][role]['path']==str(p) and cd[n]['files'][role]['sha256']==h and len(raw)==z['bytes']==cd[n]['files'][role]['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(p),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='9209dd9f83f506d6390a4f68e67b8bea8ac2c97ccb8ee4e1b8d7b2b86b4883b6'
paths=[Path(x) for x in subprocess.check_output(['fd','--hidden','--no-ignore','--max-depth','1','--type','f','^chapter(31[1-9]|32[0-9]|330)[-.]',str(r)],text=True).splitlines()]
backups=sorted(p.name for p in paths if p.name.endswith('.before-approved-fix-1109b.bak'));assert len(backups)==6
extra=['chapters311-313-independent-audit-1109.md','chapters314-316-independent-audit-1109.md','chapters317-319-independent-audit-1109.md','chapters320-322-independent-audit-1109.md','chapters320-322-supplemental-audit-1109.md','chapters322-324-325-335-349-approved-fixes-1109.md','chapters323-325-independent-audit-1109.md','chapters326-328-independent-audit-1109.md','chapters329-331-independent-audit-1109.md']
names=sorted([p.name for p in paths if p.name not in backups]+extra);assert len(names)==277 and len(set(names))==277
base={Path(bd[n]['files'][role]['path']).name for n in range(311,331) for role in ['screenplay','director-plan','storyboard']};base.update(f'chapter{n}-source-map-1104.md' for n in range(311,331));base.update(f'chapter{n}-revision-review.md' for n in range(311,331));assert len(base)==100 and base.issubset(names)
records=[]
for name in names+backups:
 raw=(r/name).read_bytes();records.append({'basename':name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
evidence=records[:277];support=[x for x in evidence if x['basename'] not in base];backup_records=records[277:];assert len(support)==177
digests={}
for label,rows,expected in [('evidence277',evidence,'b02936ca0ec58654226be4ba49b1b3db235a5866f819e501b60a77e925c29434'),('support177',support,'d5d066eedf89bad1b4f30fb5b69b7c8f04ac1497fdb28f790545921e2748cec8'),('backup6',backup_records,'5ca7246797e3d4b3d3a83b2815e8af300a039cf8fb34865bdab33da405397d6b')]:
 v=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in rows).encode()).hexdigest();assert v==expected,(label,v);digests[label]=v
latest=[];latest_h=[];latest_s=[];counts=[1315,837,687,1159,1135,827,808,856,884,1120,1081,857,981,1016,823,749,856,706,895,939]
for n,count in zip(range(311,331),counts):
 hn=f'chapter{n}-mainfresh-handoff-v'+('3' if n in [313,315,316,317,318,320,322,324] else '2')+'.json';sn=f'chapter{n}-mainfresh-structure-v2.json';hj=json.loads((r/hn).read_text());sj=json.loads((r/sn).read_text());assert hj['summary']['pass'] and hj['summary']['checks']==count and hj['source_sha256']==bs[n]['sha256'];assert 'Does not replace independent content review' in hj['scope']
 sf=next(x for x in sj['chapters'] if x['chapter']==n)['files']
 hm=[role for role in ['screenplay','director-plan','storyboard'] if hj['current_sha256'][role]!=bd[n]['files'][role]['sha256']];sm=[role for role in ['screenplay','director-plan','storyboard'] if sf[role]['sha256']!=bd[n]['files'][role]['sha256']]
 expected=['screenplay','storyboard'] if n in [322,324,325] else [];assert hm==sm==expected
 latest.append({'chapter':n,'handoff':hn,'structure':sn,'handoff_checks':count,'mismatched_roles':hm,'independent_content_review':False})
 latest_h.append(next(x for x in evidence if x['basename']==hn));latest_s.append(next(x for x in evidence if x['basename']==sn))
for label,rows,expected in [('latest_handoff20',latest_h,'188564f4ce3d69263b3adb1ca6547280d41ea1b9e15d8f4bffe715f33a597972'),('latest_structure20',latest_s,'0f9e457b67bc5c595f4455864597860bdb317748c94fcb43167874d39bc88443')]:
 v=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in rows).encode()).hexdigest();assert v==expected;digests[label]=v
report=r/'fr-history-evidence-311-330-20261111.md';fresh=r/'fr-history-311-330-mainfresh-20261111.json';assert not report.exists() and not fresh.exists()
metrics=[(16,309,3589),(16,188,2181),(12,153,1705),(14,267,2891),(16,260,2851),(12,187,2241),(12,156,1756),(14,168,1856),(12,172,1934),(15,219,2483),(16,209,2392),(15,164,1819),(14,188,2067),(12,202,2241),(14,161,1876),(14,145,1736),(12,168,1922),(14,142,1665),(10,174,2016),(10,188,2166)]
notes='''182组原声、苏棋盘与放饼末答原序保留；03—14场未逐镜审，署名景别转场昼夜待核
履历、契约双面、课堂知情与未救父保留；逐句声音未完，0509钱谷他没接话、1302童声待核
药理强度、三伤者两伤因、攻防血参末气味保留；0110源称、0508虚构药性混可播旁白，景别转场待核
救人预后、妇人留场、故人信包位离城原序保留；仅关键镜抽查，0204原说毒不致命混音，抱孩信封昼夜待核
166组原声、12石7眼、巷战测阵三日保留；逐句逐镜未完，1104—1106未署名互答与持物待核
端木承诺威胁、交易负担、巫游信及持续拎人毁庙原序保留；剧本只字段对账，1003刹那膨胀与空间因果待核
伪令数字、身份冲突、二次挑拨铜腿纸币原序保留；未逐镜审完，0610毒力先耗尽对原到极限待核
深度数字妖形推断、伤势、放核老者递粥保留；剧本未逐行，1305老者已离至1401收钱转换与水下声场待核
赌面正生反死、两次母忆、钱食矛盾、汤铜钱原序保留；导演98残485秒旧新增邻凳，未有全逐句通过链
老兵原声酒馆渐静、军牌两劝两点头、仍呼吸末两石保留；逐句声画未完，1111骰停1112骰声、1505地下声及导演113残615秒待核
药丸认知入井数字、诈局三禁品情报末两关保留；209镜仅程序对账，1002死因经过未知与原223、1506姓名声设计待核
药价前史、传闻鞋相声、查契克制担保保留；脚步停风获批修正已实施；164镜仅程序对账，1311知情、冬街声季节字数待核
阵分析糖稀八年、三石课失败教学末因果保留；逐字对白未完，0711公孙视角五层、0805—0902九息长镜、季节抽石待核
并帮动机冒险、伤势税书五页末三话保留；0301审稿注记已获批修正；0403哭声1217磕头声、1202—1203不到一息时长及钱数页血待核
前史刘陈克制、夜探知情营救代价窑伤南行保留；不超过三层获批修正已实施；1104—1108日序、0905半时辰提示及指控依据待核
桥崖动机前史补给、油纸路线分批抵达追兵原序保留；0601三日1201七天1204次日提示、0705三次骂声及油灰接缝待核
无门前史租钱修门代价、三色遇袭故人夜声晨饼钥匙保留；0209八次至0211第八次计法、0805/0808暗劲路及日光钥匙待核
被囚处境威胁原声、假王一拳反噬救援庙伤玉狐保留；1101半时辰提示、1304玉微温、景别转场及人数笼数待核
追杀两斩围炉问答、矿笼认知私塾毒河李救命末雪答保留；0204挑飞至0209受击43秒无时间处理、0505自身笼内处境及苏知情待核
十九年蛊信养鱼关系代价、三层反冲两刻信号末犬追保留；0314聚落势力进晏记忆、0403风险旁白知情及追兵时距断丝衣袖待核'''.splitlines();assert len(notes)==20
text='''# 第一卷311—330历史证据对账（2026-11-11）

只读探子 `/root/fr_history_311_330` 终报由主落盘；本批20章已有五组P2修订，11月9日独立核源各有开放项，未找到绑定当前SHA的完整全文独审通过＋主fresh链。历史独立覆盖或通过链不足，不能只补修后定点复核即关闭整章；应保留已做修订，补当前全章独审，不重新生成或重放修复。

每章唯一执行入口为chapterNNN-polished-storyboard-1104.md:5与同章剧本、导演；source-map仅核源，不叠加预算。下表记录既有成果与历史开放线索，不把线索直接当本轮确诊；后续全文独审须据当前原著和实际声画裁定。

|章|场／镜／秒|已做与待核|
|---|---|---|
'''
for n,m,note in zip(range(311,331),metrics,notes):text+=f'|{n}|{m[0]}／{m[1]}／{m[2]}|{note}|\n'
text+='''
## 独立性、入口与修复边界

修订证据均为chapterNNN-revision-review.md，311—321主要依据3/7—11，322—325主要依据3/5/7，326—330主要依据3/5/7。各章均说明主线程核源，独立语义复审待补。handoff fresh的scope:14明说不替独立内容审阅，current_sha256:17仅绑定输入；“independent of renderer data”不代表独立审阅者。

独立覆盖证据：chapters311-313、314-316、317-319、323-325、326-328的independent-audit-1109.md各章7/11/15行；320—322以supplemental-audit-1109.md:7/11/15补充旧independent-audit；329—330见chapters329-331-independent-audit-1109.md:7/8/12/13。311/312/314/315/316/317/318/320/321/322/323明确有人工覆盖缺口；313虽称逐场核三稿但未通过，其余记录有意见及开放项但无当前全稿通过SHA链。汇总未提供可核代理ID，不补造独立身份。

获批局修见chapters322-324-325-335-349-approved-fixes-1109.md:3/5/6/7/11。322脚步与停风、324去可播审稿注记、325不超过炼气三层均已实施；不再申请或重做。321 revision-review:17/19记生成器重复scene16与首次StopIteration，已独立finalize；异常记录保留，禁重放生成器尾部。

volume-one-progress.json:4200—4771的revision_and_main_source_review_passed_pending_independent及deferred_user_authorized_main_only_models_unavailable是历史状态，不等于本会话不可审；旧resume:2507—2677的480/560/680等及314/315尚未创建均不作当前预算/现状。

最新handoff为313/315/316/317/318/320/322/324的v3，其余v2；structure均v2。主核20源SHA均一致；17章两类报告三稿SHA匹配现稿，322/324/325仅导演匹配，剧本/分镜因获批局修已变，两类旧报告不能充当前fresh。48份handoff、40份structure旧版本保留，不冒充当前。v1失败保留：313 685/687、315 1134/1135、316 826/827、317 806/808、318 855/856、320 1118/1120、322 855/857、324 1015/1016；321生成v1前另有StopIteration/exit1。

## 本轮身份核验

探子起probe、尾probe、独立结构probe均exit0；2026-11-10T16:32:14.963217Z至16:40:27.639422Z本批80输入、277顶部证据与6备份指纹未变。共享current JSON因其他章进展改变，不声称全文件未变。首轮超量输出截断导致外层JSON.parse失败，缩减后的起尾probe才为成功证据。

主独立重算80输入、277证据、177支持件、6备份、20最新handoff与20structure聚合全部匹配探子。完整路径、SHA、bytes和报告失配角色见 [主身份核验](fr-history-311-330-mainfresh-20261111.json)。80输入顺序为311→330每章source→screenplay→director-plan→storyboard；UTF8每行chapter TAB role TAB absolute_path TAB sha256 TAB bytes LF。证据按basename排序，basename TAB sha256 TAB bytes LF。源baseline无bytes，采用当前实读字节另记。

277件＝60三稿＋20map＋20revision＋177支持；支持＝20before＋20handoff-review＋20write-state＋20progress＋48handoff-fresh＋40structure＋9audit/approved。六份before-approved备份单列只核指纹；未读备份子目录。探子结构probe核20章三稿场头名称秒数、唯一镜号、各场/全章求和及单镜5—15秒errors=[]，不替代语义审阅。

主定点亲读311—313独立记录全文、320—322补充记录全文、获批修正记录全文、321修订全文；核现313分镜18/106的审稿词、321分镜192/275的死因与姓名承载、322分镜10/117及324分镜54/325分镜28的已修内容。1506现有旁白说明听到姓名，是否还需实际姓名声留待全章判断，不将历史疑问直接判错误。

未作20章全文语义重审、TTS、桌读、排演、动态、观众或生产验收。对账完成不等于章节内容闭合；下一历史批331—350。
'''
backup=r/('fr-audit311-330-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for p in [lp,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(p,backup/p.name)
report.write_text(text);fresh.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'digests':digests,'inputs':inputs,'evidence_files':evidence,'support_files':support,'preserved_top_level_backups':backup_records,'latest_report_identity':latest,'reviewer':'/root/fr_history_311_330','boundary':'Historical evidence identity only; current full independent content review and main fresh remain required.'},ensure_ascii=False,indent=2)+'\n')
for n,m in zip(range(311,331),metrics):cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-11',evidence_audit=report.name,evidence_audit_scope='277 top-level evidence files and6 backups;80 inputs and177 supports identity checked; no full semantic rereview.',historical_execution_metrics={'scenes':m[0],'shots':m[1],'seconds':m[2],'source':report.name,'not_content_acceptance':True},historical_independent_coverage_incomplete_or_not_passed=True,historical_current_fresh_mismatched_roles=next(x['mismatched_roles'] for x in latest if x['chapter']==n),next_action='Preserve implemented revisions and approved fixes; complete current full independent content review then main fresh. Do not rerun repairs or historical audit.')
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(311,331)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='31 reusable chapters;020 full review active;historical001-258/271-330 registered;next history331-350. Skip unchanged closed chapters and audited historical batches.';lp.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|311—330历史证据|对账完成；主80输入/277证据/177支持/6备份聚合匹配；20最新报告身份另核|[对账报告](research/fr-history-evidence-311-330-20261111.md)、[主身份核验](research/fr-history-311-330-mainfresh-20261111.json)|保留全部已修；322/324/325旧fresh过期；20章均补当前全文独审；下批331—350|\n'+anchor,1);a='历史001—258、271—310已登记，311—330历史对账已返回，待主身份核验落账；';assert a in s;s=s.replace(a,'历史001—258、271—330已登记，311—330主80输入及所有支持件聚合核验通过；下一历史批331—350；');p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']=c['next_action'];p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'prd.md';s=p.read_text();a='历史001—258、271—310已对账登记；311—330对账已返回，待主身份核验及登记。';assert a in s;p.write_text(s.replace(a,'历史001—258、271—330已对账登记，311—330主80输入/277证据/177支持/6备份及20最新报告身份已核；下一历史批331—350。'))
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();a='311—330历史对账已返回待主核身份后登记。';assert a in s;p.write_text(s.replace(a,'311—330历史对账和主80输入/277证据/177支持/6备份身份核验已登记；下一历史批331—350。'))
print(json.dumps({'pass':True,'input_checks':80,'evidence_files':277,'support_files':177,'backup_files':6,'historical_registered':[311,330],'latest_report_matches':17,'approved_fix_stale_fresh':[322,324,325],'input_digest':digest},ensure_ascii=False))
