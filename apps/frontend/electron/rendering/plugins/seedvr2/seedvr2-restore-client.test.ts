// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runSeedVr2Restore, SEEDVR2_MAX_INPUT_PIXELS, SEEDVR2_RESTORE_MODEL } from "./seedvr2-restore-client";

function fakePngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "seedvr2-client-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const identityResize = (buffer: Buffer) => buffer;

function makeHappyRouter() {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/system_stats")) return jsonResponse({ comfyui_version: "0.33" });
    if (url.endsWith("/upload/image")) return jsonResponse({ name: "mystudio-seedvr2-input.png" });
    if (url.endsWith("/prompt")) return jsonResponse({ prompt_id: "pid-1" });
    if (url.includes("/history/pid-1")) {
      return jsonResponse({
        "pid-1": {
          status: { status_str: "success" },
          outputs: { "5": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
        },
      });
    }
    if (url.includes("/view?")) return new Response(fakePngHeader(16, 16).buffer as ArrayBuffer);
    throw new Error(`unexpected url ${url}`);
  });
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    fetchImpl: makeHappyRouter(),
    resize: identityResize,
    baseUrl: () => "http://127.0.0.1:17598",
    sleep: async () => undefined,
    ...overrides,
  };
}

describe("seedvr2 restore client", () => {
  it("happy path: uploads, polls, fetches, and writes the restored file", async () => {
    fs.writeFileSync(path.join(workDir, "input.png"), fakePngHeader(1024, 576));
    const fetchImpl = makeHappyRouter();
    const result = await runSeedVr2Restore({ imagePath: path.join(workDir, "input.png"), outputDir: workDir }, baseDeps({ fetchImpl }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath.endsWith("seedvr2-restored.png")).toBe(true);
    // 提交的工作流必须用 7B sharp(09-01 升级裁定;防回退 3B 的测试锁)
    const submitted = fetchImpl.mock.calls.find((call) => String(call[0]).endsWith("/prompt"));
    expect(submitted).toBeTruthy();
    const body = String((submitted as unknown as [string, RequestInit])[1].body);
    expect(body).toContain(SEEDVR2_RESTORE_MODEL);
    expect(body).not.toContain("seedvr2_ema_3b");
  });

  it("fail-closed with 人话文案 when ComfyUI is not running", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const result = await runSeedVr2Restore({ imagePath: "x", outputDir: workDir }, baseDeps({ fetchImpl }));
    expect(result).toEqual({ ok: false, code: "seedvr2-unreachable", message: "ComfyUI 没在运行，请先打开它再试" });
  });

  it("≤1MP 硬护栏:缩放器未把输入压到护栏内即拒绝上传(健康检查先行,上传必须被拦)", async () => {
    fs.writeFileSync(path.join(workDir, "input.png"), fakePngHeader(3840, 2160));
    const fetchImpl = makeHappyRouter();
    const result = await runSeedVr2Restore(
      { imagePath: path.join(workDir, "input.png"), outputDir: workDir },
      baseDeps({ fetchImpl, resize: (buffer: Buffer) => buffer }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("seedvr2-input-invalid");
    const uploaded = fetchImpl.mock.calls.some(([url]) => String(url).includes("/upload/image"));
    expect(uploaded).toBe(false);
  });

  it("workflow node_errors map to seedvr2-workflow-rejected", async () => {
    fs.writeFileSync(path.join(workDir, "input.png"), fakePngHeader(512, 512));
    const router = makeHappyRouter();
    router.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/system_stats")) return jsonResponse({});
      if (url.endsWith("/upload/image")) return jsonResponse({ name: "f.png" });
      if (url.endsWith("/prompt")) return jsonResponse({ node_errors: { "4": [{ type: "value_not_in_list" }] } });
      throw new Error("should not get past /prompt");
    });
    const result = await runSeedVr2Restore({ imagePath: path.join(workDir, "input.png"), outputDir: workDir }, baseDeps({ fetchImpl: router }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("seedvr2-workflow-rejected");
  });

  it("history error surfaces seedvr2-failed with detail", async () => {
    fs.writeFileSync(path.join(workDir, "input.png"), fakePngHeader(512, 512));
    const router = makeHappyRouter();
    router.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/system_stats")) return jsonResponse({});
      if (url.endsWith("/upload/image")) return jsonResponse({ name: "f.png" });
      if (url.endsWith("/prompt")) return jsonResponse({ prompt_id: "pid-1" });
      if (url.includes("/history/pid-1")) return jsonResponse({ "pid-1": { status: { status_str: "error", messages: "oom" } } });
      throw new Error(`unexpected ${url}`);
    });
    const result = await runSeedVr2Restore({ imagePath: path.join(workDir, "input.png"), outputDir: workDir }, baseDeps({ fetchImpl: router }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("seedvr2-failed");
    expect(result.message).toContain("oom");
  });

  it("poll deadline exceeded maps to seedvr2-timeout", async () => {
    fs.writeFileSync(path.join(workDir, "input.png"), fakePngHeader(512, 512));
    const router = makeHappyRouter();
    router.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/system_stats")) return jsonResponse({});
      if (url.endsWith("/upload/image")) return jsonResponse({ name: "f.png" });
      if (url.endsWith("/prompt")) return jsonResponse({ prompt_id: "pid-1" });
      if (url.includes("/history/pid-1")) return jsonResponse({}); // 永远 pending
      throw new Error(`unexpected ${url}`);
    });
    let clock = 0;
    const result = await runSeedVr2Restore(
      { imagePath: path.join(workDir, "input.png"), outputDir: workDir },
      baseDeps({ fetchImpl: router, now: () => clock, sleep: async () => { clock += 5_000; }, timeoutMs: 60_000 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("seedvr2-timeout");
  });

  it("护栏常量=1MP(09-01 整机重启事故的测试锁,严禁放宽)", () => {
    expect(SEEDVR2_MAX_INPUT_PIXELS).toBe(1_048_576);
  });
});
