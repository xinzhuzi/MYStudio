// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 导演规划(scriptPlan 型):markdown 源渲染;渲染器并发/降级链芯片在壳头区。 */
import { renderMarkdown } from "./common.js";

export default {
  key: "scriptPlan",
  render(payload) {
    const text = (payload.previewLines || []).join("\n");
    return `<div class="ms-md">${renderMarkdown(text)}</div>`;
  },
};
