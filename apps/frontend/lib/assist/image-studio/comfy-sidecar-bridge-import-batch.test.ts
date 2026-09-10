// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 工作流库导入 transport 分批发送(09-10 实弹根修):
 * A 端 /comfy/workflows/import 单请求只处理前 50 个文件、超出静默截断——
 * 78 流迁移曾只入库 50、余 27 被误标「失败」。transport 必须按 ≤50 分批,
 * 全量送达、逐文件结果不丢。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHttpComfyWorkflowLibraryTransport,
  setComfySidecarLivenessProbeForTests,
} from "@/lib/assist/image-studio/comfy-sidecar-bridge";

type Capture = { files: Array<{ name: string }>; overwrite: boolean };

function fakeJson(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

function makeFile(i: number) {
  return { name: `流 ${i}.json`, content: JSON.stringify({ "1": { class_type: "X" } }) };
}

describe("工作流导入 transport 分批(≤50/请求)", () => {
  let calls: Capture[];

  beforeEach(() => {
    calls = [];
    setComfySidecarLivenessProbeForTests(async () => true);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("/comfy/workflows/import")) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      const parsed = JSON.parse(String(init?.body ?? "{}")) as {
        files: Array<{ name: string }>;
        overwrite: boolean;
      };
      calls.push({ files: parsed.files, overwrite: parsed.overwrite });
      return fakeJson({ imported: parsed.files.map((f) => f.name), skipped: [] });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setComfySidecarLivenessProbeForTests(null);
  });

  it("120 文件=3 批(50/50/20)全量 imported,零失败", async () => {
    const transport = createHttpComfyWorkflowLibraryTransport();
    const files = Array.from({ length: 120 }, (_, i) => makeFile(i));
    const results = await transport.importFiles(files, "skip");
    expect(calls.map((c) => c.files.length)).toEqual([50, 50, 20]);
    expect(calls.every((c) => c.overwrite === false)).toBe(true); // skip 模式不覆写
    expect(results.filter((r) => r.status === "imported")).toHaveLength(120);
    expect(results.filter((r) => r.status === "failed")).toHaveLength(0);
  });

  it("50 文件恰好单批,不空转第二轮", async () => {
    const transport = createHttpComfyWorkflowLibraryTransport();
    const results = await transport.importFiles(Array.from({ length: 50 }, (_, i) => makeFile(i)), "skip");
    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(50);
  });

  it("探活不过=大白话指路,不发请求", async () => {
    setComfySidecarLivenessProbeForTests(async () => false);
    const transport = createHttpComfyWorkflowLibraryTransport();
    await expect(transport.importFiles([makeFile(1)], "skip")).rejects.toThrow("本地生图服务未运行");
    expect(calls).toHaveLength(0);
  });
});
