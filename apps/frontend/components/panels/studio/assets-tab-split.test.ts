import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("AssetsTab split boundaries", () => {
  it("keeps batch card rendering outside the data orchestration tab", () => {
    const tabSource = readFileSync(
      fileURLToPath(new URL("./AssetsTab.tsx", import.meta.url)),
      "utf8",
    );
    const cardSource = readFileSync(
      fileURLToPath(new URL("./AssetsBatchCard.tsx", import.meta.url)),
      "utf8",
    );

    expect(tabSource).toContain('from "./AssetsBatchCard"');
    expect(tabSource).not.toContain("const renderCat =");
    expect(cardSource).toContain("export function AssetsBatchCard");
    expect(cardSource).toContain("创建缺失资产");
    expect(cardSource).toContain("剧本内容");
    // 剧本弹窗:近全屏 + Markdown 渲染(1013 用户裁定:禁 pre 裸贴源码/禁 760px 小窗)
    expect(cardSource).toContain("ReactMarkdown");
    expect(cardSource).toContain("h-[calc(100vh-48px)]");
    expect(cardSource).not.toContain("w-[min(760px,92vw)]");
  });

  it("does not eagerly list the independent asset library outside explicit management mode", () => {
    const tabSource = readFileSync(
      fileURLToPath(new URL("./AssetsTab.tsx", import.meta.url)),
      "utf8",
    );

    expect(tabSource).toContain('mode?: "extract" | "manage"');
    expect(tabSource).toContain('const mode = props.mode ?? "extract"');
    expect(tabSource).toContain('if (mode === "manage") load();');
    expect(tabSource).toContain("sa.list!({ type: t, limit: 99999 })");
  });

  it("R12: 本章剧本取最新草稿走单源 latestAgentWorkEntry,禁 reverse() 数组序(现实现含 reverse(),必红)", () => {
    const tabSource = readFileSync(
      fileURLToPath(new URL("./AssetsTab.tsx", import.meta.url)),
      "utf8",
    );

    // D7 单源:latestAgentWorkEntry 按 updatedAt 取最新(workflow-helpers 导出),
    // 数组序不再参与语义——旧 `[...props.agentWorkData].reverse().find(...)` 是
    // 与 latestAgentWork 并行的第二套「最新」口径,双口径病根禁回流。
    expect(tabSource).toContain("latestAgentWorkEntry");
    expect(tabSource).toContain('from "./workflow-helpers"');
    expect(tabSource).not.toContain(".reverse()");
  });
});
