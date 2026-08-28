import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

// R14/R15 产线致哑 bug 的回归测试(08-28):这两个 bug 因控制器无单测存活多轮。
// mock 边界:child_process(可编程退出码/输出) + fs(artifact 文件中介)。

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));
const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => {
    throw new Error("not found");
  }),
  rm: vi.fn(async () => undefined),
}));
vi.mock("node:fs", () => ({ promises: fsMock, default: { promises: fsMock } }));

import { VlmReviewRuntimeController } from "./vlm-review-runtime-controller";

function makeController(resolvePath: (url: string) => Promise<string | null> = async (url) => url) {
  return new VlmReviewRuntimeController({
    pythonExecutable: "/py/python3",
    backendRoot: "/backend",
    storageBasePath: "/base",
    resolveProjectFilePath: resolvePath,
  });
}

function artifactJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    projectId: "p1",
    shotId: "s1",
    status: "accepted",
    model: "m",
    checks: {},
    reasons: [],
    inferenceMs: 1,
    inputSha256: "",
    generatedAt: 1,
    ...overrides,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("VlmReviewRuntimeController.runReview (R14/R15 回归)", () => {
  it("worker 正常退出 → 读 artifact 文件返回", async () => {
    (fsMock.readFile as Mock).mockResolvedValueOnce(artifactJson());
    execFileMock.mockImplementation((... invocation: unknown[]) => { const cb = invocation[invocation.length - 1] as Function;
      cb(null, { stdout: "stdout", stderr: "" });
    });
    const result = await makeController().runReview({
      schemaVersion: 1,
      projectId: "p1",
      shotId: "s1",
      generatedImagePath: "/tmp/gen.png",
      expectedContent: "test",
      expectedCharacters: [],
      referenceImages: [{ path: "/tmp/ref.png", role: "character", assetName: "ref" }],
    });
    expect(result.status).toBe("accepted");
    expect(result.shotId).toBe("s1");
  });

  it("worker exit 2(blocked) → 按 error.code 读回完整 artifact(R15 核心回归)", async () => {
    (fsMock.readFile as Mock).mockResolvedValueOnce(artifactJson({ status: "blocked", code: "input-not-found" }));
    const execError = Object.assign(new Error("Command failed"), { code: 2 });
    execFileMock.mockImplementation((... invocation: unknown[]) => { const cb = invocation[invocation.length - 1] as Function;
      cb(execError, "", "");
    });
    const result = await makeController().runReview({
      schemaVersion: 1,
      projectId: "p1",
      shotId: "s1",
      generatedImagePath: "/tmp/gen.png",
      expectedContent: "test",
      expectedCharacters: [],
      referenceImages: [] as { path: string; role: "character"; assetName: string }[],
    });
    // 旧判据 stderr.includes("exit code 2") 永不命中 → 误归 run-failed(产线致哑)
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("input-not-found");
  });

  it("非 2 退出码且无 artifact → 归 run-failed", async () => {
    const execError = Object.assign(new Error("spawn crash"), { code: 1 });
    execFileMock.mockImplementation((... invocation: unknown[]) => { const cb = invocation[invocation.length - 1] as Function;
      cb(execError, "", "");
    });
    const result = await makeController().runReview({
      schemaVersion: 1,
      projectId: "p1",
      shotId: "s1",
      generatedImagePath: "/tmp/gen.png",
      expectedContent: "test",
      expectedCharacters: [],
      referenceImages: [] as { path: string; role: "character"; assetName: string }[],
    });
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("run-failed");
  });

  it("resolveProjectFilePath 应用于成图与参考(R14:project-file:// 解码由注入方负责)", async () => {
    (fsMock.readFile as Mock).mockResolvedValueOnce(artifactJson());
    execFileMock.mockImplementation((... invocation: unknown[]) => { const cb = invocation[invocation.length - 1] as Function;
      cb(null, { stdout: "stdout", stderr: "" });
    });
    let capturedRequest: Record<string, unknown> = {};
    (fsMock.writeFile as unknown as { mockImplementationOnce: (fn: (...a: unknown[]) => Promise<void>) => void }).mockImplementationOnce(async (...a: unknown[]) => {
      capturedRequest = JSON.parse(String(a[1]));
    });
    await makeController(async (url) => (url.startsWith("project-file://") ? `/decoded${url.slice("project-file://x".length)}` : url)).runReview({
      schemaVersion: 1,
      projectId: "p1",
      shotId: "s1",
      generatedImagePath: "project-file://x/gen.png",
      expectedContent: "test",
      expectedCharacters: [],
      referenceImages: [{ path: "project-file://x/ref.png", role: "character", assetName: "ref" }],
    });
    expect(capturedRequest.generatedImagePath).toBe("/decoded/gen.png");
    expect((capturedRequest.referenceImages as Array<{ path: string }>)[0].path).toBe("/decoded/ref.png");
  });
});

describe("VlmReviewRuntimeController.probeReadiness", () => {
  it("stdout JSON status=ready → 解析返回", async () => {
    execFileMock.mockImplementation((... invocation: unknown[]) => { const cb = invocation[invocation.length - 1] as Function;
      cb(null, { stdout: JSON.stringify({ status: "ready", modelDir: "/m" }), stderr: "" });
    });
    const probe = await makeController().probeReadiness();
    expect(probe.status).toBe("ready");
    expect(probe.modelDir).toBe("/m");
  });

  it("执行异常 → blocked(probe-failed)", async () => {
    execFileMock.mockImplementation((... invocation: unknown[]) => { const cb = invocation[invocation.length - 1] as Function;
      cb(new Error("boom"), "", "");
    });
    const probe = await makeController().probeReadiness();
    expect(probe.status).toBe("blocked");
    expect(probe.code).toBe("probe-failed");
  });
});
