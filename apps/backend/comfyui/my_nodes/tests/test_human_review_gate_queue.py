# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""human-review-gate.js(1125 人审硬门·引擎侧队列兜底)行为测试。

与兄弟件(文本/AST 互锁)不同,本件是纯函数无 DOM 依赖——经 node 子进程
直跑 ESM 模块断言行为(退出码 0=过;断言失败=exit 1 + stderr 文案)。
覆盖:MyShot 逐镜对账/导演台当章全镜/快照过期与缺项目拦/无快照拦/
非视频提交零对账/partialExecutionTargets 过滤。

系统 python3 直跑亦可:python3 test_human_review_gate_queue.py。
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

_MY_NODES = Path(__file__).resolve().parents[1]
_GATE_JS = _MY_NODES / "web" / "human-review-gate.js"

_HARNESS = r"""
import { assertHumanReviewForQueue, hasVideoOutputInScope } from %s;

const FRESH = () => ({ updatedAt: Date.now(), staleAfterMs: 15000, originProjectId: "proj-1", currentEpisodeId: "chapter-001",
  shots: [
    { id: "sb-a", label: "S01 · a", episodeId: "chapter-001", humanApproved: true },
    { id: "sb-b", label: "S02 · b", episodeId: "chapter-001", humanApproved: false },
  ] });

function expectBlock(fn, fragment) {
  try { fn(); } catch (error) {
    if (!String(error.message).includes(fragment)) {
      console.error("BLOCK 但文案不含期望片段:", error.message, "期望:", fragment);
      process.exit(1);
    }
    return;
  }
  console.error("未拦下(期望抛错含):", fragment);
  process.exit(1);
}

function expectPass(fn) {
  try { fn(); } catch (error) {
    console.error("期望放行但拦下:", error.message);
    process.exit(1);
  }
}

// ① MyShot 未审镜按 shot_id 拦
expectBlock(() => assertHumanReviewForQueue(
  { output: { "9": { class_type: "MyShot", inputs: { shot_id: "sb-b", video: ["4003", 0] } } } },
  FRESH(),
), "未通过图片人审");

// ② MyShot 已审镜放行
expectPass(() => assertHumanReviewForQueue(
  { output: { "9": { class_type: "MyShot", inputs: { shot_id: "sb-a", video: ["4003", 0] } } } },
  FRESH(),
));

// ③ 缺 humanApproved 字段(旧宿主)=按未审拦
expectBlock(() => assertHumanReviewForQueue(
  { output: { "9": { class_type: "ManyingShot", inputs: { shot_id: "sb-a", video: ["4003", 0] } } } },
  { ...FRESH(), shots: [{ id: "sb-a", label: "S01", episodeId: "chapter-001" }] },
), "未通过图片人审");

// ④ 快照过期=拦;无快照=拦;缺项目=拦
const stale = FRESH(); stale.updatedAt = Date.now() - 60_000;
expectBlock(() => assertHumanReviewForQueue(
  { output: { "9": { class_type: "MyShot", inputs: { shot_id: "sb-a", video: [1, 0] } } } }, stale,
), "快照已过期");
expectBlock(() => assertHumanReviewForQueue(
  { output: { "9": { class_type: "MyShot", inputs: { shot_id: "sb-a", video: [1, 0] } } } }, null,
), "快照已过期");
expectBlock(() => assertHumanReviewForQueue(
  { output: { "9": { class_type: "MyShot", inputs: { shot_id: "sb-a", video: [1, 0] } } } },
  { ...FRESH(), originProjectId: "" },
), "快照已过期");

// ⑤ 导演台:当章全镜过才放行;一镜未审=拦并列镜
expectPass(() => assertHumanReviewForQueue(
  { output: { "5": { class_type: "MyDirectorConsole", inputs: { timeline_data: "{}" } } } },
  { ...FRESH(), shots: [{ id: "sb-a", label: "S01 · a", episodeId: "chapter-001", humanApproved: true }] },
));
expectBlock(() => assertHumanReviewForQueue(
  { output: { "5": { class_type: "MyDirectorConsole", inputs: {} } } },
  FRESH(),
), "1 镜未通过图片人审");

// ⑥ 非视频提交(MyGenerated 成图)零对账:连快照都不用
expectPass(() => assertHumanReviewForQueue(
  { output: { "3": { class_type: "MyGenerated", inputs: { meta: "{}" } } } }, null,
));

// ⑦ partialExecutionTargets 过滤:范围外的未审 MyShot 不拦本轮
expectPass(() => assertHumanReviewForQueue(
  { output: { "9": { class_type: "MyShot", inputs: { shot_id: "sb-b", video: [1, 0] } } },
    partialExecutionTargets: ["3"] },
  FRESH(),
));

// ⑧ 范围预判:非视频提交 false,视频提交 true
if (hasVideoOutputInScope({ output: { "3": { class_type: "MyGenerated", inputs: {} } } }) !== false) process.exit(1);
if (hasVideoOutputInScope({ output: { "9": { class_type: "MyShot", inputs: { video: [1, 0] } } } }) !== true) process.exit(1);
if (hasVideoOutputInScope({ output: { "5": { class_type: "MyDirectorConsole", inputs: {} } } }) !== true) process.exit(1);
console.log("human-review-gate.js: all assertions passed");
"""


def test_human_review_gate_queue() -> None:
    script = _HARNESS % json.dumps(str(_GATE_JS))
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, f"引擎人审门断言失败:\n{result.stdout}\n{result.stderr}"


if __name__ == "__main__":
    test_human_review_gate_queue()
    print("ok")
