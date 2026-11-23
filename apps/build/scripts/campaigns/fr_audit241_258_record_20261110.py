"""One-time registration of returned241-258 audit; main checks72 input identities."""
from pathlib import Path
from datetime import datetime, timezone
import json, hashlib, shutil, re
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text())
bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(241,259):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];fp=Path(z['path']);raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   q=cd[n]['files'][role];assert q['path']==z['path'] and q['sha256']==h and len(raw)==z['bytes']==q['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(fp.absolute()),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest()
assert len(inputs)==72 and digest=='ca84d8ed63212c82de57a3a8245cab2988eb209c2ae5210c92fe8103de5e8d6c',digest
names=sorted(fp.name for fp in r.iterdir() if fp.is_file() and re.match(r'^chapter(24[1-9]|25[0-8]).*\.md$',fp.name))
support=[]
for n in range(241,259):
 name=f'chapter{n:03d}-source-map-'+('1104' if n==258 else '1103')+'.md';fp=r/name;raw=fp.read_bytes()
 support.append({'chapter':n,'path':str(fp),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'role':'historical_support_not_extra_execution'})
expected=sorted([Path(bd[n]['files'][role]['path']).name for n in range(241,259) for role in ['screenplay','director-plan','storyboard']]+[Path(x['path']).name for x in support]);assert names==expected
rows=[(241,12,88,789,4803),(242,12,101,909,4817),(243,12,123,1107,4835),(244,12,179,1611,4859),(245,12,169,1521,4883),(246,12,185,1665,4907),(247,12,189,1696,4931),(248,12,147,1333,4955),(249,12,185,1645,4979),(250,14,173,1491,5009),(251,14,173,1397,5039),(252,16,206,1648,5073),(253,13,140,1124,5101),(254,14,173,1398,5131),(255,13,187,1481,5159),(256,12,113,926,5185),(257,16,153,1228,5203),(258,12,125,999,5217)]
notes='''磨脚、刮药、三年修鞋、火边捡鞋已补；缺水、食材、每日路程与第三次休息未逐项转译，币值、鞋匠、穿脱与240—242跳时未决；242不得强接鞋报废之后
欲冲未冲、已亮罗盘、赵风险判断、雪坡拾鞋已补；三里视听、照护者、安全未决，242—243缺口保留
三短一长、末点与额磕墙同时、征兵声序已补；接收者、国别、47天／8个月、244离矿入镇未决
裂缝矿渣、铜屑、回望、肩伤与隔衣按石已补；征龄、押送、残魂、伤情、石片、245相认未决
收包沿晏已接处理、征兵问改心声、消息婆归巫转述、无据现场拨帘已移除；会合、巫到场、指代未决
清单心声、试收牌、渔火烧图已补；三日／两天、月光、许讲机器、中毒未决
折图黑血干草、解剑擦鞘再背、竹笛记忆无回应已补；中毒、截船、重逢、剑温时序未决
章末先笑再话再灯尸，不前拍249击灯，不定声音主人；路标、死路、阵纹、会合、四层斩二阶未决
晨醒伤手、主观三式、拂剑捡竹已补；250师父身份、识海受力、竹材跳接、185镜容量未决
80镜无据剑名已去，11抽一截归囊标改编，伤妆链已核；剑具剖豹工具、249—251身份会合未决
09右手放油布接13、血迹收刀再抽链已补；原左手冲突、巫移动、药罐、250—252过渡未决
11一家舱内站位、15—16布角衔接已修，鱼贩离船省略；原185不到三个呼吸与04—05纸面镜时差异仍开放；三载／三月、剑位、人钱未决
侧卧盘坐、出血留痕、舱口望北已补；不急核／当夜试、差一文、剑蛊、重复五层与254会合未决
短炭笔、佛台边沿、重新拔草、脸伤措辞已修；船庙、云梦隐仙、币别换面孔未决
130—132抛接币改同镜，12持币点鸦眼分手已修；城名、鬼巷荒原、钱数换脸未决
11次夜改当夜、08末荒风、剑位伤妆已核；鬼巷荒原、石数、触肩传功、四字、师父未决
玉盒入怀、符合并收袖、再伸手、指腹血已补；游去向、钱数、同名手册、258第三日巫同行未决
蹲下、衣襟余饼、掖铜扣、药渣纸包已补；02接饼到07才吃的改编待复审，阿秀时间、铜钱刀剑、人物财物与259接续未决'''.splitlines()
assert len(notes)==18
report=r/'fr-history-evidence-241-258-20261110.md';fresh=r/'fr-history-241-258-mainfresh-20261110.json';assert not report.exists() and not fresh.exists()
text='''# 第一卷241—258历史证据对账（2026-11-10）

只读审阅者 `/root/fr_history_241_258` 完成限定历史对账，未修改源稿。18章现稿与既有局修沿用；所查72文件及230条相关续核未找到绑定当前SHA的全文独审＋主fresh闭合链，登记历史对账完成、内容审阅待补，不能据此判稿件错误或从零重写。

审阅者只读探针exit 0：18源与54稿baseline/current路径／SHA／bytes匹配，单元、镜号、分场和单镜5—15秒通过，结束72输入未变。主代理独立重核72输入SHA和限定顶部文件名：54三稿＋18历史source-map，无另附执行／试稿／独审件；source-map不是执行镜表，不叠加预算。

[主身份核验](fr-history-241-258-mainfresh-20261110.json) 聚合SHA `ca84d8ed63212c82de57a3a8245cab2988eb209c2ae5210c92fe8103de5e8d6c`。UTF-8每行 `chapter<TAB>role<TAB>absolute_path<TAB>sha256<TAB>bytes<LF>`；241→258，每章source→screenplay→director-plan→storyboard。另登记18支持件当前SHA，不将身份检查冒充全文语义审阅。

|章|当前单元／镜／秒|最新续核出处|沿用与开放项|
|---|---|---|---|
'''
for (n,u,shots,seconds,line),note in zip(rows,notes):text+=f'|{n}|{u}／{shots}／{seconds}|volume-one-resume-1102.md:{line}|{note}|\n'
text+='''
主代理已经点验续核4803、4805、5073、5217；252导演35及原著185“从水鬼破水而出，到三具尸体沉入江底，整个经过不到三个呼吸的时间。”现导演明确纸面镜时不是实拍动作时长，仍须动作设计与试剪检验；这一开放问题未解决，不以静态预算通过代替。242—243和243—244跨章记录另见续核4819、4837。

这些条目来自历史核源和修订记录，不是此次18章完整内容独审。既有修复不重复，后续补缺少的当前内容审阅与主fresh；TTS、桌读、动态、观众及生产均未验。下批历史271—290，跳过已闭合259—270。
'''
backup=r/('fr-audit241-258-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
report.write_text(text)
fresh.write_text(json.dumps({'pass':True,'checks_passed':72,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_72_digest':digest,'digest_format':'chapter TAB role TAB absolute_path TAB sha256 TAB bytes LF; source,screenplay,director-plan,storyboard','inputs':inputs,'top_level_markdown_files':names,'historical_support_files':support,'additional_execution_files':[],'reviewer':'/root/fr_history_241_258','main_point_checks':['volume-one-resume-1102.md:4803','volume-one-resume-1102.md:4805','volume-one-resume-1102.md:5073','volume-one-resume-1102.md:5217','chapter252-polished-director-plan-1103.md:35','chapter252 source:185'],'boundary':'Current input identity and selected historical claims only; full content closure not established; production unverified.'},ensure_ascii=False,indent=2)+'\n')
for n,u,shots,seconds,line in rows:cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit='fr-history-evidence-241-258-20261110.md',evidence_audit_scope='18 source-map entries and latest resume sections, source/draft identity; main72-input verification and selected source points. Not full semantic review.',historical_execution_metrics={'units':u,'shots':shots,'seconds':seconds,'source':report.name,'not_content_acceptance':True},next_action='Reuse current revisions; complete missing full content review and main fresh. Do not repeat historical audit or completed repair.')
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(241,259)))
c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='27 reusable chapters.016/017 targeted repair workers active; historical001-258 registered, next historical271-290. Skip unchanged closed259-270; volume2 waits volume1 content/continuity closure.'
p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1
s=s.replace(anchor,'|241—258历史证据|对账完成；主72/72输入SHA匹配，18支持件身份另记，现稿沿用|[对账报告](research/fr-history-evidence-241-258-20261110.md)、[主指纹核验](research/fr-history-241-258-mainfresh-20261110.json)|缺当前全文独审链；252三呼吸与258吃饼顺序另留证；下批271—290，跳过闭合259—270|\n'+anchor)
old=next(line for line in s.splitlines() if line.startswith('当前27章可复用（'))
s=s.replace(old,'当前27章可复用（001—015、259—270）。016／017全文独审已完成，分别由 `/root/fr016_targeted_repair`、`/root/fr017_targeted_repair` 独占局修，尚待不同审阅者复核与主fresh。历史001—258已对账登记，下批271—290；已闭合且输入未变的内容不重复实施或全文审阅。');p.write_text(s)
p=t/'prd.md';s=p.read_text();anchor='> **本轮最新操作边界（2026-10-29）**'
s=s.replace(anchor,'> **2026-11-10 最新离线进度**：27章闭合不变；016／017全文独审已落盘，正在按明确发现局修；241—258历史对账及主72/72输入身份核验已登记，历史001—258不用重扫，下批271—290。当前两章写入者与证据见offline-progress.md。\n\n'+anchor,1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();old='下一内容批016／017，下一历史批241—258，跳过已闭合259—270。';new='016／017全文独审已落盘并转入局修；241—258历史对账和主72/72输入核验已登记，下一历史批271—290，跳过已闭合259—270。';assert old in s;s=s.replace(old,new,1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:27 reusable chapters (001-015,259-270). Historical001-258 registered; latest main72/72 identity checks passed.016/017 full reviews recorded and targeted repair workers active; postfix review/main fresh pending. Next history271-290; do not repeat unchanged completed work.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'checks_passed':72,'protected_72_digest':digest,'historical_audit_through':258,'support_files':18,'metadata_backup':str(backup)}))
