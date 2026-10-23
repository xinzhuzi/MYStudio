// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 道劫底座/按型LoRA 节点输出槽中文名(daojie-base-node):
 * MyDaojieBase 侧=aspect/megapixels/base 三槽挂中文显示名(画幅比例/百万像素/型,
 * 09-19 补 base=九型驱动 LoRA 的供线槽);MyDaojieLoras 侧=applied 槽挂
 * 「已生效清单」。label 只改画布显示,不改序列化 name,存量图零影响
 * (照 stage-node.js 槽位代名词先例)。
 */
import { app } from "/scripts/app.js";

const OUTPUT_LABELS = new Map([
  ["aspect", "画幅比例"],
  ["megapixels", "百万像素"],
  ["base", "型"],
  ["applied", "已生效清单"],
]);

function labelResolutionOutputs(node) {
  for (const output of node.outputs || []) {
    const label = OUTPUT_LABELS.get(output.name);
    if (label) output.label = label;
  }
}

function withOutputLabels(nodeData, hookName) {
  const original = nodeData.prototype[hookName];
  nodeData.prototype[hookName] = function () {
    const result = original?.apply(this, arguments);
    try { labelResolutionOutputs(this); } catch (error) { /* 兜底=原生英文槽名 */ }
    return result;
  };
}

app.registerExtension({
  name: "my.daojie-base.labels",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name === "MyDaojieBase" || nodeData?.name === "MyDaojieLoras") {
      withOutputLabels(nodeType, "onNodeCreated");
      withOutputLabels(nodeType, "onConfigure");
    }
  },
});
