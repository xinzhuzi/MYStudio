from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]]);c=next(x for x in d['volume1']['chapters'] if x['chapter']==35);assert c['status']=='current_full_review_in_progress'
report=r/'chapter035-independent-full-20261111.md';assert not report.exists();report.write_text('''# 035现稿全文独审与主核源裁决

`/root/fr035_full_review`只读回传；主转存。`pass=false`，P2=3、P3=4。历史对账不重做，033/034及已闭合章不在本次范围。

S为baseline第35章原著；SP/DP/SB为`chapter035-polished-{screenplay,director-plan,storyboard}-1102.md`；六表为`chapter035-{opening,history,gu-trial,return-scroll,give-scroll,ending}-shots-1105.md`。无I，本章六表为实际执行入口。

1. **P2 开场失控条件与代价缺载体**：S15—21写三气挤撞、意念稍偏或外来灵力惊动即可绞碎经脉，郁诊断丹田随时炸；晏知道力量可杀世家也会反噬。现SP9—17及A表13—17只有疼痛、出汗、七日禁运功。补源内诊断/短旁白，保“未主动运功”。
2. **P2 族史压迫与灭证动机被泛化**：S73—74十三代祭司、六百年冒追杀培蛊；S88—96九名元婴、杀婴/搜魂/焚经/毁坟、公开庆贺及证据被销毁/举证者斩草除根；S150丹塔若留活物则牌子重刻。现SP61/69/73及历史表17/21/23仅泛述养六百年、灭族令、挂灯庆贺，未承载活物—验血牌因果。补少量源内关键代价/毁证关联，仍由郁叙述，不拍全知史；核S84—92讲灭族→按枝擦伤顺序。
3. **晏接收传承的异常证据与被动入身被削弱**：S126此前天赋者从未如此响应；S134千年牺牲与血祭后身躯相连；S166竹简承载十三代以满族性命换来的天道结论；S188母亲临死托付二十年、文字从未这样亮；S194—196气旋绷紧、口诀先以律动逼身体记下。现SP101/121/141/157—167及E表10—18多为别乱动、能容三色、养蛊/口诀、字亮疼后等稳定。补按原时点的主观声画；被动记入不等于掌握口诀或气海稳定。
4. **P3 祖先发现被改弱且误加母亲归属**：S59郁说三气“压根并不互斥”；SP51/历史表12改“她说，祖先…未必天生就不能共存”，削弱确定性并让“她”接母亲。恢复郁所述确定性，不新增母亲直接转述；仍不作客观史实认证。
5. **P3 末句与红气动作顺序倒置**：S254先“不懂法术”→扣紧弹丸、红气渗入/凡铁暗光、盯火把→“但我会扔”。现SP197—201/F15—16为警告→红气→整句。按源时点分开两句，不增加投掷。
6. **P3 横木同次动作可能执行两遍**：S246一次横木砸入门槽；SP187已给木撞声，F06与F09均写完整动作/闷响。明确同一次声音先行回切，或F09保留已卡状态，不能拍两次。
7. **P3 F01睁眼重复风险**：S232闭眼无睡意、236再睁；现SP181“睁着眼”，E24未闭眼，F01又写睁眼。明确持续睁眼状态，或恢复有据闭眼→睁眼，不重复无源动作。

## 覆盖与边界

完整读S1—254、SP1—201、DP1—65、SB1—47、source-map1—37及六表全部文字/134镜；邻源仅034:265—299、036:1—60。两账独立：旧15单元655秒；六表30/18/28/18/24/16镜、242/158/227/148/197/131秒，总134镜1103秒；不相加。只读Python最终exit0；三稿对白与六表署名发声逐字一致。最高纸面负荷B03=27/10=2.7字/s。首次解析将衔接引用误算为新增声，修解析后通过，未据误报改稿。十份输入末SHA与开读一致，源34/35/36与baseline一致。

正确保留：火星自行熄、右手按腹/至少七日禁运功、先选后开暗扣、两布→荷叶→药棉、丹塔禁混在培蛊前、抵腕针未刺且先于共振、蛊外显两人可见而体内气主观、仅两次收缩、蛊归郁/简归晏、旧魂仅晏听、白发身份未定、未投掷。两日间隔/铁珠铁丸数量/第三次/家史真实性/35→36战斗桥及药篓未逐步过程均不擅补。真实TTS、桌读、走位、安全、动态、素材、观众、195秒生产门未验。
''')
c.update(status='targeted_repair_ready',current_independent_pass=False,reviewer='/root/fr035_full_review',writer=None,owner=None,p2_groups_open=3,p3_groups_open=4,primary_findings_verified=True,next_action='Full review recorded. Primary must verify seven findings, then targeted repair only; no history replay or full review repetition.')
c.setdefault('evidence',[]).append(report.name);c['capacity_decision']={'status':'primary_reviewed_findings_ready','date':'2026-11-11','reason':'Restore source-grounded risk, history, transmission and exact event order without asserting objective clan history.'}
s='当前44章闭合（001—032、259—270），现SHA与证据直接复用。033八组修复作者收尾自审中；034三组定点修复在途；035全文独审已落盘，3P2/4P3经主核源待定点修复。已完成初审、闭合章及全卷历史对账不重复。';d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='44 closed reusable.033 repair finishing;034 repair active;035 full review recorded with seven verified findings, targeted repair next. No replay.';j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+s;out[p]='\n'.join(lines)+'\n'
out[paths[-1]]=old[paths[-1]].decode()+'\n'+s+' 本条取代此前在途快照。\n';b=r/('fr-register035-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir();
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print(json.dumps({'registered':35,'report':str(report),'closed':44},ensure_ascii=False))
