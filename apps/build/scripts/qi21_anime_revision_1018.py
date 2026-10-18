"""Scoped, backed-up Daojie anime wording revision. Never deploys or invokes Git."""
from pathlib import Path
import hashlib, json, sys
from qi21_base_swap_tool import Tool, ROOT, MANUAL, SOURCE

NEW = '美术风格底座：国风二维动漫手绘插画。造型概括鲜明，轮廓与内部结构以白描式线条塑形，线条细稳连贯、轻重富有节奏，转折利落且保留手绘笔性；平整分层的清晰色面与简洁明暗色块塑形，辅以工笔分染与薄层罩染，色面边界清楚。采用丰富多彩、明快协调的中国传统设色，主色统领、辅色呼应、点睛色突出，饱和度与对比度层级分明；材质统一于线描设色语言。数字绘画表面洁净平整，线条与设色层次清晰，细节疏密有序；保留彩色连环画的凝练造型与绘画感。'
tool = Tool({'out_dir':'qi21-anime-1018','positive_new':NEW,'positive_old':''})
tool.out.mkdir(parents=True,exist_ok=True)
phase = sys.argv[1]
if phase == 'core':
    before = SOURCE.read_bytes()
    d = json.loads(before)
    assert '动漫插画面貌' in d['art_style_base']['positive_text'], 'Source changed; stop for review'
    d['art_style_base']['positive_text'] = NEW
    d['art_style_base']['_doc'] = '只定义国风二维动漫主风格，以及白描线条、工笔分染罩染、彩色连环画概括造型的辅助语言；丰富多彩的传统设色主次清楚，数字绘画工艺洁净。主体状态、背景、照明、构图与透明承载分别归 types[]、主体事实与 rgba。viggle BasicGuider 不消费独立负向条件，必要画法写入正向。'
    neg=d['art_style_base']['negative_text'].split('，')
    assert '赛璐璐' in neg and '空气透视' in neg
    neg=[{'赛璐璐':'摄影写实','空气透视':'照片级体积明暗'}.get(x,x) for x in neg]
    d['art_style_base']['negative_text']='，'.join(neg)
    changes={
        '背景以工笔淡彩与白描铺陈':'背景按二维动漫场景组织线条与色面',
        '树木山石水面按工笔淡彩程式归纳':'树木山石水面按二维动漫场景的概括方式归纳',
        '器物按工笔程式呈现':'器物按二维动漫道具的线描设色方式呈现',
        '武器与配器按工笔器物程式呈现':'武器与配器按二维动漫道具的线描设色方式呈现',
        '头发以细线分组勾勒，发量与发际线自然':'头发概括为清晰成组的发束，细线交代局部发丝，发量与发际线服从角色设定',
        '面部以细线勾勒轮廓与五官，肤色为平整色面，五官以线造型':'面部采用动漫式概括五官，轮廓与眉眼线条清楚，以简洁分层的肤色色块交代转折，脸型与年龄感服从角色设定',
        '五官比例准确、平面造型':'五官按角色年龄与身份作动漫式概括，面部以线条与简洁色块造型',
    }
    for t in d['types']:
        for f in ['positive_text','rgba_positive']:
            if f not in t:continue
            for a,b in changes.items():t[f]=t[f].replace(a,b)
    pe=d['expand_instruction']['system_prompt_zh']
    old='光源方向、强度、色温；大气透视；整体情绪基调。（透明开时按透明豁免裁剪,只写落在主体身上的光。）照明按用途和来源事实：多视图、脸部与表情设定图采用便于辨认的均匀漫射光；剧情图按实际时段、光源方向与明暗关系组织照明，夜景保留夜色、灯火与受光层次。线描与罩染保持统一画法。\n透明关写环境与背景时笔墨放低频：空间与气氛交给连续平滑的大色面与概括形体，远景按实际场景概括轮廓、剪影与大气透视；工笔、线描、罩染集中于焦点主体与关键部件；光的落点服从主体及画面视觉重心。'
    new='照明服从类型用途和来源事实，以动漫插画的简洁明暗色块、固有色深浅与冷暖层次呈现；来源已给出的光源方向、时段与受光位置逐项保留，不增写摄影布光或写实体积渲染术语。多视图、脸部与表情设定图采用便于辨认结构的均匀漫射光；剧情图按实际场景组织明暗，夜景保留夜色与灯火。（透明开时只写主体受到的照明。）\n透明关时，环境空间按类型句组织，以概括形体、前后遮挡和色相明度层次表达远近，远景适当减少细节，焦点主体的线条和色面清楚。全图沿用国风二维动漫的造型与设色语言。'
    assert old in pe
    pe=pe.replace(old,new)
    old='光照可以写方向/强度/色温,但**不给光效赋色卡词**'
    assert old in pe
    pe=pe.replace(old,'光照保留来源已给出的方向、时段与受光位置，以明暗色块和冷暖层次交代；**不给光效赋色卡词**')
    old='**风格底座的背景句跳过**:美术风格底座中描写背景/远景的句子(如「背景是…山水基底」「远景以多彩晕染」)透明开时不并入终稿,只取其画法/线条/工艺句。'
    assert old in pe
    pe=pe.replace(old,'**类型层环境裁剪**:透明开时裁去类型句中的实体背景与环境叙事，保留其取景、布局、主体照明及状态规则；美术风格底座仅含画法与工艺，完整保留。')
    d['expand_instruction']['system_prompt_zh']=pe
    for s in d['layer_contract']['segments']:
        if s['segment']=='风格':s['art_style_base']='全部定义（国风二维动漫主风格/白描线条/工笔分染与罩染/连环画概括造型/协调多彩设色/洁净数字绘画工艺）'
    d['layer_contract']['updated']='2026-10-18'
    assert SOURCE.read_bytes()==before, 'Concurrent source edit; stop'
    tool.ledger_write(SOURCE,(json.dumps(d,ensure_ascii=False,indent=2)+'\n').encode(),'动漫主风格；类型造型应用；扩写照明；风格职责元数据')
    print('core updated; base chars',len(NEW))
elif phase == 'contract':
    path=MANUAL/'ma_sync/runtime-contract.json';d=json.loads(path.read_text())
    d['modules']['style.gongbi-base']['text']=NEW
    # Keep original MA source fingerprints: they identify the historical baseline.
    n=d['modules']['negative.universal']['text']
    print('universal negative',n)
    d['localRevision']['updated']='2026-10-18'
    d['localRevision']['styleSourceSha256']=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    d['localRevision']['styleDirection']='国风二维动漫为主，白描、工笔与彩色连环画辅助；仅风格工艺，布局照明及来源状态归类型与主体。'
    d['contractSha256']=hashlib.sha256(json.dumps({k:v for k,v in d.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    tool.ledger_write(path,(json.dumps(d,ensure_ascii=False,indent=2)+'\n').encode(),'运行时风格合同随源；重算本地指纹，保留MA历史来源登记')
else:raise SystemExit('unknown phase')
