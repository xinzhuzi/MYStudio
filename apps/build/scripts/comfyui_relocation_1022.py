#!/usr/bin/env python3
"""comfyui 包迁移战役脚本(任务 .trellis/tasks/10-22-comfyui-relocation)。

R1 git mv apps/backend/engines/comfyui → apps/backend/comfyui
R2 规则1 `engines.comfyui` → `comfyui`(import 面)
R3 规则2 `engines[/\\]+comfyui` → `comfyui`(路径串面;兼容 / 与 \\ 形态)
R4 规则3 `__file__` 深度锚点逐字精确串(行锚定,非正则)
   —— design.md §File Map D 表原枚举 + 2026-10-23 实测扩充 A/B 两类
      (comfyui/tests 与 my_nodes/tests 的 parents[N] 深度锚点,主会话已批准并入)
R7 规则4 特例注记三件(engines/__init__ docstring、backend-architecture 校准行、
   directory-structure 树+prose);其余活文档路径串由规则1/2 自动覆盖

四模式:
  --selftest   锚点全命中自检 + 替换规则单测(合成样例 + 临时件 apply/invert 往返)
  --dry-run    零写入:锚点校验 + 与 impact-scan 活区清单对账(差集非空即非零退出)
  (默认)正式   前置自检→清缓存→git mv→docstring→分组替换→收尾自检→
               对账 JSON 落 apps/output/comfyui-relocation-1022/report.json
  --invert     按 replacement-log.json + backup/ 反演(内容还原→git mv 反向)

fail-closed 铁律:前置任一红=零写入终止;收尾任一红=全量清单+非零退出。
例外口径:--selftest 为脚本质量门(CP1=锚点+单测),战役区域干净度(Q1-A/CP0
发车门闩)在 selftest 仅警示不判红——并行役在途未追踪件归 CP0 管;--dry-run
与正式模式 Phase A 仍对该门硬拒。
锚点清单以 2026-10-23 工作树实测回填(相对 10-22 impact-scan 新增 21 件已并入)。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# ----------------------------------------------------------------------------
# 常量与路径
# ----------------------------------------------------------------------------

REPO = Path(__file__).resolve().parents[3]  # apps/build/scripts/x.py → MYStudio
SELF_REL = "apps/build/scripts/comfyui_relocation_1022.py"
SRC_REL = "apps/backend/engines/comfyui"
DST_REL = "apps/backend/comfyui"
SRC = REPO / SRC_REL
DST = REPO / DST_REL

REPORT_DIR = REPO / "apps/output/comfyui-relocation-1022"
REPORT_PATH = REPORT_DIR / "report.json"
LOG_PATH = REPORT_DIR / "replacement-log.json"
BACKUP_DIR = REPORT_DIR / "backup"

ENGINES_INIT_REL = "apps/backend/engines/__init__.py"

# 三形态旧串(活区零残留判据;CP9 同款)
F1 = "engines.comfyui"                       # import 形态
F2_RE = re.compile(r"engines[/\\]+comfyui")  # 路径串形态(/ 与 \ 及连续转义)
F3 = 'parents[5] / "frontend'                # 节点深度候选形态

# 扫描/替换活区根(apps 全域 + 活文档真源;.trellis 仅 spec,tasks 归档/本役件不扫)
SCAN_ROOTS = ["apps", "AGENTS.md", ".claude", "docs", ".agents", ".trellis/spec"]

EXCLUDE_DIR_NAMES = {
    "node_modules", ".git", "__pycache__", ".zcode", "retired", "campaigns",
    "out", "release", "output",
}
# runs/ = comfyui 包内运行产物(git 不追踪,随目录物理迁移,内容不参与替换)
RUNS_DIR_SUFFIXES = (
    "apps/backend/engines/comfyui/runs",
    "apps/backend/comfyui/runs",
)

# ----------------------------------------------------------------------------
# 活区权威清单(impact-scan-1022.txt 非retired A∪B 234 件,路径=迁移前旧位)
# ----------------------------------------------------------------------------

IMPACT_SCAN_LIVE = [
    "apps/backend/engines/comfyui/bridge_contract.py",
    "apps/backend/engines/comfyui/engine_manager.py",
    "apps/backend/engines/comfyui/execute.py",
    "apps/backend/engines/comfyui/my_nodes/__init__.py",
    "apps/backend/engines/comfyui/my_nodes/bridge/settings.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_flux3_daojie_adapter.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_charsheet_labels.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_daojie_base.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_daojie_lora_stack.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_daojie_loras.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_image_ab_compare.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_image_grid_split.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_image_save.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_nodes.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_api_pe_selfcheck.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_base.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_bases_protocol_1009.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_rgba_select.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_speed_select.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_transparent_lean_1008.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_wh_suggest.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_shot_video.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_styles.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_video_ab_compare.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_video_frame_grab.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_negative_token_format_1008.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_open_receipt_server.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_prompt_meta_guard.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_qi21_edit_purpose.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_qi21_prompt_conflict_1021.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_qi21_prompt_preview.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_qi21_rgba_text.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_qi21_style_type_separation.py",
    "apps/backend/engines/comfyui/my_nodes/tests/test_workflow_subgraph_contract.py",
    "apps/backend/engines/comfyui/my_nodes/web/open-receipt.test.mjs",
    "apps/backend/engines/comfyui/my_nodes/web/open-workflow-content-anchor.test.mjs",
    "apps/backend/engines/comfyui/my_nodes/web/open-workflow-decision.test.mjs",
    "apps/backend/engines/comfyui/plugin_manager.py",
    "apps/backend/engines/comfyui/tests/conftest.py",
    "apps/backend/engines/comfyui/tests/test_bridge_actions.py",
    "apps/backend/engines/comfyui/tests/test_bridge_inbox.py",
    "apps/backend/engines/comfyui/tests/test_bridge_sidepanel.py",
    "apps/backend/engines/comfyui/tests/test_comfy_execute.py",
    "apps/backend/engines/comfyui/tests/test_comfy_hardening.py",
    "apps/backend/engines/comfyui/tests/test_comfy_integration_fields.py",
    "apps/backend/engines/comfyui/tests/test_comfy_manifest_bridge_workflows.py",
    "apps/backend/engines/comfyui/tests/test_comfy_paths_config.py",
    "apps/backend/engines/comfyui/tests/test_comfy_pure_functions.py",
    "apps/backend/engines/comfyui/tests/test_comfy_update_config_desktop_args.py",
    "apps/backend/engines/comfyui/tests/test_custom_node_seeds_sync.py",
    "apps/backend/engines/comfyui/tests/test_daojie_data_sync.py",
    "apps/backend/engines/comfyui/tests/test_daojie_handsfix_contract.py",
    "apps/backend/engines/comfyui/tests/test_daojie_workflow_contract.py",
    "apps/backend/engines/comfyui/tests/test_engine_bridge_token_heal.py",
    "apps/backend/engines/comfyui/tests/test_engine_dynamic_continuation.py",
    "apps/backend/engines/comfyui/tests/test_engine_guard_beat_converge.py",
    "apps/backend/engines/comfyui/tests/test_engine_lock.py",
    "apps/backend/engines/comfyui/tests/test_engine_models_list.py",
    "apps/backend/engines/comfyui/tests/test_engine_orphan_watchdog.py",
    "apps/backend/engines/comfyui/tests/test_engine_port_probe_timewait.py",
    "apps/backend/engines/comfyui/tests/test_engine_start_serialization.py",
    "apps/backend/engines/comfyui/tests/test_engine_stop_race.py",
    "apps/backend/engines/comfyui/tests/test_flux3_daojie_workflow_contract.py",
    "apps/backend/engines/comfyui/tests/test_my_cloud_node.py",
    "apps/backend/engines/comfyui/tests/test_my_cloud_takeover.py",
    "apps/backend/engines/comfyui/tests/test_my_sync.py",
    "apps/backend/engines/comfyui/tests/test_plugin_catalog.py",
    "apps/backend/engines/comfyui/tests/test_plugin_install_adopt.py",
    "apps/backend/engines/comfyui/tests/test_plugin_list_meta.py",
    "apps/backend/engines/comfyui/tests/test_plugin_update_gate.py",
    "apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py",
    "apps/backend/engines/comfyui/tests/test_superset_v3_contract.py",
    "apps/backend/engines/comfyui/tests/test_uploads.py",
    "apps/backend/engines/image_engine/comfyui_bridge.py",
    "apps/backend/engines/image_engine/qwen21.py",
    "apps/backend/image_gen/model_inventory.py",
    "apps/backend/image_gen/pipeline.py",
    "apps/backend/image_gen/server.py",
    "apps/backend/tests/test_comfyui_bridge.py",
    "apps/backend/tests/test_engine_home_occupancy.py",
    "apps/backend/tests/test_image_gen_krea2.py",
    "apps/backend/tests/test_image_gen_qwen21.py",
    "apps/backend/tests/test_image_gen_server.py",
    "apps/build/scripts/bases_chain_roll_1022_facebase.py",
    "apps/build/scripts/canvas_deploy.mjs",
    "apps/build/scripts/comfy-canvas-verify.mjs",
    "apps/build/scripts/daojie-t2i-app-e2e.mjs",
    "apps/build/scripts/daojie_charsheet_logic.py",
    "apps/build/scripts/daojie_charsheet_probe_1016.py",
    "apps/build/scripts/daojie_conflict_child_docs.py",
    "apps/build/scripts/daojie_lora_refclose.py",
    "apps/build/scripts/daojie_lora_refscan.py",
    "apps/build/scripts/daojie_note_wiring_1016.py",
    "apps/build/scripts/daojie_prompt_conflict_scan.py",
    "apps/build/scripts/daojie_prompt_source_sync.py",
    "apps/build/scripts/daojie_qi21_prompt_audit_1016.py",
    "apps/build/scripts/daojie_subject_overlap.py",
    "apps/build/scripts/daojie_t2i_guard.py",
    "apps/build/scripts/daojie_type_docs_rename_1016.py",
    "apps/build/scripts/daojie_engine_keeper.py",
    "apps/build/scripts/engine_workflows_reroot.py",
    "apps/build/scripts/file-size-gate-exemptions.json",
    "apps/build/scripts/fisher_pose_fire.py",
    "apps/build/scripts/flux3_daojie_delivery.py",
    "apps/build/scripts/flux3_daojie_deploy.py",
    "apps/build/scripts/flux3_daojie_layout.py",
    "apps/build/scripts/flux3_daojie_polish.py",
    "apps/build/scripts/flux3_daojie_style_v2.py",
    "apps/build/scripts/flux3_daojie_workflow.py",
    "apps/build/scripts/h3_fire_1015.py",
    "apps/build/scripts/hygiene_gate.py",
    "apps/build/scripts/manying_superset_negative_prompt.py",
    "apps/build/scripts/note_encoder_align.py",
    "apps/build/scripts/qi21_accel_bp_cfg1_1017.py",
    "apps/build/scripts/qi21_accel_layout_1018.py",
    "apps/build/scripts/qi21_accel_turbo_1016.py",
    "apps/build/scripts/qi21_anime_distribute_1018.py",
    "apps/build/scripts/qi21_anime_finalize_1018.py",
    "apps/build/scripts/qi21_anime_lora_removal_1018.py",
    "apps/build/scripts/qi21_anime_snapshots_1018.py",
    "apps/build/scripts/qi21_anime_verify_1018.py",
    "apps/build/scripts/qi21_base_swap_configs/bgstyle_types_1016.json",
    "apps/build/scripts/qi21_base_swap_configs/deenglish_1016.json",
    "apps/build/scripts/qi21_base_swap_configs/gongbi_merge_1016.json",
    "apps/build/scripts/qi21_base_swap_configs/nosimile_1017.json",
    "apps/build/scripts/qi21_base_swap_configs/slim_a_1017.json",
    "apps/build/scripts/qi21_base_swap_configs/types_refine_1017.json",
    "apps/build/scripts/qi21_base_swap_configs/zhongcai_1016.json",
    "apps/build/scripts/qi21_base_swap_configs/zhongshi_prefix_1017.json",
    "apps/build/scripts/qi21_base_swap_tool.py",
    "apps/build/scripts/qi21_bases_add_facebase_type_1022.py",
    "apps/build/scripts/qi21_browser_export_probe_1021.mjs",
    "apps/build/scripts/qi21_browser_export_probe_1021.py",
    "apps/build/scripts/qi21_charsheet_full_board_1016.py",
    "apps/build/scripts/qi21_charsheet_full_sync_1016.py",
    "apps/build/scripts/qi21_charsheet_full_verify_1016.py",
    "apps/build/scripts/qi21_charsheet_render_1016.py",
    "apps/build/scripts/qi21_charsheet_six_zone_apply_1016.py",
    "apps/build/scripts/qi21_charsheet_verify_1016.py",
    "apps/build/scripts/qi21_cleanup_browser_probe_1021.mjs",
    "apps/build/scripts/qi21_conflict_snapshot_sync.py",
    "apps/build/scripts/qi21_dancai_swap_1018.py",
    "apps/build/scripts/qi21_default_turbo_1016.py",
    "apps/build/scripts/qi21_default_turbo_round14.py",
    "apps/build/scripts/qi21_defaults_acceptance.py",
    "apps/build/scripts/qi21_edit9_fix_1016.py",
    "apps/build/scripts/qi21_edit9_img2img9_1016.py",
    "apps/build/scripts/qi21_five_method_sync_1016.py",
    "apps/build/scripts/qi21_five_method_verify_1016.py",
    "apps/build/scripts/qi21_flagship_v3_1018.py",
    "apps/build/scripts/qi21_grip_terminal_sweep_1019.py",
    "apps/build/scripts/qi21_grouptitle_shorten_edit_t2i_1015.py",
    "apps/build/scripts/qi21_i2i_alpha_wash_1015.py",
    "apps/build/scripts/qi21_i2i_cleanup_1021.py",
    "apps/build/scripts/qi21_i2i_fix7027_1016.py",
    "apps/build/scripts/qi21_i2i_layout_polish_1021.py",
    "apps/build/scripts/qi21_i2i_live_probe_1021.py",
    "apps/build/scripts/qi21_i2i_ref2_default_off_1016.py",
    "apps/build/scripts/qi21_i2i_repair_1016.py",
    "apps/build/scripts/qi21_i2i_workflow_fire.py",
    "apps/build/scripts/qi21_img2img_build_1009.py",
    "apps/build/scripts/qi21_inkling_accel_1018.py",
    "apps/build/scripts/qi21_inkling_bypass_1018.py",
    "apps/build/scripts/qi21_installed_i2i_edit.py",
    "apps/build/scripts/qi21_local_ten_types.py",
    "apps/build/scripts/qi21_mikkoani_mount_1018.py",
    "apps/build/scripts/qi21_mikkoani_strength_1019.py",
    "apps/build/scripts/qi21_native_cfg1_1017.py",
    "apps/build/scripts/qi21_output_boundary_1021.py",
    "apps/build/scripts/qi21_output_boundary_verify_1021.py",
    "apps/build/scripts/qi21_output_error_browser_1021.py",
    "apps/build/scripts/qi21_output_error_probe_1021.py",
    "apps/build/scripts/qi21_painterly_style_apply_1016.py",
    "apps/build/scripts/qi21_painterly_verify_1016.py",
    "apps/build/scripts/qi21_prompt_conflict_main_verify_1021.py",
    "apps/build/scripts/qi21_prompt_layer_scan.py",
    "apps/build/scripts/qi21_resolution_1018.py",
    "apps/build/scripts/qi21_revision_contracts.py",
    "apps/build/scripts/qi21_revision_distribute.py",
    "apps/build/scripts/qi21_revision_reconcile.py",
    "apps/build/scripts/qi21_revision_refine.py",
    "apps/build/scripts/qi21_revision_report.py",
    "apps/build/scripts/qi21_revision_snapshots.py",
    "apps/build/scripts/qi21_seedvr2_tune_1017.py",
    "apps/build/scripts/qi21_sheath_hold_1018.py",
    "apps/build/scripts/qi21_sigma_high_end_1016.py",
    "apps/build/scripts/qi21_style_correction.py",
    "apps/build/scripts/qi21_style_lora_accel_1018.py",
    "apps/build/scripts/qi21_style_type_distribute_1016.py",
    "apps/build/scripts/qi21_style_type_report_1016.py",
    "apps/build/scripts/qi21_style_type_snapshots_1016.py",
    "apps/build/scripts/qi21_style_verify.py",
    "apps/build/scripts/qi21_t2i_accel_layout_1016.py",
    "apps/build/scripts/qi21_t2i_wash_subgraph_1022.py",
    "apps/build/scripts/qi21_t2i_workflow_fire.py",
    "apps/build/scripts/qi21_turbo_default_verify_1021.py",
    "apps/build/scripts/qi21_typespeed_i2i_1017.py",
    "apps/build/scripts/qi21_typespeed_t2i_1017.py",
    "apps/build/scripts/qi21_upscale_tail_default_off_1018.py",
    "apps/build/scripts/qi21_vae_texturefix_1016.py",
    "apps/build/scripts/qi21_sidecar_api.py",
    "apps/build/scripts/qwen21_bridge_template_build.py",
    "apps/build/scripts/qwen21_daotu_rgba_t2i_build.py",
    "apps/build/scripts/run-python-tests.mjs",
    "apps/build/scripts/scripts_retention_audit.py",
    "apps/build/scripts/test_daojie_prompt_conflict_scan.py",
    "apps/build/scripts/test_qi21_i2i_canvas_1021.py",
    "apps/build/scripts/test_qi21_i2i_negative_1016.py",
    "apps/build/scripts/trellis_safe_python_checks_1020.py",
    "apps/build/scripts/word_family_sim.py",
    "apps/build/scripts/workflow_gate.py",
    "apps/build/scripts/workflow_id_counters_heal.py",
    "apps/build/scripts/workflow_layout_baseline.json",
    "apps/build/scripts/workflow_placement_audit.py",
    "apps/build/scripts/yanliao_face_t2i_1022.py",
    "apps/build/scripts/yanliao_face_t2i_pro_1022.py",
    "apps/build/scripts/yanliao_i2i_batch_1021.py",
    "apps/build/scripts/yanliao_prompts_free_1022.py",
    "apps/build/scripts/yue2_bgm_api_export.py",
    "apps/build/scripts/yue2_weights_provision.py",
    "apps/eslint.config.mjs",
    "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/prompt_layering.json",
    "apps/frontend/components/panels/assist/comfy-canvas/ComfyCanvasStudio.tsx",
    "apps/frontend/components/panels/assist/comfy-canvas/my-login-cloak.test.ts",
    "apps/frontend/components/panels/assist/comfy-canvas/my-module-policy.test.ts",
    "apps/frontend/electron/ipc/ai/comfy-api-takeover.test.ts",
    "apps/frontend/electron/ipc/ai/comfy-cloud-relay.test.ts",
    "apps/frontend/electron/ipc/ai/comfy-cloud-relay.ts",
    "apps/frontend/lib/assist/image-studio/comfy-action-origin.test.ts",
    "apps/frontend/lib/assist/image-studio/comfy-workflow-import.test.ts",
    "apps/frontend/lib/assist/image-studio/comfy-workflow-library.test.ts",
    "apps/frontend/lib/assist/image-studio/comfy-writeback-origin.test.ts",
    "apps/frontend/lib/assist/image-studio/workflow-export-comfy.ts",
]
# 2026-10-23 实测新增(10-22 扫描后并行役落账件 + README;对账 JSON 单列账目)
NEW_SINCE_SCAN = [
    "apps/backend/README.md",
    "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_instruction_select.py",
    "apps/build/scripts/bfs_face_ab_serial_1023.py",
    "apps/build/scripts/bfs_qwen21_face_ab_1023.py",
    "apps/build/scripts/bfs_qwen21_neutral_trial_1023.py",
    "apps/build/scripts/qi21-host-widget-probe.mjs",
    "apps/build/scripts/qi21-output-layout-probe.mjs",
    "apps/build/scripts/qi21-repair-browser-probe.mjs",
    "apps/build/scripts/qi21_accel_layout.py",
    "apps/build/scripts/qi21_bfs_promote_1023.py",
    "apps/build/scripts/qi21_face_inpaint_workflow_build_1023.py",
    "apps/build/scripts/qi21_i2i_asm_layout_1022.py",
    "apps/build/scripts/qi21_i2i_host_widgets_fix.py",
    "apps/build/scripts/qi21_i2i_output_compact.py",
    "apps/build/scripts/qi21_i2i_wash_subgraph_1022.py",
    "apps/build/scripts/qi21_note4100_canvas_1022.mjs",
    "apps/build/scripts/qi21_note4100_layout_1022.py",
    "apps/build/scripts/qi21_seedvr2_canvas_1022.mjs",
    "apps/build/scripts/qi21_seedvr2_layout_1022.py",
    "apps/build/scripts/qi21_shared_layout_sync.py",
    "apps/build/scripts/qi21_wire_layout.py",
]

# 活文档真源命中件(docs=16 .agents=7 AGENTS.md=1 .claude=3 .trellis/spec 命中2)
# 注:.trellis/spec/backend/directory-structure.md 为规则4 编辑件非三形态载体,
#     不入本清单(由 RULE4_EDITS 锚点单独校验),否则对账恒差。
DOCS_LIVE = [
    "AGENTS.md",
    ".agents/skills/comfyui/NODE_LIBRARY/custom-author.md",
    ".agents/skills/comfyui/SKILL.md",
    ".agents/skills/comfyui/machine.md",
    ".agents/skills/node-graph/INVOCATION.md",
    ".agents/skills/node-graph/OPTIMIZATION.md",
    ".agents/skills/node-graph/SKILL.md",
    ".agents/skills/node-graph/tools/layout_polish.py",
    ".claude/CLAUDE.md",
    ".claude/knowledge/backend-architecture.md",
    ".claude/knowledge/node-graph-architecture.md",
    ".trellis/spec/backend/comfyui-integration.md",
    ".trellis/spec/backend/error-handling.md",
    "docs/comfyui-kb/tools/batch_queue.py",
    "docs/comfyui-kb/分镜图生成与超分指引.md",
    "docs/comfyui-kb/子图宿主面板排查.md",
    "docs/comfyui-kb/子图工作流工程契约.md",
    "docs/comfyui-kb/定制代码地图.md",
    "docs/comfyui-kb/工作流落位规范.md",
    "docs/comfyui-kb/档案/DMAD-4步LoRA转制与单镜线换档-1003.md",
    "docs/comfyui-kb/漫影工作流清单.md",
    "docs/engineering/DEVELOPER_ARCHITECTURE.md",
    "docs/engineering/DOCS_COVERAGE_AUDIT.md",
    "docs/engineering/PACKAGING_AND_SMOKE_TESTING.md",
    "docs/engineering/TROUBLESHOOTING.md",
    "docs/krea2.md",
    "docs/prompts/Qwen-Image-2.1/档案/04-道劫风格适配.md",
    "docs/prompts/道劫_底座节点_0918.md",
    "docs/prompts/道劫_角色设定表出图逻辑_0919.md",
]

# form3 载件与全量预期集的定义后置(依赖 _NODE_FILES,见 D 组节)

# ----------------------------------------------------------------------------
# D 组:`__file__` 深度锚点逐字精确串(路径=迁移前旧位;行锚定,非正则)
# group: book=design.md D 表原枚举 / ext-A=comfyui.tests 实测扩充 /
#        ext-B=my_nodes.tests 实测扩充(2026-10-23 主会话批准并入)
# ----------------------------------------------------------------------------

_NODE_FILES = [
    "my_qi21_api_pe", "my_qi21_prompt_select", "my_qi21_base",
    "my_qi21_prompt_assembly", "my_qi21_final_output", "my_daojie_lora_stack",
    "my_daojie_base", "my_daojie_loras", "my_qi21_chinese_pe",
    "my_daojie_route", "my_qi21_bases_text",
]
_NODE_DOCSTRING_FILES = [
    f for f in _NODE_FILES
    if f not in ("my_qi21_api_pe", "my_qi21_bases_text")  # 此二件无该 docstring 段
]

# form3 载件(parents[5]/"frontend" 形态;impact-scan C 节单列,A/B 节不含;
# test_my_styles.py 已在 IMPACT_SCAN_LIVE B 节,此处补 11 节点件)
FORM3_CARRIERS = [
    f"apps/backend/engines/comfyui/my_nodes/nodes/{_nf}.py" for _nf in _NODE_FILES
]

# 对账权威全集 = impact-scan A∪B(234) + 10-23 新增(21) + 活文档(29) + form3 载件(11)
FORM_EXPECTED_SET = sorted(
    set(IMPACT_SCAN_LIVE) | set(NEW_SINCE_SCAN) | set(DOCS_LIVE)
    | set(FORM3_CARRIERS)
)

_P5_LINE_OLD = '        _here.parents[5] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",\n'
_P5_LINE_NEW = '        _here.parents[4] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",\n'

_DOCSTRING_OLD = (
    "    引擎家数据位=parents[4]/daojie-data:随文件真实所在地走(引擎家内节点在\n"
    "    <家>/ComfyUI/custom_nodes/my-nodes/nodes/,上四级即家根,上三级只到\n"
    "    ComfyUI 源码层),"  # 第三行行中闭合括号,后续原文同行续排(勿加行尾 \n)
)
_DOCSTRING_NEW = (
    "    引擎家数据位=parents[4]/daojie-data:随文件真实所在地走(引擎家内节点在\n"
    "    <家>/ComfyUI/custom_nodes/my-nodes/nodes/,上四级即家根,上三级只到\n"
    "    ComfyUI 源码层;10-22 迁移注:仓库位=backend/comfyui/my_nodes/nodes/,\n"
    "    daojie-data 层=apps/daojie-data MISS 无害,frontend 候选已随深度改 [4]),"
)

_P6 = "Path(__file__).resolve().parents[6]"
_P6_NEW = "Path(__file__).resolve().parents[5]"

D_GROUP: list[dict] = [
    # ---- book:design.md §File Map D 表原枚举 ----
    {"path": "apps/backend/engines/comfyui/tests/conftest.py", "group": "book",
     "replacements": [(
         "BACKEND_ROOT = Path(__file__).resolve().parents[3]  # tests/ -> comfyui/ -> engines/ -> backend",
         "BACKEND_ROOT = Path(__file__).resolve().parents[2]  # tests/ -> comfyui/ -> backend", 1)]},
    {"path": "apps/backend/engines/comfyui/plugin_manager.py", "group": "book",
     "replacements": [(
         '        here.parents[3] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",\n',
         '        here.parents[2] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",\n', 1)]},
    {"path": "apps/backend/engines/comfyui/engine_manager.py", "group": "book",
     "replacements": [(
         "            _daojie_truth_home = Path(__file__).resolve().parents[3] / (\n",
         "            _daojie_truth_home = Path(__file__).resolve().parents[2] / (\n", 1)]},
    {"path": "apps/backend/engines/image_engine/comfyui_bridge.py", "group": "book",
     "replacements": [(
         '_WORKFLOWS_DIR = Path(__file__).resolve().parents[1] / "comfyui" / "workflows"',
         '_WORKFLOWS_DIR = Path(__file__).resolve().parents[2] / "comfyui" / "workflows"', 1)]},
]

# 节点件:仅 frontend 候选行 [5]→[4];parents[4]/"daojie-data" 行一律不动(硬约束)
for _nf in _NODE_FILES:
    D_GROUP.append({
        "path": f"apps/backend/engines/comfyui/my_nodes/nodes/{_nf}.py",
        "group": "book",
        "replacements": [(_P5_LINE_OLD, _P5_LINE_NEW, 1)],
    })
for _nf in _NODE_DOCSTRING_FILES:
    D_GROUP.append({
        "path": f"apps/backend/engines/comfyui/my_nodes/nodes/{_nf}.py",
        "group": "book-docstring",
        "replacements": [(_DOCSTRING_OLD, _DOCSTRING_NEW, 1)],
    })

# ---- ext-A:comfyui/tests 深度锚点(10-23 实测,tests/ 少一层 → [N]→[N-1]) ----
D_GROUP += [
    {"path": "apps/backend/engines/comfyui/tests/test_daojie_handsfix_contract.py", "group": "ext-A",
     "replacements": [("REPO = Path(__file__).resolve().parents[5]",
                       "REPO = Path(__file__).resolve().parents[4]", 1)]},
    {"path": "apps/backend/engines/comfyui/tests/test_flux3_daojie_workflow_contract.py", "group": "ext-A",
     "replacements": [("ROOT=Path(__file__).resolve().parents[5]",
                       "ROOT=Path(__file__).resolve().parents[4]", 1)]},
    {"path": "apps/backend/engines/comfyui/tests/test_daojie_workflow_contract.py", "group": "ext-A",
     "replacements": [
         ("_REPO = _TESTS_DIR.parents[4]  # tests → comfyui → engines → backend → apps → 仓库根",
          "_REPO = _TESTS_DIR.parents[3]  # tests → comfyui → backend → apps → 仓库根", 1),
         ('BASES_JSON = _TESTS_DIR.parents[3] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"',
          'BASES_JSON = _TESTS_DIR.parents[2] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"', 1)]},
    {"path": "apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py", "group": "ext-A",
     "replacements": [
         ("_REPO = _TESTS_DIR.parents[4]  # tests → comfyui → engines → backend → apps → 仓库根",
          "_REPO = _TESTS_DIR.parents[3]  # tests → comfyui → backend → apps → 仓库根", 1),
         ('_TESTS_DIR.parents[3] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"',
          '_TESTS_DIR.parents[2] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"', 2),
         ('_scripts = _TESTS_DIR.parents[4] / "apps" / "build" / "scripts"',
          '_scripts = _TESTS_DIR.parents[3] / "apps" / "build" / "scripts"', 1)]},
    {"path": "apps/backend/engines/comfyui/tests/test_bridge_inbox.py", "group": "ext-A",
     "replacements": [("PYTHONPATH=str(Path(__file__).resolve().parents[3])",
                       "PYTHONPATH=str(Path(__file__).resolve().parents[2])", 1)]},
]

# ---- ext-B:my_nodes/tests 深度锚点(nodes/ 少一层 → [6]→[5] 等) ----
_P6_FILES = {
    "test_my_daojie_base.py": 1,
    "test_my_qi21_base.py": 1,
    "test_workflow_subgraph_contract.py": 2,
    "test_my_qi21_transparent_lean_1008.py": 2,
    "test_my_qi21_instruction_select.py": 1,
    "test_qi21_prompt_conflict_1021.py": 1,
    "test_qi21_conflict_p1_1018.py": 1,
    "test_qi21_style_boundary_1016.py": 1,
    "test_gongbi_gate.py": 1,
    "test_qi21_style_type_separation.py": 1,
    "test_flux3_daojie_adapter.py": 1,
    "test_my_qi21_bases_protocol_1009.py": 1,
}
for _tf, _cnt in _P6_FILES.items():
    D_GROUP.append({
        "path": f"apps/backend/engines/comfyui/my_nodes/tests/{_tf}",
        "group": "ext-B",
        "replacements": [(_P6, _P6_NEW, _cnt)],
    })
D_GROUP += [
    {"path": "apps/backend/engines/comfyui/my_nodes/tests/test_my_daojie_base.py", "group": "ext-B",
     "replacements": [("# 仓库根:my_nodes/tests/test_x.py → parents[6]=仓库根(apps 的上一级)",
                       "# 仓库根:my_nodes/tests/test_x.py → parents[5]=仓库根(apps 的上一级)", 1)]},
    {"path": "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_base.py", "group": "ext-B",
     "replacements": [("# 仓库根:my_nodes/tests/test_x.py → parents[6]=仓库根(apps 的上一级)",
                       "# 仓库根:my_nodes/tests/test_x.py → parents[5]=仓库根(apps 的上一级)", 1)]},
    {"path": "apps/backend/engines/comfyui/my_nodes/tests/test_workflow_subgraph_contract.py", "group": "ext-B",
     "replacements": [('WORKFLOWS = _ROOT / "apps" / "backend" / "engines" / "comfyui" / "workflows"',
                       'WORKFLOWS = _ROOT / "apps" / "backend" / "comfyui" / "workflows"', 1)]},
    {"path": "apps/backend/engines/comfyui/my_nodes/tests/test_qi21_prompt_preview.py", "group": "ext-B",
     "replacements": [("sys.path.insert(0, str(Path(__file__).resolve().parents[4]))",
                       "sys.path.insert(0, str(Path(__file__).resolve().parents[3]))", 1)]},
    {"path": "apps/backend/engines/comfyui/my_nodes/tests/test_color_code_strip_1009.py", "group": "ext-B",
     "replacements": [('_HERE / ".." / ".." / ".." / ".." / "frontend" / "assets" / "studio-manuals"',
                       '_HERE / ".." / ".." / ".." / "frontend" / "assets" / "studio-manuals"', 1)]},
    {"path": "apps/backend/engines/comfyui/my_nodes/tests/test_my_styles.py", "group": "ext-B",
     "replacements": [
         ("# dev 布局真源:本测试文件 parents[5]=apps → frontend/assets/studio-manuals/art_skills",
          "# dev 布局真源:本测试文件 parents[4]=apps → frontend/assets/studio-manuals/art_skills", 1),
         ('Path(__file__).resolve().parents[5] / "frontend" / "assets" / "studio-manuals" / "art_skills"',
          'Path(__file__).resolve().parents[4] / "frontend" / "assets" / "studio-manuals" / "art_skills"', 1)]},
]

# ----------------------------------------------------------------------------
# 规则4:特例注记三件(R1 附带 + R7 Q2-B 措辞)
# ----------------------------------------------------------------------------

ENGINES_INIT_OLD = (
    '"""托管引擎域(09-09 裁定:engines 独立抽离,不止 image 概念)。\n'
    "\n"
    "每引擎一个子包(照 Jan extensions/ 一引擎一包先例);本域只管引擎实例\n"
    "生命周期(安装/更新/launch/守卫/插件策展),零业务生成逻辑。分层权威:\n"
    ".claude/knowledge/backend-architecture.md(改目录前必读)。\n"
    '"""\n'
)
ENGINES_INIT_NEW = (
    '"""托管引擎域(09-09 裁定:engines 独立抽离,不止 image 概念)。\n'
    "\n"
    "每引擎一个子包(照 Jan extensions/ 一引擎一包先例);本域只管引擎实例\n"
    "生命周期(安装/更新/launch/守卫/插件策展),零业务生成逻辑。分层权威:\n"
    ".claude/knowledge/backend-architecture.md(改目录前必读)。\n"
    "\n"
    "特例(10-22 迁移):comfyui 托管包上提为 apps/backend/comfyui 平级包\n"
    "(import 名 comfyui 直达),不在本域内;engines/ 其余各包仍循每引擎一\n"
    "子包原则,09-09 分层裁定不变。\n"
    '"""\n'
)

_BA_OLD = "> **2026-10-10 校准**:engines/ 现 7 包(upscale/depth 已随 09-10 退役删除),以 ls apps/backend/engines 现数为准。"
_BA_NEW = (_BA_OLD + "\n> **2026-10-22 校准**:comfyui 特例托管包上提为顶层 `apps/backend/comfyui`"
           "(平级于 engines/,import 名 `comfyui` 直达);engines/ 其余 6 包仍循 09-09"
           "「每引擎一子包」原则,本分层裁定不变。")

_DS_PROSE_OLD = (
    "   surface and imports downward, never the reverse); (b) **managed instance\n"
    "   engines** (`comfyui/`): lifecycle of an external engine process\n"
    "   (install/update/launch/guard/plugins), which is never imported into a"
)
_DS_PROSE_NEW = (
    "   surface and imports downward, never the reverse); (b) **managed instance\n"
    "   engines** (`comfyui/`, lifted 2026-10-22 to top-level `backend/comfyui`\n"
    "   as a special case with import namespace `comfyui`; the per-engine\n"
    "   subpackage ruling stands for the remaining engines/ packages):\n"
    "   lifecycle of an external engine process\n"
    "   (install/update/launch/guard/plugins), which is never imported into a"
)
_DS_TREE_OLD = (
    "│   ├── music3_engine/        # weights only (model_cache + install script;\n"
    "│   │                         #   inference goes through mlx-serve service)\n"
    "│   └── comfyui/              # managed instance: manifest/engine_manager/\n"
    "│                             #   plugin_manager/execute + curated + tests/\n"
)
_DS_TREE_NEW = (
    "│   └── music3_engine/        # weights only (model_cache + install script;\n"
    "│                             #   inference goes through mlx-serve service)\n"
    "├── comfyui/                  # 10-22 special-case lift: managed-instance host\n"
    "│                             #   package (manifest/engine_manager/plugin_manager/\n"
    "│                             #   execute + curated + tests/); import = `comfyui`\n"
)

RULE4_EDITS = [
    {"path": ENGINES_INIT_REL, "name": "engines-init-docstring",
     "replacements": [(ENGINES_INIT_OLD, ENGINES_INIT_NEW, 1)]},
    {"path": ".claude/knowledge/backend-architecture.md", "name": "backend-architecture-calibration",
     "replacements": [(_BA_OLD, _BA_NEW, 1)]},
    {"path": ".trellis/spec/backend/directory-structure.md", "name": "directory-structure-prose",
     "replacements": [(_DS_PROSE_OLD, _DS_PROSE_NEW, 1)]},
    {"path": ".trellis/spec/backend/directory-structure.md", "name": "directory-structure-tree",
     "replacements": [(_DS_TREE_OLD, _DS_TREE_NEW, 1)]},
    # .gitignore runs/ 忽略位=路径锚定,.gitignore:160 旧路径条目随迁改写
    # (不改则迁后 runs/ 以未追踪态浮出 git status,触发收尾自检假红)
    {"path": ".gitignore", "name": "gitignore-runs-path",
     "replacements": [("apps/backend/engines/comfyui/runs/\n",
                       "apps/backend/comfyui/runs/\n", 1)]},
]

# 门禁 C 组关键锚(信息型断言:正式/dry-run 前置必命中)
GATE_ANCHORS = [
    ("apps/build/scripts/hygiene_gate.py",
     'Q21_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"'),
    ("apps/build/scripts/run-python-tests.mjs",
     '"backend/engines/comfyui/tests"'),
    ("apps/build/scripts/run-python-tests.mjs",
     '"backend/engines/comfyui/my_nodes/tests"'),
    ("apps/build/scripts/workflow_gate.py",
     '"apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"'),
    ("apps/build/scripts/workflow_gate.py",
     '"backend/engines/comfyui/tests/test_qwen21_workflow_contract.py"'),
    ("apps/eslint.config.mjs", "backend/engines/comfyui/.zcode"),
    ("apps/build/scripts/canvas_deploy.mjs", "apps\\/backend\\/engines\\/comfyui\\/workflows\\/"),
]

# ----------------------------------------------------------------------------
# 规则5:flux3 批准链重钉(2026-10-23 主会话授权;先例=1022 批准链重钉)
# 迁移联动:test_flux3_daojie_workflow_contract 锁 receipt.gui.path=旧工作流路径且
# receipt 字节被测试内 sha 钉死;source-drift/source-hashes 键=旧路径。
# 链序:drift/hashes 键改 → receipt 冻结 sha 两枚随新字节回填 + gui.path 改 →
# receipt 新字节 sha 回填测试两处常量与 shared-source-revisions.leaf_receipt_sha256。
# 全部 sha 程序化计算(禁手算);.trellis 侧为本地簿记,入 git 者仅测试常量。
# ----------------------------------------------------------------------------

_RULE5_TASK = ".trellis/tasks/10-16-flux3-daojie-ten-types"
RULE5_DRIFT_REL = f"{_RULE5_TASK}/reports/source-drift.json"
RULE5_HASHES_REL = f"{_RULE5_TASK}/artifacts/source-hashes.json"
RULE5_RECEIPT_REL = f"{_RULE5_TASK}/reports/approved-live-subject-revision-1021-3dcutaway.json"
RULE5_REVISIONS_REL = f"{_RULE5_TASK}/reports/shared-source-revisions.json"
RULE5_TEST_REL = "apps/backend/engines/comfyui/tests/test_flux3_daojie_workflow_contract.py"

_R5_OLD_QI21_KEY = ("apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/"
                    "1_文生图/qi21-道劫-t2i.json")
_R5_OLD_FLUX3_KEY = ("apps/backend/engines/comfyui/workflows/1_图片/Flux3图像/"
                     "flux3-文生图.json")
_R5_OLD_GUI_PATH = ("apps/backend/engines/comfyui/workflows/1_图片/Flux3图像/"
                    "flux3-道劫-t2i.json")
_R5_TEST_SHA_OLD = "6436a794becd93f13284d6921f41939c9f259f44dd4aa5611244b5bbaeb8d0d5"


def _r5_new(relpath: str) -> str:
    return F2_RE.sub("comfyui", relpath) if "engines/comfyui" in relpath else relpath


def verify_rule5_anchors(*, post: bool) -> list[str]:
    errors: list[str] = []
    try:
        import json as _json
        drift_t = (REPO / RULE5_DRIFT_REL).read_text(encoding="utf-8")
        hashes_t = (REPO / RULE5_HASHES_REL).read_text(encoding="utf-8")
        receipt_t = (REPO / RULE5_RECEIPT_REL).read_text(encoding="utf-8")
        revisions_t = (REPO / RULE5_REVISIONS_REL).read_text(encoding="utf-8")
        test_t = (REPO / (remap(RULE5_TEST_REL) if post else RULE5_TEST_REL)).read_text(encoding="utf-8")
    except OSError as e:
        return [f"规则5文件不可读: {e}"]
    for label, text, old, new, cnt in [
        ("drift键", drift_t, _R5_OLD_QI21_KEY, _r5_new(_R5_OLD_QI21_KEY), 1),
        ("hashes键qi21", hashes_t, _R5_OLD_QI21_KEY, _r5_new(_R5_OLD_QI21_KEY), 1),
        ("hashes键flux3", hashes_t, _R5_OLD_FLUX3_KEY, _r5_new(_R5_OLD_FLUX3_KEY), 1),
        ("receipt.gui.path", receipt_t, _R5_OLD_GUI_PATH, _r5_new(_R5_OLD_GUI_PATH), 1),
    ]:
        want = new if post else old
        if text.count(want) != cnt:
            errors.append(f"规则5 {label} 计数 {text.count(want)}≠{cnt} (post={post})")
    if post:
        # 新态:测试两处常量=新 receipt sha;drift/hashes 无旧键;revisions 已回填
        receipt = _json.loads((REPO / RULE5_RECEIPT_REL).read_text(encoding="utf-8"))
        new_sha = sha256_bytes((REPO / RULE5_RECEIPT_REL).read_bytes())
        if test_t.count(new_sha) != 2:
            errors.append("规则5 测试内 receipt sha 常量未同步(应 2 处)")
        if _R5_TEST_SHA_OLD in test_t:
            errors.append("规则5 测试内旧 sha 常量残留")
        if revisions_t.count(new_sha) != 1:
            errors.append("规则5 revisions.leaf_receipt_sha256 未回填")
    else:
        if test_t.count(_R5_TEST_SHA_OLD) != 2:
            errors.append("规则5 测试内旧 sha 常量计数≠2")
        if revisions_t.count(_R5_TEST_SHA_OLD) != 1:
            errors.append("规则5 revisions 旧 sha 计数≠1")
        try:
            receipt = _json.loads(receipt_t)
            frozen = {e["path"]: e["sha256"] for e in receipt.get("frozen", [])}
            for need in (RULE5_DRIFT_REL, RULE5_HASHES_REL):
                if need not in frozen:
                    errors.append(f"规则5 receipt 缺冻结条目: {need}")
        except (_json.JSONDecodeError, KeyError) as e:
            errors.append(f"规则5 receipt 解析失败: {e}")
    return errors


def apply_rule5(record_change) -> dict:
    """B5 执行规则5(链序固定;sha 全程序化;逐件进替换日志)。返回重钉账。"""
    import json as _json

    def edit(relpath: str, old: str, new: str, expect: int, note: str) -> str:
        path = REPO / relpath
        text = path.read_text(encoding="utf-8")
        got = text.count(old)
        if got != expect:
            raise RuntimeError(f"规则5失配 {relpath}: {note} 计数 {got}≠{expect}")
        new_text = text.replace(old, new)
        record_change(relpath, relpath, text, new_text,
                      {}, [f"rule5:{note}"])
        path.write_text(new_text, encoding="utf-8")
        return new_text

    ledger = {"reason": "10-22 目录迁移机械联动(批准链重钉,先例=1022 批准链重钉)",
              "edits": []}

    # a/b) drift 与 hashes 键改(字节级,仅路径串)
    edit(RULE5_DRIFT_REL, _R5_OLD_QI21_KEY, _r5_new(_R5_OLD_QI21_KEY), 1, "drift键")
    s_drift = sha256_bytes((REPO / RULE5_DRIFT_REL).read_bytes())
    ledger["edits"].append({"file": RULE5_DRIFT_REL, "old": _R5_OLD_QI21_KEY,
                            "new": _r5_new(_R5_OLD_QI21_KEY), "new_sha256": s_drift})
    edit(RULE5_HASHES_REL, _R5_OLD_QI21_KEY, _r5_new(_R5_OLD_QI21_KEY), 1, "hashes键qi21")
    edit(RULE5_HASHES_REL, _R5_OLD_FLUX3_KEY, _r5_new(_R5_OLD_FLUX3_KEY), 1, "hashes键flux3")
    s_hashes = sha256_bytes((REPO / RULE5_HASHES_REL).read_bytes())
    ledger["edits"].append({"file": RULE5_HASHES_REL,
                            "old": [_R5_OLD_QI21_KEY, _R5_OLD_FLUX3_KEY],
                            "new": [_r5_new(_R5_OLD_QI21_KEY), _r5_new(_R5_OLD_FLUX3_KEY)],
                            "new_sha256": s_hashes})

    # c) receipt:gui.path 改 + 两枚冻结 sha 回填(旧 sha 自 receipt json 定位)
    receipt_path = REPO / RULE5_RECEIPT_REL
    receipt_text = receipt_path.read_text(encoding="utf-8")
    frozen = {e["path"]: e["sha256"] for e in _json.loads(receipt_text)["frozen"]}
    old_drift_sha = frozen[RULE5_DRIFT_REL]
    old_hashes_sha = frozen[RULE5_HASHES_REL]
    for old, new, note in [
        (_R5_OLD_GUI_PATH, _r5_new(_R5_OLD_GUI_PATH), "receipt.gui.path"),
        (old_drift_sha, s_drift, "receipt冻结sha.drift"),
        (old_hashes_sha, s_hashes, "receipt冻结sha.hashes"),
    ]:
        receipt_text = edit(RULE5_RECEIPT_REL, old, new, 1, note)
    s_receipt = sha256_bytes(receipt_path.read_bytes())
    ledger["edits"].append({
        "file": RULE5_RECEIPT_REL,
        "old": {"gui.path": _R5_OLD_GUI_PATH, "frozen_sha.drift": old_drift_sha,
                "frozen_sha.hashes": old_hashes_sha},
        "new": {"gui.path": _r5_new(_R5_OLD_GUI_PATH), "frozen_sha.drift": s_drift,
                "frozen_sha.hashes": s_hashes},
        "new_sha256": s_receipt})

    # d/e) receipt 新 sha 回填:测试两处常量 + revisions.leaf_receipt_sha256
    test_rel = remap(RULE5_TEST_REL)
    edit(test_rel, _R5_TEST_SHA_OLD, s_receipt, 2, "测试receipt.sha常量×2")
    ledger["edits"].append({"file": test_rel, "old": _R5_TEST_SHA_OLD,
                            "new": s_receipt, "occurrences": 2})
    edit(RULE5_REVISIONS_REL, _R5_TEST_SHA_OLD, s_receipt, 1, "revisions.leaf_receipt_sha256")
    ledger["edits"].append({"file": RULE5_REVISIONS_REL, "old": _R5_TEST_SHA_OLD,
                            "new": s_receipt})
    ledger["receipt_new_sha256"] = s_receipt
    return ledger


# ----------------------------------------------------------------------------
# 基础工具
# ----------------------------------------------------------------------------

def die(msg: str, code: int = 1) -> None:
    print(f"[FAIL] {msg}", file=sys.stderr)
    sys.exit(code)


def ok(msg: str) -> None:
    print(f"[ok] {msg}")


def rel(p: Path) -> str:
    return str(p.relative_to(REPO))


def remap(relpath: str) -> str:
    """旧路径 → 迁移后路径(仅 comfyui 包内件重映射)。"""
    if relpath.startswith(SRC_REL + "/"):
        return DST_REL + relpath[len(SRC_REL):]
    return relpath


def reverse_remap(relpath: str) -> str:
    """迁移后路径 → 迁移前路径(日志 pre_path 保真用)。"""
    if relpath.startswith(DST_REL + "/"):
        return SRC_REL + relpath[len(DST_REL):]
    return relpath


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True,
                          text=True, check=check)


def git_head() -> str:
    return run_git("rev-parse", "HEAD").stdout.strip()


def git_status_porcelain() -> list[str]:
    out = run_git("status", "--porcelain=v1").stdout
    return [ln for ln in out.splitlines() if ln.strip()]


def git_status_entries() -> list[tuple[str, str, str | None]]:
    """porcelain -z 结构化解析 → [(XY, path, old_path|None), ...]。

    路径含空格/非 ASCII(如「单镜视频 · chapter-001.json」)时 v1 明文模式会给
    路径加引号致裸切解析失真;-z 模式 NUL 分隔且改名项为 `XY new\\0old\\0`。
    """
    out = run_git("status", "--porcelain=v1", "-z").stdout
    items = out.split("\0")
    entries: list[tuple[str, str, str | None]] = []
    i = 0
    while i < len(items):
        it = items[i]
        if not it:
            i += 1
            continue
        code, path = it[:2], it[3:]
        old: str | None = None
        if code[0] in ("R", "C") and i + 1 < len(items):
            old = items[i + 1]
            i += 2
        else:
            i += 1
        entries.append((code, path, old))
    return entries


def _excluded(relpath: str) -> bool:
    parts = Path(relpath).parts
    for part in parts[:-1]:
        if part in EXCLUDE_DIR_NAMES:
            return True
    posix = relpath.replace(os.sep, "/")
    for suffix in RUNS_DIR_SUFFIXES:
        if posix == suffix or posix.startswith(suffix + "/"):
            return True
    if parts[-1] == ".DS_Store" or parts[-1].endswith(".pyc"):
        return True
    if posix == SELF_REL:  # 本脚本自身含锚点旧串,永不自改
        return True
    return False


def iter_live_files() -> list[str]:
    """活区文件枚举(排序稳定;不进符号链接;排除历史区/产物区/运行产物)。"""
    found: list[str] = []
    for root in SCAN_ROOTS:
        base = REPO / root
        if not base.exists():
            die(f"活区根不存在: {root}")
        if base.is_file():
            if not _excluded(root):
                found.append(root)
            continue
        for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
            dirnames[:] = sorted(
                d for d in dirnames
                if d not in EXCLUDE_DIR_NAMES
                and not Path(dirpath, d).is_symlink()
                and not _excluded(rel(Path(dirpath) / d))
            )
            for fn in sorted(filenames):
                full = Path(dirpath) / fn
                if full.is_symlink():
                    continue
                r = rel(full)
                if not _excluded(r):
                    found.append(r)
    return sorted(set(found))


def form_hits(content: str) -> dict[str, int]:
    return {
        "form1_engines_dot_comfyui": content.count(F1),
        "form2_engines_sep_comfyui": len(F2_RE.findall(content)),
        "form3_parents5_frontend": content.count(F3),
    }


def apply_form_rules(content: str) -> tuple[str, dict[str, int]]:
    """规则1+2(顺序无关,两形态判据不相交)。返回新内容与替换计数。"""
    n1 = content.count(F1)
    if n1:
        content = content.replace(F1, "comfyui")
    n2 = len(F2_RE.findall(content))
    if n2:
        content = F2_RE.sub("comfyui", content)
    return content, {"rule1": n1, "rule2": n2}


# ----------------------------------------------------------------------------
# 锚点校验
# ----------------------------------------------------------------------------

def verify_exact_anchors(entries: list[dict], *, post: bool, label: str) -> list[str]:
    """D 组/规则4 锚点逐条校验。post=False 校验旧串计数;post=True 校验新串计数。"""
    errors: list[str] = []
    for entry in entries:
        path_old = entry["path"]
        path = remap(path_old) if post else path_old
        target = REPO / path
        if not target.is_file():
            errors.append(f"{label} 文件缺失: {path}")
            continue
        content = target.read_text(encoding="utf-8")
        for old, new, count in entry["replacements"]:
            want, probe = (new, "新串") if post else (old, "旧串")
            got = content.count(want)
            if got != count:
                errors.append(
                    f"{label} {path} {probe}计数 {got}≠{count}"
                    f"({'ext-'+entry['group'] if 'group' in entry else entry.get('name','')})")
    return errors


def structural_hard_checks() -> list[str]:
    """硬结构事实(SRC/DST/符号链接/同名包占用)——各模式一律致命。"""
    errors: list[str] = []
    if not SRC.is_dir():
        errors.append(f"源目录缺失: {SRC_REL}")
    if DST.exists():
        errors.append(f"目标位已存在: {DST_REL}")
    # 指向源目录的符号链接
    for root in ("apps", ".claude", ".agents", "docs"):
        base = REPO / root
        if not base.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
            for name in dirnames + filenames:
                p = Path(dirpath) / name
                if p.is_symlink():
                    try:
                        if "engines/comfyui" in os.readlink(p):
                            errors.append(f"符号链接指向源目录: {rel(p)}")
                    except OSError:
                        pass
    # 顶层名 comfyui 无本地/pip 包占用(迁后 import 语义唯一)
    proc = subprocess.run(
        [sys.executable, "-c", "import comfyui"],
        cwd=REPO / "apps/backend", capture_output=True, text=True)
    if proc.returncode == 0:
        errors.append("import comfyui 竟然成功(存在同名占用包,迁移后语义将歧义)")
    return errors


def campaign_area_cleanliness() -> list[str]:
    """战役区域干净度(Q1-A 门):dry-run/正式 Phase A 致命;selftest 仅警示。

    并行役在途未追踪件(如 yanliao_kv_viewsheet_1023.py)属 CP0 发车门闩范畴,
    不应阻塞 CP1 脚本质量门(锚点+单测);正式迁移 Phase A 仍硬拒。
    """
    area = [(c, p, o) for c, p, o in git_status_entries()
            if p.startswith(("apps/backend/engines/", "apps/build/scripts/"))
            or (o or "").startswith(("apps/backend/engines/", "apps/build/scripts/"))]
    return [f"{c} {p}" for c, p, _o in area if p != SELF_REL]


def structural_prechecks() -> list[str]:
    return structural_hard_checks() + campaign_area_cleanliness()


def structural_postchecks() -> list[str]:
    errors: list[str] = []
    if SRC.exists():
        errors.append(f"源目录仍在: {SRC_REL}")
    if not DST.is_dir():
        errors.append(f"目标位缺失: {DST_REL}")
    return errors


def verify_gate_anchors(*, post: bool) -> list[str]:
    errors: list[str] = []
    for path, needle in GATE_ANCHORS:
        target = REPO / (remap(path) if post else path)
        if not target.is_file():
            errors.append(f"门禁锚文件缺失: {path}")
            continue
        want = needle.replace("engines.comfyui", "comfyui") if post else needle
        want = F2_RE.sub("comfyui", want) if post else want
        if want not in target.read_text(encoding="utf-8"):
            errors.append(f"门禁锚未命中(post={post}): {path} :: {needle[:60]}")
    return errors


# ----------------------------------------------------------------------------
# 对账:活区实测 vs 权威清单
# ----------------------------------------------------------------------------

def discover_form_files() -> tuple[dict[str, list[str]], dict[str, dict[str, int]]]:
    files: list[str] = []
    counts: dict[str, dict[str, int]] = {}
    for r in iter_live_files():
        try:
            content = (REPO / r).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        hits = form_hits(content)
        if any(hits.values()):
            files.append(r)
            counts[r] = hits
    agg: dict[str, list[str]] = {"form1": [], "form2": [], "form3": []}
    for r, h in counts.items():
        if h["form1_engines_dot_comfyui"]:
            agg["form1"].append(r)
        if h["form2_engines_sep_comfyui"]:
            agg["form2"].append(r)
        if h["form3_parents5_frontend"]:
            agg["form3"].append(r)
    return agg, counts


def reconcile_against_authority(counts: dict[str, dict[str, int]]) -> dict:
    """dry-run/正式 前置:实测命中文件集 vs FORM_EXPECTED_SET 双向差集。

    调用时机均在 git mv 之前(dry-run 全程;正式模式 Phase A),故以旧位路径比对;
    正式模式 Phase C 的改动集校验单独走 expected_paths(含重映射),与本判据无关。
    """
    discovered = set(counts)
    expected = set(FORM_EXPECTED_SET)
    diff_new = sorted(discovered - expected)
    diff_gone = sorted(expected - discovered)
    return {
        "authority_size": len(expected),
        "discovered_size": len(discovered),
        "discovered_not_expected": diff_new,
        "expected_not_discovered": diff_gone,
        "clean": not diff_new and not diff_gone,
    }


# ----------------------------------------------------------------------------
# --selftest:锚点矩阵 + 规则单测
# ----------------------------------------------------------------------------

def rule_unit_tests() -> list[str]:
    failures: list[str] = []

    def check(name: str, got, want):
        if got != want:
            failures.append(f"单测 {name}: got={got!r} want={want!r}")

    # 规则1:import 形态
    check("r1-import", apply_form_rules("from engines.comfyui import engine_manager as _em")[0],
          "from comfyui import engine_manager as _em")
    check("r1-patch-str", apply_form_rules('patch("engines.comfyui.my_nodes.bridge.settings.t")')[0],
          'patch("comfyui.my_nodes.bridge.settings.t")')
    check("r1-keep-sibling-dot", apply_form_rules("from engines.image_engine import krea2")[0],
          "from engines.image_engine import krea2")
    check("r1-keep-tts", apply_form_rules("engines.tts_engine.catalog")[0],
          "engines.tts_engine.catalog")

    # 规则2:路径串形态(/ 与 \ 与连续转义)
    check("r2-abs", apply_form_rules("apps/backend/engines/comfyui/workflows/1_图片")[0],
          "apps/backend/comfyui/workflows/1_图片")
    check("r2-rel", apply_form_rules('"backend/engines/comfyui/tests"')[0],
          '"backend/comfyui/tests"')
    check("r2-backslash", apply_form_rules("..\\\\engines\\\\comfyui\\\\x")[0],
          "..\\\\comfyui\\\\x")
    check("r2-regex-literal",
          apply_form_rules("if (/^apps\\/backend\\/engines\\/comfyui\\/workflows\\/.*/.test(f))")[0],
          "if (/^apps\\/backend\\/comfyui\\/workflows\\/.*/.test(f))")
    check("r2-keep-image-engine", apply_form_rules("engines/image_engine/comfyui_bridge.py")[0],
          "engines/image_engine/comfyui_bridge.py")
    # 引号分段路径构造形态规则1/2 不触(留给 D 组逐字精确串处理)
    quoted = 'W = _ROOT / "apps" / "backend" / "engines" / "comfyui" / "workflows"'
    _qc, _qn = apply_form_rules(quoted)
    check("r2-keep-quoted-segments", (_qc, any(_qn.values())), (quoted, False))
    check("r2-keep-prose-sep", apply_form_rules("engines、comfyui 两域")[0],
          "engines、comfyui 两域")

    # 规则3:节点件深度锚(合成样例)
    node_sample = (
        "def _daojie_data(fn):\n"
        '    """候选链。"""\n'
        "    _here = Path(__file__).resolve()\n"
        "    _cands = [\n"
        + _P5_LINE_OLD
        + '        _here.parents[4] / "daojie-data",\n'
        + "    ]\n"
    )
    got = node_sample.replace(_P5_LINE_OLD, _P5_LINE_NEW)
    check("r3-node-frontend-line", '_here.parents[4] / "frontend' in got, True)
    check("r3-node-daojie-untouched", '_here.parents[4] / "daojie-data"' in got, True)
    check("r3-node-no-p5-left", "_here.parents[5]" in got, False)

    # 幂等:后置态再跑规则1/2 零变化
    post_state = "from comfyui import engine_manager; backend/comfyui/tests"
    check("idempotent", apply_form_rules(post_state)[1], {"rule1": 0, "rule2": 0})

    # 三形态判据与规则自洽:规则输出态必为零命中
    sample = "from engines.comfyui import x\nREPO/apps/backend/engines/comfyui/tests\n"
    transformed, _ = apply_form_rules(sample)
    check("post-forms-zero", any(form_hits(transformed).values()), False)
    return failures


def selftest_invert_roundtrip() -> list[str]:
    """临时目录内:内容变换+日志 → 反演 → 字节全等。"""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        tdir = Path(td)
        f = tdir / "sample.py"
        original = (
            "from engines.comfyui import plugin_manager\n"
            "# path apps/backend/engines/comfyui/tests\n"
            "REPO = Path(__file__).resolve().parents[5]\n"
        )
        f.write_text(original, encoding="utf-8")
        backup = tdir / "backup.py"

        content = f.read_text(encoding="utf-8")
        backup.write_text(content, encoding="utf-8")
        content, counts = apply_form_rules(content)
        old = "REPO = Path(__file__).resolve().parents[5]"
        new = "REPO = Path(__file__).resolve().parents[4]"
        if content.count(old) != 1:
            failures.append("roundtrip: D 旧串计数≠1")
            return failures
        content = content.replace(old, new)
        post_sha = sha256_bytes(content.encode("utf-8"))
        f.write_text(content, encoding="utf-8")

        # 反演
        if sha256_bytes(f.read_bytes()) != post_sha:
            failures.append("roundtrip: post 哈希不符")
            return failures
        f.write_text(backup.read_text(encoding="utf-8"), encoding="utf-8")
        if f.read_text(encoding="utf-8") != original:
            failures.append("roundtrip: 反演结果与原文不全等")
    return failures


def cmd_selftest() -> int:
    print("== comfyui_relocation_1022 --selftest ==")
    failures: list[str] = []
    pre_phase = SRC.is_dir() and not DST.exists()
    post_phase = not SRC.exists() and DST.is_dir()
    if not pre_phase and not post_phase:
        die("selftest: 工作树既非迁移前(SRC 在/DST 无)也非迁移后(SRC 无/DST 在),无法定相")

    if pre_phase:
        ok("相位=迁移前(SRC 在位,DST 不存在)")
        failures += structural_hard_checks()
        # Q1-A 战役区域干净度:selftest 只警示(CP0/正式 Phase A 才致命)
        for line in campaign_area_cleanliness()[:5]:
            print(f"[warn] 并行役在途件(CP0 发车门闩,不阻 selftest): {line}")
        failures += verify_gate_anchors(post=False)
        failures += verify_exact_anchors(D_GROUP, post=False, label="D组")
        failures += verify_exact_anchors(RULE4_EDITS, post=False, label="规则4")
        failures += verify_rule5_anchors(post=False)
        # 权威清单件在位性(旧位)
        missing = [p for p in IMPACT_SCAN_LIVE if not (REPO / p).is_file()]
        if missing:
            failures.append(f"impact-scan 清单件缺失(旧位): {missing[:5]}")
        missing_new = [p for p in NEW_SINCE_SCAN if not (REPO / p).is_file()]
        if missing_new:
            failures.append(f"新增件缺失: {missing_new}")
        missing_docs = [p for p in DOCS_LIVE if not (REPO / p).is_file()]
        if missing_docs:
            failures.append(f"活文档清单件缺失: {missing_docs}")
    else:
        ok("相位=迁移后(SRC 消失,DST 在位)")
        failures += structural_postchecks()
        failures += verify_gate_anchors(post=True)
        failures += verify_exact_anchors(D_GROUP, post=True, label="D组")
        failures += verify_exact_anchors(RULE4_EDITS, post=True, label="规则4")
        failures += verify_rule5_anchors(post=True)

    failures += rule_unit_tests()
    failures += selftest_invert_roundtrip()

    if failures:
        print(f"\n[FAIL] selftest {len(failures)} 项红:")
        for f in failures:
            print("  -", f)
        return 1
    ok("锚点矩阵全命中 + 规则单测 + 反演往返 全绿")
    return 0


# ----------------------------------------------------------------------------
# --dry-run:零写入对账
# ----------------------------------------------------------------------------

def cmd_dry_run() -> int:
    print("== comfyui_relocation_1022 --dry-run(零写入)==")
    status_before = git_status_porcelain()
    failures: list[str] = []

    failures += structural_prechecks()
    failures += verify_gate_anchors(post=False)
    failures += verify_exact_anchors(D_GROUP, post=False, label="D组")
    failures += verify_exact_anchors(RULE4_EDITS, post=False, label="规则4")
    failures += verify_rule5_anchors(post=False)

    agg, counts = discover_form_files()
    recon = reconcile_against_authority(counts)
    print(f"实测命中: form1={len(agg['form1'])} 件 form2={len(agg['form2'])} 件 "
          f"form3={len(agg['form3'])} 件 / 权威清单 {recon['authority_size']} 件")
    agg_counts = {
        "form1_hits": sum(v["form1_engines_dot_comfyui"] for v in counts.values()),
        "form2_hits": sum(v["form2_engines_sep_comfyui"] for v in counts.values()),
        "form3_hits": sum(v["form3_parents5_frontend"] for v in counts.values()),
    }
    print(f"命中处数: {agg_counts}")
    if not recon["clean"]:
        failures.append(
            f"对账差集非空: 新增未入账 {recon['discovered_not_expected'][:8]} / "
            f"清单已失活 {recon['expected_not_discovered'][:8]}")

    # 预览:替换文件计数(规则1/2)与 D/规则4 逐条已由锚点校验覆盖
    planned = sorted(counts)
    preview = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "git_head": git_head(),
        "mode": "dry-run",
        "planned_rule12_files": len(planned),
        "planned_rule12": {p: counts[p] for p in planned},
        "d_group_sites": [
            {"path": e["path"], "group": e.get("group", e.get("name")),
             "sites": len(e["replacements"])}
            for e in D_GROUP + RULE4_EDITS
        ],
        "reconciliation": recon,
        "form_totals": agg_counts,
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / "dry-run-report.json").write_text(
        json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")
    ok(f"预览落 {rel(REPORT_DIR / 'dry-run-report.json')}(git 不入)")

    if git_status_porcelain() != status_before:
        failures.append("dry-run 期间工作树状态变化(应零写入)")

    if failures:
        print(f"\n[FAIL] dry-run {len(failures)} 项红:")
        for f in failures:
            print("  -", f)
        return 1
    ok("dry-run 全绿:锚点全命中、对账差集为空、零写入")
    return 0


# ----------------------------------------------------------------------------
# 正式模式
# ----------------------------------------------------------------------------

def cmd_execute() -> int:
    print("== comfyui_relocation_1022 正式迁移 ==")
    t0 = time.time()

    # ---- Phase A:前置自检(任一红=零写入终止) ----
    print("-- Phase A 前置自检 --")
    failures: list[str] = []
    failures += structural_prechecks()
    failures += verify_gate_anchors(post=False)
    failures += verify_exact_anchors(D_GROUP, post=False, label="D组")
    failures += verify_exact_anchors(RULE4_EDITS, post=False, label="规则4")
    failures += verify_rule5_anchors(post=False)
    agg, counts = discover_form_files()
    recon = reconcile_against_authority(counts)
    pre_counts = {
        "form1_files": len(agg["form1"]),
        "form1_hits": sum(v["form1_engines_dot_comfyui"] for v in counts.values()),
        "form2_files": len(agg["form2"]),
        "form2_hits": sum(v["form2_engines_sep_comfyui"] for v in counts.values()),
        "form3_files": len(agg["form3"]),
        "form3_hits": sum(v["form3_parents5_frontend"] for v in counts.values()),
    }
    print(f"迁移前计数: {pre_counts}")
    if not recon["clean"]:
        failures.append(f"对账差集非空: {recon}")
    # 门禁目标件在位(工作流三件+契约四件,迁移前旧位)
    for wf in [
        "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
        "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
        "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json",
    ]:
        if not (REPO / wf).is_file():
            failures.append(f"WORKFLOW_TARGETS 件缺失: {wf}")
    status_snapshot = git_status_entries()
    tracked_src = run_git("ls-files", "--", SRC_REL).stdout.splitlines()
    if not tracked_src:
        failures.append("git ls-files 源目录零追踪件(异常)")
    if failures:
        print("[FAIL] Phase A 红,零写入终止:")
        for f in failures:
            print("  -", f)
        return 1
    ok(f"Phase A 全绿:锚点全命中、对账差集空、源区 {len(tracked_src)} 追踪件、树净")

    # ---- Phase B:执行 ----
    print("-- Phase B 执行:清缓存 → git mv → 分组替换 --")
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    if BACKUP_DIR.exists():
        shutil.rmtree(BACKUP_DIR)
    BACKUP_DIR.mkdir(parents=True)

    # B1 清 __pycache__/.DS_Store(git 不追踪,免随迁垃圾)
    cleaned = {"pycache": 0, "ds_store": 0}
    for dirpath, dirnames, filenames in os.walk(SRC):
        for d in list(dirnames):
            if d == "__pycache__":
                shutil.rmtree(Path(dirpath) / d)
                dirnames.remove(d)
                cleaned["pycache"] += 1
        for fn in filenames:
            if fn == ".DS_Store":
                (Path(dirpath) / fn).unlink()
                cleaned["ds_store"] += 1
    ok(f"清缓存: __pycache__×{cleaned['pycache']} .DS_Store×{cleaned['ds_store']}")

    # B2 git mv(整目录物理迁移,runs/ 等未追踪件随迁)
    run_git("mv", SRC_REL, DST_REL)
    ok(f"git mv {SRC_REL} → {DST_REL}")

    log_files: list[dict] = []

    def record_change(cur_rel: str, pre_rel: str, pre_content: str,
                      post_content: str, rule_counts: dict, exact_names: list[str]) -> None:
        pre_b = pre_content.encode("utf-8")
        post_b = post_content.encode("utf-8")
        idx = f"{len(log_files):04d}"
        bdir = BACKUP_DIR / f"{idx}_{cur_rel.replace('/', '__')}"
        bdir.write_bytes(pre_b)
        log_files.append({
            "path": cur_rel, "pre_path": pre_rel,
            "pre_sha256": sha256_bytes(pre_b), "post_sha256": sha256_bytes(post_b),
            "backup": rel(bdir), "rules": rule_counts, "exact": exact_names,
        })

    # B3 规则1/2:活区全量(迁后树)
    rule_totals = {"rule1": 0, "rule2": 0}
    rule_file_counts = {"rule1": 0, "rule2": 0}
    rule_files = 0
    for r in iter_live_files():
        target = REPO / r
        try:
            content = target.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        new_content, n = apply_form_rules(content)
        if not any(n.values()):
            continue
        record_change(r, reverse_remap(r), content, new_content, n, [])
        target.write_text(new_content, encoding="utf-8")
        rule_files += 1
        for k in ("rule1", "rule2"):
            if n[k]:
                rule_totals[k] += n[k]
                rule_file_counts[k] += 1
    ok(f"规则1/2 完成: {rule_files} 件替换 (rule1={rule_totals['rule1']}"
       f"/{rule_file_counts['rule1']}件 rule2={rule_totals['rule2']}"
       f"/{rule_file_counts['rule2']}件)")

    # B4 规则3:D 组逐字精确串(路径重映射至迁后位)
    d_applied = 0
    for entry in D_GROUP + RULE4_EDITS:
        path_new = remap(entry["path"])
        target = REPO / path_new
        content = target.read_text(encoding="utf-8")
        pre = content
        names: list[str] = []
        n_rules: dict = {}
        for old, new, count in entry["replacements"]:
            got = content.count(old)
            if got != count:  # Phase A 已验;迁后树再失配=中止(fail-closed)
                print(f"[FAIL] D组迁后失配 {path_new}: 计数 {got}≠{count}")
                _write_report_and_log(
                    status_snapshot, tracked_src, pre_counts, recon, rule_totals,
                    rule_file_counts, rule_files, d_applied, log_files, t0,
                    post_checks={"aborted": f"D组迁后失配 {path_new}"})
                return 2
            content = content.replace(old, new)
            names.append(entry.get("group") or entry.get("name") or "exact")
        if content != pre:
            record_change(path_new, entry["path"], pre, content, n_rules, names)
            target.write_text(content, encoding="utf-8")
            d_applied += len(entry["replacements"])
    ok(f"规则3(D组+规则4)完成: {d_applied} 处精确替换")

    # B5 规则5:flux3 批准链重钉(主会话授权;sha 全程序化,逐件进日志)
    try:
        rule5_ledger = apply_rule5(record_change)
        ok(f"规则5 完成: receipt 新 sha={rule5_ledger['receipt_new_sha256'][:16]}… "
           f"({len(rule5_ledger['edits'])} 笔重钉账)")
    except (RuntimeError, KeyError, json.JSONDecodeError) as e:
        print(f"[FAIL] 规则5失配: {e}")
        _write_report_and_log(
            status_snapshot, tracked_src, pre_counts, recon, rule_totals,
            rule_file_counts, rule_files, d_applied, log_files, t0,
            post_checks={"aborted": f"规则5失配: {e}"},
            rule5_ledger=None)
        return 2

    # ---- Phase C:收尾自检(任一红=全量清单+非零退出) ----
    print("-- Phase C 收尾自检 --")
    post_fail: list[str] = []
    post_fail += structural_postchecks()
    post_fail += verify_gate_anchors(post=True)
    post_fail += verify_exact_anchors(D_GROUP, post=True, label="D组")
    post_fail += verify_exact_anchors(RULE4_EDITS, post=True, label="规则4")
    post_fail += verify_rule5_anchors(post=True)

    # C1 三形态旧串零残留(排除本脚本自身)
    residue: dict[str, list[str]] = {"form1": [], "form2": [], "form3": []}
    residue_counts: dict[str, int] = {"form1": 0, "form2": 0, "form3": 0}
    parents6_left: list[str] = []
    for r in iter_live_files():
        try:
            content = (REPO / r).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        h = form_hits(content)
        if h["form1_engines_dot_comfyui"]:
            residue["form1"].append(r)
            residue_counts["form1"] += h["form1_engines_dot_comfyui"]
        if h["form2_engines_sep_comfyui"]:
            residue["form2"].append(r)
            residue_counts["form2"] += h["form2_engines_sep_comfyui"]
        if h["form3_parents5_frontend"]:
            residue["form3"].append(r)
            residue_counts["form3"] += h["form3_parents5_frontend"]
        if "parents[6]" in content and r.startswith("apps/"):
            parents6_left.append(r)
    for form, files in residue.items():
        if files:
            post_fail.append(f"三形态残留 {form}: {files[:6]}")
    if parents6_left:
        post_fail.append(f"parents[6] 残留(D组深度锚补充判据): {parents6_left[:6]}")

    # C2 git status 改动集 ⊆ 预期集(-z 结构化解析,防特殊字符路径引号失真)
    expected_paths: set[str] = set()
    for p in tracked_src:
        expected_paths.add(p)
        expected_paths.add(remap(p))
    for p in list(counts) + [e["path"] for e in D_GROUP + RULE4_EDITS] + \
            [ENGINES_INIT_REL] + FORM_EXPECTED_SET:
        expected_paths.add(p)
        expected_paths.add(remap(p))
    snapshot_keys = {f"{c} {p} -> {o}" if o else f"{c} {p}"
                     for c, p, o in status_snapshot}
    unexpected: list[str] = []
    for code, path, old in git_status_entries():
        preexisting = (f"{code} {path} -> {old}" if old else f"{code} {path}") in snapshot_keys
        for p in [path] + ([old] if old else []):
            if preexisting or p in expected_paths or p == SELF_REL \
                    or p.startswith("apps/output/"):
                continue
            unexpected.append(f"{code} {path}" + (f" -> {old}" if old else ""))
            break
    if unexpected:
        post_fail.append(f"改动越界(非预期集): {unexpected[:8]}")

    # C3 import 冒烟
    proc = subprocess.run(
        [sys.executable, "-c", "import comfyui, comfyui.plugin_manager"],
        cwd=REPO / "apps/backend", capture_output=True, text=True,
        env={**os.environ, "PYTHONPATH": "backend"})
    smoke = proc.returncode == 0
    if not smoke:
        post_fail.append(f"import 冒烟红: {proc.stderr.strip()[:200]}")

    # C4 conftest BACKEND_ROOT 断言(加载迁后 conftest,断言解析=apps/backend)
    conftest_rel = "apps/backend/comfyui/tests/conftest.py"
    backend_root = REPO / "apps/backend"
    conftest_code = (
        "import importlib.util, pathlib, sys\n"
        f"spec = importlib.util.spec_from_file_location('cf', {str(REPO / conftest_rel)!r})\n"
        "m = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(m)\n"
        f"sys.exit(0 if m.BACKEND_ROOT == pathlib.Path({str(backend_root)!r}) else 3)\n"
    )
    proc2 = subprocess.run([sys.executable, "-c", conftest_code],
                           capture_output=True, text=True)
    conftest_ok = proc2.returncode == 0
    if not conftest_ok:
        post_fail.append(f"conftest BACKEND_ROOT 断言红: rc={proc2.returncode} {proc2.stderr.strip()[:200]}")

    report = _write_report_and_log(
        status_snapshot, tracked_src, pre_counts, recon, rule_totals,
        rule_file_counts, rule_files, d_applied, log_files, t0,
        post_checks={
            "residue_three_forms": {k: len(v) for k, v in residue.items()},
            "residue_three_form_hits": residue_counts,
            "residue_parents6_files": len(parents6_left),
            "changed_subset_expected": not unexpected,
            "unexpected_entries": unexpected,
            "smoke_import_comfyui": "pass" if smoke else "FAIL",
            "conftest_backend_root": "pass" if conftest_ok else "FAIL",
        },
        rule5_ledger=rule5_ledger)

    if post_fail:
        print(f"\n[FAIL] Phase C {len(post_fail)} 项红(工作树已迁移,可 --invert 反演):")
        for f in post_fail:
            print("  -", f)
        return 2
    ok(f"Phase C 全绿;对账 JSON → {rel(REPORT_PATH)}")
    print(f"正式迁移完成({time.time() - t0:.1f}s),replacement-log → {rel(LOG_PATH)}")
    return 0


def _write_report_and_log(status_snapshot, tracked_src, pre_counts, recon,
                          rule_totals, rule_file_counts, rule_files, d_applied,
                          log_files, t0, post_checks, rule5_ledger=None) -> dict:
    head = git_head()
    log = {
        "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "git_head": head,
        "git_mv": {"src": SRC_REL, "dst": DST_REL,
                   "tracked_files": len(tracked_src)},
        "pre_status_snapshot": status_snapshot,
        "files": log_files,
    }
    LOG_PATH.write_text(json.dumps(log, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    report = {
        "mode": "execute",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "git_head": head,
        "duration_s": round(time.time() - t0, 1),
        "pre": pre_counts,
        "reconciliation": recon,
        "new_since_scan": NEW_SINCE_SCAN,
        "rules": {
            "rule1_engines_dot": {"files": rule_file_counts.get("rule1", 0),
                                  "hits": rule_totals.get("rule1", 0)},
            "rule2_engines_sep": {"files": rule_file_counts.get("rule2", 0),
                                  "hits": rule_totals.get("rule2", 0)},
            "rule12_files_union": rule_files,
            "rule3_d_group_sites": d_applied,
            "d_group_breakdown": {
                g: len([e for e in D_GROUP if e.get("group") == g])
                for g in sorted({e.get("group") for e in D_GROUP})},
            "rule4_special_notes": [e["name"] for e in RULE4_EDITS],
        },
        "git_mv": {"src": SRC_REL, "dst": DST_REL, "tracked_files": len(tracked_src)},
        "post_checks": post_checks,
        "rule5_approval_repins": rule5_ledger,
        "files_changed": len(log_files),
        "backup_dir": rel(BACKUP_DIR),
        "log": rel(LOG_PATH),
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2),
                           encoding="utf-8")
    return report


# ----------------------------------------------------------------------------
# --invert:按替换日志反演
# ----------------------------------------------------------------------------

def cmd_invert() -> int:
    print("== comfyui_relocation_1022 --invert(按替换日志反演)==")
    if not LOG_PATH.is_file():
        die(f"替换日志缺失: {rel(LOG_PATH)}(无日志不可反演;已提交请走 git revert)")
    log = json.loads(LOG_PATH.read_text(encoding="utf-8"))
    if not BACKUP_DIR.is_dir():
        die(f"备份目录缺失: {rel(BACKUP_DIR)}")

    head = git_head()
    if log.get("git_head") != head:
        die(f"日志锚定 commit {log.get('git_head')[:12]} ≠ 当前 HEAD {head[:12]}"
            "(迁移后已有新提交——请走 git revert <迁移commit>,勿用 --invert)")

    if DST.is_dir() and SRC.exists():
        die("源/目标同时在位,状态异常,拒绝反演")

    # 1)逐件校验:同路径多条目(先规则1/2 后精确串)按链校验——
    #    链内 post[i]==pre[i+1],当前字节==链尾 post;还原取链首备份(原始态)
    by_path: dict[str, list[dict]] = {}
    for entry in log["files"]:
        by_path.setdefault(entry["path"], []).append(entry)
    drifted: list[str] = []
    for path, entries in by_path.items():
        for a, b in zip(entries, entries[1:]):
            if a["post_sha256"] != b["pre_sha256"]:
                drifted.append(f"链断裂 {path}")
        target = REPO / path
        if not target.is_file():
            drifted.append(f"缺失 {path}")
            continue
        if sha256_bytes(target.read_bytes()) != entries[-1]["post_sha256"]:
            drifted.append(f"漂移 {path}")
    if drifted:
        die("反演前置红(下列文件在迁移后被改动,强反演会吞改动):\n  " + "\n  ".join(drifted[:10]))

    # 2)还原内容(日志路径=迁后位;未迁件同位;取链首备份=迁移前原始字节)
    for path, entries in by_path.items():
        backup = REPO / entries[0]["backup"]
        (REPO / path).write_bytes(backup.read_bytes())
    ok(f"内容还原 {len(by_path)} 件(日志条目 {len(log['files'])} 条)")

    # 3)git mv 反向
    if DST.is_dir() and not SRC.exists():
        run_git("mv", DST_REL, SRC_REL)
        ok(f"git mv {DST_REL} → {SRC_REL}")
    else:
        ok("目录已在源位(仅内容反演)")

    # 4)终态校验:战役区域 git 状态 ⊆ 迁移前快照
    pre_keys = {f"{c} {p} -> {o}" if o else f"{c} {p}"
                for c, p, o in log.get("pre_status_snapshot", [])}
    leftover = [f"{c} {p}" + (f" -> {o}" if o else "")
                for c, p, o in git_status_entries()
                if (f"{c} {p} -> {o}" if o else f"{c} {p}") not in pre_keys
                and p != SELF_REL and not p.startswith("apps/output/")]
    if leftover:
        print(f"[WARN] 反演后仍有非快照状态项(需人工核): {leftover[:6]}")
        return 3
    ok("反演完成:内容全等还原 + 目录回迁 + 状态回到迁移前快照")
    return 0


# ----------------------------------------------------------------------------
# 入口
# ----------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="comfyui 包迁移战役脚本(10-22-comfyui-relocation;fail-closed)")
    parser.add_argument("--selftest", action="store_true",
                        help="锚点全命中自检 + 替换规则单测(零写入)")
    parser.add_argument("--dry-run", action="store_true",
                        help="零写入对账:锚点校验 + impact-scan 活区清单对账")
    parser.add_argument("--invert", action="store_true",
                        help="按 apps/output/comfyui-relocation-1022/replacement-log.json 反演")
    args = parser.parse_args()

    if args.selftest:
        return cmd_selftest()
    if args.dry_run:
        return cmd_dry_run()
    if args.invert:
        return cmd_invert()
    return cmd_execute()


if __name__ == "__main__":
    sys.exit(main())
