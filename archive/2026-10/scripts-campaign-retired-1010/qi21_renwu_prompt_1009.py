#!/usr/bin/env python3
"""1009 人物型提示词优化:回退错位的跨视图四负向 token + 台账收口。

背景:1008 S3 将四条「跨视图一致性」候实弹 token 落入人物型负面(prompt_layering
known_gaps/5 挂账,候 S5 实弹裁决、红则回退)。现行状态三重错位:
① 跨视图条目住在单视图的人物型(型定位决定内容边界——人物型无多视图);
②「侧视图构图跑成正面」会干扰主体句合法的侧身取景;
③ 实弹裁决协议随 40 步验收批废弃而停滞,且人物多视图型负向已改写为专职四条
  (透视/视角歪斜/俯仰机位/各面比例漂移)。
处置=按挂账预案提前回退,台账两处(prompt_layering known_gaps/5 + 05库 1008 S3 注)
追加收口注记。不改史:05库原文保留,只追加;qi21_s3_surgery_1008.py 历史脚本不动。
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASES = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
LAYERING = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/prompt_layering.json'
LIB05 = ROOT / 'docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md'
TASK = ROOT / '.trellis/tasks/10-09-qi21-renwu-prompt-optimize'

BASES_SHA = '647dedd917f6c6bac004726601fad2a89bfa494bfc48cab70330694a1e789805'  # 并行人脸负向重定位合并态(1009)
LAYERING_SHA = 'fdddbed2772956082c9d9572923bf8090cabd44b18537ee34834ab960021abe5'

OLD_TAIL = '，视图间发型变化，视图间五官变化，武器尺寸视图间变形，侧视图构图跑成正面'
GAP5_OLD = ('跨视图一致性负面条目(夸克Skill5.4对拍④;1005 挂账,1008 S3 首步落库):四条候实弹 token '
            '已入人物型负面(视图间发型变化/视图间五官变化/武器尺寸视图间变形/侧视图构图跑成正面),'
            '候 S5 实弹裁决、红则回退;多视图/表情差分型级仍零跨视图条目,候实弹结论再定扩布')
GAP5_NEW = ('~~已回退(1009 人物优化轮)~~跨视图一致性负面条目(夸克Skill5.4对拍④;1005 挂账,1008 S3 首步落库):'
            '四条 token 已从人物型负面移除——跨视图条目错住单视图人物型(「侧视图构图跑成正面」干扰主体句'
            '合法侧身取景),人物多视图型已持专职负向(透视/视角歪斜/俯仰机位/各面比例漂移),实弹裁决随 '
            '40 步验收批废弃停滞,按挂账预案提前回退;扩布议题随专职负向就位失焦——留痕')
LIB05_OLD_TAIL = '候 S5 实弹裁决、红则回退;美宣/分镜/多视图/高清人脸/表情差分型未挂;真文以 qi21_bases.json 现值为准。'
LIB05_APPEND = ('**(1009 人物优化轮回退)**:四条跨视图 token 已从人物型负面移除——错住单视图人物型,'
                '人物多视图型已持专职负向(透视/视角歪斜/俯仰机位/各面比例漂移),实弹裁决随 40 步验收批'
                '废弃停滞;真文以 qi21_bases.json 现值为准。')


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def splice_json_field(text: str, key: str, old: str, new: str) -> str:
    anchor = json.dumps(key) + ': ' + json.dumps(old, ensure_ascii=False)
    assert text.count(anchor) == 1, f'anchor not unique: {key}'
    return text.replace(anchor, json.dumps(key) + ': ' + json.dumps(new, ensure_ascii=False), 1)


def atomic_write(path: Path, data: bytes, expect_before: bytes) -> None:
    assert path.read_bytes() == expect_before, f'concurrent change: {path}'
    fd, tmp = tempfile.mkstemp(prefix=f'.{path.name}-', dir=path.parent)
    try:
        with open(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
        shutil.copymode(path, tmp)
        assert path.read_bytes() == expect_before, f'concurrent change during surgery: {path}'
        Path(tmp).replace(path)
    finally:
        if Path(tmp).exists():
            Path(tmp).unlink()


def main() -> None:
    apply = '--apply' in sys.argv
    bases_raw = BASES.read_bytes()
    layering_raw = LAYERING.read_bytes()
    lib_raw = LIB05.read_bytes()
    assert sha(bases_raw) == BASES_SHA, 'qi21_bases.json changed concurrently: reread before editing'
    assert sha(layering_raw) == LAYERING_SHA, 'prompt_layering.json changed concurrently: reread before editing'

    bases = json.loads(bases_raw)
    entry = bases['types'][0]
    assert entry['zh'] == '人物'
    neg = entry['negative_text']
    assert neg.endswith(OLD_TAIL) and neg.count(OLD_TAIL) == 1, 'negative tail anchor mismatch'
    new_neg = neg[:-len(OLD_TAIL)]
    # 负向 token 格式四硬规(1008 终审)内联自检:回退不得引入新违例
    toks = [t for t in new_neg.split('，') if t]
    assert toks and all(len(t) < 12 and '/' not in t for t in toks)
    assert len(toks) == len(set(toks)), 'duplicate token after removal'
    assert not any(t in new_neg for t in ('视图间发型变化', '视图间五官变化', '武器尺寸视图间变形', '侧视图构图跑成正面'))

    bases_text = splice_json_field(bases_raw.decode('utf-8'), 'negative_text', neg, new_neg)
    new_bases = json.loads(bases_text)
    assert new_bases['types'][0]['negative_text'] == new_neg
    # 白名单:全文件仅人物负向一字段变化,其余九型与全局零漂移
    for i, (a, b) in enumerate(zip(bases['types'], new_bases['types'])):
        diff = {k for k in set(a) | set(b) if a.get(k) != b.get(k)}
        assert diff <= ({'negative_text'} if i == 0 else set()), f'unexpected drift types[{i}]: {diff}'
    assert {k for k in bases if bases[k] != new_bases[k]} <= {'types'}, 'unexpected top-level drift'

    layering = json.loads(layering_raw)
    assert layering['known_gaps'][5] == GAP5_OLD, 'known_gaps/5 anchor mismatch'
    # known_gaps 为字符串数组:以整段引号串为锚(前验全文唯一)
    layering_text = layering_raw.decode('utf-8')
    gap_anchor = json.dumps(GAP5_OLD, ensure_ascii=False)
    assert layering_text.count(gap_anchor) == 1, 'known_gaps/5 string anchor not unique'
    layering_text = layering_text.replace(gap_anchor, json.dumps(GAP5_NEW, ensure_ascii=False), 1)
    new_layering = json.loads(layering_text)
    assert new_layering['known_gaps'][5] == GAP5_NEW
    assert [g for i, g in enumerate(new_layering['known_gaps']) if i != 5] == \
           [g for i, g in enumerate(layering['known_gaps']) if i != 5], 'unexpected known_gaps drift'

    lib_text = lib_raw.decode('utf-8')
    assert lib_text.count(LIB05_OLD_TAIL) == 1, '05 lib note anchor mismatch'
    new_lib_text = lib_text.replace(LIB05_OLD_TAIL, LIB05_OLD_TAIL + '\n' + LIB05_APPEND, 1)

    report = {
        'removed_tokens': OLD_TAIL.lstrip('，').split('，'),
        'negative_tokens_before': len(neg.split('，')),
        'negative_tokens_after': len(new_neg.split('，')),
        'bases_sha_before': BASES_SHA,
        'bases_sha_after': sha(bases_text.encode('utf-8')),
        'layering_sha_after': sha(layering_text.encode('utf-8')),
        'lib05_sha_after': sha(new_lib_text.encode('utf-8')),
    }
    if apply:
        backup = TASK / 'backups'
        backup.mkdir(parents=True, exist_ok=True)
        for path, raw in [(BASES, bases_raw), (LAYERING, layering_raw), (LIB05, lib_raw)]:
            dst = backup / (path.name + '-before')
            assert not dst.exists(), f'never overwrite backup: {dst}'
            shutil.copy2(path, dst)
        atomic_write(BASES, bases_text.encode('utf-8'), bases_raw)
        atomic_write(LAYERING, layering_text.encode('utf-8'), layering_raw)
        atomic_write(LIB05, new_lib_text.encode('utf-8'), lib_raw)
        (TASK / 'research/renwu-surgery-report.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'mode': 'apply' if apply else 'dry-run', **report}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
