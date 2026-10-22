#!/usr/bin/env python3
"""1022 人脸基准入列·flux3 快照链滚(第三链,循 1021 配方)。

original 锚恒不动(a2df104b);滚 approved_sha256+批准锚/台账两证据
(path/anchor/sha256);测试钉值随迁(test_flux3_daojie_workflow_contract.py)。
fail-closed:全部前置断言不过即退。
"""
import hashlib, json, re, sys
from pathlib import Path

ROOT = Path('/Users/zhengbingjin/Project/Github/MYStudio')
TASK = ROOT / '.trellis/tasks/10-16-flux3-daojie-ten-types'
REV = TASK / 'reports/shared-source-revisions.json'
TEST = ROOT / 'apps/backend/engines/comfyui/tests/test_flux3_daojie_workflow_contract.py'
BASES_REL = 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
APPROVAL = TASK / 'reports/bases-reapproval-1022-facebase.md'
LEDGER = TASK / 'reports/bases-change-ledger-1022-facebase.md'
APPROVAL_REL = '.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-reapproval-1022-facebase.md'
LEDGER_REL = '.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-change-ledger-1022-facebase.md'
APPROVAL_ANCHOR = '## Decisions(2026-10-22 用户令「按照晏燎基准脸的方式,新增一个人脸基准的类型」)'
LEDGER_ANCHOR = '## 字段级变更(2 处,1022 人脸基准入列实测)'


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    # ── 前置断言 ──
    bases = json.loads((ROOT / BASES_REL).read_text(encoding='utf-8'))
    assert len(bases['types']) == 13, "bases 须 13 档"
    assert bases['types'][11]['zh'] == '人脸基准'
    a_doc = APPROVAL.read_text(encoding='utf-8')
    l_doc = LEDGER.read_text(encoding='utf-8')
    assert APPROVAL_ANCHOR in a_doc.splitlines(), "批准锚行不在档"
    assert LEDGER_ANCHOR in l_doc.splitlines(), "台账锚行不在档"
    new_bases_sha = sha(ROOT / BASES_REL)
    approval_sha, ledger_sha = sha(APPROVAL), sha(LEDGER)

    # ── revisions 滚链 ──
    rev = json.loads(REV.read_text(encoding='utf-8'))
    ent = rev[BASES_REL]
    assert ent['original_sha256'] == 'a2df104bf740670cbea1fbe9b06ba43c7695b7d2be26d0a6cfc621e422967bff', "original 锚漂移"
    old_approved = ent['approved_sha256']
    assert old_approved == '9a5b54ef26b06bf63fbd5b74faa8b633afb1c775161031bbcce26cc3359ae64e', \
        f"前置 approved 非 1021 终值,链断: {old_approved}"
    ent['approved_sha256'] = new_bases_sha
    ent['approval'] = {'path': APPROVAL_REL, 'anchor': APPROVAL_ANCHOR, 'sha256': approval_sha}
    ent['change_ledger'] = {'path': LEDGER_REL, 'anchor': LEDGER_ANCHOR, 'sha256': ledger_sha}
    ent['historical_backup'] = '.trellis/tasks/archive/2026-10/10-18-daojie-conflict-p1-canon/backups/qi21_bases.json'
    REV.write_text(json.dumps(rev, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    # ── 测试钉值随迁 ──
    t = TEST.read_text(encoding='utf-8')
    assert old_approved in t, "测试无旧 approved 钉值(形态变?)"
    t = t.replace(old_approved, new_bases_sha)
    t = t.replace(
        "'path':'.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-reapproval-1021-3d-cutaway.md',",
        "'path':'.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-reapproval-1022-facebase.md',")
    t = t.replace(
        "'anchor':'## Decisions(2026-10-21 用户令「源提示词里面还需要加1个类型,就是3D剖面场景图,专门做室内」)',",
        "'anchor':'" + APPROVAL_ANCHOR + "',")
    t = t.replace(
        "'sha256':'6d88266425ffc9065c258f5c243ca539de9d2588a485edf4ac5ca3f2ef7811d5',",
        "'sha256':'" + approval_sha + "',")
    t = t.replace(
        "'path':'.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-change-ledger-1021-3d-cutaway.md',",
        "'path':'.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-change-ledger-1022-facebase.md',")
    t = t.replace(
        "'anchor':'## 字段级变更(2 处,1021 新型入列实测)',",
        "'anchor':'" + LEDGER_ANCHOR + "',")
    t = t.replace(
        "'sha256':'f8d8a0c78c323d94c4f4e6c1756754f291bfe5103e099067b6afc902a18ed22e',",
        "'sha256':'" + ledger_sha + "',")
    TEST.write_text(t, encoding='utf-8')
    print(f"[ok] 链滚:approved {old_approved[:8]}→{new_bases_sha[:8]};"
          f"批准锚/台账→1022-facebase 两件钉值随迁;original a2df104b 恒定")
    return 0


if __name__ == '__main__':
    sys.exit(main())
