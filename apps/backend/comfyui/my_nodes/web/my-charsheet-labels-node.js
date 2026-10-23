// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 设定表标注节点输入槽中文名(my-charsheet-labels-node):MyCharsheetLabels
 * 七输入挂中文显示名(姓名/身份字段/字族/姓名字号/字段字号/墨色/印文),
 * label 只改画布显示不改序列化 name,存量图零影响(照 daojie-base-node.js 先例)。
 */
import { app } from "/scripts/app.js";

const INPUT_LABELS = new Map([
  ["name", "姓名"],
  ["fields", "身份字段"],
  ["font", "字族"],
  ["name_size", "姓名字号"],
  ["field_size", "字段字号"],
  ["ink", "墨色"],
  ["seal_text", "印文"],
]);

app.registerExtension({
  name: "my.charsheet-labels.labels",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "MyCharsheetLabels") return;
    const original = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = original?.apply(this, arguments);
      try {
        for (const input of this.inputs || []) {
          const label = INPUT_LABELS.get(input.name);
          if (label) input.label = label;
        }
        for (const widget of this.widgets || []) {
          const label = INPUT_LABELS.get(widget.name);
          if (label) widget.label = label;
        }
      } catch (error) { /* 兜底=原生英文槽名 */ }
      return result;
    };
  },
});
