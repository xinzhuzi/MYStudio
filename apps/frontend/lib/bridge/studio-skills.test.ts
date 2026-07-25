import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStudioSkillsBridge,
  type StudioSkillsBridge,
} from "./studio-skills";

describe("getStudioSkillsBridge", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns no bridge when the renderer window is unavailable", () => {
    expect(getStudioSkillsBridge()).toBeUndefined();
  });

  it("returns no bridge when the preload surface is unavailable", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });

    expect(getStudioSkillsBridge()).toBeUndefined();
  });

  it("returns the preload bridge without reshaping its contract", () => {
    const bridge: StudioSkillsBridge = {
      list: async () => [],
      readText: async () => ({ success: true }),
      writeText: async () => ({ success: true }),
      createText: async () => ({ success: true }),
      deleteText: async () => ({ success: true }),
      restoreText: async () => ({ success: true }),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { studioSkills: bridge },
    });

    expect(getStudioSkillsBridge()).toBe(bridge);
  });

  it("preserves all six method arguments, results, and errors", async () => {
    const listedFile = {
      relativePath: "agent_skills/example.md",
      filePath: "/skills/agent_skills/example.md",
      storagePath: "/skills/agent_skills/example.md",
      size: 12,
      updatedAt: 123,
      isCustomized: true,
      sourceExists: true,
    };
    const list = vi.fn(async () => [listedFile]);
    const readText = vi.fn(async () => ({
      success: false,
      error: "read failed",
    }));
    const writeText = vi.fn(async () => ({
      success: true,
      filePath: listedFile.filePath,
      updatedAt: 456,
    }));
    const createText = vi.fn(async () => ({
      success: false,
      error: "create failed",
    }));
    const deleteText = vi
      .fn<
        [relativePath: string],
        ReturnType<StudioSkillsBridge["deleteText"]>
      >()
      .mockResolvedValueOnce({ success: true, deleted: true })
      .mockRejectedValueOnce(new Error("delete rejected"));
    const restoreText = vi.fn(async () => ({
      success: false,
      error: "restore failed",
    }));
    const bridge: StudioSkillsBridge = {
      list,
      readText,
      writeText,
      createText,
      deleteText,
      restoreText,
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { studioSkills: bridge },
    });
    const resolved = getStudioSkillsBridge();

    await expect(resolved?.list()).resolves.toEqual([listedFile]);
    await expect(resolved?.readText(listedFile.relativePath)).resolves.toEqual({
      success: false,
      error: "read failed",
    });
    await expect(
      resolved?.writeText(listedFile.relativePath, "updated"),
    ).resolves.toEqual({
      success: true,
      filePath: listedFile.filePath,
      updatedAt: 456,
    });
    await expect(
      resolved?.createText("agent_skills/new.md", "created"),
    ).resolves.toEqual({ success: false, error: "create failed" });
    await expect(resolved?.deleteText(listedFile.relativePath)).resolves.toEqual({
      success: true,
      deleted: true,
    });
    await expect(resolved?.deleteText(listedFile.relativePath)).rejects.toThrow(
      "delete rejected",
    );
    await expect(resolved?.restoreText(listedFile.relativePath)).resolves.toEqual({
      success: false,
      error: "restore failed",
    });

    expect(list).toHaveBeenCalledWith();
    expect(readText).toHaveBeenCalledWith(listedFile.relativePath);
    expect(writeText).toHaveBeenCalledWith(listedFile.relativePath, "updated");
    expect(createText).toHaveBeenCalledWith(
      "agent_skills/new.md",
      "created",
    );
    expect(deleteText).toHaveBeenCalledWith(listedFile.relativePath);
    expect(restoreText).toHaveBeenCalledWith(listedFile.relativePath);
  });

  it("keeps the designated consumers behind the shared accessor", () => {
    const consumerPaths = [
      "frontend/components/panels/skills/index.tsx",
      "frontend/components/panels/studio/ManualEditDialog.tsx",
      "frontend/components/panels/studio/useStudioManualCatalog.ts",
    ];

    for (const consumerPath of consumerPaths) {
      const source = readFileSync(join(process.cwd(), consumerPath), "utf8");
      expect(source, consumerPath).toContain("getStudioSkillsBridge");
      expect(source, consumerPath).not.toContain("window.studioSkills");
    }
  });
});
