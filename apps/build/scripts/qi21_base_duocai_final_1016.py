#!/usr/bin/env python3
"""1016 美术风格底座多彩定稿(用户令版;反打并行水墨融合稿)。

用户令:中英文括注配合 + 可见质量词(2.1 官方劝退空 booster,质量语=可见描述)。
删除:透明水彩(watercolor)/写意水墨(ink wash)融合语/水墨笔意渗化干湿句/透明薄染晕染句。
新增:色面边界明确平整/色相对比保持清晰/线条饱满有力/细节密度高笔笔可辨/
crisp sharp edges/clean flat digital finish/多彩主次句回补(1016 双令)。
机制复刻 qi21_base_multicolor_swap_1016.py(分发39目标);OLD 动态读真源防错字。
stages: core/docs/snapshots/test-anchors/distribute/verify
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[3]
MANUAL = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
OUT = ROOT / 'apps/output/automation/qi21-base-duocai-final-1016'
SOURCE = MANUAL / 'json/qi21_bases.json'

NEW = ('美术风格底座：中国传统工笔设色（Gongbi painting）与白描线条（baimiao line drawing）'
       '主导的二维手绘数字游戏插画，融合彩色连环画（classic Chinese lianhuanhua comic）'
       '的概括造型，各种画法主次明确、协调统一。轮廓线与内部结构线共同承担造型，'
       '精细用笔（fine brushwork），线条细稳连贯、饱满有力，轻重、疏密富有节奏，'
       '形体概括凝练。清晰色面、分染与层层罩染共同塑形，色面边界明确平整，'
       '色相对比保持清晰，明暗融入固有色的浓淡与冷暖层次；采用协调统一的中国传统色体系，'
       '以丰富多彩的设色为主，多色相并陈且协调统一，主色统领、辅色呼应、点睛色突出，'
       '饱和度与对比度受控且层级分明，材质统一于线描设色语言。保留清楚的手绘笔性'
       '（hand-painted brushwork），全图细节密度高、笔笔可辨，轮廓与色面边界清晰锐利'
       '（crisp, sharp edges），数字绘画表面洁净平整（clean, flat digital finish），'
       '线条与罩染层次分明。')

DOC_OLD = '只定义工笔与白描主导、连环画造型、水彩薄染和水墨笔韵融合的绘画语言与数字成像工艺'
DOC_NEW = '只定义工笔设色与白描主导、连环画概括造型、丰富多彩设色与可见质量语言的数字成像工艺'
OWNS_OLD = '全部定义（工笔设色与白描主导/连环画概括造型/透明水彩薄染/写意水墨笔韵/多彩主次/数字绘画工艺）'
OWNS_NEW = '全部定义（工笔设色与白描主导/连环画概括造型/丰富多彩设色主次/可见质量语言/数字绘画工艺）'
LOCK_OLD = '数字绘画表面洁净平整，线条与罩染层次清晰。'
LOCK_NEW = '数字绘画表面洁净平整（clean, flat digital finish），线条与罩染层次分明。'
BOUNDARY_OLD = ("'watercolor illustration', 'Chinese ink wash painting', 'soft transparent washes',\n"
                "                 '清晰色面', '分染', '层层罩染', '明暗融入固有色', '协调统一', '传统色', '受控', "
                "'数字绘画表面洁净平整，线条与罩染层次清晰。']:")
BOUNDARY_NEW = ("'fine brushwork', 'hand-painted brushwork',\n"
                "                 '清晰色面', '分染', '层层罩染', '明暗融入固有色', '多色相并陈', '协调统一', '传统色', '受控',\n"
                "                 '细节密度高、笔笔可辨', 'crisp, sharp edges', 'clean, flat digital finish',\n"
                "                 '数字绘画表面洁净平整（clean, flat digital finish），线条与罩染层次分明。']:")

WF_COUNTS = {
    ROOT / 'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json': 2,
    ROOT / 'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json': 1,
    ROOT / 'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json': 2,
    ROOT / 'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-img2img.json': 1,
    ROOT / 'apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json': 2,
    ROOT / 'apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json': 2,
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_old() -> str:
    data = json.loads(SOURCE.read_text(encoding='utf-8'))
    old = data['art_style_base']['positive_text']
    for mark in ('写意水墨', 'watercolor illustration', '边缘渗化'):
        if mark not in old:
            raise RuntimeError(f'真源底座非水墨融合稿前置形态(缺 {mark!r}),并行态又变了,拒续')
    if old == NEW:
        raise RuntimeError('已是新稿,幂等拦停')
    return old


def ledger_write(path: Path, data: bytes, reason: str) -> None:
    before = path.read_bytes()
    if before == data:
        return
    relative = (path.relative_to(ROOT) if path.is_relative_to(ROOT)
                else Path('external') / path.relative_to('/'))
    backup = OUT / 'backups' / relative
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
        shutil.copy2(path, backup)
    path.write_bytes(data)
    ledger_file = OUT / 'changes.json'
    ledger = json.loads(ledger_file.read_text()) if ledger_file.exists() else []
    row = next((r for r in ledger if r['path'] == str(path)), None)
    if row is None:
        row = {'path': str(path), 'backup': str(backup), 'before': sha(before), 'reasons': []}
        ledger.append(row)
    row['after'] = sha(data)
    if reason not in row['reasons']:
        row['reasons'].append(reason)
    ledger_file.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')


def swap(path: Path, pairs, reason: str) -> None:
    text = path.read_text(encoding='utf-8')
    for old, new, expect in pairs:
        got = text.count(old)
        if got != expect:
            raise RuntimeError(f'{path.name}: 期望 {old[:24]!r}×{expect}, 实际×{got}')
        text = text.replace(old, new)
    ledger_write(path, text.encode('utf-8'), reason)


def json_roundtrip_stable(path: Path) -> bool:
    text = path.read_text(encoding='utf-8')
    return json.dumps(json.loads(text), ensure_ascii=False, indent=2) + '\n' == text


def core() -> None:
    old = load_old()
    assert json_roundtrip_stable(SOURCE)
    swap(SOURCE, [(old, NEW, 1), (DOC_OLD, DOC_NEW, 1)], '底座多彩定稿+分层契约doc随源')


def docs() -> None:
    old = load_old.__wrapped__() if hasattr(load_old, '__wrapped__') else None
    # OLD 再取一次(此刻真源已是 NEW,从备份台账取原值不可靠→直接读 changes.json 前
    # 不行;改为:docs 阶段从 prefix.md 现文按「含写意水墨的整段」定位)
    prefix = MANUAL / 'prefix.md'
    text = prefix.read_text(encoding='utf-8')
    import re
    m = re.findall(r'美术风格底座：[^。]*写意水墨[^“"]*(?:。[^“"“\n]*){0,12}。', text)
    # 退化方案:直接用 core 备份的 OLD
    ledger = json.loads((OUT / 'changes.json').read_text())
    src_row = next(r for r in ledger if r['path'].endswith('qi21_bases.json'))
    old_text = json.loads(Path(src_row['backup']).read_text(encoding='utf-8'))['art_style_base']['positive_text']
    swap(prefix, [(old_text, NEW, 2)], '手册两处底座全文随源')
    swap(MANUAL / 'json/prompt_layering.json', [(OWNS_OLD, OWNS_NEW, 1)], '分层契约owns随源')
    swap(MANUAL / 'ma_sync/lock-anchors.json', [(LOCK_OLD, LOCK_NEW, 1)], '风格底座锁锚随源')
    snapshot = MANUAL / 'ma_sync/LOCK_SNAPSHOT.md'
    stext = snapshot.read_text(encoding='utf-8')
    marker = '本目录是 MYStudio 道劫手册与 MA `ma-imagegen` 的同步锚点:'
    if stext.count(marker) != 1:
        raise RuntimeError('LOCK_SNAPSHOT 标记异常')
    note = ('> **1016 底座多彩定稿(用户令版)**：删透明水彩/写意水墨融合语与渗化干湿句;'
            '补色面边界明确平整/色相对比保持清晰/线条饱满有力/细节密度高笔笔可辨/'
            'crisp sharp edges/clean flat digital finish;多彩主次句回补(1016 双令)。'
            '机读现值见 `../json/qi21_bases.json#art_style_base`。\n\n')
    if '1016 底座多彩定稿' not in stext:
        ledger_write(snapshot, stext.replace(marker, note + marker).encode('utf-8'), '记录多彩定稿')
    contract = MANUAL / 'ma_sync/runtime-contract.json'
    assert json_roundtrip_stable(contract)
    data = json.loads(contract.read_text(encoding='utf-8'))
    data['modules']['style.gongbi-base']['text'] = NEW
    data['localRevision']['styleSourceSha256'] = sha(SOURCE.read_bytes())
    fingerprint = {k: v for k, v in data.items() if k != 'contractSha256'}
    data['contractSha256'] = sha(json.dumps(fingerprint, ensure_ascii=False, sort_keys=True,
                                            separators=(',', ':')).encode())
    ledger_write(contract, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'),
                 '运行时风格模块同文+重算合同指纹')


def snapshots() -> None:
    ledger = json.loads((OUT / 'changes.json').read_text())
    src_row = next(r for r in ledger if r['path'].endswith('qi21_bases.json'))
    old_text = json.loads(Path(src_row['backup']).read_text(encoding='utf-8'))['art_style_base']['positive_text']
    for path, expect in WF_COUNTS.items():
        swap(path, [(old_text, NEW, expect)], '工作流/子图底座字符串随源(原位换句)')


def test_anchors() -> None:
    tests = ROOT / 'apps/backend/engines/comfyui/my_nodes/tests'
    new16 = sha(NEW.encode())[:16]
    swap(tests / 'test_my_qi21_prompt_assembly.py', [
        ('"锁层A全文": "1a3456dd1e8ae550",', f'"锁层A全文": "{new16}",  # 1016底座多彩定稿重锚', 1),
    ], '装配默认SHA锚随新底座')
    swap(tests / 'test_qi21_style_boundary_1016.py', [
        (BOUNDARY_OLD, BOUNDARY_NEW, 1),
    ], '底座边界词表锚随新底座(水墨英文词退役,可见质量词入册)')
    rc = json.loads((MANUAL / 'ma_sync/runtime-contract.json').read_text())
    ts = ROOT / 'apps/frontend/lib/ai/daojie-prompt-contract.test.ts'
    ts_text = ts.read_text(encoding='utf-8')
    import re
    old_sha = re.search(r'[0-9a-f]{64}', ts_text).group(0)
    swap(ts, [(old_sha, rc['contractSha256'], 1)], '前端合同指纹锚随重算值')


def distribute() -> None:
    app = Path('/Applications/漫影工作室.app/Contents/Resources')
    release = (ROOT / 'apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources')
    ma = Path('/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng')
    ip = Path('/Users/zhengbingjin/Project/IP/漫影工作室/skills/art_skills/daojie_ink_guofeng')
    engine_data = Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/daojie-data')
    engine_nodes = Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes')
    manual = 'studio-manuals/art_skills/daojie_ink_guofeng'

    plan: list[tuple[Path, Path]] = []
    for name in ['prefix.md', 'json/qi21_bases.json', 'json/prompt_layering.json',
                 'ma_sync/runtime-contract.json', 'ma_sync/lock-anchors.json', 'ma_sync/LOCK_SNAPSHOT.md']:
        src = MANUAL / name
        for base, rel in [(app, manual), (release, manual), (ma, '.'), (ip, '.')]:
            plan.append((src, base / rel / name))
    for src in WF_COUNTS:
        rel_wf = src.relative_to(ROOT / 'apps/backend/engines/comfyui')
        plan.append((src, app / 'backend/engines/comfyui' / rel_wf))
        plan.append((src, release / 'backend/engines/comfyui' / rel_wf))
        if src.parent.name == 'subgraphs':
            plan.append((src, engine_nodes / 'subgraphs' / src.name))
    plan.append((SOURCE, engine_data / 'qi21_bases.json'))

    rows = []
    for src, target in plan:
        if not target.exists():
            rows.append({'target': str(target), 'status': 'missing'})
            continue
        src_bytes = src.read_bytes()
        if target.read_bytes() == src_bytes:
            rows.append({'target': str(target), 'status': 'already-in-sync'})
            continue
        if src == SOURCE:
            current = json.loads(target.read_text(encoding='utf-8'))
            desired = json.loads(src_bytes)
            types_before = json.dumps(current.get('types'), ensure_ascii=False, sort_keys=True)
            current['art_style_base'] = desired['art_style_base']
            current['layer_contract'] = desired['layer_contract']
            assert json.dumps(current.get('types'), ensure_ascii=False,
                              sort_keys=True) == types_before
            data = (json.dumps(current, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        else:
            data = src_bytes
        ledger_write(target, data, '分发:随源' + ('(保留目标types)' if src == SOURCE else ''))
        rows.append({'target': str(target), 'status': 'written',
                     'byte_identity': target.read_bytes() == src_bytes})
    (OUT / 'distribution.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    print(f'分发 {len(rows)} 目标: written={sum(1 for r in rows if r["status"]=="written")}, '
          f'in-sync={sum(1 for r in rows if r["status"]=="already-in-sync")}, '
          f'missing={sum(1 for r in rows if r["status"]=="missing")}')


def verify() -> None:
    problems = []
    residue_tokens = ['写意水墨', 'Chinese ink wash painting', '边缘渗化', '透明薄染（soft']
    for p in [SOURCE, MANUAL / 'json/prompt_layering.json', MANUAL / 'ma_sync/runtime-contract.json'] + list(WF_COUNTS):
        text = Path(p).read_text(encoding='utf-8')
        for tok in residue_tokens:
            if tok in text:
                problems.append(f'水墨融合残留 {tok!r}: {p.name}')
    for p, expect in [(SOURCE, 1), (MANUAL / 'prefix.md', 2),
                      (MANUAL / 'ma_sync/runtime-contract.json', 1)] + list(WF_COUNTS.items()):
        got = Path(p).read_text(encoding='utf-8').count(NEW)
        if got != expect:
            problems.append(f'新句次数 {p.name}: {got}!={expect}')
    new16 = sha(NEW.encode())[:16]
    asm = (ROOT / 'apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py').read_text()
    if new16 not in asm:
        problems.append('装配 sha16 锚未同步')
    rc_sha = json.loads((MANUAL / 'ma_sync/runtime-contract.json').read_text())['contractSha256']
    ts = (ROOT / 'apps/frontend/lib/ai/daojie-prompt-contract.test.ts').read_text()
    if ts.count(rc_sha) < 1:
        problems.append('TS 指纹锚未同步')
    anchors = json.loads((MANUAL / 'ma_sync/lock-anchors.json').read_text())
    prefix_text = (MANUAL / 'prefix.md').read_text(encoding='utf-8')
    for lock in anchors['locks']:
        if lock['name'] == '风格底座锁':
            for a in lock.get('manualAnchors', []):
                if a not in prefix_text:
                    problems.append(f'风格锁锚不在 prefix.md: {a[:28]}')
    dist = json.loads((OUT / 'distribution.json').read_text())
    for row in dist:
        if row['status'] == 'missing':
            problems.append(f'分发目标缺失: {row["target"]}')
    print(json.dumps({'ok': not problems, 'problems': problems, 'targets': len(dist)},
                     ensure_ascii=False, indent=1))


def residue() -> None:
    """补刀:bases.layer_contract 段矩阵 OWNS 标签 + prompt_layering owns 转述从句。"""
    swap(SOURCE, [(OWNS_OLD, OWNS_NEW, 1)], '段矩阵OWNS标签随源(那役写了双份)')
    clause = ('，透明水彩（watercolor illustration）负责薄透设色，'
              '写意水墨（Chinese ink wash painting）负责笔触韵致')
    swap(MANUAL / 'json/prompt_layering.json', [(clause, '', 1)], 'owns转述删水墨双从句')
    contract = MANUAL / 'ma_sync/runtime-contract.json'
    data = json.loads(contract.read_text(encoding='utf-8'))
    data['localRevision']['styleSourceSha256'] = sha(SOURCE.read_bytes())
    fingerprint = {k: v for k, v in data.items() if k != 'contractSha256'}
    new_sha = sha(json.dumps(fingerprint, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':')).encode())
    old_sha = data['contractSha256']
    data['contractSha256'] = new_sha
    ledger_write(contract, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'),
                 'styleSourceSha 随bases段矩阵再改,重算合同指纹')
    swap(ROOT / 'apps/frontend/lib/ai/daojie-prompt-contract.test.ts',
         [(old_sha, new_sha, 1)], '前端合同指纹锚随重算值')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    {'core': core, 'docs': docs, 'snapshots': snapshots, 'residue': residue,
     'test-anchors': test_anchors, 'distribute': distribute, 'verify': verify}[sys.argv[1]]()
