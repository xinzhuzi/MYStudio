#!/usr/bin/env python3
"""Apply the six-zone character-card type and preserve its layout through PE."""
from pathlib import Path
import json
import shutil
import hashlib

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/daojie-charsheet-six-zone-1016'
SOURCE=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
NODE=ROOT/'apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_api_pe.py'
LAYOUT=('同一角色的横向角色设定卡，固定六个图像区。左侧约占画面宽度四成，独立放置一幅自然站姿的主视觉全身立绘。'
'右侧分上下两排：上排约占右侧高度七成，等宽并列三格，自左至右依次为正面平视、朝画面右侧的纯九十度侧面平视、背面平视，各一幅完整全身像；'
'下排等宽并列两格，左格一幅面部近景，右格一幅角色腰部衣装与佩挂连接结构的局部特写。'
'全卡共有四幅全身像、一幅面部近景和一幅局部特写，六区内容一一对应，区间净空均匀，边界清楚。'
'三视图均为同一角色的自然标准站姿，人物等高，头顶与脚底分别对齐，各格完整呈现来源设定中的身体与衣装。'
'脸型五官、发型发饰、服装配饰与配器结构逐区一致；局部特写取自该角色身上实际存在的结构。')


def save(p,new):
    old=p.read_bytes();data=new.encode();assert old!=data,p
    b=OUT/'backups'/p.relative_to(ROOT);b.parent.mkdir(parents=True,exist_ok=True)
    assert not b.exists(),b
    shutil.copy2(p,b);assert p.read_bytes()==old
    p.write_bytes(data)
    rows=json.loads((OUT/'changes.json').read_text()) if (OUT/'changes.json').exists() else []
    rows.append({'path':str(p.relative_to(ROOT)),'backup':str(b.relative_to(ROOT)),
        'before':hashlib.sha256(old).hexdigest(),'after':hashlib.sha256(data).hexdigest()})
    (OUT/'changes.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')


def data_stage():
    original=SOURCE.read_text();d=json.loads(original)
    c=next(t for t in d['types'] if t['zh']=='设定卡')
    assert '数格细节特写' in c['positive_text']
    c['positive_text']='\n'.join([LAYOUT,*c['positive_text'].splitlines()[1:]])
    c['rgba_positive']=c['positive_text']
    c['negative_text']=c['negative_text'].replace('姿势重复','正侧背机位重复')
    c['purpose']='横向固定六区角色设定卡：左侧主立绘，右上正/纯侧/背三视图，右下面部与腰部连接结构特写；共四幅全身、一幅面部、一幅局部。主体句只写身份事实；档案文字与色卡后期合成，版式由类型层锁定，透明与普通分支同文。'
    c['postprocess']='档案文字、格名与色卡后期合成；专项武器、表情或灵兽资料另做专项图。'
    c['recipe_version']='v0.2(1016 固定六区，实图验证结果见本轮报告)'
    # Only the selected type changes, including no art-style changes.
    prior=json.loads(original);prior['types'][next(i for i,t in enumerate(prior['types']) if t['zh']=='设定卡')]=c
    assert prior==d
    save(SOURCE,json.dumps(d,ensure_ascii=False,indent=2)+'\n')
    (OUT/'layout-text-v1.txt').write_text(LAYOUT+'\n')
    print('data updated')


def code_stage():
    s=NODE.read_text()
    a='                transparent: bool, subj: str) -> list[str]:'
    assert s.count(a)==1
    s=s.replace(a,'                transparent: bool, subj: str, type_pos: str = "") -> list[str]:',1)
    a='    pos_c = _squash(pos)  # 空白归一:"软 3D"与"软3D"判同\n'
    b=a+'''    # 设定卡首段为固定版式；首稿、补发和模型救回均须原样保留。
    # 文本锁只保证入图指令，图片计数及机位仍须实际看图验收。
    for entry in (_load_bases_node().get("types") or []):
        if (entry.get("zh") == "设定卡"
                and (entry.get("positive_text") or "").strip() == type_pos.strip()):
            layout = type_pos.splitlines()[0].strip()
            if layout and _squash(layout) not in pos_c:
                v.append("设定卡版式丢失或改写:类型句首段须逐字保留")
            break
'''
    assert s.count(a)==1;s=s.replace(a,b,1)
    for a in ['_self_check(_p2s, neg_tokens, bool(透明模式), subj)',
              '_self_check(pos_s, neg_tokens, bool(透明模式), subj)',
              '_self_check(_p3s, neg_tokens, bool(透明模式), subj)']:
        assert s.count(a)==1;s=s.replace(a,a[:-1]+', type_pos=base)',1)
    a='        user_with_ctx = direct + "\\n\\n" + "\\n".join(ctx)\n'
    b='''        for entry in (_load_bases_node().get("types") or []):
            if entry.get("zh") == "设定卡" and (entry.get("positive_text") or "").strip() == base:
                ctx.append("[设定卡版式锁] 类型句首段逐字保留，仅润色人物描述，不增减图像区、视图、文字或色卡。")
                break
'''+a
    assert s.count(a)==1;s=s.replace(a,b,1)
    compile(s,str(NODE),'exec');save(NODE,s);print('code updated')


if __name__=='__main__':
    import sys
    {'data':data_stage,'code':code_stage}[sys.argv[1]]()
