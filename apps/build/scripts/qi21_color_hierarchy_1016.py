"""Incremental color hierarchy update on top of GLM's completed 1016 revision.
Plan before apply; preserve unrelated bytes and fail on concurrent edits. No git.
"""
from pathlib import Path
import hashlib
import json
import runpy
import shutil
import sys

ROOT = Path(__file__).resolve().parents[3]
BASE = runpy.run_path(str(ROOT/'apps/build/scripts/qi21_base_multicolor_swap_1016.py'))
MANUAL, SOURCE = BASE['MANUAL'], BASE['SOURCE']
OUT = ROOT/'apps/output/automation/qi21-color-hierarchy-1016'
OLD = BASE['NEW']
COLOR_OLD = '采用中国传统色体系，多色相并陈，饱和度与对比度受控，'
COLOR_NEW = ('采用中国传统色体系，以丰富多彩的设色为主，多色相并陈且协调统一，'
             '主色统领、辅色呼应、点睛色突出，饱和度与对比度受控且层级分明，')
NEW = OLD.replace(COLOR_OLD, COLOR_NEW)
RULE = '以丰富多彩的传统设色为主，配色协调统一，主色统领、辅色呼应、点睛色突出，饱和度与对比度受控且层级分明'
LABEL_OLD = BASE['LABEL_NEW']
LABEL_NEW = LABEL_OLD.replace('传统色多色相', '传统色多彩协调与主次')
OWN_OLD = BASE['OWNS_NEW']
OWN_NEW = OWN_OLD.replace('色彩浓淡与多色相传统色。', '色彩浓淡与多色相传统色；丰富设色为主、配色协调统一、主辅与点睛色主次分明。')
CHANGES = {}
OPS = {}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dumps(data):
    return json.dumps(data, ensure_ascii=False, indent=2)+'\n'


def patch(path, pairs):
    path = Path(path)
    before = path.read_bytes()
    text = CHANGES[path][1].decode() if path in CHANGES else before.decode()
    for old, new, expected in pairs:
        count = text.count(old)
        if count != expected:
            raise RuntimeError(f'{path}: expected {expected}, found {count}: {old[:70]}')
        text = text.replace(old, new)
    CHANGES[path] = (CHANGES[path][0] if path in CHANGES else before, text.encode())
    OPS.setdefault(path, []).extend(pairs)


def doc(fragment):
    paths = [p for p in MANUAL.rglob('*.md') if p.name.startswith(fragment)]
    assert len(paths) == 1, paths
    return paths[0]


patch(SOURCE, [(OLD, NEW, 1), (LABEL_OLD, LABEL_NEW, 1)])
patch(MANUAL/'json/prompt_layering.json', [
    (OWN_OLD, OWN_NEW, 1), (LABEL_OLD, LABEL_NEW, 1),
    ('中国传统色体系与受控饱和度、对比度；具体用色由类型预算和主体落点负责，色板数据由独立词典供给。',
     RULE+'；具体用色由类型预算和主体落点负责，色板数据由独立词典供给。', 1)])
patch(MANUAL/'prefix.md', [
    (OLD, NEW, 2),
    ('| **一级风格** | 水墨国风修仙（Chinese Ink-Wash Xianxia） |',
     '| **一级风格** | 传统设色国风修仙；多彩协调、主次分明 |', 1),
    ('| **二级风格** | 工笔线描 · 写意泼墨 + 浅净平涂底 |',
     '| **二级风格** | 工笔线描 · 传统设色分染罩染 |', 1),
    ('工笔白描、写意晕染、浅净哑光平涂底、水墨留白、淡墨淡彩细线低对比',
     '工笔线描、传统设色、分染罩染、多彩协调、主辅与点睛色主次分明', 1),
    ('默认水墨为主、2-3 种低饱和矿物色点缀、古雅统一。', RULE+'。具体色相与数量服从来源事实，不限定少量点缀色。', 1),
    ('| 整体色调 | 水墨低饱和 + 青绿淡彩 | 禁止高饱和动漫配色 |',
     '| 整体色调 | 丰富传统设色、配色协调统一 | 主色、辅色与点睛色主次分明，不全幅等强度鲜艳 |', 1),
    ('| 阴影 | 淡墨层叠渲染 | 禁止纯黑硬阴影 |',
     '| 阴影 | 随对象色相分染罩染，浓淡与冷暖层次清楚 | 不默认用灰墨覆盖各物色相 |', 1),
    ('| 晕染色块 | 水墨渗透自然过渡 | 禁止色块断层/赛璐璐平涂 |',
     '| 晕染色块 | 彩色分染罩染自然衔接 | 禁止色块断层/赛璐璐平涂 |', 1),
    ('| 整体色温 | 偏冷中性，水墨清冷基调 | 清冷墨色基调、冷中性宣纸底 |',
     '| 整体色温 | 按来源事实与类型规则组织 | 具体冷暖由主体与类型提供，整体配色协调 |', 1),
    ('| 对比度 | 中低对比，层次过渡柔和 | 墨色层次过渡柔和、淡墨渐变 |',
     '| 对比度 | 受控且有主次层级 | 主色统领、辅色呼应、点睛色突出 |', 1),
    ('| 饱和度 | 低饱和淡彩 | 低饱和淡彩、矿物色薄染 |',
     '| 饱和度 | 按配色职责分层控制 | 多彩协调、主次分明、罩染层次清晰 |', 1),
    ('明确主体哪些部位用工笔线描、背景哪些部位用淡墨/写意；用「工笔负责结构、水墨负责气韵」的统一媒介关系，不要只写「水墨国风」。',
     '工笔线描交代结构，传统设色分染罩染形成完整色面；背景的远近层次由类型句组织，保留来源色相，不默认把背景改成淡墨。', 1),
    ('至多 2-3 种低饱和矿物点缀色，色相跟随角色/场景设定事实', RULE+'，具体色相与数量跟随角色/场景设定事实', 1),
    ('人物肤色匀净如瓷、矿物罩染通透分层；场景墨色浓淡干湿五阶',
     '人物肤色遵从来源事实、矿物罩染通透分层；场景色彩浓淡与冷暖层次', 1),
    ('| R1 | 必须包含「水墨国风」风格锚定词 |', '| R1 | 统一使用传统设色国风画法；丰富设色为主、配色协调、主次分明 |', 1),
    ('| R2 | 必须声明「工笔线描 + 写意晕染」 |', '| R2 | 共同画法为工笔线描与传统设色分染罩染 |', 1),
    ('| R4 | 必须声明「水墨留白 + 气韵生动」 |', '| R4 | 留白与视觉密度由类型句规定；色彩保持协调层级 |', 1),
    ('| R5 | 必须声明「水墨国风成片质感」（clean finished gongbi quality） |', '| R5 | 成像工艺干净，线条与罩染层次清晰 |', 1),
    ('远景淡墨），纵深条款', '远景概括色面与软边），纵深条款', 1),
])
patch(MANUAL/'README.md', [
    ('共同底座仅统一画法；', '共同底座仅统一画法；'+RULE+'，具体颜色依来源事实；', 1),
    ('工笔线描勾勒形体结构，写意泼墨渲染气韵意境，二者有机结合',
     '工笔线描勾勒形体结构，传统设色分染罩染形成色面，丰富色彩协调统一、主次清楚', 1),
    ('- **水墨成片质感**：构图讲究、水墨光影层次、动态张力、灵气氛围',
     '- **彩色工笔成片质感**：线条与罩染清晰，主色、辅色与点睛色层级明确；构图、照明和氛围由类型及主体确定', 1),
    ('## 历史画卷基准(09-18《三国望神州》美术 DNA 并入)',
     '## 历史画卷基准(09-18《三国望神州》美术 DNA 并入)\n\n> 以下为参考基准的历史说明；道劫当前配色以 2026-10-16 用户裁定为准：'+RULE+'。不将参考中的淡彩、低对比解释为现行全局要求。', 1),
    ('场景充满水墨意境，山水云雾以写意泼墨呈现，留白深远',
     '场景保留来源色相，以协调的传统设色组织主辅层次；空间与留白服从类型规则', 1),
    ('分镜与渲染均强调水墨成片质感、修仙古韵、传统国画技法',
     '分镜与渲染保持多彩协调、主次分明的传统绘画语言与修仙古韵', 1),
])
color_doc = doc('03_')
text = color_doc.read_text()
formula = next(line for line in text.splitlines() if line.startswith('3. **默认公式:'))
application = next(line for line in text.splitlines() if line.startswith('2. 默认公式:'))
patch(color_doc, [
    ('# 色彩体系 · 传统色与淡而不脏', '# 色彩体系 · 多彩协调与主次层级', 1),
    ('用什么色(色名)、用多少(色量)、怎么淡(换算)、怎么不脏(审稿)',
     '用什么色(色名)、如何协调(配色)、如何分主次(层级)、怎么不脏(审稿)', 1),
    ('每图 2-3 种矿物色点缀(prefix 公式;受控而非压低,源第5.1节)',
     '色相与数量按来源事实；丰富设色，主色、辅色与点睛色各有层级', 1),
    ('同一套色名体系 + 同一套淡彩纪律 = 古雅统一', '同一传统色体系 + 配色协调 + 主辅与点睛层级 = 统一', 1),
    ('| 整体色温 | 偏冷中性 | 组织画面理解 | 否——用「清冷墨色基调」表达 |',
     '| 整体色温 | 随来源事实与类型规则 | 组织画面理解 | 否——具体冷暖归主体与类型 |', 1),
    ('| 饱和度语言 | 低饱和淡彩(prefix 原词;v2.2 读法＝受控饱和,源第5.1节) | — | 是——「低饱和淡彩、矿物色薄染」 |',
     '| 饱和度语言 | 受控且层级分明 | 配色主次 | 是——「多彩协调、主色统领、辅色呼应、点睛色突出」 |', 1),
    (formula, '3. **默认公式：'+RULE+'。**具体色相与数量依来源事实，不固定为少量点缀。', 1),
    ('| 整体色温 | 偏冷中性,水墨清冷基调 | 清冷墨色基调、冷中性宣纸底 |',
     '| 整体色温 | 按来源事实与类型规则 | 具体冷暖随主体与类型，整体配色协调 |', 1),
    ('| 对比度 | 中低对比,层次过渡柔和 | 墨色层次过渡柔和、淡墨渐变 |',
     '| 对比度 | 受控且有主次层级 | 主色统领、辅色呼应、点睛色突出 |', 1),
    ('| 饱和度 | 低饱和淡彩 | 低饱和淡彩、矿物色薄染 |',
     '| 饱和度 | 按配色职责分层控制 | 多彩协调、主次分明、罩染层次清晰 |', 1),
    ('腰间旧金牌作点睛,低饱和淡彩,矿物色薄染', '腰间旧金牌作点睛,主辅色协调、点睛色突出,矿物色分染罩染', 1),
    (application, '2. 默认公式：'+RULE+'；具体色相与数量按来源事实，不预设水墨主导或仅少量点缀。', 1),
])
outline = doc('00_')
line = next(line for line in outline.read_text().splitlines() if line.startswith('- **「淡」是关键而非「旧」**'))
patch(outline, [(line, '- **现行配色（2026-10-16 用户裁定）**：'+RULE+'；具体色相与数量依来源事实。传统色可以鲜明，不以淡墨淡彩和低对比作为全局要求；保持色相可辨，不套灰褐或做旧滤镜。', 1)])
battle = doc('05_')
patch(battle, [
    ('| 色彩 | 淡彩 2-3 种低饱和矿物色点缀 | 同一传统色体系,允许局部点睛色加锐 | 画风层(恒定) |',
     '| 色彩 | 丰富传统设色，主辅协调、点睛明确 | 同一配色层级，允许局部点睛色加锐 | 画风层(恒定) |', 1),
    ('| **淡** | 墨淡彩淡,**「淡是关键而非旧」**——颜色真实存在但不抢主体(v2.2 读作受控饱和,第5.1节) | 淡墨层叠、薄透矿物罩染、低饱和淡彩(controlled saturation) |',
     '| **淡** | 表现克制，色彩丰富且协调；主色、辅色与点睛色有主次，不要求整体淡彩 | 分染罩染、色相清楚、饱和度与对比度分层控制 |', 1),
])
story = doc('art_storyboard_video.md')
patch(story, [
    ('> 与 MA `美术成片风格提示词模板库.md` 词级一致（快照见 ma_sync）。',
     '> 2026-10-16 依用户配色裁定作本地修订；MA 历史来源快照见 ma_sync，不再声明本段与外部逐字一致。', 1),
    ('按场景使用至多 2-3 个低饱和点缀色：石青、石绿、靛青、玉青、赭石、朱砂、矿物朱、旧金或血红形成连续可见色区。',
     RULE+'。具体色相与数量依场景事实，色彩形成连续可见色区。', 1),
    ('水墨为主、彩色点缀、古雅', '丰富设色为主、配色协调、主辅与点睛色主次分明、古雅', 1),
])
anchors = MANUAL/'ma_sync/lock-anchors.json'
# Only the local manual anchor changes; inherited MA baseline remains historical.
a = json.loads(anchors.read_text())
row = next(row for row in a['guidanceLocks'] if row['name'] == '指导·材质微观')
old_anchor = row['manualAnchors'][0]
new_anchor = '人物肤色遵从来源事实、矿物罩染通透分层；场景色彩浓淡与冷暖层次'
needle = json.dumps(row['manualAnchors'], ensure_ascii=False, indent=2)
# Surgical occurrence selection avoids changing the identical maAnchors entry.
s = anchors.read_text()
start = s.index('"name": "指导·材质微观"')
end = s.index('"maAnchors"', start)
section = s[start:end]
assert section.count(old_anchor) == 1
s = s[:start]+section.replace(old_anchor, new_anchor)+s[end:]
CHANGES[anchors] = (anchors.read_bytes(), s.encode())

for path, count in BASE['WF_COUNTS'].items():
    patch(path, [(OLD, NEW, count)])
contract_path = MANUAL/'ma_sync/runtime-contract.json'
c = json.loads(contract_path.read_text())
old_contract_sha = c['contractSha256']
assert c['modules']['style.gongbi-base']['text'] == OLD
c['modules']['style.gongbi-base']['text'] = NEW
c['localRevision']['styleSourceSha256'] = sha(CHANGES[SOURCE][1])
c['contractSha256'] = sha(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},
                         ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
CHANGES[contract_path] = (contract_path.read_bytes(), dumps(c).encode())
patch(ROOT/'apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py', [
    ('"锁层A全文": "'+sha(OLD.encode())[:16]+'",',
     '"锁层A全文": "'+sha(NEW.encode())[:16]+'",', 1)])
patch(ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts', [(old_contract_sha,c['contractSha256'],1)])

# Derive mirror locations only from GLM's observed distribution receipt.
dist = json.loads((BASE['OUT']/'distribution.json').read_text())
mirrors = [Path(row['target']).parent for row in dist if Path(row['target']).name=='prefix.md']
assert len(mirrors) == 4
for source in list(CHANGES):
    if not source.is_relative_to(MANUAL):
        continue
    for mirror in mirrors:
        target = mirror/source.relative_to(MANUAL)
        assert target.exists(), target
        before = target.read_bytes()
        if source in OPS:
            patch(target, OPS[source])
        else:
            # Contract/anchor have structured changes; require exact preimage first.
            assert before == CHANGES[source][0], f'Divergent structured target: {target}'
            CHANGES[target] = (before, CHANGES[source][1])
for row in dist:
    target = Path(row['target'])
    if target in CHANGES or target.name=='LOCK_SNAPSHOT.md':
        continue
    text = target.read_text()
    count = text.count(OLD)
    if count:
        if target.name=='qi21_bases.json':
            patch(target, [(OLD, NEW, count),(LABEL_OLD,LABEL_NEW,1)])
        else:
            patch(target, [(OLD,NEW,count)])

OUT.mkdir(parents=True, exist_ok=True)
plan = [{'path':str(p),'before':sha(b),'after':sha(a),'old_style_count':b.decode().count(OLD),
         'new_style_count':a.decode().count(NEW)} for p,(b,a) in CHANGES.items()]
if sys.argv[1]=='plan':
    (OUT/'plan.json').write_text(dumps(plan))
    print(dumps({'files':len(plan),'source_docs':sum(p.is_relative_to(MANUAL) and p.suffix=='.md' for p in CHANGES),
                 'style':NEW,'plan':str(OUT/'plan.json')}))
elif sys.argv[1]=='apply':
    prior = json.loads((OUT/'plan.json').read_text())
    assert prior == plan, 'Preflight changed; review a fresh plan before applying.'
    for p,(before,after) in CHANGES.items():
        assert p.read_bytes()==before, f'Concurrent modification before any write: {p}'
    ledger=[]
    for p,(before,after) in CHANGES.items():
        assert p.read_bytes()==before, f'Concurrent modification: {p}'
        rel=p.relative_to(ROOT) if p.is_relative_to(ROOT) else Path('external')/p.relative_to('/')
        backup=OUT/'backups'/rel
        backup.parent.mkdir(parents=True,exist_ok=True)
        assert not backup.exists(), backup
        shutil.copy2(p,backup)
        p.write_bytes(after)
        ledger.append({'path':str(p),'backup':str(backup),'before':sha(before),'after':sha(after)})
        (OUT/'changes.json').write_text(dumps(ledger))
    (OUT/'final-style.txt').write_text(NEW+'\n')
    print(dumps({'written':len(ledger),'contractSha256':c['contractSha256'],'style':NEW}))
else:
    raise ValueError('Use plan or apply')
