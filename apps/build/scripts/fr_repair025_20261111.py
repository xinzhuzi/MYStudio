from pathlib import Path
import json,hashlib,shutil
R=Path('.trellis/tasks/10-27-script-narrative-translation-cure/research')
d=json.loads((R/'fr-volumes-baseline-20261110.json').read_text())
paths={k:Path(v['path']) for k,v in next(x for x in d['volume1_drafts'] if x['chapter']==25)['files'].items()}
paths['source']=Path(next(x['path'] for x in d['volumes'][0]['chapters'] if x['chapter']==25));paths['trial']=R/'chapter025-shot-breakdown-1105.md'
expected={'source':'c7650a1be834e025b94a279f8d7c8c6bb221bde796da35628189a18d7b308808','screenplay':'9c3ccccb117713d0ced3bdc095b68d82125794aa23c2e4be8994c247f7584550','director-plan':'0e87d55d0cb510c708cd0e3c3ce93b815d50f2c3e50d92b081100bdb5eb2e567','storyboard':'f0646133e5e9287dd3e60244044540a3b7fe73f177599e49fda3e2f0e3a5edb3','trial':'26fc1b26953221410b5c85a1590bedbca464c1a1583c8bd2ed56925fc36c2f62'}
B=R/'chapter025-review-backup-20261111';B.mkdir(exist_ok=False);m={}
for role,p in paths.items():
 b=p.read_bytes();sha=hashlib.sha256(b).hexdigest();assert sha==expected[role],role
 if role!='source': shutil.copy2(p,B/p.name)
 m[role]={'path':str(p.resolve()),'sha256':sha,'bytes':len(b),'backup':str((B/p.name).resolve()) if role!='source' else None}
(B/'inputs.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
voice='她看了一眼鲁械的膝骨，没把“截肢”两个字说出口。'
patches={
'screenplay': [('巫千面嘴动了一下，终究没说“截肢”。她嚼碎毒草，俯身敷上去。鲁械手指扣紧木棍。','巫千面嘴动了一下，终究没说“截肢”。\n\n旁白：'+voice+'\n\n这句旁白只给观众，与巫望膝、停口同拍，场内人物听不见；不把这一念演成必须截肢的决定。她随后嚼碎毒草，俯身敷上去。鲁械手指扣紧木棍。')],
'director-plan':[
('表演与难点　巫把截肢的话咽下，只做观察与敷药；鲁械靠棍撑住，避免烂口直拍。','表演与难点　巫把截肢的话咽下；旁白与她望膝、停口同拍，只给观众，场内人物听不见，也不演成必须截肢的决定；随后嚼药敷腿。鲁械靠棍撑住，避免烂口直拍。'),
('环境与动作声　湿药轻响、紧喘，旁白解释感染与暂吊经络。','环境与动作声　湿药轻响、紧喘，旁白依次承载伤势恶化、未说出口的截肢念头与暂吊经络。'),
('旁白：这些毒草还在勉强吊着腿部残存的经络。','旁白：'+voice+'\n\n旁白：这些毒草还在勉强吊着腿部残存的经络。'),
('袖破后晏看血再看槽。','袖破后晏先看槽，再低头看右掌新渗的血。'),
('巫不动药碗不等于袖手救成，独孤仍守口。','巫慢慢压低药碗，未喂药、未施术，不等于救成；独孤仍守口。')],
'storyboard':[
('巫千面嘴动了一下，终究没说“截肢”。她嚼碎毒草，俯身敷上去。鲁械手指扣紧木棍。','巫千面嘴动了一下，终究没说“截肢”；旁白与望膝、停口同拍，只给观众，人物听不见，不演成必须截肢的决定。随后她嚼碎毒草，俯身敷上去。鲁械手指扣紧木棍。'),
('旁白：这些毒草还在勉强吊着腿部残存的经络。','旁白：'+voice+'<br>旁白：这些毒草还在勉强吊着腿部残存的经络。'),
('动作与环境声　湿药轻响、紧喘，旁白解释感染与暂吊经络。','动作与环境声　湿药轻响、紧喘，旁白依次承载伤势恶化、未说出口的截肢念头与暂吊经络。')],
 'trial': [('旁白：“三个酒杯大的烂口，已经渗出黑水。”不说出“截肢”。','旁白：“三个酒杯大的烂口，已经渗出黑水。”旁白续：“她看了一眼鲁械的膝骨，没把‘截肢’两个字说出口。”巫不发声；后句与望膝、停口同拍，只给观众，人物听不见，不演成必须截肢的决定。')]
}
for role,repls in patches.items():
 p=paths[role];s=p.read_text();assert hashlib.sha256(p.read_bytes()).hexdigest()==expected[role]
 for old,new in repls: assert s.count(old)==1,(role,old);s=s.replace(old,new)
 p.write_text(s);print(role,hashlib.sha256(p.read_bytes()).hexdigest())
print('025 only three verified groups changed; both budgets and all original voice retained pending verification')
