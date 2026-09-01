// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeSeedVr2 } from "./seedvr2-probe";
import { SEEDVR2_RESTORE_MODEL } from "./seedvr2-restore-client";

let fakeDir: string;
const previousEnv = { ...process.env };

beforeEach(() => {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "seedvr2-probe-"));
  process.env.MYSTUDIO_COMFYUI_SEEDVR2_DIR = fakeDir;
});

afterEach(() => {
  fs.rmSync(fakeDir, { recursive: true, force: true });
  process.env.MYSTUDIO_COMFYUI_SEEDVR2_DIR = previousEnv.MYSTUDIO_COMFYUI_SEEDVR2_DIR;
  if (previousEnv.MYSTUDIO_COMFYUI_SEEDVR2_DIR === undefined) delete process.env.MYSTUDIO_COMFYUI_SEEDVR2_DIR;
});

const upFetch = vi.fn(async () => new Response("{}", { status: 200 }));
const downFetch = vi.fn(async () => {
  throw new Error("ECONNREFUSED");
});

describe("seedvr2 probe", () => {
  it("服务在+模型在=ready 形态(serviceUp/modelPresent/字节数)", async () => {
    fs.writeFileSync(path.join(fakeDir, SEEDVR2_RESTORE_MODEL), Buffer.alloc(1024));
    const result = await probeSeedVr2({ fetchImpl: upFetch as unknown as typeof fetch });
    expect(result.serviceUp).toBe(true);
    expect(result.modelPresent).toBe(true);
    expect(result.modelBytes).toBe(1024);
    expect(result.modelFile).toBe(path.join(fakeDir, SEEDVR2_RESTORE_MODEL));
  });

  it("服务挂=serviceUp false 但不抛(设置页 fail-open 展示)", async () => {
    fs.writeFileSync(path.join(fakeDir, SEEDVR2_RESTORE_MODEL), Buffer.alloc(8));
    const result = await probeSeedVr2({ fetchImpl: downFetch as unknown as typeof fetch });
    expect(result.serviceUp).toBe(false);
    expect(result.modelPresent).toBe(true);
  });

  it("模型缺=modelPresent false + bytes null", async () => {
    const result = await probeSeedVr2({ fetchImpl: upFetch as unknown as typeof fetch });
    expect(result.modelPresent).toBe(false);
    expect(result.modelBytes).toBeNull();
  });

  it("探测的是 7B sharp(升级裁定测试锁,防回退 3B)", () => {
    expect(SEEDVR2_RESTORE_MODEL).toBe("seedvr2_7b_sharp_fp8_e4m3fn.safetensors");
  });
});
