"""Register271-290 returned evidence audit once; no manuscript writes or repair reruns."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil,re
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json'
c=json.loads(p.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(271,291):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];fp=Path(z['path']);raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   q=cd[n]['files'][role];assert q['path']==z['path'] and q['sha256']==h and len(raw)==z['bytes']==q['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(fp),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest()
assert len(inputs)==80 and digest=='6741eb199e41d0a679d32290984bc127d20edf6db40cac9969a83bddf397a191',digest
expected_extra={
'chapter278-handoff-inputs.json':'9eeafc25de2b5babb7432098dbfe32431b7cd87f281179bacf0c8189d717ede6',
'chapter278-handoff-revision.md':'aa159a0633e517b0e1a4e6072a9ddbd680f5feadb6220a3c70b4036a6a773596',
'chapter278-handoff-static-audit.json':'6afadc1a0c8ef275ee6856ecf02f25af70d45445da73db398d81bb1ac113c347',
'chapter278-handoff-verification.json':'da1ee029b1b51226c18b3b5a7979022de70693e40e9d5d5611609a6ac1f7ab38',
'chapter278-handoff-verification-v2.json':'a9624b4f2337b16a50b2a73cd40280af533aaa51f3e7365989fa68cfb983bad3',
'chapter278-mainfresh-handoff.json':'30829dd7a8e3f19a68c2c55ddf17ebd1d0d9a5f6170d2a3b9c2990674861c64d',
'chapter280-handoff-before.json':'bddddd62a46264380a41d25ae11e6d6df905cf508cd707015f4866e9218b0808',
'chapter280-handoff-review.md':'dde19001bb923b907db18c1e44818c13cb130d72559913062c1aaec2d08dff9c',
'chapter280-handoff-revision-review.md':'0910d4ad64518c30c8072f5ef2294c0e2ea828c5b9adff8ffd4801cc2f32e0c8',
'chapter280-handoff-structure.json':'25bc4402e7977e7d86ca2f71b6ace1c7ba2dc1187475dd13034ec0f86099d5a8',
'chapter280-mainfresh-handoff.json':'6aa52f35640e46f6673b704e732bf6e18ad98ff8b411471a6991a7fd362c6538',
'chapter280-mainfresh-handoff-v2.json':'7c290fcb0878a89e85dd5bba3b9d8369be488cd6c5e9fa46497f9c181927c9aa'}
support=[]
for name in sorted(expected_extra):
 raw=(r/name).read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==expected_extra[name]
 support.append({'path':str(r/name),'sha256':h,'bytes':len(raw),'role':'evidence_support_not_execution'})
all_files=sorted(fp.name for fp in r.iterdir() if fp.is_file() and re.match(r'^chapter(27[1-9]|28[0-9]|290)[-.]',fp.name))
preserved_backups=[name for name in all_files if name.endswith('.pre-main-1108.md')]
assert len(preserved_backups)==9 and all(name.startswith(('chapter288-','chapter289-','chapter290-')) for name in preserved_backups)
files=[name for name in all_files if name not in preserved_backups]
expected=sorted([Path(bd[n]['files'][role]['path']).name for n in range(271,291) for role in ['screenplay','director-plan','storyboard']]+[f'chapter{n:03d}-source-map-1104.md' for n in range(271,291)]+[f'chapter{n:03d}-revision-review-1108.md' for n in range(271,291)]+list(expected_extra));assert files==expected,(len(files),len(expected))
rows=[(271,14,42,550,9,20),(272,18,54,755,9,21),(273,12,36,490,9,15),(274,14,42,560,9,15),(275,16,48,640,9,16),(276,18,54,720,9,17),(277,16,48,640,9,15),(278,16,138,1236,13,23),(279,16,48,640,9,16),(280,14,88,905,7,1),(281,12,36,480,9,15),(282,16,48,630,9,18),(283,16,48,630,12,17),(284,14,42,560,12,16),(285,16,48,640,12,18),(286,14,42,560,12,15),(287,14,92,1240,13,16),(288,16,48,640,11,16),(289,16,48,640,11,16),(290,12,48,525,11,16)]
notes='''余火、断钉与实际声词沿用；年龄/同行年数、季节、270会合、鸟与饼、油布走位未决
实收一文、渡资改词、母子/善堂证据层级及实际声词沿用；铜钱/饼、夜航时序、柴刀收回、蛇尾、273转场未决
剪发藏发轮值、师父主观回忆及实际声词沿用；毁容范围、残剑伤臂、苏实体/人数、禁火路线、外化对白未决
摊铺矿渣交易、27营生记录、河税决心与声词沿用；矿渣灵气、毒烟后果、钱数/矿图来源、地点路线旧伤未决
分卡报价、船娘不判死/离断、扣包落水分开、炭笔声词沿用；税算、翻船数、货包沉河说法、船夫身份与276衔接未决
17/43不合并、三次爆破、贯臂拖延上岸及声词沿用；灵网机制、船位时间、剑回囊、资金与左手夹符改右手未决
询价非交割、赌局悬赏非客观认证及声词沿用；32/30币种、玉佩效力、旧伤装备、木雕来历与278时空未决
114组原引文、断言强度、无灵气不可见云纹、报告指令、193规则V.S.、游发讯、138镜新版沿用；15钱/17人、船路线回收、镜135残骸、233/311残句、远观视线及277—279时空未决
册籍族属冲突、逐项问答、认人回忆、两张符及声词沿用；地点/查册次日、藏点、纸色草梗、三掌/一脚伤叙未决
五组P2修复已实施：33组原声、沉默拆缝、穿衣笑后九年记忆、动机危险载体、末场声词同步；取衣睡姿、钉位针眼、去年/三年前、五年前拿针、雪地/铁笼记忆、年龄与迁移未决
七天/两次外出、强逼残渣失败记忆、外层薄渗血伤痛、有限碎冰试验沿用；280衣物针具迁移、冰块行囊天色与后遗症未决
不收学费/轮饭、1/2/10天人数、40石板、十五天契约及声词沿用；非线性时间季节、纸墨搬运、识字者、定订课堂改写、追踪墨脸未决
婆婆对白、30/37矛盾、焦黑/未熟、吃饱/不饱、鞋步枯草咳嗽黑猫沿用；饼量份数、阿石饼来源、女孩计数、婆婆身份与三年跨度未决
识字实际三联、三路记忆分立、人皇淡字四石/第四天错唱/轻触沿用；书纸来源交接、童谣文字、283—285时空及三气未决
兽香追兵判断、残页区分、劣酒质疑/少年旧话/三日溪边夜谈沿用；地名雨时长、284—286重聚伤势时空、感知三气未决
完整入学问答、婆婆未证听见、钉不补移动、写坐修凳在吹灯前沿用；镇规、卡片套/张、钉位年龄及285—287衔接未决
41条对白按序、42→92镜、匠人自问命名/一粒/拒绝再试/收箱黑烟沿用；器物142/99、失败统计、能量节点、缓震阀及286—288地点时序未决
四十天联合印威胁、砚碎干柴、识字局限、刀痕非官差沿用；12/6人、私塾地点人数季节黑烟、字卡残页及夜间顺序未决
四成消耗、瘦者不判死、毒逼出/传闻/气息判断沿用；标题药瓶、左右伤持刀与290近心伤、刀痕、两日/第三日/数日后、五成实得未决
近心伤封脉、靴底线索、网络风险、登记后分配尾随改编沿用；三日前与289时序、游关系、47/12/安置、敌数兵器去向未决'''.splitlines();assert len(notes)==20
report=r/'fr-history-evidence-271-290-20261110.md';fresh=r/'fr-history-271-290-mainfresh-20261110.json';assert not report.exists() and not fresh.exists()
text='''# 第一卷271—290历史证据对账（2026-11-10）

只读审阅者 `/root/fr_history_271_290` 返回，限定顶部112件：60三稿、20核源底稿、20修订记录、12交接支持件。未找到任一章绑定当前SHA的全文独审＋主fresh完整闭合链；现稿与既有局修保留，缺链不等于稿件有错。不得重放已完成修复。

当前唯一执行入口均为chapterNNN-polished-storyboard-1104.md:5及同章配套剧本/导演；278源图25行起为场—正文—落点映射，不是另一执行镜表。没有额外执行/汇编件，旧预算不叠加。

审阅者亲跑只读probe exit0：80源稿baseline/current身份匹配；20章编号/名称/秒同步、镜号唯一、分场合计及5—15秒通过，结构错误为空；280镜号为01-01至14-04，其余为全章数字。80输入15:44:00.436256Z至15:50:47.656540Z、顶部112件15:48:55.557790Z至15:50:47.656540Z均未变。主亲核80输入和12支持件SHA及112证据文件名；顶部另有288—290的9份.pre-main-1108.md旧备份，保留且不算当前执行稿。登记命令初跑exit1在文件清单断言处停止（尚未写报告或台账），按已核备份身份分类后重跑，见[主身份核验](fr-history-271-290-mainfresh-20261110.json)。

80输入聚合SHA `6741eb199e41d0a679d32290984bc127d20edf6db40cac9969a83bddf397a191`。UTF8每行chapter、role、absolute_path、sha256、bytes以TAB分隔加LF；章271→290，每章source→screenplay→director-plan→storyboard。源baseline无bytes，字节数取现盘，不虚称原清单提供。

|章|单元／镜／秒|最新依据|已修沿用及开放项|
|---|---|---|---|
'''
for (n,u,shots,seconds,line,source_line),note in zip(rows,notes):
 evidence=f'chapter{n:03d}-revision-review-1108.md:{line}；source-map-1104.md:{source_line}'
 if n==278:evidence='chapter278-handoff-revision.md:13、49'
 if n==280:evidence='chapter280-handoff-revision-review.md:7、42'
 text+=f'|{n}|{u}／{shots}／{seconds}|{evidence}|{note}|\n'
text+='''
主代理完整读278修订交接及280修前独审、修后交接，点验以下身份区别：

- 271—277修订报告37/37/36/38/38/38/39行均声明主线程复核非独审；279标题虽写独立复核，36行明确不是独立终审；281—290也未完成独立审校。
- 278旧48镜640秒已被138镜1236秒新版替代；不能沿用旧缓和语断言当前文本。mainfresh-handoff四稿SHA匹配只是self-verification，修订交接3/54行要求独立内容复核。416项自验不可代独审；只补缺少审阅，不重做114组原引文恢复。
- 280已具修前全文独审pass=false（handoff-review.md:1、3、14—18）和五组修订交接。修前SHA不等于现稿；当前mainfresh-handoff-v2三稿SHA匹配，旧fresh/structure是页首状态更新前指纹。修订报告44/46明确独立新复审未完，后续应沿用修前全文覆盖，核修复改动与影响，不重复五组实施。旧42镜535秒不计入现预算。

以上仅历史证据、执行入口、指纹与结构核验，未代20章全文语义审阅或主内容验收。TTS、桌读、排演、动态、观众与生产均未验，纸面长稿不等于195秒门通过。下一历史批291—310。
'''
backup=r/('fr-audit271-290-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
report.write_text(text);fresh.write_text(json.dumps({'pass':True,'checks_passed':80,'protected_80_digest':digest,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'inputs':inputs,'top_level_files':files,'preserved_top_level_backups':preserved_backups,'additional_support':support,'additional_execution_files':[],'reviewer':'/root/fr_history_271_290','main_read_reports':['chapter278-handoff-revision.md','chapter280-handoff-review.md','chapter280-handoff-revision-review.md'],'boundary':'Identity and historical evidence only; no20-chapter semantic acceptance or production verification.'},ensure_ascii=False,indent=2)+'\n')
for n,u,shots,seconds,line,source_line in rows:
 cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit=report.name,evidence_audit_scope='112 top-level artifacts, corresponding resume sections,80 inputs; main80-input and12 support SHA checks and278/280 handoff reading. Not full current content review.',historical_execution_metrics={'units':u,'shots':shots,'seconds':seconds,'source':report.name,'not_content_acceptance':True},next_action='Reuse latest drafts and completed local repairs; complete missing independent content review and main fresh. No repeated historical audit or repair.')
 if n==278:cd[n]['next_action']='Review current138-shot1236-second version independently; reuse114 restored original quote groups. Ignore old48-shot640-second execution budget.'
 if n==280:
  cd[n]['prior_full_review']='chapter280-handoff-review.md';cd[n]['implemented_repairs']='chapter280-handoff-revision-review.md';cd[n]['current_self_fresh']='chapter280-mainfresh-handoff-v2.json';cd[n]['next_action']='Reuse prior full review coverage and five completed repairs; independently review current repair diff and affected content, then main fresh. Do not repeat implementation.'
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(271,291)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='27 reusable chapters;016 postfix review returned pass;017 postfix review active. Historical001-258 and271-290 registered;259-270 closed skipped. Next history291-310.';p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|271—290历史证据|对账完成；主80/80输入及12支持件SHA匹配，278/280新版身份单列|[对账报告](research/fr-history-evidence-271-290-20261110.md)、[主指纹核验](research/fr-history-271-290-mainfresh-20261110.json)|278只审138镜新版；280五组修复已实施只接独审；下批291—310|\n'+anchor)
old=next(line for line in s.splitlines() if line.startswith('当前27章可复用（'));s=s.replace(old,'当前27章可复用（001—015、259—270）。016五项局修完成，由 `/root/fr016_postfix_review` 独立定点复核；017局修完成，由 `/root/fr017_postfix_review` 独立定点复核，均尚待主fresh。历史001—258、271—290已登记，259—270闭合跳过；下一历史批291—310。已完成且输入未变的内容不重复实施或全文审阅。');p.write_text(s)
p=t/'prd.md';s=p.read_text();old='当前两章写入者与证据见offline-progress.md。';new='271—290历史对账及主80/80输入、12支持件指纹也已登记；278新版与280已实施五组修复均保留。016／017局修完成进入独审；所有权与证据见offline-progress.md。';assert old in s;s=s.replace(old,new,1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();old='下一历史批271—290，跳过已闭合259—270。';new='271—290历史对账及主80/80输入、12支持件指纹已登记，278新版及280修复待独审身份已明确；下一历史批291—310，跳过已闭合259—270。';assert old in s;s=s.replace(old,new,1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:27 reusable chapters; historical001-258 and271-290 registered,259-270 closed skipped. Latest main80/80 inputs and12 supports match.016 postfix review passed;017 postfix review active;main fresh pending. Next history291-310.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'checks_passed':80,'protected_80_digest':digest,'support_checks':12,'top_files':len(files),'historical_registered':[271,290]}))
