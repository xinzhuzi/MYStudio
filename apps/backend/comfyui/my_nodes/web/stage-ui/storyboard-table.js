// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 分镜表(storyboardTable 型):md 表格渲染——正文是 markdown(## 场/### 片段
 * + 15 列 | 表格),但生成器按 50 字软换行把宽表行拆碎了;先做表格行回接
 * (非块标记行接回上一行)再喂 markdown-it,成型为真表格+标题层级。
 * 载荷已解析出 tableRows(结构化)时优先两行制表行(零解析依赖)。 */
import { emptyHTML, esc, renderMarkdown } from "./common.js";

const BLOCK_START = /^(#|<|\||```|\s*$)/;

/** 宽表行回接:上一行以 | 开头且当前行不是新块(标题/新行/空)→并回;
 * 分隔行续段(纯 -|: 字符)同样并回。 */
function reflowTableLines(lines) {
  const out = [];
  for (const line of lines) {
    const text = String(line || "").trim();
    const prev = out.length > 0 ? out[out.length - 1] : "";
    const isContinuation = prev.startsWith("|") && text !== "" && !BLOCK_START.test(text);
    // 分隔行续段:不以 | 开头(整条分隔行是新块)且由 -|: 空格组成、含 |
    const isSeparatorTail = prev.startsWith("|") && !text.startsWith("|") && /^[-| :]+\|/.test(text);
    if (isContinuation || isSeparatorTail) {
      out[out.length - 1] = prev + (prev.endsWith("|") ? " " : "") + text;
    } else {
      out.push(text);
    }
  }
  return out.join("\n");
}

export default {
  key: "storyboardTable",
  render(payload) {
    if (Array.isArray(payload.tableRows) && payload.tableRows.length > 0) {
      const rows = payload.tableRows.map((row) => `
        <div class="ms-row">
          <span class="idx">#${String(row.index).padStart(2, "0")}</span>
          <span class="main"><span class="scene">${esc(row.scene)}</span>${esc(row.title)}
            <span class="sub">「${esc(row.lines || "—")}」${row.action ? " · " + esc(row.action) : ""}${row.sound ? " · ♪" + esc(row.sound) : ""}${row.assets ? " · 【" + esc(row.assets) + "】" : ""}</span>
          </span>
          <span class="meta">${esc(row.shotSize)}${row.cameraMove ? "·" + esc(row.cameraMove) : ""} ${row.duration}s</span>
        </div>`).join("");
      return `<div class="ms-rows">${rows}</div>`;
    }
    const text = reflowTableLines(payload.previewLines || []);
    if (!text.trim()) return emptyHTML("暂无分镜表 · 详情进分镜面板");
    return `<div class="ms-md ms-md--table">${renderMarkdown(text)}</div>`;
  },
};
