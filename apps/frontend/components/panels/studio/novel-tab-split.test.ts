import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("NovelTab split boundaries", () => {
  it("keeps import dialog UI outside the main novel tab", () => {
    const tabSource = readFileSync(
      fileURLToPath(new URL("./NovelTab.tsx", import.meta.url)),
      "utf8",
    );
    const importDialogSource = readFileSync(
      fileURLToPath(new URL("./NovelImportDialog.tsx", import.meta.url)),
      "utf8",
    );

    expect(tabSource).toContain('from "./NovelImportDialog"');
    expect(importDialogSource).toContain("export function NovelImportDialog");
    expect(importDialogSource).toContain("导入原文");
    expect(importDialogSource).toContain("选择 TXT/Markdown 文件");
    expect(tabSource).not.toContain("选择 TXT/Markdown 文件");
  });

  it("keeps edit dialog UI outside the main novel tab", () => {
    const tabSource = readFileSync(
      fileURLToPath(new URL("./NovelTab.tsx", import.meta.url)),
      "utf8",
    );
    const editDialogSource = readFileSync(
      fileURLToPath(new URL("./NovelEditDialog.tsx", import.meta.url)),
      "utf8",
    );

    expect(tabSource).toContain('from "./NovelEditDialog"');
    expect(editDialogSource).toContain("export function NovelEditDialog");
    expect(editDialogSource).toContain("编辑章节");
    expect(editDialogSource).toContain("事件摘要");
    expect(tabSource).not.toContain("保存后会同步更新项目存储位置下的章节文档");
  });
});
