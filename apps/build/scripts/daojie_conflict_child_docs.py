"""Write PRD/implement for the four children of 10-18-daojie-prompt-conflict-cleanup (planning artifacts only)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
T = ROOT / ".trellis/tasks"
PARENT = "../10-18-daojie-prompt-conflict-cleanup"
M = "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
SCAN = "python3 apps/build/scripts/daojie_prompt_conflict_scan.py --rules-only"
PY = "cd apps/backend/comfyui && python3 -m pytest -q my_nodes/tests tests/test_qwen21_workflow_contract.py -p no:cacheprovider"
VT = "cd apps && npx vitest run --config frontend/config/vite.config.ts"

COMMON = f"""## 共同约束
- 父任务裁定 D1–D15、改写规则与术语映射:`{PARENT}/prd.md`、`{PARENT}/design.md` §3–§4。
- 只改 design.md §2 所有权表中本子任务独占的文件;越界即停。
- 改前 `cp` 备份到本任务 `backups/`;每行改动可追溯到 C 编号。
- 完成门:扫描器本子任务规则 exit 0 + 测试全绿 + check 子代理复核 + pathspec 提交(不 amend 不 push)。
"""

CHILDREN = {
"10-18-daojie-conflict-p0-injection": dict(
 cs="C01,C02,C04,C05", goal="分镜帧正/负向注入块、主风格锁与锚对齐 1018 动漫底座(D2/D11/D12)。",
 req=["R1 storyboard-frame-negative 块删去 cel shading / anime style / cartoon 类风格禁项,保留 photorealistic、paper-wrinkle、bad anatomy、watermark。",
      "R2 storyboard-image-style-tokens 与 :131 正向锚改为 design.md §4 英文 token(ink wash→guofeng 2D anime 口径),muted palette→明快多彩。",
      "R3 主风格锁 :76/:82 及同文件 :11/:43/:68/:123/:136 按术语映射改写,原句入文末「历史口径(1018 前)」。",
      "R4 lock-anchors.json :190/:209 manualAnchors 与 daojie-manual-contract.test.ts 相关断言逐字随动,锚数与断言数不减;LOCK_SNAPSHOT.md 登记 1018 有意差异。",
      "R5 不改 daojie-prompt-contract.ts Avoid 拼接、不改 krea2 模板(N1/N2)。"],
 files=[f"Modify: `{M}/art_prompt/art_storyboard_video.md`", f"Modify: `{M}/ma_sync/lock-anchors.json`", f"Modify: `{M}/ma_sync/LOCK_SNAPSHOT.md`", "Modify: `apps/frontend/lib/studio/daojie-manual-contract.test.ts`", "Verify: `apps/frontend/lib/studio/visual-manual-style-tokens.ts`、`apps/frontend/lib/ai/daojie-prompt-contract.ts`"],
 steps=[("先改测试锚为新措辞(RED)", f"{VT} frontend/lib/studio/daojie-manual-contract.test.ts", "FAIL:新锚在手册中缺失"),
        ("改 storyboard-frame-negative 块(R1)", None, None),
        ("改正向 token 块与 :131(R2)", None, None),
        ("改 :76/:82 主风格锁并同步 lock-anchors.json(R3/R4)", None, None),
        ("改 :11/:43/:68/:123/:136 并写历史小节(R3)", None, None),
        ("GREEN 复跑契约与 token 测试", f"{VT} frontend/lib/studio/daojie-manual-contract.test.ts frontend/lib/studio/visual-manual-style-tokens.test.ts frontend/lib/ai/daojie-prompt-contract.test.ts", "全绿;断言数不少于改前(改前先记录 passed 数)"),
        ("登记 LOCK_SNAPSHOT 有意差异", None, None),
        ("扫描器门", f"{SCAN} C01,C02,C04,C05; echo $?", "0")]),
"10-18-daojie-conflict-p1-canon": dict(
 cs="C10,C11,C12,C13,C14,C15,C16", goal="qi21_bases.json 内部自洽,并把改动镜像到 D4 四件预填(D1/D4/D5/D6/D8)。",
 req=["R1 人物多视图/人物/概念 purpose 与 aspect_ratio、resolution_override、positive_text 一致(D1)。",
      "R2 color_lexicon note `:775` 墨线→彩线口径(D5)。",
      "R3 人物型云雾句与美宣型统一为「淡色罩染分层、层间边界清晰」。",
      "R4 铺满型 color_recipe.base→随场景时段;RGBA 型 base→透明(关闭透明时由主体句给底色);expand_instruction 第七步留白随型(D6)。",
      "R5 删人物系性别鞋履负向串、设定卡「刀身弯曲」、概念「人影,人脸」(D8)。",
      "R6 人物多视图头身比改「服从来源」并补动漫式五官句。",
      "R7 C16 张力项逐条判 done/不修并写理由。",
      "R8 预填四件字符串叶子与真源逐字一致,连线/参数零变动;JSON 旧值写父任务 research/json-before-after.md。"],
 files=[f"Modify: `{M}/json/qi21_bases.json`", "Modify: `apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`", "Modify: `apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json`", "Modify: `apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json`", "Modify: `apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json`", "Modify(随动): `apps/backend/comfyui/my_nodes/tests/*`、`apps/backend/comfyui/tests/test_qwen21_workflow_contract.py`", "Create: `apps/build/scripts/qi21_conflict_snapshot_sync.py`(复用 qi21_base_swap_tool.Tool)"],
 steps=[("记录基线 passed 数", f"{PY} | tail -1", "745 passed"),
        ("先写/改测试断言 R1–R6 新口径(RED)", f"{PY} -x", "FAIL:真源未改"),
        ("写 qi21_conflict_snapshot_sync.py(只换字符串叶子+ledger+sha256)", None, None),
        ("改真源 R1/R2", None, None), ("改真源 R3/R4", None, None), ("改真源 R5/R6", None, None),
        ("跑同步脚本镜像四件预填并逐字核验(R8)", "python3 apps/build/scripts/qi21_conflict_snapshot_sync.py --verify; echo $?", "0;链接/参数 diff 为空"),
        ("GREEN", PY, "全绿,数量只增不减"),
        ("vitest 真源消费方", f"{VT} frontend/lib/ai/daojie-prompt-contract.test.ts frontend/lib/ai/daojie-palette.test.ts", "全绿"),
        ("C16 逐条判定写入 research", None, None),
        ("扫描器门", f"{SCAN} C10,C11,C12,C13,C14,C15,C16; echo $?", "0")]),
"10-18-daojie-conflict-p2-manuals": dict(
 cs="C03,C20,C21,C22,C23,C24,C25,C26,C27", goal="风格手册现行反向条款就地改写+历史小节(D3/D5/D6/D7)。",
 req=["R1 C20 线色、C21 工笔重彩、C22 写实/低对比、C23 留白、C24 晕染泼墨、C25 平涂、C26 纸面/背景/光照、C27 prompt_layering、C03 导演负面模板,按 design.md §4 改写。",
      "R2 原句入各文件末尾「历史口径(1018 前)」并带原行号;JSON 文件旧值入父 research/json-before-after.md。",
      "R3 不触碰 prefix.md :114/:189 与 runtime-contract.json style.gongbi-base 底座原文(已与真源一致)。",
      "R4 art_storyboard_video.md 与 lock-anchors.json 归 P0,本子任务不碰。"],
 files=[f"Modify: `{M}/prefix.md`、`{M}/README.md`", f"Modify: `{M}/style_guide/00_总纲.md`…`07_九型配方.md`", f"Modify: `{M}/art_prompt/art_character.md`、`art_scene.md`、`art_scene_derivative.md`", f"Modify: `{M}/driector_skills/director_planning_style.md`、`director_storyboard.md`、`director_storyboard_table_style.md`", f"Modify: `{M}/json/prompt_layering.json`、`{M}/ma_sync/runtime-contract.json`"],
 steps=[("扫描本子任务规则得基线清单", f"{SCAN} C03,C20,C21,C22,C23,C24,C25,C26,C27 --json", "exit 2,清单与 research/audit 对齐"),
        ("prefix.md 逐条改写(每次 ≤5 处,改后回读)", None, None), ("README.md", None, None),
        ("style_guide 00/01", None, None), ("style_guide 02/03", None, None), ("style_guide 04/05/06", None, None),
        ("art_prompt 三件", None, None), ("driector_skills 三件", None, None), ("prompt_layering.json + runtime-contract.json :112", None, None),
        ("契约测试", f"{VT} frontend/lib/studio/daojie-manual-contract.test.ts frontend/lib/ai/daojie-prompt-contract.test.ts", "全绿"),
        ("扫描器门", f"{SCAN} C03,C20,C21,C22,C23,C24,C25,C26,C27; echo $?", "0")]),
"10-18-daojie-conflict-p3-subject-docs": dict(
 cs="C30,C31,C32,C33,C34,C35,C36,C37", goal="主体句手册与 docs/prompts 对齐 P1 后的真源(依赖 P1 done)。",
 req=["R1 多视图 1:1 四区/1632 全改为 16:9 左特写+右三视图/1824×1024(C30,C36)。",
      "R2 设定卡分区比例按真源「一成/七成/两成;七成/一成半/一成半」并补标题栏(C31)。",
      "R3 示例主体句去除与类型负向/类型句相撞内容:罡风狂舞、握住剑鞘→按类型句「至多轻搭」统一、远山淡去(C32)。",
      "R4 示例主体句移除版式/九宫格/取景/画法设色词,手册骨架同步(C33)。",
      "R5 光照条款按 D7 改写(C34);K:39/50 旧锁更新(C35)。",
      "R6 型数十型、色锚 11 词、型名「人物多视图」、断链指针、水墨产线称谓(C36,C37)。"],
 files=[f"Modify: `{M}/art_prompt/art_subject_ten_types.md`", "Modify: `docs/prompts/道劫_类型主体句示例.md`、`docs/prompts/道劫_类型配方.md`", "Modify: `docs/prompts/Qwen-Image-2.1/07-主体句写作宪法.md`、`docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md`"],
 steps=[("前置门:确认 P1 task status=completed 且真源已提交", "python3 ./.trellis/scripts/task.py list | rg p1-canon", "completed"),
        ("扫描本子任务规则得基线", f"{SCAN} C30,C31,C32,C33,C34,C35,C36,C37 --json", "exit 2"),
        ("art_subject_ten_types.md:§0 总则/光照条款", None, None), ("art_subject_ten_types.md:§5 §6 §8 §10 骨架", None, None),
        ("道劫_类型主体句示例.md:§1 §4", None, None), ("示例 §5 §6 §8 §9 及头注", None, None),
        ("道劫_类型配方.md 表格", None, None), ("07 宪法 :39/:48/:50/:68/:72-73", None, None), ("05 库 :44-51 指针", None, None),
        ("扫描器门", f"{SCAN} C30,C31,C32,C33,C34,C35,C36,C37; echo $?", "0")]),
}

for name, c in CHILDREN.items():
    d = T / name
    title = (d / "prd.md").read_text().splitlines()[0]
    reqs = "\n".join(f"- {r}" for r in c["req"])
    acs = "\n".join(f"- [ ] AC{i+1} ({r.split()[0]}): 达成并经扫描器/测试证实。" for i, r in enumerate(c["req"]))
    (d / "prd.md").write_text(f"""{title}

最后核账:2026-10-18
父任务:`{PARENT}`  ·  覆盖审计编号:{c['cs']}(`{PARENT}/research/audit-1018-conflicts.md`)

## Goal

{c['goal']}

## Requirements

{reqs}

## Acceptance Criteria

{acs}
- [ ] AC-gate:扫描器 `--rules-only {c['cs']}` exit 0;对应 C 编号在父 research/audit 打四标。

{COMMON}""")
    lines = [f"# {title[2:]} · Implementation Plan", "", f"Covers: {', '.join(r.split()[0] for r in c['req'])}", "",
             "**Files:**", *[f"- {f}" for f in c["files"]], "", "## Steps", ""]
    for i, (act, cmd, exp) in enumerate(c["steps"], 1):
        lines.append(f"- [ ] Step {i}: {act}")
        if cmd:
            lines += [f"  - Run: `{cmd}`", f"  - Expected: {exp}"]
        else:
            lines.append("  - Verify: 改后 Read 回读受影响段落,确认与 design.md §4 一致且历史小节已收原句")
    lines += ["", "## 收尾", "- [ ] check 子代理复核(断言数不减、无越界文件)", "- [ ] pathspec 提交本子任务文件;task-tiers/父 audit 四标同步", ""]
    (d / "implement.md").write_text("\n".join(lines))
    print("wrote", name)
