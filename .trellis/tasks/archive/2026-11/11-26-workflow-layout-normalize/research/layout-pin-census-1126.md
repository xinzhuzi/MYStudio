# 钉死面普查:改工作流布局会碰到哪些既有契约(2026-11-26 实查)

> 目的:布局整治只动 `pos`/`size`/组框/视图态,但这些文件被测试、基线、生成器、前端副本以各种方式钉着。
> 逐类给出**钉什么、谁钉的、动了以后要同步什么**。路径均为仓库相对路径;行号为 1126 实读。

## 总表(149 件 GUI 工作流)

| 类 | 钉法 | 涉及件 | 动布局后必须同步 |
|---|---|---|---|
| P0 官方/原件 | 上游逐字节 | QwenImage2.1/0_官方模板 3 件(测试钉 SHA);SenseNova/0_官方模板 2 件(清单注记,无测试钉);`340-*萝卜原件` 2 件(命名=作者原版留档) | **不能动**;Qwen 三件动了测试即红 |
| P1 生成器重导出逐字节 | 文件字节==生成器 `render()` | `sn-道劫-t2i/-api/-i2i/-api` 4 件 | 改生成器 `sensenova_daojie_build_1126.py` 的布局段后重导出,不能手改 JSON |
| P2 收据 SHA(含用户批准记录) | 工作流字节哈希写进收据,收据另钉用户批准消息 | `flux3-道劫-t2i.json` | 重钉收据=改写一份带「用户说好」的批准记录,须用户明令 |
| P3 守护脚本已审 SHA | `PATCHED_SHA256` 钉工作流字节 | `qi21-道劫-换脸-局部重绘.json` | 同批更新 `qi21_local_face_mask_repair_1027.py` 的 SHA 常量 |
| P4 棘轮基线 | 按作用域钉 交叉数/线遮数,只降不升 | `qi21-道劫-t2i.json`、`qi21-道劫-i2i.json`、`qi21-edit.json` | 过 `workflow_gate.py` 段3;降了可用 `--rebuild-baseline` 拧紧 |
| P5 坐标/组框哨兵 | 测试里直接断言坐标、组框、相对位置 | 见下表 | 契约锚随行同步(立宪文档 §四明许「契约锚随行同步」) |
| P6 蓝图全等 | 子图定义与蓝图「除 id 外全等」 | qi21 三件的子图 ↔ `my_nodes/subgraphs/qi21-*.json` 9 件 | 蓝图同批双刷(仓库+装机) |
| P7 前端副本 | 前端模板与仓库件逐字节/逐坐标对拍 | `fasth3-单镜视频-i2v.json`、`一镜到底-分段.json` | 重生成/重拷前端模板 |
| P8 生成器属主(无字节钉) | 重跑生成器会把布局重置回旧值 | 见下表 | 生成器产出后须再跑归一化;用「不动点测试」把门 |
| P9 零引用 | 测试/在役脚本/前端均不引用 | 53 件 | 只需过新门禁 |

## P5 哨兵明细(布局敏感断言所在测试)

| 测试 | 敏感点 | 锚的是「关系」还是「数值」 |
|---|---|---|
| `apps/backend/comfyui/tests/test_qwen21_workflow_contract.py`(83 处) | qi21 三件及 QwenImage2.1 域:主图骨架/宿主层布局/画布归一(零负区、加速框罩成员、组框零重叠)/横向排版左向线豁免集/说明卡置顶/节奏常数 | 多为**关系**(A 在 B 上方、[400] 在 [6] 上方行、说明卡高于一切组框)+ 少量数值锚(豁免集 link id、精确坐标) |
| `test_qi21_local_face_contract.py` | 节点 `size` ≥ est、交叉 ≤29、其余判据全 0、守护脚本幂等 | 数值+幂等 |
| `test_daojie_sheet_card_workflow.py:125` / `test_daojie_sheet_card_qwen_workflow.py:194` | 节点中心落在某组框内 | 关系 |
| `test_three_stage_contract.py:266`、`test_multiseg_full3stage_contract.py:230` | 组框带数、两两不交、节点左上角在组内、pos≥80、连线向右 | 关系 |
| `apps/frontend/lib/comfyui/h3/h3-shot-video-workflow.test.ts:772-825` | 前端界面图节点坐标==画布件坐标;组框除宽度外相同;节点在组内(顶部留 40) | 数值(逐点相等) |

其余 14 个引用工作流的测试只钉结构/语义(类谱、接线、控件值),坐标不敏感。

## P8 生成器属主明细

| 工作流 | 生成器 | 备注 |
|---|---|---|
| `1_图片/MossImage/moss-道劫-t2i.json` | `apps/build/scripts/moss_daojie_build_1108.py` | 测试只对数据文件重导出,不对画布字节 |
| `1_图片/MiniMax/5_角色设定卡/道劫-角色设定卡.json` 及 Qwen 设定卡两件 | `daojie_sheet_workflow_build_1113.py` 等 | 测试只用生成器取提示词 |
| `1_图片/QwenImage2.1/2_图生图/qi21-局部重绘.json` | `qi21_local_inpaint_build_1126.py` | 自 `qi21-edit.json` 派生;edit 整治后重跑即同步 |
| `1_图片/SenseNova/2_图生图/sn-局部重绘.json` + `-api.json` | `sn_local_inpaint_build_1126.py` | 1126 役新建;画布件当前有节点互叠/组框互遮(本役修) |
| `1_图片/Flux.3/flux3-道劫-t2i.json` | `flux3_daojie_workflow.py` | 同时属 P2 |

## 交付落点(改完仓库真源之后)

- 装机 App 只准 `apps/build/packaging/build-mac.sh` 整包覆盖安装;任何役禁止向 `/Applications` 下 App 直写(`.trellis/spec/guides/installed-app-no-direct-write-guide.md`,2026-10-19 用户令)。
- 侧栏 `repo:` 叶子直载读**装机包** `Resources/backend/comfyui/workflows`,不读仓库(node-graph 调用集 INVOCATION.md §6)。所以仓库改完、用户没下打包令之前,App 里看到的仍是旧布局。
- node-graph 调用集里 1006 的「cp 热覆盖装机 Resources」口径与上述 10-19 指南冲突,后者晚出且是用户令;`canvas_deploy.mjs` 的部署模式会直写装机 App,**不可用于部署**,其 `--audit`/`--verify-only` 只读模式仍可用作指纹门。
- Windows 侧:`deploy-dual.sh` Phase B(Win 仓 git pull → 构建 → 安装),须 Mac 侧已提交并推送。

## 引用面怎么查的(可复现)

- 引用测试/脚本/前端:对 149 件按**文件名**在 `apps/backend/comfyui/tests`、`apps/backend/comfyui/my_nodes/tests`、`apps/build/scripts`(不含 `campaigns/`)、`apps/frontend/lib/comfyui`、`apps/frontend/components/panels/comfyui` 内做子串匹配(结果见任务目录外临时件,已删)。按文件名匹配会漏掉「按目录遍历」的测试(如 `K2_DIR.rglob`、`test_comfy_manifest_bridge_workflows`),**执行阶段须以「整治后全量跑测试」为准**,本表只用于事前排兵。

## 更正(1126 晚按实物复核;以本节为准)

1. **P7 前端副本漏了 2 件**。全仓同字节/同结构副本对账(74 个非工作流 JSON 对 149 件 GUI)结果:同字节副本 3 件——`fasth3-单镜视频-i2v.json` → `fasth3-shot-template.json`、`pika-单镜视频-fl2v.json` → `pika-shot-template.json`、`pika-单镜视频-ref2v.json` → `pika-ref-shot-template.json`;另 1 件由画布件生成——`一镜到底-分段.json` → `h3-multiseg-template.json`(`multiseg_ui_template_build.py`)。初版只列了第 1、4 件。
2. **P6 蓝图不能按子图名找宿主**。子图名跨工作流重名(「道劫·加速子图」在 `qi21-道劫-t2i`、`t2i-无审查-超分`、`t2i-皮肤-超分`、`t2i-通用`、`qi21-edit`、`qi21-道劫-i2i` 6 件里都有定义;「[6] 文本提示词类型优化子图」在 4 件里)。逐件对照表见 `design.md` §6。9 件里 `qi21-道劫-二采精修子图.json` 在库里没有同名定义。
3. **P4 棘轮基线的时序**。`workflow_gate.py` 段 3 从 `git show HEAD:` 取数、三件任一有未提交改动时整段 SKIP;`--rebuild-baseline` 同样取已提交版本。所以基线要与工作流同一笔提交更新,或提交后再重建。基线是逐作用域的 `crossings` / `occlusion`(调研档里的 t2i 101、i2i 141 是全文件各作用域合计:54+2+43+0+2 与 92+3+44+0+2)。
4. **整治对象补一个根**:`apps/backend/comfyui/my_nodes/subgraphs/` 下 9 件 qi21 蓝图(顶层 1 个实例节点 + 1 个子图定义,共 18 个作用域)。
5. **检查器全库计时**:158 件(149 + 9)47.5 秒;机器门因此分轻量档与全量档(F18)。
