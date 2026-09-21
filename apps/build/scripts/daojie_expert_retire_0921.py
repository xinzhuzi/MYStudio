#!/usr/bin/env python3
"""09-21 用户裁定:K2-文生图-道劫-专家模式.json 退役(很多 LoRA 效果没那么好)。

动作(幂等):
  1. 删仓库真源文件。
  2. 主线工作流 [66] 用法速查卡清除全部专家模式指向与已无住所的备选件建议
     (淡彩线描/墨洗/湿画——仅作文本面编辑,其余字节不动)。
  3. 同一套文本编辑原地施于引擎家用户区副本(该副本带 [90] 边界登记字段,
     禁整文件覆盖——契约见 docs/comfyui-kb/子图工作流工程契约.md §四)。
  4. 装机 Resources:主线整文件覆盖(与仓库字节同源)+ 删专家模式副本。

不动:8 件 LoRA 权重文件(物理删除另行裁定);apps/build/scripts/ 历史一次性
脚本(清单 risk#8 口径:历史操作记录保留不清理);test_my_daojie_lora_stack.py
(引用的是节点常量 EXPERT_PRESET,非本文件)。
回滚路径 = git 历史(清单原「勿删=回滚路径」注就此由 git 承担)。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows"
T2I_DIR = REPO / "1_图片/K2图像/1_文生图"
MAIN = T2I_DIR / "K2-文生图-道劫.json"
EXPERT = T2I_DIR / "K2-文生图-道劫-专家模式.json"
INSTALLED_T2I = Path(
    "/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
)
USERDATA_MAIN = Path(
    "~/Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/workflows/"
    "1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
).expanduser()

# (旧文, 新文) —— 每条必须在卡内恰好出现一次;幂等=旧文找不到且新文已在=跳过
CARD_EDITS: list[tuple[str, str]] = [
    # ① LoRA栈节:整条"全自定义大改走专家模式"bullet 删除
    (
        "- 全自定义大改走同目录「K2-文生图-道劫-专家模式.json」(14 件全手拨的专家画布)\n",
        "",
    ),
    # ② LoRA栈节:互斥纪律去掉已无住所的三画风件细则
    (
        "- 互斥纪律(手改行内件时过一遍):画风件同开 ≤1(+鎏金半件),淡彩线描/墨洗/湿画三画风同开=崩源;手开淡彩线描须在 [50] 补触发词 watercolor ink illustration style\n",
        "- 互斥纪律(手改行内件时过一遍):画风件同开 ≤1(+鎏金半件),多画风叠加=崩源\n",
    ),
    # ③ 表前段:去掉三画风句与墨洗备选(金雾鎏金句原样保留)
    (
        "互斥纪律:淡彩线描/墨洗/湿画三画风同开 ≤1;金雾与鎏金=场景互换、人物禁同开;人物系备选=墨洗轻档 0.4-0.6(可选非首选)。",
        "互斥纪律:金雾与鎏金=场景互换、人物禁同开。",
    ),
    # ④ 矩阵·场景行辅路:去掉备选画风件
    (
        "去噪精修→K2-去噪精修.json;K2-去噪精修 按需;备选画风件=淡彩线描×0.5-0.6/湿画×0.6(住专家模式.json;与墨洗互斥,同开≤1)",
        "去噪精修→K2-去噪精修.json;K2-去噪精修 按需",
    ),
    # ⑤ 矩阵·概念气氛图行辅路:去掉备选画风件
    (
        "备选画风件=湿画×0.5-0.6(住专家模式.json;与墨洗二选一);恒不做跨图一致性要求",
        "恒不做跨图一致性要求",
    ),
    # ⑥ 尾注:淡彩浓度随件退役
    (
        "[63] 12带重平衡全1.0=中性,同图可调淡彩浓度。",
        "[63] 12带重平衡全1.0=中性。",
    ),
]


def load_card(path: Path) -> tuple[dict, str]:
    wf = json.loads(path.read_text(encoding="utf-8"))
    node = next(n for n in wf["nodes"] if n.get("id") == 66 and n["type"] == "MarkdownNote")
    wv = node.get("widgets_values")
    if not (isinstance(wv, list) and wv and isinstance(wv[0], str)):
        raise SystemExit(f"[abort] {path} [66] widgets_values 非预期形状")
    return wf, wv


def apply_card_edits(path: Path, label: str) -> bool:
    """对单个文件的 [66] 卡施编辑;已施=跳过;失配=报错退出。返回是否发生写入。"""
    wf, wv = load_card(path)
    text = wv[0]
    changed = False
    for old, new in CARD_EDITS:
        count = text.count(old)
        if count == 1:
            text = text.replace(old, new)
            changed = True
        elif count == 0:
            if new and new in text:
                continue  # 已施过,幂等
            raise SystemExit(f"[abort] {label} 卡内找不到待替文本: {old[:40]}…")
        else:
            raise SystemExit(f"[abort] {label} 卡内该文本出现 {count} 次(应=1): {old[:40]}…")
    if not changed:
        print(f"[skip] {label} [66] 卡已是新文,无需改")
        return False
    wv[0] = text
    path.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {label} [66] 卡已清 {len(CARD_EDITS)} 处专家模式指向")
    return True


def main() -> int:
    # 1. 删仓库真源
    if EXPERT.exists():
        EXPERT.unlink()
        print(f"[ok] 已删仓库真源: {EXPERT.name}")
    else:
        print("[skip] 仓库真源已不在")

    # 2. 仓库主线卡
    apply_card_edits(MAIN, "仓库真源")

    # 3. 引擎家用户副本(只动卡文本,保登记字段)
    if USERDATA_MAIN.exists():
        apply_card_edits(USERDATA_MAIN, "引擎用户副本")
    else:
        print("[skip] 引擎用户副本不存在(契约三处同步的第三处可缺席)")

    # 4. 装机 Resources
    if INSTALLED_T2I.is_dir():
        dst_main = INSTALLED_T2I / MAIN.name
        dst_expert = INSTALLED_T2I / EXPERT.name
        shutil.copyfile(MAIN, dst_main)
        print(f"[ok] 装机主线已覆盖: {dst_main}")
        if dst_expert.exists():
            dst_expert.unlink()
            print(f"[ok] 已删装机副本: {dst_expert.name}")
        else:
            print("[skip] 装机专家模式副本已不在")
    else:
        print("[warn] 装机目录不存在,跳过(下次打包自动收敛)")

    # 5. 全树计数(供清单锚点核对)
    total = len(list(REPO.rglob("*.json")))
    print(f"[info] 工作流全树 json 计数 = {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
