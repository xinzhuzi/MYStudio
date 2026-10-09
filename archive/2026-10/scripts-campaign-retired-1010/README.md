# 战役脚本退役归档(2026-10-10 清理役)

用户令「清理临时性质代码」收敛:apps/build/scripts/ 顶层 70 件役毕战役脚本
(日期后缀 `_09XX`/`_100X` 形态+hygiene 豁免表滞留件)git mv 至此,移回即恢复。
配套:`../campaigns-retired-1010/`(战役 run 产物域 341 项)、`../backups-retired-1010/`
(1008-1009 手术前备份 16 组)。

## 白名单保留(仍在 scripts/ 顶层,勿归档)
- `qi21_t2i_workflow_fire.py` 出图唯一正器(用户令)
- `qi21_img2img_build_1009.py` + `qi21_img2img_layout_1009.json`(1009 令保留)
- `daojie_charsheet_logic.py`(K2 常驻)
- `pe_final_fetch_1004.py`(PE 终稿取件器)/ `daojie_canon_lib.py`(canon 词库)
- 门禁/工具全家:hygiene/preflight/commit/workflow_gate、engine_doctor、
  canvas_deploy/verify 系、daojie-t2i-app-e2e.mjs、lmstudio-* 运维、
  comfy_bare_engine_restart.py、campaign_closeout_audit 及 CI 清单内 test_*
- 1010 在途四件(qi21_*_1010)随并行役,役毕后另批归档
