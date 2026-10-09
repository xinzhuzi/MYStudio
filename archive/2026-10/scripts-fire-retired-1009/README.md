# 历史发车件退役(1009 用户令:「历史发车件无用的都清理,只用 qi21_t2i_workflow_fire.py」)

现役出图唯一入口 = `apps/build/scripts/qi21_t2i_workflow_fire.py`(跑 qi21-道劫-t2i.json 工作流本体,随机种子)。
i2i 线现役 = `qi21_facegrid_img2img_fire_1009.py`(跑 qi21-道劫-img2img.json);消融编排 = `qi21_hdface_ablation_viggle_1009.py`(逐臂调 fire)。

本目录收编退役发车件(自建图时代产物,已收官战役记录,勿再用于新出图):
- b4_duipai_run_0930.py — 0930 B4 对拍直写九件图
- qi21_rgba_lean_refire_1008.py — 1008 透明极简修复复射
- qi21_edit_funacc_matrix_1003.mjs — 1003 edit×FunAcc 可行性矩阵
- qi21_usertest_livefire_1001.mjs — 1001 用户测试批实弹
- qi21-dedup-livefire.mjs — 1005 提示词去重实弹验证
- qwen21_multiref_fire_1002.mjs / qwen21_sancai_ab_1002.mjs / qwen21_titlecard_fire_1002.mjs / qwen21_daotu_rgba_fire_1002.mjs / qwen21_t2i_seedvr2_fire_1002.mjs / qwen21_pose_edit_fire_1002.mjs — 1002 系实验驱动

未收编:q21_optimized_round_0925.mjs(当日 17:27 仍被并行会话编辑,未证明无用,留位候查)。
另见 archive/2026-10/scripts-t2i-consolidated-1009/(同日 R3 九型驱动退役)。

## 二轮追收(同日 18:07,用户令「以后只用 qi21_t2i_workflow_fire.py,其他的清理」)

- qi21_hdface_ablation_viggle_1009.py — 高清人脸四臂消融编排(实验已收官,hdface-d-landing 17:59 终产物在 apps/output/hdface-d-landing-1009)
- qi21_facegrid_img2img_fire_1009.py — 表情差分九宫格图生图驱动(实验产物在 apps/output/facegrid-posmap-1009;i2i 工作流体 qi21-道劫-img2img.json 仍在库;要再用从本目录移回即可)
- q21_optimized_round_0925.mjs — 0925 K2 系发车件(17:27 后无动静,静默窗口收编)

至此 apps/build/scripts 出图发车件仅剩 qi21_t2i_workflow_fire.py(唯一入口,跑 qi21-道劫-t2i.json 本体)。

## 三轮追收(同日深夜,用户令「以后都用 qi21_t2i_workflow_fire.py,其他的都清理下吧」)

- qi21_viggle_v03_ab_1008.py — viggle v0.3 换件 A/B 射手(实验收官 1008,换件+默认档已落地)
- qi21_apipe_thinking_ab_1007.py — [4013] 思考档位 A/B 射手(实验收官 1007,档位下拉已入节点)
- colorline-ab-shots-1004.mjs — 多彩行 A/B 三发直排(实验收官 1004,多彩行已落型文)

分类保留(非发车件,勿误清):qi21_daojie_t2i_0923/i2i_0924/qwen21_edit_core_pe_0923=工作流幂等生成器(已破勿重跑,三处警示在案:workflow_gate.py/cards_refresh/画布布局规范);qi21_img2img_build_1009.py=img2img 工作流建件(1009 在途用户令「严格经典图生图 denoise 0.5~0.7」);daojie_charsheet_logic.py=K2 角色设定表两步链常驻件(09-22 提升令);qi21_facegrid_count_1009.py=数脸验收器;qi21_facegrid_label_1009.py=格名标注;qi21_facegrid_posmap_1009.py=逐格点位部署手术。
