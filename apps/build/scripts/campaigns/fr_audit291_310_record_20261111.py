"""Register291-310 historical evidence once; preserve all current manuscripts."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';ledger=r/'fr-volumes-current-20261110.json'
c=json.loads(ledger.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(291,311):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];p=Path(z['path']);raw=p.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   cur=cd[n]['files'][role];assert cur['path']==z['path'] and cur['sha256']==h and len(raw)==z['bytes']==cur['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(p),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='ab3717f4ae7efd3c20a0f0f668d101dde3d0a5693890fe5967d73fa6629402f9',digest
all_names=sorted(p.name for p in r.iterdir() if p.is_file() and re.match(r'^chapter(29[1-9]|30[0-9]|310)[-.]',p.name));backups=[name for name in all_names if name.endswith('.pre-main-1108.md')];assert len(backups)==9 and all(name.startswith(('chapter291-','chapter292-','chapter293-')) for name in backups)
names=[name for name in all_names if name not in backups];assert len(names)==159
base_names={Path(bd[n]['files'][role]['path']).name for n in range(291,311) for role in ['screenplay','director-plan','storyboard']}
base_names.update(f'chapter{n:03d}-source-map-1104.md' for n in range(291,311));base_names.update(f'chapter{n:03d}-revision-review'+('-1108' if n<=303 else '')+'.md' for n in range(291,311));assert len(base_names)==100 and base_names.issubset(names)
file_records=[]
for name in names:
 raw=(r/name).read_bytes();file_records.append({'basename':name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
support=[x for x in file_records if x['basename'] not in base_names];assert len(support)==59
file_digest=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in file_records).encode()).hexdigest();support_digest=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in support).encode()).hexdigest();assert file_digest=='1c99d48c087ee063db66329d477cbafa07da05abc4a0c858e7c0e0b17c9e8ea2';assert support_digest=='6dcca8b3b9dc91bca783f0e7d2fcc131214dac1b391ff9e1e14545be65605c23'
current_self_checks=[]
for n in range(304,311):
 name=f'chapter{n:03d}-mainfresh-handoff-v'+('3' if n in [304,305] else '2')+'.json';j=json.loads((r/name).read_text());assert j['summary']['pass'] is True and j['source_sha256']==bs[n]['sha256']
 assert all(j['current_sha256'][role]==bd[n]['files'][role]['sha256'] for role in ['screenplay','director-plan','storyboard']);assert 'Does not replace independent content review' in j['scope']
 current_self_checks.append({'chapter':n,'file':name,'checks':j['summary']['checks'],'scope':j['scope'],'independent_content_review':False})
rows=[(291,12,48,510,'11、28'),(292,14,56,605,'11、28'),(293,12,48,515,'11、28'),(294,14,64,800,'15、29、97'),(295,14,56,605,'8、19、100'),(296,12,56,615,'25、42、60'),(297,14,56,595,'3、9'),(298,14,56,595,'3、5'),(299,14,56,595,'3、5'),(300,14,56,595,'3、5'),(301,12,48,510,'3、5'),(302,14,56,595,'3、5'),(303,16,64,680,'3、5'),(304,16,160,1694,'3、11、42、50'),(305,16,179,1918,'7、11、19、29、34'),(306,16,180,1825,'9、17、24、27'),(307,14,135,1500,'3、7、15、17、20'),(308,16,253,2760,'3、7、15、17、20'),(309,18,182,1906,'3、7、15、19、23'),(310,16,309,3448,'3、7、15、19、23')]
notes='''五层、枯骨崖原计划、两老人分开、未出手/未来灵网沿用；290—292时空伤势、队长境界、身份生死未决
八车/第四车、三色出拳、术法暴露、火化未实施沿用；人数货量、冬春雨、怪物结局、293镖途未决
首张晏留、七张交付/三张留宁、自述符效边界沿用；十一人/十张、付款与后画一张、黑影、时距未决
59声音块、原序、巡夜当夜、V53未署名、窗誓与小兽沿用；自报名拾牌、两遇、年龄磕头窗框、原文压缩待全文独审
止杀牌、跪碎矛盾、楚王原声、父遗剑、血契/万灵体代价沿用；时称迁移、金刚符数字、灵识身份未决
求粮、三息/三十息、47人灵觉、三车粮承诺、咳血前自述及末币源序沿用；时空、粮铜车、先收又持币/两印字未决
左手四指、十二钢弹与三钉分开、金丹判断沿用；重复拔铳取矛、符来源、破防、敌身份死伤、令牌与关系未决
43000斤/92%、37/38阶段、七聚落、12万斤预估、四牌活捉沿用；统计、密使到达、秦于推断、村庄暴露未决
四指、47水路/三疑似源头、一次原型沿用；第三尾鱼、统计路线精确性、灵脉自循环、296—300时空未决
半升客栈、38→43文、横线歇脚、白鹿回忆/柳湾建议、横加竖沿用；暗号次序/十字、两年时距、伤处兵器/战后调度未决
80里/四车、12年见闻、30/300文口述、两队收费沿用；桥结果、银两利润、镖队关系、关前编排未决
四品禁制/五层、三人位、60/30息、12拓本、归刀封皮沿用；潜次/拓图/封口退出、短刀、13/19年与转场未决；map尚未创建是旧记
60年、剑魂伤亡、30里破庙、种果区分、三兽、沉睡三日残碑沿用；雷泽距离、内化剑气、碑种同源与迁移未决
五组P2、80组2369字符、战讯先成交、残左臂右手调度、种子帮会阿石劫晶代价沿用；年份、一副/两副、坊市雪雨剑鞘未决
五组P2、83组2271字符、苍梧先井铁匠回忆、孩子不缩手、六文、文书老人待裁插镜沿用；剑鞘老人告示、日期空间、六文算术未决
五组P2、111组2179字符、资产动机灰市规则、笼内细节、成员承认先看路、蓝光条件沿用；至少200/结余、少女身份、视线时距未决
五组P2、56组1512字符、未署名声、信息止翻身退丝不错、漆黑略白返屋沿用；融合心率、生死定义、恢复组合、窗门19/20年剑魂未决
五组P2、154组3810字符、苏自问答、原数字源序、七鞭背人医棚代价、终声场沿用；署名户数年数境界、突现物件、刀鞘炭血缝针未决
五组P2、98组1543字符、六夜梦七夜复述、直接触墙、确信心声、路线回忆沿用；梦次时距、独孤实体残魂、三气署名、书突现/四字五字未决
五组P2、150组5335字符、滑国源序、残玉简、晏茶未动、支付掰饼停锅诗句原序、棚口官道声场沿用；国年方位、父手儿伤、空碗人物位、玉简诗署名未决'''.splitlines();assert len(notes)==20
report=r/'fr-history-evidence-291-310-20261111.md';fresh=r/'fr-history-291-310-mainfresh-20261111.json';assert not report.exists() and not fresh.exists()
text='''# 第一卷291—310历史证据对账（2026-11-11）

只读审阅者 `/root/fr_history_291_310` 返回；20章未找到绑定当前SHA的全文独立内容审阅＋主fresh完整链。已有修订保留，缺链不表示稿件错误。304—310全文核源诊断、修订、fresh均由作者主线程完成，不能当修前独审；后续仍需当前全文内容独审，不只检查已列五组局修。

唯一当前执行入口为chapterNNN-polished-storyboard-1104.md:5及同章三稿；source-map仅核源对照，无额外执行/汇编件。顶部159现用证据件＝60稿＋20map＋20revision-review＋59支持件，另291—293九份.pre-main-1108.md备份单列；预算不叠加，未读备份子目录。

|章|单元／镜／秒|最新revision-review依据|已有修订与开放项|
|---|---|---|---|
'''
for (n,u,shots,seconds,lines),note in zip(rows,notes):text+=f"|{n}|{u}／{shots}／{seconds}|chapter{n:03d}-revision-review{('-1108' if n<=303 else '')}.md:{lines}|{note}|\n"
text+='''
291—303旧状态main_review_only_pending_independent，304—306旧blocked_worker_models_unavailable，307—310旧deferred_user_authorized_main_only_models_unavailable；这些历史模型故障不表示本会话当前不能审。

主点验294 static:4的single-agent offline static only、304修订3/11/42/50、305修订7/29/31/34、310修订3/7/19/23及其fresh14—21：主线程自验不是独立内容意见。304/305当前fresh为v3，306—310为v2；主另核7份当前源/三稿SHA一致及scope，694/778/789/598/1081/801/1306项只属作者自验。对应structure-v2均由探子核匹配；其余16旧handoff/structure指纹不匹配现稿。305v1为777/778、pass=false，保留失败事实。各write-state旧指纹不得重放；旧map的压缩对白、九文、许可触墙、删玉简等建议不重新施回现稿。

审阅者只读身份probe两次exit0，结构probe exit0：80输入及159证据/9顶部备份从2026-11-10T16:09:17.117832Z至16:16:08.630484Z未变；20章场头/名/秒、镜号唯一、场镜合计、5—15秒无错误，304—310用分场四位号。工具编排在成功尾probe后因未使用TextEncoder抛ReferenceError，另算聚合exit0，无文件写入。

[主身份核验](fr-history-291-310-mainfresh-20261111.json)：80输入聚合ab3717f4ae7efd3c20a0f0f668d101dde3d0a5693890fe5967d73fa6629402f9；159证据聚合1c99d48c087ee063db66329d477cbafa07da05abc4a0c858e7c0e0b17c9e8ea2；59支持件聚合6dcca8b3b9dc91bca783f0e7d2fcc131214dac1b391ff9e1e14545be65605c23，均由主独立重算匹配。80输入按章291→310及source→screenplay→director-plan→storyboard，UTF8每行chapter TAB role TAB absolute_path TAB sha256 TAB bytes LF；证据按basename排序，每行basename TAB sha256 TAB bytes LF。源baseline无bytes，现读字节数单列。

支持件用途：static-validation单作者静态；handoff-before改前输入；handoff-review作者诊断；write-state旧生成状态；mainfresh-handoff声源镜自验；structure结构自验；progress-update待独审状态。完整逐件身份在主JSON，不能以件名review或pass=true替代独立性核查。

未作20章全文语义重审或生产验收；TTS、真人读时、排演、动态与观众未验。已做实施不重放，下一历史批311—330。
'''
backup=r/('fr-audit291-310-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for p in [ledger,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(p,backup/p.name)
report.write_text(text);fresh.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'evidence_159_digest':file_digest,'support_59_digest':support_digest,'inputs':inputs,'evidence_files':file_records,'support_files':support,'preserved_top_level_backups':backups,'current_self_verifications':current_self_checks,'reviewer':'/root/fr_history_291_310','main_point_checks':['chapter294-static-validation-1108.json:4','chapter304-revision-review.md:3,11,42,50','chapter305-revision-review.md:7,29,31,34','chapter310-revision-review.md:3,7,19,23','chapter310-mainfresh-handoff-v2.json:14-21'],'boundary':'Current identity and historical scope only; independent full content review pending.'},ensure_ascii=False,indent=2)+'\n')
for n,u,shots,seconds,lines in rows:
 cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-11',evidence_audit=report.name,evidence_audit_scope='159 current evidence files and9 old backups identified;80 inputs/59 supports identity checked; no full semantic rereview.',historical_execution_metrics={'units':u,'shots':shots,'seconds':seconds,'source':report.name,'not_content_acceptance':True},next_action='Reuse current revisions and completed fixes; current full independent content review and main fresh still needed. Do not rerun historical repairs or audit.')
 if n>=304:cd[n]['historical_review_author_is_implementer']=True;cd[n]['current_self_fresh']=next(x['file'] for x in current_self_checks if x['chapter']==n)
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(291,311)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='29 reusable chapters;018 postfix review and019 full review active. Historical001-258/271-310 registered;259-270 closed skipped. Next history311-330.';ledger.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|291—310历史证据|对账完成；主80/80输入、159证据及59支持件聚合匹配，七份当前fresh身份另核|[对账报告](research/fr-history-evidence-291-310-20261111.md)、[主身份核验](research/fr-history-291-310-mainfresh-20261111.json)|304—310原作者诊断不能代独审；沿用已修，只补当前全文独审；下批311—330|\n'+anchor,1);old=next(l for l in s.splitlines() if l.startswith('当前29章可复用（'));s=s.replace(old,'当前29章可复用（001—017、259—270）。018四行局修完成，由 `/root/fr018_postfix_review` 定点独审；019由 `/root/fr019_full_review` 全文独审。历史001—258、271—310已登记，下一历史批311—330；当前无稿件写入者，已完成且输入未变不重做。',1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']=c['next_action'];p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'prd.md';s=p.read_text();s=s.replace('018／019只读全文独审、291—310只读历史对账在途，当前无稿件写入者。','018局修后独审、019全文独审在途；291—310历史对账及主80输入/159证据/59支持件核验已登记，下一历史批311—330。当前无稿件写入者。',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();s=s.replace('018／019只读全文独审及291—310历史对账现已启动，无稿件写入者。','018四行局修进入定点独审，019全文独审在途；291—310历史对账及主身份核验已登记，下一历史批311—330。无稿件写入者。',1);p.write_text(s)
print(json.dumps({'pass':True,'input_checks':80,'evidence_files':159,'support_files':59,'current_self_fresh_checks':7,'historical_registered':[291,310],'input_digest':digest}))
