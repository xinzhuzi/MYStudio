#!/usr/bin/env python3
# 出处:2026-09-22 战役产物(带日期文件名清整,任务 09-22-repo-dated-filename-reorg);战役件自身,归档于 campaigns/。
"""带日期文件名清整执行器(Phase A)——本脚本自身即战役件,落归档区 campaigns/。

单一事实源:.trellis/tasks/09-22-repo-dated-filename-reorg/research/disposition-table.md
(2026-09-22 深化普查定稿,116 件)。本脚本内嵌同源数据;表-盘不一致即中止(exit 2)。

三模式:
  --dry-run(默认)  内嵌 116 件表与磁盘对账;多/少/漂移 exit 2 并打印差集;
                     通过则打印「CONSISTENCY OK」+各类计数(Phase B defer 单列)后 exit 0。
  --apply           按处置表执行:git mv 战役件 79+my_prefix 进 campaigns/(原名);
                     T1 正名 10 件;T3 三件进 docs/prompts/档案/;D1=git rm 十件 v 系超期件;
                     8 件提升件加出处头注释;my_prefix 加 DEPRECATED 警示头;全部引用改写;
                     prose 交付(CLAUDE.md 铁律/两个 README);收尾写 apply-manifest.json(b1-b4)。
  --verify          顶层残留正则/提升件头注释/冻结与 Phase B 未动/manifest 对账,逐项 PASS/FAIL。

铁律:幂等(目标已存在即跳过);黑名单触碰即 abort;不跑 pytest/守卫(外层门禁负责);
不 git add/commit(只 mv/rm);零网络。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

TASK_DIR = ".trellis/tasks/09-22-repo-dated-filename-reorg"
MANIFEST_REL = TASK_DIR + "/research/apply-manifest.json"
JOURNAL_REL = ".trellis/workspace/xinzhuzi/journal-2.md"
AUDIT_DATE = "2026-09-22"

# 带日期文件名口径(inventory §7):MMDD 式 + YYYYMMDD 式,后跟非数字。
DATE_RE = re.compile(r"[-_](0[89]|1[0-2])[0-9]{2}[^0-9]|[-_]202[0-9]{5}[^0-9]")


def find_repo_root() -> Path:
    cur = Path(__file__).resolve()
    for cand in [cur] + list(cur.parents):
        if (cand / ".git").exists():
            return cand
    raise SystemExit("ABORT: 无法定位仓库根(未找到 .git)")


REPO = find_repo_root()
S = "apps/build/scripts"
CAMPAIGNS = S + "/campaigns"
ARCHIVE = "docs/prompts/档案"


# ---------------------------------------------------------------------------
# 内嵌处置表(原样内嵌自 research/disposition-table.md,2026-09-22 定稿;二者不一致=中止)
# 116 件 = 已跟踪脚本 97(MMDD 91 + YYYYMMDD 6)+ 未跟踪 2 + 文档 17;另 my_prefix 无日期特殊件。
# ---------------------------------------------------------------------------

# 1. 常驻件提升(8):(旧名, 新名, 战役日期, 裁定背景一句)
PROMOTE = [
    ("daojie_charsheet_logic_0919.py", "daojie_charsheet_logic.py", "2026-09-19",
     "角色设定表逻辑生成器,任务 in_progress"),
    ("daojie_dual_sample_build_0921.py", "daojie_dual_sample_build.py", "2026-09-21",
     "二采版生成器,重基重跑"),
    ("daojie_engine_keeper_0919.py", "daojie_engine_keeper.py", "2026-09-19",
     "引擎守护拉起,记忆配方在用"),
    ("daojie_expert_retire_0921.py", "daojie_expert_retire.py", "2026-09-21",
     "专家模式清账,装机残留清理幂等"),
    ("daojie_lora_refclose_0919.py", "daojie_lora_refclose.py", "2026-09-19",
     "LoRA 引用关闭配套,幂等"),
    ("daojie_lora_refscan_0919.py", "daojie_lora_refscan.py", "2026-09-19",
     "删权重前引用审计工具,只读"),
    ("daojie_t2i_guard_0921.py", "daojie_t2i_guard.py", "2026-09-21",
     "布局守卫,五关协议常跑"),
    ("portrait_prompt_db_build_0917.py", "portrait_prompt_db_build.py", "2026-09-17",
     "人像美学库数据构建"),
]

# 2. 版本超期件(10,D1 裁定=删除,git 历史可回;契约只引用 v12)
SUPERSEDED_DELETE = [
    "daojie_lora_stack_subgraph_0921.py",
    "daojie_lora_stack_subgraph_v11_0921.py",
    "daojie_lora_stack_subgraph_v2_0921.py",
    "daojie_lora_stack_subgraph_v3_0921.py",
    "daojie_lora_stack_subgraph_v4_0921.py",
    "daojie_lora_stack_subgraph_v5_0921.py",
    "daojie_lora_stack_subgraph_v6_0921.py",
    "daojie_lora_stack_subgraph_v7_0921.py",
    "daojie_lora_stack_subgraph_v8_0921.py",
    "daojie_lora_stack_subgraph_v9_0921.py",
]

# 3. 战役件归档(79 = 3a 被引用 7 + 3b 零引用 72,保名挪 campaigns/,引用零波及)
CAMPAIGN_FILES = [
    # 3a 被外部引用(保名⇒引用仍准)
    "daojie_emotion_compose_0920.py",
    "daojie_i2i_routes_0919.py",
    "daojie_lora_stack_subgraph_v12_0921.py",
    "daojie_nineform_card_0919.py",
    "daojie_projector_sweep_0920.py",
    "daojie_sanshitu_compose_0920.py",
    "daojie_subgraph_boundary_fix_0921.py",
    # 3b 零外部引用(MMDD 66 件)
    "artskills_anchor_fullwidth_0916.py",
    "build_mac_tail_0919.py",
    "cdp-daojie-batch-gen-0917.mjs",
    "civitai_parallel_dl_0919.py",
    "daojie_ablation_0919.py",
    "daojie_bases_v3_0919.py",
    "daojie_batch_engine_0918.py",
    "daojie_card_consistency_fix_0919.py",
    "daojie_charsheet_2k_0920.py",
    "daojie_charsheet_4view_0920.py",
    "daojie_charsheet_4view_diag_0920.py",
    "daojie_charsheet_4view_wireup_0920.py",
    "daojie_charsheet_cnlabels_0920.py",
    "daojie_charsheet_compose_run_0920.py",
    "daojie_charsheet_compose_wireup_0920.py",
    "daojie_charsheet_onegen_run_0920.py",
    "daojie_charsheet_preset_0919.py",
    "daojie_charsheet_quadview_0920.py",
    "daojie_charsheet_quadview_wireup_0920.py",
    "daojie_charsheet_textoverlay_0920.py",
    "daojie_charsheet_wireup_0919.py",
    "daojie_dual_sample_e2e_0921.mjs",
    "daojie_emotion_labels_0920.py",
    "daojie_expert_card_sync_0920.py",
    "daojie_face_samechar_0920.py",
    "daojie_goldenmist_install_0919.py",
    "daojie_hands_ab_tier_0918.py",
    "daojie_handsfix_nag_ab_0919.py",
    "daojie_handsfix_run_0917.py",
    "daojie_i2i_routes_livefire_0919.py",
    "daojie_ink4_ab_0919.py",
    "daojie_line_layer_0918.py",
    "daojie_livefire_0917.py",
    "daojie_lora_by_type_livefire_0919.py",
    "daojie_lora_by_type_wireup_0919.py",
    "daojie_lora_groups_0919.py",
    "daojie_lora_stack_expand_0918.py",
    "daojie_lora_stack_switch_0919.py",
    "daojie_lora_subgraph_0920.py",
    "daojie_main_graph_layout_0921.py",
    "daojie_main_graph_layout_v10_0921.py",
    "daojie_manual_66_refresh_0921.py",
    "daojie_nag_ab_0918.py",
    "daojie_nineform_audit_merge_0919.py",
    "daojie_nineform_recipe_livefire_0919.py",
    "daojie_obedience_stack_0920.py",
    "daojie_projector_ab_0919.py",
    "daojie_projector_scale_add_0919.py",
    "daojie_retest_2k_0919.py",
    "daojie_sanshitu_a_0920.py",
    "daojie_sanshitu_rewire_0920.py",
    "daojie_sanshitu_seed43_0920.py",
    "daojie_sanshitu_six_0920.py",
    "daojie_softwatercolor_purge_0919.py",
    "daojie_stack_equiv_0919.py",
    "daojie_stack_preset_verdict_0919.py",
    "daojie_t2i_e2e_driver_0921.mjs",
    "daojie_t2i_manual_zone_0921.py",
    "daojie_tancai_lora_install_0919.py",
    "daojie_usage_card_lora_fix_0919.py",
    "daojie_verdict_goldenmist_char_0920.py",
    "k2_lora_accept_0916.py",
    "k2_lora_integrate_0916.py",
    "storyboard_wf_layout_0916.py",
    "superset_layout_adopt_user_0916.py",
    "superset_tier_matrix_0916.py",
    # 3c 年份式 YYYYMMDD(6 件,全零引用)
    "daojie_hands_evidence_20260920.py",
    "daojie_ink4_history_evidence_20260920.py",
    "daojie_lora_evidence_20260920.py",
    "daojie_recipe_manifest_evidence_20260920.py",
    "daojie_stack_history_evidence_20260920.py",
    "repair_upscale_store_20260816.py",
]

# 4. 特殊处置:my_prefix(无日期)挪 campaigns/ + DEPRECATED 头;两个未跟踪活跃件不动。
MY_PREFIX = "manying_workflow_my_prefix.py"
UNTRACKED_KEEP = ["daojie_prop_alpha_0921.py", "qwen_hdr_vae_comfy_convert_0922.py"]

# 5. 文档处置(17):T1 正名 10(Phase A)+ T3 档案 3(Phase A)+ T2 冻结 1 + Phase B 3(禁碰)。
T1_DOCS = [
    ("docs/comfyui-kb/LoRA库存台账-0919.md", "docs/comfyui-kb/LoRA库存台账.md"),
    ("docs/comfyui-kb/插件链故障台账-0919.md", "docs/comfyui-kb/插件链故障台账.md"),
    ("docs/engineering/architecture-coupling-audit-0831.md", "docs/engineering/architecture-coupling-audit.md"),
    ("docs/prompts/道劫_九型配方_0919.md", "docs/prompts/道劫_九型配方.md"),
    ("docs/prompts/道劫_九型主体句示例_0919.md", "docs/prompts/道劫_九型主体句示例.md"),
    ("docs/prompts/道劫_四视图标准提示词_0920.md", "docs/prompts/道劫_四视图标准提示词.md"),
    ("docs/prompts/道劫_LoRA逻辑图解_0920.md", "docs/prompts/道劫_LoRA逻辑图解.md"),
    ("docs/prompts/krea2官方/风格提示词_官方采集_0918.md", "docs/prompts/krea2官方/风格提示词_官方采集.md"),
    ("docs/prompts/krea2官方/角色设定表/X_角色设定图提示词精选_0918.md", "docs/prompts/krea2官方/角色设定表/X_角色设定图提示词精选.md"),
    ("docs/prompts/工笔风格参照_G27复现规格_0917.md", "docs/prompts/工笔风格参照_G27复现规格.md"),
]
T3_DOCS = [
    "docs/prompts/工笔宣纸三案对照_自测包_0917.md",
    "docs/prompts/超集与风格参照_提示词补全包_0917.md",
    "docs/prompts/道劫_水墨四件对拍定谳_0919.md",
]
FROZEN_DOCS = ["docs/prompts/道劫_新提示词包_0917.md"]  # T2 冻结(pytest:29 硬路径锚,D2)
PHASE_B_DOCS = [
    "docs/prompts/道劫_底座节点_0918.md",          # 0922 预检冲突转段(并行会话持有未提交改动)
    "docs/prompts/道劫_角色设定表出图逻辑_0919.md",  # WIP JSON×3 Note(#66/#66/#301)
    "docs/comfyui-kb/K2服饰LoRA调研_0919.md",       # WIP K2-角色换装.json Note(#102)
]

# ---------------------------------------------------------------------------
# 引用改写映射(30 op)= disposition-table §1/§5 波及列 + inventory §3 引用矩阵。
# 仅活文档白名单;campaigns 件内容/归档件/`.trellis` 任务史零触碰(容忍陈旧)。
# 底座节点键(docs_refresh_batch.py:32)与出图逻辑/K2服饰的正名均随 Phase B,此处禁入。
# 条目:(目标文件, 旧串, 新串, 提交批次 bucket)
# ---------------------------------------------------------------------------
_B2 = "b2"
REWRITES = [
    # docs_refresh_batch.py 两个键(台账/九型配方;底座节点键随 Phase B)
    ("apps/build/scripts/docs_refresh_batch.py", "'LoRA库存台账-0919.md'", "'LoRA库存台账.md'", _B2),
    ("apps/build/scripts/docs_refresh_batch.py", "'道劫_九型配方_0919.md'", "'道劫_九型配方.md'", _B2),
    # docs_closeout_ledger.py 两处 endswith
    ("apps/build/scripts/docs_closeout_ledger.py", "architecture-coupling-audit-0831.md", "architecture-coupling-audit.md", _B2),
    # docs/README.md 索引
    ("docs/README.md", "architecture-coupling-audit-0831.md", "architecture-coupling-audit.md", _B2),
    # docs/prompts/README.md 索引(T1 正名 + T3 档案路径)
    ("docs/prompts/README.md", "krea2官方/风格提示词_官方采集_0918.md", "krea2官方/风格提示词_官方采集.md", _B2),
    ("docs/prompts/README.md", "工笔风格参照_G27复现规格_0917.md", "工笔风格参照_G27复现规格.md", _B2),
    ("docs/prompts/README.md", "道劫_LoRA逻辑图解_0920.md", "道劫_LoRA逻辑图解.md", _B2),
    ("docs/prompts/README.md", "道劫_九型主体句示例_0919.md", "道劫_九型主体句示例.md", _B2),
    ("docs/prompts/README.md", "道劫_九型配方_0919.md", "道劫_九型配方.md", _B2),
    ("docs/prompts/README.md", "道劫_四视图标准提示词_0920.md", "道劫_四视图标准提示词.md", _B2),
    ("docs/prompts/README.md", "](工笔宣纸三案对照_自测包_0917.md)", "](档案/工笔宣纸三案对照_自测包_0917.md)", _B2),
    ("docs/prompts/README.md", "](超集与风格参照_提示词补全包_0917.md)", "](档案/超集与风格参照_提示词补全包_0917.md)", _B2),
    ("docs/prompts/README.md", "](道劫_水墨四件对拍定谳_0919.md)", "](档案/道劫_水墨四件对拍定谳_0919.md)", _B2),
    # krea2官方/角色设定表/README.md(注:其 line41 出图逻辑引用=Phase B,禁改)
    ("docs/prompts/krea2官方/角色设定表/README.md", "风格提示词_官方采集_0918.md", "风格提示词_官方采集.md", _B2),
    ("docs/prompts/krea2官方/角色设定表/README.md", "X_角色设定图提示词精选_0918.md", "X_角色设定图提示词精选.md", _B2),
    # 参数速查.md
    ("docs/comfyui-kb/参数速查.md", "工笔风格参照_G27复现规格_0917.md", "工笔风格参照_G27复现规格.md", _B2),
    # 漫影工作流清单.md(台账正名 + 两提升件)
    ("docs/comfyui-kb/漫影工作流清单.md", "LoRA库存台账-0919.md", "LoRA库存台账.md", _B2),
    ("docs/comfyui-kb/漫影工作流清单.md", "daojie_expert_retire_0921.py", "daojie_expert_retire.py", _B2),
    ("docs/comfyui-kb/漫影工作流清单.md", "daojie_dual_sample_build_0921.py", "daojie_dual_sample_build.py", _B2),
    # LoRA库存台账(正名后)内部两提升件
    ("docs/comfyui-kb/LoRA库存台账.md", "daojie_lora_refscan_0919.py", "daojie_lora_refscan.py", _B2),
    ("docs/comfyui-kb/LoRA库存台账.md", "daojie_lora_refclose_0919.py", "daojie_lora_refclose.py", _B2),
    # 子图工作流工程契约.md 布局守卫
    ("docs/comfyui-kb/子图工作流工程契约.md", "daojie_t2i_guard_0921.py", "daojie_t2i_guard.py", _B2),
    # 人像美学提示词库.md
    ("docs/prompts/portrait_aesthetics/人像美学提示词库.md", "portrait_prompt_db_build_0917.py", "portrait_prompt_db_build.py", _B2),
    # 道劫_角色设定表出图逻辑_0919.md(自身正名在 Phase B,Phase A 仅改文字)
    ("docs/prompts/道劫_角色设定表出图逻辑_0919.md", "daojie_charsheet_logic_0919.py", "daojie_charsheet_logic.py", _B2),
    ("docs/prompts/道劫_角色设定表出图逻辑_0919.md", "道劫_九型主体句示例_0919.md", "道劫_九型主体句示例.md", _B2),
    # 道劫_LoRA逻辑图解(正名后)内部台账引用
    ("docs/prompts/道劫_LoRA逻辑图解.md", "LoRA库存台账-0919.md", "LoRA库存台账.md", _B2),
    # 提升件 daojie_charsheet_logic.py 内部主体句引用(提升后顶层件,引用须保持准确)
    ("apps/build/scripts/daojie_charsheet_logic.py", "道劫_九型主体句示例_0919.md", "道劫_九型主体句示例.md", _B2),
    # docs_refresh_prompt_boundaries.py:41 运行时 glob 旧名(verify 实测发现;inventory §3 漏列,同串同改)
    ("apps/build/scripts/docs_refresh_prompt_boundaries.py", "*九型配方_0919.md", "*九型配方.md", _B2),
    # 装机手册 studio-manuals 两处
    ("apps/frontend/assets/studio-manuals/art_skills/daojie_neo_chinese/README.md", "道劫_九型主体句示例_0919.md", "道劫_九型主体句示例.md", _B2),
    ("apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/style_guide/07_九型配方.md", "道劫_九型主体句示例_0919.md", "道劫_九型主体句示例.md", _B2),
    # AGENTS.md my_prefix 路径(磁盘实测 1 处;inventory §6 记 2 处,按实际命中数执行)
    ("AGENTS.md", "apps/build/scripts/manying_workflow_my_prefix.py", "apps/build/scripts/campaigns/manying_workflow_my_prefix.py", "b1"),
]

# 黑名单:触碰即 abort(implement.md 禁止事项 + 0922 执行中裁定)
BLACKLIST_EXACT = {
    "apps/build/scripts/daojie_prop_alpha_0921.py",
    "apps/build/scripts/qwen_hdr_vae_comfy_convert_0922.py",
    "docs/prompts/道劫_底座节点_0918.md",
}
BLACKLIST_PREFIXES = [
    "apps/backend/engines/comfyui/workflows/",
    ".trellis/",
]
BLACKLIST_EXEMPT = {MANIFEST_REL}  # .trellis 下唯一可写件

# 正名映射(new -> old):改写目标在 pre-apply 态位于旧路径时解析用(文档 T1 + 脚本提升)
RENAME_MAP = {new: old for old, new in T1_DOCS}
RENAME_MAP.update({S + "/" + new: S + "/" + old for old, new, _d, _n in PROMOTE})


def path_is_blacklisted(p: str) -> bool:
    p = p.replace(os.sep, "/")
    if p in BLACKLIST_EXEMPT:
        return False
    if p in BLACKLIST_EXACT:
        return True
    return any(p.startswith(q) for q in BLACKLIST_PREFIXES)


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------

def rel(p: str) -> Path:
    return REPO / p


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("git %s 失败: %s" % (list(args)[:3], r.stderr.strip()))
    return r.stdout


def git_ok(*args: str) -> bool:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True).returncode == 0


def read_text(path: Path) -> str:
    with open(path, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write_text(path: Path, content: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def resolve_rewrite_path(path: str) -> str:
    """改写目标路径解析:pre-apply 态落在正名前旧路径,post-apply 态在新路径。"""
    if rel(path).exists():
        return path
    if path in RENAME_MAP and rel(RENAME_MAP[path]).exists():
        return RENAME_MAP[path]
    return path


# ---------------------------------------------------------------------------
# 表-盘一致性对账(dry-run 核心;apply 启动同跑;verify 复跑)
# ---------------------------------------------------------------------------

def mv_state(src: str, dst: str) -> str:
    s, d = rel(src).exists(), rel(dst).exists()
    if s and not d:
        return "pending"
    if d and not s:
        return "applied"
    if s and d:
        return "conflict"
    return "missing"


def delete_state(path: str) -> str:
    if rel(path).exists():
        return "pending"
    # 磁盘无:曾存在于 HEAD=已删(applied);HEAD 也无=表错件(missing)
    return "applied" if git_ok("cat-file", "-e", "HEAD:" + path) else "missing"


def entry_states() -> dict:
    st = {}
    for old, new, _d, _n in PROMOTE:
        st[S + "/" + new] = mv_state(S + "/" + old, S + "/" + new)
    for f in CAMPAIGN_FILES:
        st[CAMPAIGNS + "/" + f] = mv_state(S + "/" + f, CAMPAIGNS + "/" + f)
    st[CAMPAIGNS + "/" + MY_PREFIX] = mv_state(S + "/" + MY_PREFIX, CAMPAIGNS + "/" + MY_PREFIX)
    for f in SUPERSEDED_DELETE:
        st[S + "/" + f] = delete_state(S + "/" + f)
    for old, new in T1_DOCS:
        st[new] = mv_state(old, new)
    for f in T3_DOCS:
        dst = ARCHIVE + "/" + f.split("/")[-1]
        st[dst] = mv_state(f, dst)
    for f in UNTRACKED_KEEP:
        st[S + "/" + f] = "ok" if rel(S + "/" + f).exists() else "missing"
    for f in FROZEN_DOCS + PHASE_B_DOCS:
        st[f] = "ok" if rel(f).exists() else "missing"
    return st


def scan_disk_dated():
    """按 inventory §7 方法扫盘:git ls-files(tracked)+ porcelain 未跟踪补全。"""
    # 脚本侧:顶层 tracked(排除 campaigns/ 归档区)
    dated_scripts = set()
    for p in git("ls-files", S + "/").splitlines():
        if not p or p.startswith(CAMPAIGNS + "/"):
            continue
        if DATE_RE.search(p.split("/")[-1]):
            dated_scripts.add(p)
    # 文档侧:tracked .md(排除 档案/ 归档区;备份_工作流 json=工作流资产,.md 过滤自然排除)
    dated_docs = set()
    for p in git("ls-files", "docs/").splitlines():
        if p.endswith(".md") and not p.startswith(ARCHIVE + "/") and DATE_RE.search(p.split("/")[-1]):
            dated_docs.add(p)
    # 未跟踪件(scripts 顶层;campaigns/ 内未跟踪件=归档区自身,排除)
    untracked = set()
    for ln in git("status", "--porcelain", S + "/").splitlines():
        if ln.startswith("??"):
            u = ln[3:]
            if not u.startswith(CAMPAIGNS + "/"):
                untracked.add(u)
    return dated_scripts, dated_docs, untracked


def rewrite_stale_ops():
    """改写映射 sanity:每个 op 必须「旧串在或新串在」(经正名前路径解析),否则=映射漂移。"""
    stale = []
    for path, old, new, _bucket in REWRITES:
        rp = resolve_rewrite_path(path)
        p = rel(rp)
        if not p.exists():
            stale.append("%s (文件不存在,含正名前路径)" % path)
            continue
        c = read_text(p)
        if new not in c and old not in c:
            stale.append("%s: 既无旧串 %r 也无新串 %r" % (path, old, new))
    return stale


def reconcile(verbose=True):
    """表-盘对账;多/少/漂移任一非空即 not ok。"""
    dated_scripts, dated_docs, untracked = scan_disk_dated()
    table_scripts = {S + "/" + p[0] for p in PROMOTE} | {S + "/" + f for f in SUPERSEDED_DELETE} | {S + "/" + f for f in CAMPAIGN_FILES}
    table_untracked = {S + "/" + f for f in UNTRACKED_KEEP}
    table_docs = {old for old, _new in T1_DOCS} | set(T3_DOCS) | set(FROZEN_DOCS) | set(PHASE_B_DOCS)

    extra = sorted((dated_scripts - table_scripts) | (untracked - table_untracked) | (dated_docs - table_docs))
    states = entry_states()
    missing = sorted(k for k, v in states.items() if v == "missing")
    conflict = sorted(k for k, v in states.items() if v == "conflict")
    stale = rewrite_stale_ops()

    ok = not (extra or missing or conflict or stale)
    if verbose and not ok:
        print("== 对账失败:表-盘不一致 ==")
        if extra:
            print("[多] 磁盘有而表无(%d):" % len(extra))
            for p in extra:
                print("  + " + p)
        if missing:
            print("[少] 表有而磁盘无(%d):" % len(missing))
            for p in missing:
                print("  - " + p)
        if conflict:
            print("[漂移] 源与目标并存(%d):" % len(conflict))
            for p in conflict:
                print("  ! " + p)
        if stale:
            print("[改写映射漂移] 旧新串均缺失(%d):" % len(stale))
            for p in stale:
                print("  ~ " + p)
    return ok, states


# ---------------------------------------------------------------------------
# dry-run
# ---------------------------------------------------------------------------

def category_counts(states: dict):
    def cat(keys):
        pend = sum(1 for k in keys if states.get(k) == "pending")
        appl = sum(1 for k in keys if states.get(k) == "applied")
        return pend, appl

    rows = []
    for label, keys in [
        ("promote(提升)", [S + "/" + p[1] for p in PROMOTE]),
        ("superseded_delete(D1=git rm)", [S + "/" + f for f in SUPERSEDED_DELETE]),
        ("campaign_archive(保名挪 campaigns/)", [CAMPAIGNS + "/" + f for f in CAMPAIGN_FILES]),
        ("my_prefix(挪+DEPRECATED)", [CAMPAIGNS + "/" + MY_PREFIX]),
        ("t1_rename(正名+核账行)", [new for _o, new in T1_DOCS]),
        ("t3_archive(挪 档案/)", [ARCHIVE + "/" + f.split("/")[-1] for f in T3_DOCS]),
    ]:
        pend, appl = cat(keys)
        rows.append("  %-36s %2d 件(pending %d / applied %d)" % (label, len(keys), pend, appl))
    return rows


def cmd_dry_run() -> int:
    ok, states = reconcile(verbose=True)
    if not ok:
        return 2

    print("== 处置计划(Phase A;[skip]=已执行,幂等跳过)==")
    for old, new, _d, _n in PROMOTE:
        tag = "" if states[S + "/" + new] == "pending" else "[skip]"
        print("  promote %s%s/%s -> %s/%s" % (tag + ": " if tag else "", S, old, S, new))
    for f in CAMPAIGN_FILES:
        tag = "" if states[CAMPAIGNS + "/" + f] == "pending" else "[skip] "
        print("  campaign %s%s/%s -> %s/%s" % (tag, S, f, CAMPAIGNS, f))
    print("  my_prefix: %s/%s -> %s/%s (+DEPRECATED 头 + AGENTS.md 路径同步)" % (S, MY_PREFIX, CAMPAIGNS, MY_PREFIX))
    for f in SUPERSEDED_DELETE:
        tag = "" if states[S + "/" + f] == "pending" else "[skip] "
        print("  delete(D1) %sgit rm %s/%s" % (tag, S, f))
    for old, new in T1_DOCS:
        tag = "" if states[new] == "pending" else "[skip] "
        print("  t1 %s%s -> %s (+最后核账:%s)" % (tag, old, new, AUDIT_DATE))
    for f in T3_DOCS:
        dst = ARCHIVE + "/" + f.split("/")[-1]
        tag = "" if states[dst] == "pending" else "[skip] "
        print("  t3 %s%s -> %s" % (tag, f, dst))
    rw_pend = sum(1 for p, o, n, _b in REWRITES if rewrite_op_state(p, o, n) == "pending")
    print("  rewrites: %d op(待执行 %d / 已执行 %d)" % (len(REWRITES), rw_pend, len(REWRITES) - rw_pend))
    print("  prose: .claude/CLAUDE.md 文件命名铁律 | scripts/README.md 落位规则 | campaigns/README.md 新建")
    print("  manifest: %s(键 b1/b2/b3/b4)" % MANIFEST_REL)
    print()
    print("CONSISTENCY OK")
    for row in category_counts(states):
        print(row)
    print("  %-36s %2d 件(ok)" % ("untracked_keep(不动)", len(UNTRACKED_KEEP)))
    print("  %-36s %2d 件(pytest:29 锚,D2 冻结豁免)" % ("frozen(T2)", len(FROZEN_DOCS)))
    print("  %-36s %2d 件(defer,WIP 落地后 B5)" % ("phase_b(T1-B)", len(PHASE_B_DOCS)))
    print("  dated_artifacts_total: 116  # 97 tracked 脚本 + 2 未跟踪 + 17 文档(口径=disposition-table §6)")
    return 0


def rewrite_op_state(path: str, old: str, new: str) -> str:
    p = rel(resolve_rewrite_path(path))
    if not p.exists():
        return "missing"
    c = read_text(p)
    if new in c:
        return "applied"
    if old in c:
        return "pending"
    return "stale"


# ---------------------------------------------------------------------------
# apply
# ---------------------------------------------------------------------------

def prepend_comment(path: Path, line: str) -> bool:
    """文件头加注释行(shebang 保持首行)。幂等:已含该行即跳过。"""
    content = read_text(path)
    if line in content:
        return False
    lines = content.split("\n")
    lines.insert(1 if lines and lines[0].startswith("#!") else 0, line)
    write_text(path, "\n".join(lines))
    return True


def cmd_apply() -> int:
    ok, _states = reconcile(verbose=False)
    if not ok:
        print("ABORT: 表-盘对账未过,--apply 拒绝执行(差集如下)")
        reconcile(verbose=True)
        return 2

    # 黑名单预检:本轮将触达的全部路径与黑名单求交,非空即 abort
    will_touch = set()
    for old, new, _d, _n in PROMOTE:
        will_touch |= {S + "/" + old, S + "/" + new}
    for f in CAMPAIGN_FILES:
        will_touch |= {S + "/" + f, CAMPAIGNS + "/" + f}
    will_touch |= {S + "/" + MY_PREFIX, CAMPAIGNS + "/" + MY_PREFIX}
    will_touch |= {S + "/" + f for f in SUPERSEDED_DELETE}
    for old, new in T1_DOCS:
        will_touch |= {old, new}
    for f in T3_DOCS:
        will_touch |= {f, ARCHIVE + "/" + f.split("/")[-1]}
    will_touch |= {p for p, _o, _n, _b in REWRITES}
    will_touch |= {".claude/CLAUDE.md", S + "/README.md", CAMPAIGNS + "/README.md", MANIFEST_REL}
    hits = sorted(p for p in will_touch if path_is_blacklisted(p))
    if hits:
        print("ABORT: 触碰黑名单(触碰即中止):")
        for h in hits:
            print("  !! " + h)
        return 1

    print("== apply 开始(audit %s)==" % AUDIT_DATE)
    touched = {"b1": [], "b2": [], "b3": [], "b4": []}
    deleted = []
    rel(CAMPAIGNS).mkdir(parents=True, exist_ok=True)
    rel(ARCHIVE).mkdir(parents=True, exist_ok=True)

    def do_mv(src: str, dst: str, bucket: str):
        if rel(dst).exists():
            print("  [skip] 目标已存在: %s" % dst)
        else:
            git("mv", "--", src, dst)
            print("  mv %s -> %s" % (src, dst))
        touched[bucket].append(src)
        touched[bucket].append(dst)

    # B1:战役件 79 + my_prefix 保名挪 campaigns/
    for f in CAMPAIGN_FILES:
        do_mv(S + "/" + f, CAMPAIGNS + "/" + f, "b1")
    do_mv(S + "/" + MY_PREFIX, CAMPAIGNS + "/" + MY_PREFIX, "b1")

    # B1:D1 删除 v 系超期 10 件
    for f in SUPERSEDED_DELETE:
        p = S + "/" + f
        if rel(p).exists():
            git("rm", "-q", "--", p)
            print("  rm %s" % p)
        else:
            print("  [skip] 已删: %s" % p)
        touched["b1"].append(p)
        deleted.append(p)

    # B1:8 件提升 + 出处头注释
    for old, new, date, note in PROMOTE:
        do_mv(S + "/" + old, S + "/" + new, "b1")
        header = "# 出处:%s 战役产物(%s);%s 带日期文件名清整提升为常驻件,幂等可重跑。" % (date, note, AUDIT_DATE)
        if prepend_comment(rel(S + "/" + new), header):
            print("  +头注释 %s" % new)

    # B1:my_prefix DEPRECATED 警示头
    dep = ("# DEPRECATED(%s 归档):已与 09-18 裁定反向(会把全库改回 MY- 前缀),勿再运行;"
           "详见 AGENTS.md 与 .claude/CLAUDE.md「文件命名铁律」。") % AUDIT_DATE
    if prepend_comment(rel(CAMPAIGNS + "/" + MY_PREFIX), dep):
        print("  +DEPRECATED 头 %s" % MY_PREFIX)

    # B2:T1 正名 10 件 + 头部「最后核账」
    for old, new in T1_DOCS:
        do_mv(old, new, "b2")
        p = rel(new)
        content = read_text(p)
        if "最后核账:" + AUDIT_DATE in content:
            print("  [skip] 核账行已在: %s" % new)
        else:
            lines = content.split("\n")
            lines.insert(1, "最后核账:" + AUDIT_DATE)
            write_text(p, "\n".join(lines))
            print("  +最后核账 %s" % new)

    # B2:T3 三件进 档案/(内容零触碰,点时快照)
    for f in T3_DOCS:
        do_mv(f, ARCHIVE + "/" + f.split("/")[-1], "b2")

    # B1/B2:全部引用改写(幂等:新串已在=跳过;旧串缺失且新串不在=映射漂移,abort)
    for path, old, new, bucket in REWRITES:
        rp = resolve_rewrite_path(path)
        p = rel(rp)
        content = read_text(p)
        if new in content:
            print("  [skip] 改写已应用: %s" % path)
        else:
            n = content.count(old)
            if n == 0:
                raise RuntimeError("ABORT: 改写映射漂移 %s 无旧串 %r(且无新串 %r)" % (path, old, new))
            write_text(p, content.replace(old, new))
            print("  rewrite %s: %r ×%d" % (path, old, n))
        touched[bucket].append(path)

    # B3:prose 交付
    write_claude_section(touched)
    write_scripts_readme_section(touched)
    write_campaigns_readme(touched)
    # b3 批次面跨运行稳定:幂等 skip 时同样入册
    for p in (".claude/CLAUDE.md", S + "/README.md", CAMPAIGNS + "/README.md"):
        if rel(p).exists() and p not in touched["b3"]:
            touched["b3"].append(p)

    # B4:任务目录全部文件 + journal(声明式批次清单;apply 对其零写入)
    for p in sorted(rel(TASK_DIR).rglob("*")):
        if p.is_file():
            touched["b4"].append(p.relative_to(REPO).as_posix())
    if rel(JOURNAL_REL).exists():
        touched["b4"].append(JOURNAL_REL)
    if MANIFEST_REL not in touched["b4"]:  # manifest 自身入册,首跑/重跑口径一致
        touched["b4"].append(MANIFEST_REL)

    manifest = {
        "meta": {
            "generated_by": CAMPAIGNS + "/repo_dated_artifacts_reorg.py --apply",
            "audit_date": AUDIT_DATE,
            "task": TASK_DIR,
            "deleted": sorted(deleted),
            "counts": {k: len(v) for k, v in touched.items()},
        },
        "b1": sorted(set(touched["b1"])),
        "b2": sorted(set(touched["b2"])),
        "b3": sorted(set(touched["b3"])),
        "b4": sorted(set(touched["b4"])),
    }
    mpath = rel(MANIFEST_REL)
    mpath.parent.mkdir(parents=True, exist_ok=True)
    write_text(mpath, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print("  manifest -> %s" % MANIFEST_REL)
    print("== apply 完成: b1=%d b2=%d b3=%d b4=%d deleted=%d ==" % (
        len(manifest["b1"]), len(manifest["b2"]), len(manifest["b3"]),
        len(manifest["b4"]), len(deleted)))
    print("提示: pytest/守卫/detect_changes 由外层门禁负责;git add/commit 由外层按 b1-b4 分批执行。")
    return 0


def write_claude_section(touched):
    p = rel(".claude/CLAUDE.md")
    content = read_text(p)
    if "文件命名铁律" in content:
        print("  [skip] CLAUDE.md 铁律小节已在")
        return
    section = """## 🚨 铁律 5:文件命名铁律(2026-09-22 立,任务 09-22-repo-dated-filename-reorg)

1. 文件名=身份,日期=历史;版本与时间一律交给 git;
2. 新脚本默认稳定名;确认一次性战役脚本直接落 `campaigns/`(名含日期合法);
3. 活文档稳定名,头部维护 `最后核账:YYYY-MM-DD` 字段,更新即改;
4. 活文档文件名禁带日期;时点裁定类内容落 `档案/`;
5. 豁免清单:被测试/代码硬路径锚定的契约文档(现仅 `道劫_新提示词包_0917.md`),改名须连锚一起改,否则冻结。

"""
    anchor = "## 工具优先级"
    if anchor not in content:
        raise RuntimeError("ABORT: .claude/CLAUDE.md 找不到插入锚点 %r" % anchor)
    write_text(p, content.replace(anchor, section + anchor, 1))
    print("  +CLAUDE.md 文件命名铁律小节")
    touched["b3"].append(".claude/CLAUDE.md")


def write_scripts_readme_section(touched):
    p = rel(S + "/README.md")
    content = read_text(p)
    if "落位规则" in content:
        print("  [skip] scripts/README.md 落位规则段已在")
        return
    section = """## 落位规则(常驻 vs 战役归档,2026-09-22 立)

- **常驻脚本**放本目录顶层,用**稳定名**(无日期后缀、无 v2/v3 版本号);版本与时间交给 git。
- **一次性战役脚本**直接落 `campaigns/`(文件名含日期合法,日期=战役标识)。归档件是**点时快照**:路径假设按原位、内部相对路径(`__file__` 推根)已失效,**勿直接执行**,详见 `campaigns/README.md`。
- 会再跑的脚本(守卫/审计/生成器)即常驻:顶层稳定名,头部注明出处与裁定背景。
- 文档侧同口径:`docs/prompts/` 活文档稳定名(头部维护 `最后核账:YYYY-MM-DD`),时点裁定/自测包落 `docs/prompts/档案/`(保名含日期)。
- 完整条文见 `.claude/CLAUDE.md`「铁律 5:文件命名铁律」。

"""
    anchor = "## 路径治理脚本"
    if anchor not in content:
        raise RuntimeError("ABORT: scripts/README.md 找不到插入锚点 %r" % anchor)
    write_text(p, content.replace(anchor, section + anchor, 1))
    print("  +scripts/README.md 落位规则段")
    touched["b3"].append(S + "/README.md")


def write_campaigns_readme(touched):
    p = rel(CAMPAIGNS + "/README.md")
    if p.exists():
        print("  [skip] campaigns/README.md 已在")
        return
    content = """# campaigns/ —— 一次性战役脚本归档区(2026-09-22 立)

本目录收纳**已完成使命的一次性战役脚本**,文件名保留日期(日期=战役标识,见 `.claude/CLAUDE.md`「铁律 5:文件命名铁律」与 `apps/build/scripts/README.md` 落位规则)。

## 三条声明

1. **点时快照**:每个脚本只对应当年当日的仓库/引擎/装机状态,不承诺对当前现实有效;
2. **相对路径失效**:归档件按原位(`apps/build/scripts/` 顶层)编写,挪目录后其内部相对路径(`__file__` 推根等)即失效;
3. **勿直接执行**:如确需参考其做法,请先读代码、在新位置重建路径假设,不要原样运行。

历史价值=可追溯(生成过什么、当时怎么做的);运行价值=无。要跑的常驻工具在上级目录顶层(稳定名)。

> 入库口径:任务 09-22-repo-dated-filename-reorg(处置表=research/disposition-table.md,116 件定稿);后续战役件随各自任务落账后归档于此。
"""
    write_text(p, content)
    print("  +campaigns/README.md")
    touched["b3"].append(CAMPAIGNS + "/README.md")


# ---------------------------------------------------------------------------
# verify
# ---------------------------------------------------------------------------

DOC_OLD_NAME_RE = re.compile(
    r"台账-0919|九型配方_0919|主体句示例_0919|四视图标准提示词_0920|LoRA逻辑图解_0920"
    r"|官方采集_0918|提示词精选_0918|G27复现规格_0917|coupling-audit-0831"
)
VERIFY_SCAN_EXCLUDES = (
    CAMPAIGNS + "/",                        # 归档件容忍陈旧
    ARCHIVE + "/",                          # 点时快照保留原貌
    ".trellis/",                            # 任务史不改写
    "docs/prompts/道劫_新提示词包_0917.md",  # D2 冻结豁免
)

# 全部 mv 对(src -> dst):V5 manifest 对账时源路径经此解析(post-apply 源不在盘=正常)
def moved_pairs() -> dict:
    pairs = {S + "/" + p[0]: S + "/" + p[1] for p in PROMOTE}
    pairs.update({S + "/" + f: CAMPAIGNS + "/" + f for f in CAMPAIGN_FILES})
    pairs[S + "/" + MY_PREFIX] = CAMPAIGNS + "/" + MY_PREFIX
    pairs.update({old: new for old, new in T1_DOCS})
    pairs.update({f: ARCHIVE + "/" + f.split("/")[-1] for f in T3_DOCS})
    return pairs


def cmd_verify() -> int:
    results = []

    def check(name, ok, detail=""):
        results.append((name, bool(ok), detail))
        print("[%s] %s%s" % ("PASS" if ok else "FAIL", name, (" — " + detail) if detail else ""))

    # V1 顶层残留正则(implement.md S4 第一条:MMDD+YYYYMMDD 双口径,限 .py/.mjs/.sh;
    # 白名单=2 个未跟踪活跃件;gitignored 件如 build_mac_tail_0919.log 不在 git 口径内)
    keep = {S + "/" + x for x in UNTRACKED_KEEP}
    leftovers = [S + "/" + f.name for f in sorted(rel(S).iterdir())
                 if f.is_file() and f.suffix in (".py", ".mjs", ".sh")
                 and DATE_RE.search(f.name) and S + "/" + f.name not in keep]
    check("V1 顶层脚本无带日期文件名残留(.py/.mjs/.sh;白名单 2 未跟踪活跃件)", not leftovers,
          "; ".join(leftovers) if leftovers else "apps/build/scripts/ 顶层干净")

    # V2 文档旧名残留(tracked 文件内容扫描=implement.md S4 第二条 rg 的等价实现)
    residual = []
    for path in git("ls-files").splitlines():
        if not path or any(path == e or path.startswith(e) for e in VERIFY_SCAN_EXCLUDES):
            continue
        p = rel(path)
        if not p.is_file():
            continue
        try:
            if DOC_OLD_NAME_RE.search(read_text(p)):
                residual.append(path)
        except (UnicodeDecodeError, OSError):
            continue
    check("V2 tracked 文件无 T1/T3 旧文档名残留(9 模式)", not residual,
          "; ".join(residual) if residual else "全仓零命中(排除 campaigns/档案/.trellis/冻结件)")

    # V3 提升件头注释在(8 件)
    missing_hdr = [new for _o, new, _d, _n in PROMOTE
                   if not rel(S + "/" + new).exists() or "出处:" not in read_text(rel(S + "/" + new))]
    check("V3 提升件 8 件出处头注释在", not missing_hdr,
          "; ".join(missing_hdr) if missing_hdr else "8/8 含「出处:」头")

    # V3b my_prefix DEPRECATED 头
    mp = rel(CAMPAIGNS + "/" + MY_PREFIX)
    check("V3b my_prefix DEPRECATED 警示头在", mp.exists() and "DEPRECATED" in read_text(mp))

    # V3c T1 十件「最后核账」行
    no_audit = [new for _o, new in T1_DOCS
                if not rel(new).exists() or ("最后核账:" + AUDIT_DATE) not in read_text(rel(new))]
    check("V3c T1 十件「最后核账:%s」在" % AUDIT_DATE, not no_audit,
          "; ".join(no_audit) if no_audit else "10/10")

    # V4 冻结件与 Phase B 文件未动(ask 点名对:新提示词包+底座节点;存在+不在 manifest)
    mpath = rel(MANIFEST_REL)
    manifest = json.loads(read_text(mpath)) if mpath.exists() else None
    touched_all = set()
    if manifest:
        for k in ("b1", "b2", "b3", "b4"):
            touched_all |= set(manifest.get(k, []))
    protected = list(FROZEN_DOCS) + ["docs/prompts/道劫_底座节点_0918.md"]
    bad_protect = [f for f in protected if not rel(f).exists() or f in touched_all]
    check("V4 冻结件+底座节点未动(存在且不在 manifest)", not bad_protect,
          "; ".join(bad_protect) if bad_protect
          else "2 件原位未动(底座节点现行 WIP diff 归并行会话,非本任务)")

    # V4b Phase B defer 名义核查:出图逻辑/K2服饰仍在原名(正名 defer;出图逻辑内容改写=Phase A 既定动作)
    defer_renamed = [f for f in ("docs/prompts/道劫_角色设定表出图逻辑_0919.md",
                                 "docs/comfyui-kb/K2服饰LoRA调研_0919.md") if not rel(f).exists()]
    check("V4b Phase B 两文档仍原名未挪(defer)", not defer_renamed,
          "; ".join(defer_renamed) if defer_renamed else "出图逻辑/K2服饰LoRA调研 原名在位")

    # V5 manifest 与磁盘一致(mv 源路径经 moved_pairs 解析;deleted 必须缺席)
    if manifest is None:
        check("V5 manifest 对账", False, "%s 不存在(先 --apply)" % MANIFEST_REL)
    else:
        deleted = set(manifest["meta"]["deleted"])
        moved = moved_pairs()
        missing_on_disk = sorted(
            p for k in ("b1", "b2", "b3", "b4") for p in manifest.get(k, [])
            if not rel(p).exists() and p not in deleted
            and not (p in moved and rel(moved[p]).exists()))
        still_alive = sorted(p for p in deleted if rel(p).exists())
        ok5 = not missing_on_disk and not still_alive
        detail5 = "b1=%d b2=%d b3=%d b4=%d deleted=%d 全对账(mv 源经目标解析)" % (
            len(manifest["b1"]), len(manifest["b2"]), len(manifest["b3"]),
            len(manifest["b4"]), len(deleted))
        if missing_on_disk:
            detail5 = "缺失: " + "; ".join(missing_on_disk) + " | " + detail5
        if still_alive:
            detail5 = "应删未删: " + "; ".join(still_alive) + " | " + detail5
        check("V5 manifest 与磁盘一致", ok5, detail5)

    # V6 表-盘一致性复跑(post-apply 幂等态:Phase A 项全 applied)
    ok6, states6 = reconcile(verbose=False)
    pend_leftover = sorted(k for k, v in states6.items() if v == "pending")
    check("V6 表-盘一致性复跑(Phase A 全 applied)", ok6 and not pend_leftover,
          "; ".join(pend_leftover) if pend_leftover else "无 pending 残留/无多少漂移")

    n_fail = sum(1 for _n, ok_, _d in results if not ok_)
    print("== verify: %d 项 %s ==" % (len(results), "全 PASS" if n_fail == 0 else "FAIL×%d" % n_fail))
    return 0 if n_fail == 0 else 1


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="带日期文件名清整执行器(Phase A,战役件)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", dest="mode", action="store_const", const="dry",
                   default="dry", help="对账+处置计划(默认)")
    g.add_argument("--apply", dest="mode", action="store_const", const="apply", help="按处置表执行")
    g.add_argument("--verify", dest="mode", action="store_const", const="verify", help="自检")
    args = ap.parse_args()
    if args.mode == "apply":
        return cmd_apply()
    if args.mode == "verify":
        return cmd_verify()
    return cmd_dry_run()


if __name__ == "__main__":
    sys.exit(main())
