"""1016 canon 口径墨字头清尾(用户令「1 修完啊」=活口径翻彩收尾)。

范围=活手册/导演技能/分镜视频/场景手册/prompt_layering 的线层墨词(铁线描/细墨线/墨线→中性线语)
与总述性「墨色浓淡」(→色彩浓淡)+导演文档「材质水墨化」硬指令(→传统绘画技法)。
不动=05库/canon_lib(今日页首已定性历史快照,历史不改史)、MA 侧锚与来源、
淡墨远景/空气软边(bases 型文 sanctioned)、00_总纲纠偏表与墨韵行(防御性)、
base 负向反单色词、故事线历史件。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[3]
MANUAL = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
OUT = ROOT / 'apps/output/automation/qi21-canon-ink-flip-1016'

R = 'repo'


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def ledger_write(path: Path, data: bytes, reason: str) -> None:
    if path.read_bytes() == data:
        return
    rel = (path.relative_to(ROOT) if path.is_relative_to(ROOT)
           else Path('external') / path.relative_to('/'))
    backup = OUT / 'backups' / rel
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
        shutil.copy2(path, backup)
    path.write_bytes(data)
    ledger_file = OUT / 'changes.json'
    ledger = json.loads(ledger_file.read_text()) if ledger_file.exists() else []
    row = next((r for r in ledger if r['path'] == str(path)), None)
    if row is None:
        row = {'path': str(path), 'backup': str(backup), 'before': sha(backup.read_bytes()),
               'reasons': []}
        ledger.append(row)
    row['after'] = sha(data)
    if reason not in row['reasons']:
        row['reasons'].append(reason)
    ledger_file.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')


SWAPS: dict[Path, list[tuple[str, str]]] = {
    MANUAL / 'prefix.md': [
        ('| L1 画法约束 | 高 | 铁线描与矿物罩染；', '| L1 画法约束 | 高 | 线描与矿物罩染；'),
        ('侧逆光勾铁线描边（点睛色提线）', '侧逆光细线勾边（点睛色提线）'),
        ('铁线描更硬朗锐利', '线条更硬朗锐利'),
        ('工笔结构：细稳铁线描交代轮廓与结构', '工笔结构：细稳线条交代轮廓与结构'),
    ],
    MANUAL / 'style_guide/01_人物美术.md': [
        ('| 线条 | 铁线描更硬朗锐利;脸、手与关键轮廓必须可读 | 铁线描硬朗、轮廓可读 |',
         '| 线条 | 线条更硬朗锐利;脸、手与关键轮廓必须可读 | 线描硬朗、轮廓可读 |'),
        ('血朱砂只点睛,铁线描更硬朗;显式设定才启用', '血朱砂只点睛,线条更硬朗;显式设定才启用'),
    ],
    MANUAL / 'style_guide/02_服饰系统.md': [
        ('铁线描勾甲片结构，深色块克制', '细线勾甲片结构，深色块克制'),
        ('├── Line：白描／铁线描', '├── Line：白描／工笔线描'),
        ('甲片结构以铁线描勾勒', '甲片结构以细线勾勒'),
    ],
    MANUAL / 'style_guide/05_动态与战斗.md': [
        ('姿态张力、墨色浓淡对比、镜头强度', '姿态张力、色彩浓淡对比、镜头强度'),
        ('细线勾勒(fine linework)、铁线描轮廓、发丝衣纹清楚',
         '细线勾勒(fine linework)、工笔线描轮廓、发丝衣纹清楚'),
    ],
    MANUAL / 'style_guide/06_新中式设计语言.md': [
        ('| 线条 | 细线勾勒、墨线、铁线描、线宽连续有节奏 |',
         '| 线条 | 细线勾勒、工笔线描、线宽连续有节奏 |'),
    ],
    MANUAL / 'driector_skills/director_planning_style.md': [
        ('- **水墨晕染为锚** — 水墨国风的核心：工笔线描、薄透分染罩染、按场景时段的底色与明暗、墨色浓淡干湿、禁止赛璐璐色块/色块断层',
         '- **工笔设色为锚** — 水墨国风的核心：工笔线描、薄透分染罩染、按场景时段的底色与明暗、色彩浓淡干湿、禁止赛璐璐色块/色块断层'),
        ('是传统水墨画技法加修仙美学的融合', '是中国传统绘画技法加修仙美学的融合'),
        ('- **材质水墨化** — 所有服化道的材质必须以水墨技法呈现：灵丝的光泽用淡墨渲染、灵金的反光用飞白笔触、灵玉的润感用水墨晕染。禁止"赛璐璐感"和"3D 感"',
         '- **材质绘画化** — 所有服化道的材质必须以传统绘画技法呈现：灵丝的光泽用薄染渲染、灵金的反光用点睛色提亮、灵玉的润感用罩染晕开。禁止"赛璐璐感"和"3D 感"'),
        ('通过墨色浓淡、留白、远景淡墨晕染、灵光等手段', '通过色彩浓淡、留白、远景淡彩晕染、灵光等手段'),
    ],
    MANUAL / 'driector_skills/director_storyboard_table_style.md': [
        ('- **水墨晕染为锚** — 所有镜头中人物/服饰/法宝/场景的渲染必须保持水墨晕染质感，工笔线描清晰，墨色浓淡自然，禁止赛璐璐平涂/3D 写实/CG 动画/照片级渲染',
         '- **工笔设色为锚** — 所有镜头中人物/服饰/法宝/场景的渲染必须保持分染罩染质感，工笔线描清晰，色彩浓淡自然，禁止赛璐璐平涂/3D 写实/CG 动画/照片级渲染'),
        ('云锦 + 灵丝 + 仙纱的质感用水墨晕染表现', '云锦 + 灵丝 + 仙纱的质感用分染罩染表现'),
        ('材质带有岁月感但以水墨笔触呈现', '材质带有岁月感但以传统绘画笔触呈现'),
    ],
    MANUAL / 'art_prompt/art_scene.md': [
        ('墨色浓淡干湿五阶分明，矿物罩染通透分层', '色彩浓淡层次分明，矿物罩染通透分层'),
    ],
    MANUAL / 'art_prompt/art_storyboard_video.md': [
        ('用墨色浓淡渐变表现纵深（近浓远淡）', '用色彩浓淡渐变表现纵深（近浓远淡）'),
        ('大气透视 = 墨分五色的近浓远淡 + 远景留白晕染', '大气透视 = 色彩近浓远淡 + 远景留白晕染'),
        ('主体轮廓以墨线/留白与背景分离明确，避免主体融入背景墨色',
         '主体轮廓以细线/留白与背景分离明确，避免主体融入背景色面'),
        ('水墨折枝构图天然适配', '传统折枝构图天然适配'),
    ],
    MANUAL / 'json/prompt_layering.json': [
        ('细墨线在人物型勾全身轮廓', '细线在人物型勾全身轮廓'),
    ],
}


def core() -> None:
    for path, pairs in SWAPS.items():
        text = path.read_text(encoding='utf-8')
        for old, new in pairs:
            got = text.count(old)
            if got == 0 and text.count(new) == 1:
                continue  # 幂等:已应用
            if got != 1:
                raise RuntimeError(f'{path}: 期望 {old[:24]!r}×1, 实际×{got}')
            text = text.replace(old, new)
        ledger_write(path, text.encode('utf-8'), 'canon 口径墨字头清尾(活手册+契约应用句)')
    anchors = MANUAL / 'ma_sync/lock-anchors.json'
    assert json.dumps(json.loads(anchors.read_text()), ensure_ascii=False,
                      indent=2) + '\n' == anchors.read_text(encoding='utf-8')
    data = json.loads(anchors.read_text(encoding='utf-8'))
    changed = 0
    for lock in data['locks'] + data.get('guidanceLocks', []):
        for i, a in enumerate(lock.get('manualAnchors', [])):
            if a == '工笔结构：细稳铁线描交代轮廓与结构':
                lock['manualAnchors'][i] = '工笔结构：细稳线条交代轮廓与结构'
                changed += 1
            if a == '侧逆光勾铁线描边（点睛色提线）、发丝留金（点睛色职责）、矿物罩染的通透光泽':
                lock['manualAnchors'][i] = '侧逆光细线勾边（点睛色提线）、发丝留金（点睛色职责）、矿物罩染的通透光泽'
                changed += 1
    if changed == 2:
        ledger_write(anchors, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'),
                     '工笔结构锁与光影 guidance 锁的手册锚随 prefix 同步(MA 侧锚不改)')
    elif changed == 0 and any(
            '工笔结构：细稳线条交代轮廓与结构' in a
            for lk in data['locks'] + data.get('guidanceLocks', [])
            for a in lk.get('manualAnchors', [])):
        pass  # 幂等:已应用
    else:
        raise RuntimeError(f'manualAnchors 应改 2 处, 实际 {changed}')
    print(f'core 完成: {len(SWAPS)} 文件 + lock-anchors 2 锚')


def distribute() -> None:
    bases = [Path('/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng'),
             Path('/Users/zhengbingjin/Project/IP/漫影工作室/skills/art_skills/daojie_ink_guofeng'),
             Path('/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng')]
    rows = []
    for src, pairs in SWAPS.items():
        rel = src.relative_to(MANUAL)
        for base in bases:
            target = base / rel
            if not target.exists():
                rows.append({'target': str(target), 'status': 'missing'})
                continue
            text = target.read_text(encoding='utf-8')
            missing = []
            for old, new in pairs:
                got = text.count(old)
                if got == 0 and text.count(new) == 1:
                    continue  # 幂等:该刀已应用
                if got != 1:
                    missing.append(old)
            if missing:
                rows.append({'target': str(target), 'status': 'prestate-mismatch',
                             'missing': [m[:40] for m in missing]})
                continue
            for old, new in pairs:
                text = text.replace(old, new)
            ledger_write(target, text.encode('utf-8'), 'canon 墨字头清尾随源(原位换句)')
            rows.append({'target': str(target), 'status': 'written'})
    anchors = MANUAL / 'ma_sync/lock-anchors.json'
    repo_pre = (OUT / 'backups' / anchors.relative_to(ROOT)).read_bytes()
    for base in bases:
        target = base / 'ma_sync/lock-anchors.json'
        if not target.exists():
            rows.append({'target': str(target), 'status': 'missing'})
            continue
        if target.read_bytes() == anchors.read_bytes():
            rows.append({'target': str(target), 'status': 'already-in-sync'})
            continue
        if target.read_bytes() == repo_pre:
            ledger_write(target, anchors.read_bytes(), 'lock-anchors 字节同源随仓(MA 侧锚保留)')
            rows.append({'target': str(target), 'status': 'byte-copied'})
            continue
        # 前置态不等:json 精确复刻两处 manualAnchor 改动,不触 maAnchors
        data = json.loads(target.read_text(encoding='utf-8'))
        changed = 0
        for lock in data['locks'] + data.get('guidanceLocks', []):
            for i, a in enumerate(lock.get('manualAnchors', [])):
                if a == '工笔结构：细稳铁线描交代轮廓与结构':
                    lock['manualAnchors'][i] = '工笔结构：细稳线条交代轮廓与结构'
                    changed += 1
                if a == '侧逆光勾铁线描边（点睛色提线）、发丝留金（点睛色职责）、矿物罩染的通透光泽':
                    lock['manualAnchors'][i] = '侧逆光细线勾边（点睛色提线）、发丝留金（点睛色职责）、矿物罩染的通透光泽'
                    changed += 1
        if changed == 0 and any('工笔结构：细稳线条交代轮廓与结构' in a
                                for lk in data['locks'] + data.get('guidanceLocks', [])
                                for a in lk.get('manualAnchors', [])):
            rows.append({'target': str(target), 'status': 'already-in-sync'})
            continue
        if changed != 2:
            rows.append({'target': str(target), 'status': 'anchor-prestate-mismatch', 'changed': changed})
            continue
        ledger_write(target, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'),
                     'lock-anchors json 复刻两锚(MA 侧锚不改)')
        rows.append({'target': str(target), 'status': 'written'})
    (OUT / 'distribution.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    written = sum(1 for r in rows if r['status'] == 'written')
    print(f'分发: written={written}, 异常={sum(1 for r in rows if r["status"] not in ("written",))}')


def verify() -> None:
    problems, preexisting = [], []
    pf = (MANUAL / 'prefix.md').read_text(encoding='utf-8')
    la = json.loads((MANUAL / 'ma_sync/lock-anchors.json').read_text())
    known_debt = ['《道劫》默认主风格', '工笔结构层用细密', '写意气韵层用彩色矿物分染',
                  '不得灰白化', '不要伪字题跋', '不要把背景画成空泛山水', '画面必须主体明确']
    for lock in la['locks'] + la.get('guidanceLocks', []):
        for a in lock.get('manualAnchors', []):
            if a not in pf:
                (preexisting if any(a.startswith(k) for k in known_debt)
                 else problems).append(f'manualAnchor 断链: {a[:36]}')
    # 00_总纲 纠偏表(优先理解 vs 避免理解)为防御性 teaching=sanctioned 白名单
    live_roots = [MANUAL / 'style_guide', MANUAL / 'driector_skills', MANUAL / 'art_prompt',
                  MANUAL / 'prefix.md', MANUAL / 'json/prompt_layering.json']
    for root in live_roots:
        paths = [root] if root.is_file() else list(root.rglob('*.md'))
        for p in paths:
            if p.name == '00_总纲.md':
                continue
            t = p.read_text(encoding='utf-8')
            for w in ['铁线描', '细墨线', '墨色浓淡', '材质水墨化', '水墨晕染为锚']:
                if w in t:
                    problems.append(f'{w} 残留: {p.relative_to(MANUAL)}')
    print(json.dumps({'ok': not problems, 'problems': problems[:12],
                      'preexisting_anchor_debt': len(preexisting)}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    {'core': core, 'distribute': distribute, 'verify': verify}[sys.argv[1]]()
