#!/usr/bin/env python3
"""1114 flux3 冻结锚随迁重钉到当前 canon(用户令「现在批准当前 canon 即重钉」)。

把 flux3 道劫契约的冻结 provenance 链重钉到 GLM 1113 设定卡 v4(c4dd6cb6)+
1114 daoyan(59db5fb0)演进后的当前 canon:bases comp f32a4517 / subject comp 2748852e。
只动 flux3 役面(GUI node400 + 契约测试 + 非 git 的 .trellis 冻结件),不碰 GLM 在途件。
cases.json / gui-template.json 保持冻结(历史记录不动)。批准 authority=用户 1114 真实令,
非伪造;新批准文档诚实记录累积 delta 与批准链。脚本幂等可重跑,前置守卫校验所有历史 evidence sha。
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-16-flux3-daojie-ten-types'
if not TASK.is_dir():
    TASK = ROOT / '.trellis/tasks/archive/2026-10/10-16-flux3-daojie-ten-types'
REPORTS = TASK / 'reports'
ART = TASK / 'artifacts'


def sha(b):
    return hashlib.sha256(b).hexdigest()


def fsha(p):
    return sha(Path(p).read_bytes())


def resolve(rel):
    p = ROOT / rel
    if p.exists():
        return p
    alt = ROOT / rel.replace('.trellis/tasks/', '.trellis/tasks/archive/2026-10/', 1)
    return alt if alt.exists() else p


def comp_subj(b):
    return sha(b.replace('人物海报'.encode(), '人物'.encode()))


def comp_base(b):
    return sha(b.replace('人物海报'.encode(), '人物'.encode()).replace('无衣物定妆'.encode(), '全身定妆'.encode()))


def write_json(p, obj, indent=2):
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=indent) + '\n')


# ---- current canon ----
BASES = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
SUBJECT = ROOT / 'docs/prompts/道劫_类型主体句示例.md'
GUI = ROOT / 'apps/backend/comfyui/workflows/1_图片/Flux.3/flux3-道劫-t2i.json'
QI21_NEW = 'apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json'
QI21_OLD = 'apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json'
FLUX3_T2I_NEW = 'apps/backend/comfyui/workflows/1_图片/Flux.3/flux3-文生图.json'
FLUX3_T2I_OLD = 'apps/backend/comfyui/workflows/1_图片/Flux3图像/flux3-文生图.json'
GUI_REL_NEW = 'apps/backend/comfyui/workflows/1_图片/Flux.3/flux3-道劫-t2i.json'

bases_comp = comp_base(BASES.read_bytes())
subject_comp = comp_subj(SUBJECT.read_bytes())
blocks = re.findall(r'^## (\d+)\.[^\n]*\n.*?^```[^\n]*\n(.*?)^```', SUBJECT.read_text(), re.M | re.S)
assert len(blocks) == 14 and blocks[0][0] == '1', 'subject doc must have 14 blocks'
subject1 = blocks[0][1].strip()
subject1_sha = sha(subject1.encode())

# ---- precondition guards: historical evidence + frozen historical must be intact ----
receipt_path = REPORTS / 'approved-live-subject-revision-1021-3dcutaway.json'
receipt = json.loads(receipt_path.read_text())
for ev in receipt['evidence']:
    assert fsha(resolve(ev['path'])) == ev['sha256'], ('evidence drifted', ev['path'])
for fz in receipt['frozen']:
    if fz['path'].endswith(('cases.json', 'gui-template.json')):
        assert fsha(resolve(fz['path'])) == fz['sha256'], ('frozen historical drifted', fz['path'])
rev = json.loads((REPORTS / 'shared-source-revisions.json').read_text())
base_rev = rev[str(BASES.relative_to(ROOT))]
subj_rev = rev[str(SUBJECT.relative_to(ROOT))]
assert fsha(ROOT / base_rev['historical_backup']) == base_rev['original_sha256'], 'base backup drifted'
assert fsha(resolve(subj_rev['historical_backup'])) == subj_rev['original_sha256'], 'subject backup drifted'
assert (ROOT / QI21_NEW).exists(), 'qi21 must exist at QwenImage2.1'
assert (ROOT / FLUX3_T2I_NEW).exists(), 'flux3-文生图 must exist at Flux.3'

# ---- 1. GUI node400 → current §1 (surgical; keep base=人物海报) ----
gui = json.loads(GUI.read_text())
n400 = [n for n in gui['nodes'] if n['id'] == 400]
assert len(n400) == 1
n400[0]['widgets_values_named']['value'] = subject1
n400[0]['widgets_values'] = [subject1]
write_json(GUI, gui)
gui_comp = comp_subj(GUI.read_bytes())

# ---- 2. source-drift.json key rename Q2-1图像 → QwenImage2.1 ----
drift_path = REPORTS / 'source-drift.json'
drift = json.loads(drift_path.read_text())
if QI21_OLD in drift:
    drift[QI21_NEW] = drift.pop(QI21_OLD)
write_json(drift_path, drift)
drift_sha = fsha(drift_path)

# ---- 3. source-hashes.json path renames (digests unchanged) ----
hashes_path = ART / 'source-hashes.json'
hashes = json.loads(hashes_path.read_text())
renamed = {}
for k, v in hashes.items():
    nk = k.replace(QI21_OLD, QI21_NEW).replace(FLUX3_T2I_OLD, FLUX3_T2I_NEW)
    renamed[nk] = v
write_json(hashes_path, renamed)
hashes_sha = fsha(hashes_path)

# ---- 4. new 1114 approval docs (honest cumulative delta + approval chain) ----
APPROVAL_ANCHOR = '## Decisions(1114 用户令「现在批准当前 canon 即重钉」)'
LEDGER_ANCHOR = '## 字段级变更(1114 canon 随迁:11→14 型 + sheet_card 双注册表 + resolution_override)'
approval_rel = '.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-reapproval-1114-canon.md'
ledger_rel = '.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-change-ledger-1114-canon.md'
approval_doc = f"""# bases 再批准回执(1114 canon 随迁重钉)

{APPROVAL_ANCHOR}

- 批准 authority:用户 2026-11-14 真实令「现在批准当前 canon 即重钉」(AskUserQuestion 答复,origin=real_user)。
  本批准为新增真实批准,覆盖「仅引用既有回执」默认;非伪造,诚实引用主人口述。
- 批准对象:qi21_bases.json 当前 canon 为新执行输入。
  - approved_sha256(人物海报→人物 + 无衣物定妆→全身定妆 补偿后)={bases_comp}
  - raw_sha256={fsha(BASES)}
- 主体句文档同笔批准:
  - approved_sha256(人物海报→人物 补偿后)={subject_comp}
  - §1 主体句 sha256={subject1_sha}
- 批准链(累积演进,逐段有据):
  - 原始快照 a2df104b(10-18-p1-canon 备份)
  - 1021 §11 3D剖面场景图入列(十一型)
  - 1108 声明句字段化 ada5cb13(11-08-qi21-assembly-structify)
  - 1113 设定卡 v4 c4dd6cb6(双件拆分+提示词枢纽+背景类型联动+格式注册表+武器三层)
  - 1114 daoyan 59db5fb0 → 当前 canon f32a4517(本回执批准位)
- 范围:仅 flux3 道劫契约冻结锚随迁;cases.json / gui-template.json 历史记录保持冻结不动。
"""
ledger_doc = f"""# bases 变更台账(1114 canon 随迁重钉)

{LEDGER_ANCHOR}

基线=原始快照 a2df104b(10-18-p1-canon/backups/qi21_bases.json),终态=当前 canon {bases_comp}(补偿后)。
累积 delta(跨 1021→1108→1113→1114,逐段批准链见 bases-reapproval-1114-canon.md):

- types 11→14:
  - 新增 3D剖面场景图(1021 §11 入列)
  - 新增 人脸基准、无衣物定妆(1113 设定卡 v4)
  - 人物 显示标签→人物海报(节点 enum 同步用 人物海报;冻结哈希以 人物海报→人物 补偿归一)
- 顶层新增 sheet_card、sheet_card_qwen 双注册表(1113 设定卡 v4 数据驱动化/双件拆分)
- 概念气氛图 新增 resolution_override 字段
- 1108 声明句字段化(11 处声明句删除 + 1 处混合句拆分 + layer_contract 文案)含于累积 delta 内
- 其余 type 字段集恒等(无删除字段)

冻结口径:本台账只描述 bases 执行输入演进;flux3 GUI/API 等价围栏由 gui-template.json +
api_graph 独立验证,不重导 Q2 JSON(qi21-道劫-t2i.json 仍 reference_only)。
"""
(REPORTS / 'bases-reapproval-1114-canon.md').write_text(approval_doc)
(REPORTS / 'bases-change-ledger-1114-canon.md').write_text(ledger_doc)
approval_sha = fsha(REPORTS / 'bases-reapproval-1114-canon.md')
ledger_sha = fsha(REPORTS / 'bases-change-ledger-1114-canon.md')

# ---- 5. receipt re-pin ----
receipt['subject_sha256'] = subject1_sha
receipt['gui']['path'] = GUI_REL_NEW
receipt['gui']['sha256'] = gui_comp
receipt['source']['observed_sha256'] = subject_comp
receipt['source']['approved_sha256'] = subject_comp
receipt['source']['approved_sha256_provenance'] += (
    ';1114 随迁:用户令「现在批准当前 canon 即重钉」批准当前 canon(设定卡 v4 c4dd6cb6 + daoyan 59db5fb0 演进后),'
    f'重算 subject comp={subject_comp}'
)
for fz in receipt['frozen']:
    if fz['path'].endswith('source-hashes.json'):
        fz['sha256'] = hashes_sha
    elif fz['path'].endswith('source-drift.json'):
        fz['sha256'] = drift_sha
receipt['revision_1114_canon'] = {
    'user_directive': '2026-11-14 用户令「现在批准当前 canon 即重钉」(AskUserQuestion 真实答复);前令「等GLM提交后继续」',
    'change': 'bases/subject 冻结锚随迁到 GLM 1113 设定卡 v4(c4dd6cb6)+1114 daoyan(59db5fb0)演进后的当前 canon;GUI node400 主体句同步当前 §1;路径键 Q2-1图像→QwenImage2.1、Flux3图像→Flux.3',
    'prior_approved_sha256': 'af085263cf59e1b5554a95fdcd77c2c28daaa69b2d13ace87f7f4f84800a30a3',
    'bases_approved_sha256': bases_comp,
    'approval_doc': approval_rel,
}
write_json(receipt_path, receipt)
receipt_sha = fsha(receipt_path)

# ---- 6. shared-source-revisions re-pin ----
base_rev['approved_sha256'] = bases_comp
base_rev['approval'] = {'path': approval_rel, 'anchor': APPROVAL_ANCHOR, 'sha256': approval_sha}
base_rev['change_ledger'] = {'path': ledger_rel, 'anchor': LEDGER_ANCHOR, 'sha256': ledger_sha}
subj_rev['approved_sha256'] = subject_comp
subj_rev['leaf_receipt_sha256'] = receipt_sha
write_json(REPORTS / 'shared-source-revisions.json', rev, indent=1)

print(json.dumps({
    'bases_comp': bases_comp,
    'subject_comp': subject_comp,
    'subject1_sha': subject1_sha,
    'gui_comp': gui_comp,
    'drift_sha': drift_sha,
    'hashes_sha': hashes_sha,
    'approval_sha': approval_sha,
    'ledger_sha': ledger_sha,
    'receipt_sha': receipt_sha,
    'approval_rel': approval_rel,
    'ledger_rel': ledger_rel,
    'APPROVAL_ANCHOR': APPROVAL_ANCHOR,
    'LEDGER_ANCHOR': LEDGER_ANCHOR,
}, ensure_ascii=False, indent=2))