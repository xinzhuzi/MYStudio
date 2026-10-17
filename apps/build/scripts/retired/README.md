# retired/ —— 已花战役脚本归档(1016-10-16 用户令:全目录常驻/已花/在途三分)

归档件=已完成使命的一次性战役脚本(真源/工作流已是其 NEW 态,或其产出已提交)。
**仅作历史收据查阅,不再可执行**——内部互引与 `__file__` 推根路径未随迁移改写
(如 color_hierarchy 引 multicolor、ref5to3 引 ref5);复跑考古用
`git log --follow -- apps/build/scripts/<件名>` 取回原位语境。

三分口径与取证器:`../scripts_retention_audit.py`(引用分类/互引闭包/git 状态/
pycache 执行余温);判定权在人,工具只出证据。

## 役组台账

| 役组 | 件 | 说明 |
|---|---|---|
| 1016 底座换血三代机壳 | qi21_base_multicolor_swap_1016 / qi21_color_hierarchy_1016 / qi21_base_duocai_final_1016 / qi21_base_zhongcai_swap_1016 | 墨彩翻转+多彩+工笔重彩;继任者=`../qi21_base_swap_tool.py`+`../qi21_base_swap_configs/` |
| 1016 色彩层级验证腿 | qi21_color_hierarchy_verify_1016.py | 上组闭包补齐(主件先退役,验证腿随组) |
| 1010 型文手术族 | qi21_daoju_peibi_surgery_1010 / qi21_face_transparent_surgery_1010 / qi21_transparent_types_surgery_1010 / qi21_duocai_fourtypes_surgery_1010 / qi21_fenjing_duocai_surgery_1010 | 型文层五刀,成果已在 qi21_bases.json 各代真源;hygiene 豁免随役出账 |
| 1010 i2i 参考图五槽扩展 | qi21_i2i_ref5_1010 / qi21_i2i_ref5to3_1010 | 双脚本互引成组走;工作流 i2i.json Note 中的手术史叙事保留原词 |
| 1010 AB/实弹 | qi21_27b_newname_fire_1010 / qi21_7027_ab_fire_1010 / qi21_7027_ab_handmetrics_1010 | 27B 换件与 7027 A/B 实弹收据 |
| 1010 杂件 | daojie_fisher_pose_wf_1010 / docs_archive_cleanup_1010 | Fisher-Pose 工作流建件(役毕候令装,未装)/docs 归档清理 |
| 1014 i2i 重构族 | qi21_i2i_9type_semantic_1014 / qi21_i2i_9type_sweep_1014 / qi21_i2i_anchor_probe_1014 / qi21_i2i_transparent_anchor_1014 / qi21_i2i_viggle_resrc_1014 / qi21_i2i_viggle_sigma_1014 | 九型语义/透明锚/viggle 资源σ链六刀,成果已在 i2i 工作流 |
| 1014 misc | h3_upgrade_1014 / vl_judge_1014 | H3 v1.2 全量升级(幂等,manifest 留 `../backups/`)/VL 判图器(判图已改本机 Vision+像素指标) |
| 1015 i2i 蓝图族 | qi21_i2i_encoders_out_1015 / qi21_i2i_note402_09spec_1015 / qi21_i2i_note_types_1015 / qi21_i2i_output_group_1015 / qi21_i2i_r33_relayout_1015 / qi21_i2i_sg6_relayout_1015 / qi21_i2i_title6_restore_1015 / qi21_i2i_wh_bytype_1015 / qi21_i2i_grouptitle_shorten_1015 | i2i 画布历次重排/编码器出子图/组框瘦身等,成果均在已提交工作流;清单.md 内手术史叙事保留原词 |
| 1015 资产归 store | asset_land_1015.py | 资产归位役收据(役毕 Oct-15) |
| 层冲突手术族 | qi21_layer_conflict_distribute / qi21_layer_conflict_snapshots / qi21_layer_conflict_splice / test_qi21_layer_conflict_splice | 型文层冲突拆分(脚本+测试成组,测试不入口禁清单) |

## 留守 notable(有引用/在途而未归档)

- `img_stat_1014.py` 顶层留守:被常驻 `qi21_i2i_workflow_fire.py` import(依赖闭包实证),已补 hygiene 豁免,候选改名轮去日期名。
- `qi21_i2i_alpha_wash_1015.py`、`qi21_accel_turbo_1016.py` 顶层留守:被 engines 契约测试 `test_qwen21_workflow_contract.py` 引用。
- 1016 现役诸族(charsheet/painterly 硬朗/style_type/revision/five_method/turbo/i2i-1016/flux3_daojie)全部冻结原位——并行会话在途,役毕再走本归档流程。
