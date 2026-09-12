// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 剧本(script 型):markdown 源渲染(markdown-it 成型,禁裸排)。 */
import { renderMarkdown } from "./common.js";

export default {
  key: "script",
  render(payload) {
    const text = (payload.previewLines || []).join("\n");
    return `<div class="ms-md">${renderMarkdown(text)}</div>`;
  },
};
