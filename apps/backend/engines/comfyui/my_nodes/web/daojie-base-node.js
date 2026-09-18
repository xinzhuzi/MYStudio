// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 道劫底座节点输出槽中文名(daojie-base-node,09-18 分辨率数据面接线备):
 * Python 侧 RETURN_TYPES 新增 aspect(COMBO)/megapixels(FLOAT) 两出,
 * 本文件只给两槽挂中文显示名——画幅比例/百万像素(照 stage-node.js 槽位
 * 代名词先例:label 只改画布显示,不改序列化 name,存量图零影响)。
 */
import { app } from "/scripts/app.js";

const OUTPUT_LABELS = new Map([
  ["aspect", "画幅比例"],
  ["megapixels", "百万像素"],
]);

function labelResolutionOutputs(node) {
  for (const output of node.outputs || []) {
    const label = OUTPUT_LABELS.get(output.name);
    if (label) output.label = label;
  }
}

app.registerExtension({
  name: "my.daojie-base.labels",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "MyDaojieBase") return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      try { labelResolutionOutputs(this); } catch (error) { /* 兜底=原生英文槽名 */ }
      return result;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      try { labelResolutionOutputs(this); } catch (error) { /* 兜底=原生英文槽名 */ }
      return result;
    };
  },
});
