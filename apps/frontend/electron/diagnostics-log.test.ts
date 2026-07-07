import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiagnosticsLogService } from "./diagnostics-log";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-diagnostics-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("diagnostics log service", () => {
  it("writes sanitized JSONL entries and queries recent records", async () => {
    const rootDir = createTempRoot();
    const service = createDiagnosticsLogService({
      rootDir,
      now: () => new Date("2026-07-02T10:11:12.000Z"),
    });

    await service.write({
      level: "error",
      category: "network",
      operationId: "op-generate-asset",
      requestId: "req-1",
      message: "图片生成失败",
      context: {
        url: "https://console.fanrenapi.eu.cc/v1/images/generations?api_key=secret&task=1",
        headers: {
          Authorization: "Bearer real-key",
          "x-api-key": "real-key",
        },
        prompt: "这是一段非常长的提示词".repeat(20),
        image: "data:image/png;base64," + "a".repeat(2048),
      },
      error: new Error("Request failed"),
    });

    const filePath = path.join(rootDir, "diagnostics-2026-07-02.jsonl");
    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).toContain("\"category\":\"network\"");
    expect(raw).not.toContain("real-key");
    expect(raw).not.toContain("api_key=secret");
    expect(raw).not.toContain("data:image/png;base64");
    expect(raw).toContain("\"promptPreview\"");
    expect(raw).toContain("\"promptLength\"");

    const result = await service.query({ since: "2026-07-02T00:00:00.000Z", minLevel: "warn" });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      level: "error",
      category: "network",
      operationId: "op-generate-asset",
      requestId: "req-1",
    });
  });

  it("exports a diagnostic bundle and reports size plus error counts", async () => {
    const rootDir = createTempRoot();
    const service = createDiagnosticsLogService({
      rootDir,
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });

    await service.write({ level: "warn", category: "tts", message: "TTS backend offline" });
    await service.write({ level: "error", category: "ai", message: "Image generation failed" });

    const info = await service.getInfo();
    expect(info.directory).toBe(rootDir);
    expect(info.totalBytes).toBeGreaterThan(0);
    expect(info.recentWarnCount).toBe(1);
    expect(info.recentErrorCount).toBe(1);

    const bundle = await service.exportBundle();
    expect(bundle.success).toBe(true);
    expect(bundle.filePath).toContain("diagnostics-bundle-2026-07-02");
    expect(fs.existsSync(bundle.filePath!)).toBe(true);
  });

  it("clears all diagnostics logs without touching unrelated files", async () => {
    const rootDir = createTempRoot();
    const service = createDiagnosticsLogService({
      rootDir,
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });
    await service.write({ level: "info", category: "runtime", message: "ready" });
    fs.writeFileSync(path.join(rootDir, "keep.txt"), "keep");

    const result = await service.clear();

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "diagnostics-2026-07-02.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, "keep.txt"))).toBe(true);
  });
});
