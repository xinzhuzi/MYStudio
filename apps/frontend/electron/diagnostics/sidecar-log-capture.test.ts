// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSidecarOutput,
  configureSidecarLogCapture,
  dumpSidecarFailure,
} from "./sidecar-log-capture";

let sidecarsDir: string;

beforeEach(() => {
  sidecarsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-capture-"));
});

afterEach(() => {
  configureSidecarLogCapture(null);
  fs.rmSync(sidecarsDir, { recursive: true, force: true });
});

function configure(overrides?: { maxFileBytes?: number; retentionDays?: number; writeDiagnostics?: (entry: unknown) => void }) {
  configureSidecarLogCapture({
    getSidecarsDir: () => sidecarsDir,
    ...(overrides?.maxFileBytes !== undefined ? { maxFileBytes: overrides.maxFileBytes } : {}),
    ...(overrides?.retentionDays !== undefined ? { retentionDays: overrides.retentionDays } : {}),
    ...(overrides?.writeDiagnostics ? { writeDiagnostics: overrides.writeDiagnostics as never } : {}),
  });
}

describe("sidecar-log-capture", () => {
  it("未配置时全部 no-op 不抛错", () => {
    const child = spawn(process.execPath, ["-e", "console.log('x')"]);
    const handle = captureSidecarOutput({ module: "noop", child });
    expect(handle.filePath).toBeNull();
    expect(dumpSidecarFailure({ module: "noop", title: "t", detail: "d" })).toBeNull();
    handle.dispose();
  });

  it("module 名不合法时降级 no-op(捕获不反噬宿主链)", () => {
    configure();
    const child = spawn(process.execPath, ["-v"]);
    // 不抛错、不写文件、不发生路径穿越(裸调用:若抛错测试即失败)
    const handle = captureSidecarOutput({ module: "../escape", child });
    expect(handle.filePath).toBeNull();
    expect(dumpSidecarFailure({ module: "Bad_Name", title: "t", detail: "d" })).toBeNull();
    expect(fs.readdirSync(sidecarsDir)).toHaveLength(0);
    child.kill();
  });

  it("日志目录不可创建时降级 no-op 不抛错(设计不变量回归)", () => {
    const blockFile = path.join(sidecarsDir, "blocker");
    fs.writeFileSync(blockFile, "not a dir");
    configureSidecarLogCapture({ getSidecarsDir: () => path.join(blockFile, "sidecars") });
    const handle = captureSidecarOutput({ module: "depth", child: spawn(process.execPath, ["-v"]) });
    expect(handle.filePath).toBeNull();
    expect(dumpSidecarFailure({ module: "depth", title: "t", detail: "d" })).toBeNull();
  });

  it("捕获 stdout/stderr 行并写 start/exit 标记", async () => {
    configure();
    const child = spawn(process.execPath, ["-e", "console.log('hello-out'); console.error('hello-err')"]);
    const handle = captureSidecarOutput({ module: "tts-backend", child, label: "tts test" });
    expect(handle.filePath).toBeTruthy();
    const code = await new Promise<number>((resolve) => child.once("close", resolve));
    expect(code).toBe(0);
    const content = fs.readFileSync(handle.filePath as string, "utf8");
    expect(content).toContain("[start] tts test");
    expect(content).toContain("[out] hello-out");
    expect(content).toContain("[err] hello-err");
    expect(content).toContain("[exit] code=0");
  });

  it("dumpSidecarFailure 落盘并进 diagnostics", () => {
    const writeDiagnostics = vi.fn();
    configure({ writeDiagnostics });
    const filePath = dumpSidecarFailure({
      module: "hyperframes",
      title: "overlay 渲染失败",
      detail: "line1\nline2",
    });
    expect(filePath).toBeTruthy();
    const content = fs.readFileSync(filePath as string, "utf8");
    expect(content).toContain("[failure] overlay 渲染失败");
    expect(content).toContain("line1");
    expect(content).toContain("line2");
    expect(writeDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ category: "runtime", level: "error" }),
    );
  });

  it("单文件超上限写截断标记后停写", () => {
    configure({ maxFileBytes: 64 });
    const filePath = dumpSidecarFailure({
      module: "depth",
      title: "t",
      detail: "x".repeat(200),
    }) as string;
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("[truncated]");
    expect(content.length).toBeLessThan(200 + 128);
  });

  it("同 module 超保留期的旧文件被清扫,他 module 不动", () => {
    configure({ retentionDays: 14 });
    const staleDepth = path.join(sidecarsDir, "depth-20200101-000000.log");
    const staleOther = path.join(sidecarsDir, "upscale-20200101-000000.log");
    fs.writeFileSync(staleDepth, "old\n");
    fs.writeFileSync(staleOther, "old\n");
    const tenDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    fs.utimesSync(staleDepth, tenDaysAgo, tenDaysAgo);
    fs.utimesSync(staleOther, tenDaysAgo, tenDaysAgo);
    dumpSidecarFailure({ module: "depth", title: "trigger sweep", detail: "d" });
    expect(fs.existsSync(staleDepth)).toBe(false);
    expect(fs.existsSync(staleOther)).toBe(true);
  });
});
