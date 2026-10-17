"""1016 美术风格底座墨彩翻转(用户令:底座要多彩,不要水墨拉力)。

改动三刀(正向底座句):
  1. 「铁线描细稳连贯,线宽与轻重提按富有节奏」→「线条细稳连贯、粗细随结构与轻重富有节奏」
     (铁线描=等细线与提按节奏自相矛盾;1009 去彩裁定线层无彩,故用中性「线条」而非「彩线描」)
  2. 「墨色浓淡」→「色彩浓淡」(1009 墨彩化既定替换;型文层 3 型已在用)
  3. 「采用中国传统色体系,饱和度…」→「采用中国传统色体系,多色相并陈,饱和度…」(型文已验证词汇)

不碰:K2/LoRA/视频线(gongbi_v2)/canon 甲案(05库,09-23 用户令按三国望圣经定)/人像库/历史快照。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[3]
MANUAL = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
OUT = ROOT / 'apps/output/automation/qi21-base-multicolor-1016'
SOURCE = MANUAL / 'json/qi21_bases.json'

OLD = ('美术风格底座：中国传统人物画审美经现代游戏美术设计重组的二维数字绘画。'
       '融合工笔、白描与连环画的绘画语言；铁线描细稳连贯，线宽与轻重提按富有节奏，保留手绘笔性；'
       '薄透矿物色分染与罩染，墨色浓淡、虚实边缘与笔触节奏相融；'
       '采用中国传统色体系，饱和度与对比度受控，材质表现统一于绘画语言。'
       '成像工艺干净，线条与罩染层次清晰。')
NEW = ('美术风格底座：中国传统人物画审美经现代游戏美术设计重组的二维数字绘画。'
       '融合工笔、白描与连环画的绘画语言；线条细稳连贯、粗细随结构与轻重富有节奏，保留手绘笔性；'
       '薄透矿物色分染与罩染，色彩浓淡、虚实边缘与笔触节奏相融；'
       '采用中国传统色体系，多色相并陈，饱和度与对比度受控，材质表现统一于绘画语言。'
       '成像工艺干净，线条与罩染层次清晰。')

LABEL_OLD = '全部定义（传统绘画转译/画种/媒介/线条/罩染/墨色/传统色体系）'
LABEL_NEW = '全部定义（传统绘画转译/画种/媒介/线条/罩染/色彩浓淡/传统色多色相）'
OWNS_OLD = ('中国传统人物画经现代游戏美术重组的二维数字绘画；'
            '工笔、白描、连环画、铁线描、矿物色分染罩染、墨色与笔触节奏。')
OWNS_NEW = ('中国传统人物画经现代游戏美术重组的二维数字绘画；'
            '工笔、白描、连环画、线条节奏与手绘笔性、矿物色分染罩染、色彩浓淡与多色相传统色。')
ANCHOR_OLD = '铁线描细稳连贯'
ANCHOR_NEW = '线条细稳连贯、粗细随结构与轻重富有节奏'

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
        row = {'path': str(path), 'backup': str(backup),
               'before': sha(before), 'reasons': []}
        ledger.append(row)
    row['after'] = sha(data)
    if reason not in row['reasons']:
        row['reasons'].append(reason)
    ledger_file.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')


def swap(path: Path, pairs: list[tuple[str, str, int]], reason: str) -> None:
    """原位换句:每个 (old,new,期望次数) 精确断言,不动文件其余字节。"""
    text = path.read_text(encoding='utf-8')
    for old, new, expect in pairs:
        got = text.count(old)
        if got != expect:
            raise RuntimeError(f'{path}: 期望 {old[:24]!r}×{expect}, 实际×{got}')
        text = text.replace(old, new)
    ledger_write(path, text.encode('utf-8'), reason)


def json_roundtrip_stable(path: Path) -> bool:
    text = path.read_text(encoding='utf-8')
    return json.dumps(json.loads(text), ensure_ascii=False, indent=2) + '\n' == text


def core() -> None:
    assert json_roundtrip_stable(SOURCE)
    swap(SOURCE, [(OLD, NEW, 1), (LABEL_OLD, LABEL_NEW, 1)], '底座正向句墨彩翻转+分层契约标签随源')


def docs() -> None:
    swap(MANUAL / 'prefix.md', [(OLD, NEW, 2)], '手册两处底座全文引用随源')
    swap(MANUAL / 'json/prompt_layering.json', [(OWNS_OLD, OWNS_NEW, 1), (LABEL_OLD, LABEL_NEW, 1)],
         '分层契约owns与段矩阵随源')
    swap(MANUAL / 'ma_sync/lock-anchors.json', [(ANCHOR_OLD, ANCHOR_NEW, 1)],
         '风格底座锁手册锚随源(MA侧锚与来源不改)')
    snapshot = MANUAL / 'ma_sync/LOCK_SNAPSHOT.md'
    text = snapshot.read_text(encoding='utf-8')
    marker = '本目录是 MYStudio 道劫手册与 MA `ma-imagegen` 的同步锚点:'
    if text.count(marker) != 1:
        raise RuntimeError('LOCK_SNAPSHOT 标记异常')
    note = ('> **1016 底座墨彩翻转**：正向句「铁线描细稳连贯，线宽与轻重提按富有节奏」→'
            '「线条细稳连贯、粗细随结构与轻重富有节奏」、「墨色浓淡」→「色彩浓淡」、'
            '「传统色体系」后补「多色相并陈」(用户令:底座要多彩,不要水墨拉力;'
            '1009 去彩裁定线层无彩,故用中性「线条」而非「彩线描」)。'
            '机读现值见 `../json/qi21_bases.json#art_style_base`。\n\n')
    if '1016 底座墨彩翻转' not in text:
        text = text.replace(marker, note + marker)
        ledger_write(snapshot, text.encode('utf-8'), '记录底座墨彩翻转')
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
    for path, expect in WF_COUNTS.items():
        swap(path, [(OLD, NEW, expect)], '工作流/子图底座字符串随源(原位换句,不触并行改动)')


def test_anchors() -> None:
    tests = ROOT / 'apps/backend/engines/comfyui/my_nodes/tests'
    swap(tests / 'test_my_qi21_bases_text.py', [
        ('assert "铁线描" in 风格 and "成像工艺干净" in 风格',
         'assert "线条细稳连贯" in 风格 and "成像工艺干净" in 风格', 1),
    ], '热读锚随新底座')
    new16 = sha(NEW.encode())[:16]
    swap(tests / 'test_my_qi21_prompt_assembly.py', [
        ('"锁层A全文": "687cb0ac49944a14",',
         f'"锁层A全文": "{new16}",  # 1016底座墨彩翻转重锚(铁线描→线条/墨色浓淡→色彩浓淡/补多色相并陈)', 1),
    ], '装配默认SHA锚随新底座')
    swap(tests / 'test_qi21_style_boundary_1016.py', [
        ("'连环画', '铁线描',", "'连环画', '线条细稳连贯',", 1),
        ("'矿物色', '传统色', '受控',", "'矿物色', '色彩浓淡', '多色相并陈', '传统色', '受控',", 1),
    ], '底座边界词表锚随新底座')
    contract_sha = json.loads((MANUAL / 'ma_sync/runtime-contract.json').read_text())['contractSha256']
    ts = ROOT / 'apps/frontend/lib/ai/daojie-prompt-contract.test.ts'
    old_sha = 'b9e402d14095e3641a6d32b694a917a93adcd4c3c9e442da3efb3411b384503f'
    swap(ts, [(old_sha, contract_sha, 1)], '前端合同指纹锚随重算值')


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
        # 基座 json 目标可能有既有类型差异 → 原位合并保留目标 types
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
    written = sum(1 for r in rows if r['status'] == 'written')
    print(f'分发 {len(rows)} 目标: written={written}, '
          f'in-sync={sum(1 for r in rows if r["status"] == "already-in-sync")}, '
          f'missing={sum(1 for r in rows if r["status"] == "missing")}')


def verify() -> None:
    problems = []
    # 1) 真源与手册链零旧句(prefix.md 的 L2 色彩材质指导属 canon 谱系词汇,不在底座句范围)
    for p in [SOURCE, MANUAL / 'json/prompt_layering.json',
              MANUAL / 'ma_sync/runtime-contract.json'] + list(WF_COUNTS):
        text = Path(p).read_text(encoding='utf-8')
        if OLD in text or '墨色浓淡' in text:
            problems.append(f'旧句残留: {p}')
    if OLD in (MANUAL / 'prefix.md').read_text(encoding='utf-8'):
        problems.append('旧句残留: prefix.md')
    # 2) 新句落位与次数
    for p, expect in [(SOURCE, 1), (MANUAL / 'prefix.md', 2),
                      (MANUAL / 'ma_sync/runtime-contract.json', 1)] + list(WF_COUNTS.items()):
        got = Path(p).read_text(encoding='utf-8').count(NEW)
        if got != expect:
            problems.append(f'新句次数 {p}: {got}!={expect}')
    # 3) 锚件闭环:只核本次触达的「风格底座锁」行;其余锁的既有断链(1016 前序战役改写
    #    prefix.md 未回同步)属既有债,记为 informational 不判失败
    prefix_text = (MANUAL / 'prefix.md').read_text(encoding='utf-8')
    anchors = json.loads((MANUAL / 'ma_sync/lock-anchors.json').read_text())
    preexisting = []
    for lock in anchors['locks']:
        for a in lock.get('manualAnchors', []):
            if a not in prefix_text:
                if lock['name'] == '风格底座锁':
                    problems.append(f'manualAnchor 不在 prefix.md: {a[:30]}')
                else:
                    preexisting.append(f"{lock['name']}:{a[:20]}")
    # 4) TS 指纹锚与 runtime-contract 一致
    rc_sha = json.loads((MANUAL / 'ma_sync/runtime-contract.json').read_text())['contractSha256']
    ts = (ROOT / 'apps/frontend/lib/ai/daojie-prompt-contract.test.ts').read_text(encoding='utf-8')
    if ts.count(rc_sha) < 1:
        problems.append('TS 合同指纹锚未同步')
    # 5) 装配 sha16 锚
    assembly = (ROOT / 'apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py'
                ).read_text(encoding='utf-8')
    if sha(NEW.encode())[:16] not in assembly:
        problems.append('装配 sha16 锚未同步')
    # 6) 分发一致性
    dist = json.loads((OUT / 'distribution.json').read_text())
    for row in dist:
        if row['status'] == 'missing':
            problems.append(f'分发目标缺失: {row["target"]}')
    print(json.dumps({'ok': not problems, 'problems': problems,
                      'preexisting_anchor_debt': len(preexisting), 'targets': len(dist)},
                     ensure_ascii=False, indent=1))


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    {'core': core, 'docs': docs, 'snapshots': snapshots,
     'test-anchors': test_anchors, 'distribute': distribute, 'verify': verify}[sys.argv[1]]()
