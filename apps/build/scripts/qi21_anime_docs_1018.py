"""Narrow current-manual wording updates with originals retained in the change ledger."""
import json
from qi21_base_swap_tool import Tool, ROOT, MANUAL, SOURCE
base=json.loads(SOURCE.read_text())['art_style_base']['positive_text']
tool=Tool({'out_dir':'qi21-anime-1018','positive_new':base,'positive_old':''})
note='> **2026-10-18 当前执行口径**：道劫以国风二维动漫手绘插画为主，白描线条、工笔分染罩染和彩色连环画造型为辅助；允许动漫式五官概括、清晰发束及简洁分层明暗色块，不把动漫或赛璐璐本身列为禁项。丰富多彩、明快协调，主色、辅色与点睛色层级明确。下文《三国望神州》原文与旧筛选案例仅供来源研究，其“偏写实、非二次元、低对比”不覆盖当前口径。底座只管画法工艺，布局、背景、照明与状态规则归类型，具体事实归主体。\n'
# Every old substring below was read and checked before this script was authored.
pairs={
'README.md':[
 ('**2026-10-16 五法融合底座**：工笔设色与白描线条主导，彩色连环画提供概括造型、透明水彩提供薄透设色、写意水墨提供笔触韵致；中英风格名称并列，主辅设色层级明确，数字绘画表面洁净平整。','**2026-10-18 动漫主风格底座**：国风二维动漫手绘插画主导，白描线条、工笔分染罩染和彩色连环画的凝练造型辅助；清晰色面与简洁明暗色块塑形，传统设色丰富、明快且主次清楚，数字绘画表面洁净平整。'),
 ('- 日式赛璐璐平涂/动漫渲染','- 机械均一勾边、失去结构的贴纸式色块、摄影式体积塑形'),
],
'prefix.md':[
 ('| **一级风格** | 工笔重彩国风修仙；多彩协调、主次分明 |','| **一级风格** | 国风二维动漫手绘插画；多彩协调、主次分明 |'),
 ('| **二级风格** | 工笔线描 · 重彩设色分染罩染 |','| **二级风格** | 白描线条 · 工笔分染罩染 · 彩色连环画概括造型 |'),
 ('### 连环画动漫路线（可选媒介层）','### 连环画动漫路线（当前主风格）'),
 ('**配方全文（风格段可选切换，整句追加）**','**历史试验句（仅供对照，不追加到当前底座）**'),
 ('禁止色块断层/赛璐璐平涂','避免无结构的色块断裂；允许清楚的动漫明暗分区'),
 ('3D渲染, 摄影写实, CGI, 赛璐璐平涂, 日式动漫风,','3D渲染, 摄影写实, CGI, 失去结构的贴纸式色块,'),
 ('厚动漫描边, 粗黑轮廓','机械均一描边, 粗黑轮廓'),
 ('严禁「高饱和动漫色/赛璐璐平涂/日式渲染」','严禁「全幅等强度高饱和/荧光霓虹色/失去结构的贴纸式色块」；允许动漫概括与简洁分层明暗'),
 ('共同画法为工笔线描与重彩设色分染罩染','共同画法为国风二维动漫线描设色，辅以工笔分染罩染'),
 ('工笔重彩与修仙题材；','国风二维动漫与修仙题材；'),
],
'art_prompt/art_subject_ten_types.md':[
 ('传统绘画转译／线描与设色／墨色与笔触','国风二维动漫造型／白描线条与工笔设色／手绘笔触'),
],
'art_prompt/art_character.md':[
 ('偏写实不走二次元：成年人真实骨骼比例、清晰脸部结构、克制表情、历史人物气质；服装结构可信、甲胄兵器有重量感；禁「二次元美少年模板」也禁纯影视写实——定位=**写实人物+中国画线条审美+游戏角色美术**','国风二维动漫人物：五官概括、发束清晰、明暗色块简洁，脸型、年龄感和身体比例服从角色事实；服装与配器结构可信；各角色保持独立身份——定位=**动漫角色造型+中国画线条设色+游戏角色美术**'),
],
'art_prompt/art_scene.md':[
 ('以水墨国风为标准，拒绝3D写实/CG动画/赛璐璐质感；追求工笔线描、薄透分染罩染','以国风二维动漫为标准，拒绝摄影写实与3D体积塑形；使用概括线条、清晰分层色面，辅以工笔分染罩染'),
],
'art_prompt/art_scene_derivative.md':[
 ('保持水墨国风质感，拒绝3D写实/CG动画/赛璐璐感；保留原有工笔线描与分染罩染','保持国风二维动漫语言，拒绝摄影写实与3D体积塑形；保留原有线描、分层色面与工笔分染罩染'),
],
'art_prompt/art_storyboard_video.md':[
 ('赛璐璐平涂/日式动漫风','失去结构的贴纸式色块/机械均一勾边'),
 ('《道劫》默认主风格：工笔结构层用','《道劫》默认主风格：国风二维动漫手绘插画，以概括造型、清晰发束与简洁明暗色块呈现人物，白描与工笔结构层用'),
 ('写意气韵层用彩色矿物分染、罩染与克制泼墨处理','环境层用分层色面、适量分染与罩染处理'),
 ('画面清雅、细腻、透气、旧而不脏','画面明快协调、线色清楚、疏密有序'),
],
'driector_skills/director_storyboard.md':[
 ('- ❌ 赛璐璐平涂/日式动画渲染/anime style','- ❌ 失去结构的贴纸式色块/机械均一勾边'),
 ('- ❌ 高饱和动漫色/荧光色/霓虹色','- ❌ 全幅等强度高饱和/荧光色/霓虹色'),
],
'driector_skills/director_storyboard_table_style.md':[
 ('灵光保持水墨晕染质感，禁止赛璐璐/3D 写实/CG 动画光效','灵光以二维动漫色块与手绘过渡呈现，禁止摄影写实与3D体积光效'),
 ('必须保持水墨晕染质感与工笔线描，禁止出现赛璐璐粒子特效或3D写实流体效果','保持二维动漫概括、清楚色面与手绘线条，避免遮蔽主体的密集粒子和3D写实流体'),
 ('必须保持分染罩染质感，工笔线描清晰，色彩浓淡自然，禁止赛璐璐平涂/3D 写实/CG 动画/照片级渲染','保持国风二维动漫的线描与简洁分层色面，辅以工笔分染罩染；禁止3D写实与照片级渲染'),
 ('**禁止高饱和色** — 严禁高饱和动漫色/荧光色/霓虹色/赛璐璐色块出现','**控制色彩层级** — 多彩明快、主辅点睛分明，避免全幅等强度高饱和、荧光色与霓虹色'),
],
'driector_skills/director_planning_style.md':[
 ('高饱和动漫色、荧光色、霓虹色、赛璐璐色块均与本风格不兼容','全幅等强度高饱和、荧光色、霓虹色会破坏色彩层级；动漫式分层明暗色块属于当前画法'),
 ('水墨国风的核心：工笔线描、薄透分染罩染、按场景时段的底色与明暗、色彩浓淡干湿、禁止赛璐璐色块/色块断层','国风二维动漫为主：概括线条、清晰色面与简洁明暗，辅以工笔分染罩染；底色与明暗服从场景时段，避免无结构的色块断裂'),
 ('不是写实摄影，不是 3D CG，不是日式动画，是中国传统绘画技法加修仙美学的融合','以国风二维动漫造型为主，融合中国画线条设色与修仙美学，避免摄影写实及3D体积塑形'),
 ('禁止"赛璐璐感"和"3D 感"','允许动漫式简洁明暗分区，避免照片级反射和3D体积塑形'),
 ('玉白基调、工笔淡染、内蕴微光、温润质感、底色平净。禁止哑光/死白/蜡感/油光/过曝/赛璐璐平涂','肤色服从角色设定，以动漫式简洁肤色色块和适量工笔薄染呈现，边界清楚；避免蜡感、油光与过曝'),
],
}
common=[('3D 写实/CG 动画/赛璐璐/日式动画质感（禁用 3D render、CGI、Unreal Engine、Unity、cel shading 等词）','摄影写实与3D体积塑形（避免 3D render、CGI 与照片级材质；允许二维动漫分层明暗色块）')]
for rel,swaps in pairs.items():
    p=MANUAL/rel;s=p.read_text();old=s
    for a,b in swaps:
        assert a in s,(rel,a)
        s=s.replace(a,b)
    for a,b in common:s=s.replace(a,b)
    if rel=='prefix.md':
        lines=s.splitlines(keepends=True)
        count=0
        for i,line in enumerate(lines):
            if line.startswith('| 质量锚定 | 美术风格底座：'):
                lines[i]='| 质量锚定 | '+base+' |\n';count+=1
            elif line.startswith('美术风格底座：中式手绘'):
                lines[i]=base+'\n';count+=1
        assert count==2,count
        s=''.join(lines)
    first=s.index('\n')+1;s=s[:first]+'\n'+note+s[first:]
    assert p.read_text()==old,'Concurrent doc edit: '+rel
    tool.ledger_write(p,s.encode(),'当前动漫口径及冲突条款同步')
# Historical reference guides keep source quotes, but their executable exclusion gates change.
for p in sorted((MANUAL/'style_guide').glob('*.md')):
    s=p.read_text();old=s
    if p.name.startswith('00_'):
        s=s.replace('| 6 | 国风二次元 | 动漫粗描边、赛璐璐平涂、日式比例与脸 |','| 6 | 无差别模板化造型 | 各角色失去身份、年龄与体型差异；动漫概括本身不作排除项 |')
        s=s.replace('动漫粗描边、赛璐璐勾边','机械均一勾边、失去结构的贴纸式色块').replace('| 动漫描边、仙侠铠甲','| 机械均一描边、仙侠铠甲')
    if p.name.startswith('01_'):
        s=s.replace('写实人物 + 中国画线条审美 + 游戏角色美术','动漫角色造型 + 中国画线条设色 + 游戏角色美术')
        s=s.replace('偏写实而走绘画线描，既非纯影视真人，也非二次元','此段保留参考作品的偏写实线描分析；道劫当前采用动漫概括五官与简洁明暗色块')
        s=s.replace('| 成年人写实结构 + 游戏角色设计感 |','| 年龄与体型服从来源 + 动漫角色设计感 |')
        s=s.replace('| 二次元美少女比例、generic anime beauty(源文档第2.2节/第19.3节) |','| 各角色套用同一比例、脸型与年龄模板 |')
        s=s.replace('| 绘画性写实——线描承结构 |','| 动漫式概括——线描与色块承结构 |')
        s=s.replace('幼态大头/二次元美少女比例/欧美超级英雄比例/摄影级真人','违背来源年龄的幼态大头/统一美型模板/违背体型的夸张比例/摄影级真人')
        s=s.replace('thick anime outline / uniform black outline / bold cel-shading outline','uniform black outline / structureless sticker-like contour')
        s=s.replace('角色脸强二次元按源第15节 Production Gate 归级,不入 S/A 主生产','动漫化本身不作淘汰依据；按身份差异、线色结构与整套风格一致性验收')
    if p.name.startswith('03_'):s=s.replace('X2(高饱和动漫色)','X2(全幅等强度高饱和与荧光霓虹色)')
    if p.name.startswith('05_'):s=s.replace('CG 体积渲染/赛璐璐/厚涂特效','CG 体积渲染/摄影写实/遮蔽结构的厚涂特效')
    if p.name.startswith('06_'):
        s=s.replace('| N4 | 国风二次元 | X2 高饱和动漫色/赛璐璐平涂 |','| N4 | 无差别模板化造型 | 保留动漫概括；避免身份、年龄与体型趋同 |')
        s=s.replace('粗动漫描边、赛璐璐勾边、AI 自动勾边感','机械均一描边、失去结构的贴纸式色块、AI 自动勾边感')
    first=s.index('\n')+1;s=s[:first]+'\n'+note+s[first:]
    assert p.read_text()==old,'Concurrent guide edit'
    tool.ledger_write(p,s.encode(),'参考来源与当前动漫执行规则分界；同步验收条款')
# Core contracts and machine-readable manual anchor metadata.
p=MANUAL/'json/prompt_layering.json';s=p.read_text();old=s
s=s.replace('全部定义（工笔淡彩与白描主导/连环画概括造型/丰富多彩设色主次/可见质量语言/数字绘画工艺）','全部定义（国风二维动漫主风格/白描线条/工笔分染与罩染/连环画概括造型/协调多彩设色/洁净数字绘画工艺）')
s=s.replace('"updated": "2026-10-16"','"updated": "2026-10-18"')
assert s!=old
tool.ledger_write(p,s.encode(),'完整版分层契约随源')
p=MANUAL/'json/README.md';s=p.read_text();old=s
s=s.replace('(工笔与白描主导/连环画造型/水彩薄染/水墨笔韵/传统色主次/数字绘画工艺)','(国风二维动漫主导/白描线条/工笔分染罩染/连环画造型/协调多彩/洁净数字绘画工艺)')
first=s.index('\n')+1;s=s[:first]+'\n'+note+s[first:]
tool.ledger_write(p,s.encode(),'字段字典当前画风说明')
p=MANUAL/'ma_sync/lock-anchors.json';d=json.loads(p.read_text())
lock=next(x for x in d['locks'] if x['name']=='风格底座锁')
lock['manualAnchors']=['国风二维动漫手绘插画','线条细稳连贯、轻重富有节奏','数字绘画表面洁净平整']
lock['localRevision']='2026-10-18 MYStudio 动漫风格修订；maAnchors 保留历史来源，不声明逐字镜像'
tool.ledger_write(p,(json.dumps(d,ensure_ascii=False,indent=2)+'\n').encode(),'本地风格锚随源；MA历史锚保留')
# Official-example library is a reference, not another executable style source.
p=next((ROOT/'docs/prompts/Qwen-Image-2.1').glob('05-*.md'));s=p.read_text();old=s
first=s.index('\n')+1
s=s[:first]+'\n'+note+'\n> 本文旧常量和负面词块为设计记录快照，包含已退役规则，不得直接拼装。当前底座及类型统一读取 `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json`。\n'+s[first:]
tool.ledger_write(p,s.encode(),'明确旧常量快照不作当前拼装来源')
print('manual changes recorded')
