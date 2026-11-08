import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUnclothChain } from "./run-uncloth";
import { resolveUnclothParams } from "./uncloth-defaults";

const mocks = vi.hoisted(() => ({
  project: { activeProjectId: "project-a" as string | null },
  ensureRuntime: vi.fn(),
  saveImage: vi.fn(),
  saveToMediaLibrary: vi.fn(),
  appendProjectLedger: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: { getState: () => mocks.project },
}));
vi.mock("@/lib/ai/image-generation-engine", () => ({
  ensureLocalImageSidecarRunning: mocks.ensureRuntime,
}));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({ saveImage: mocks.saveImage }),
}));
vi.mock("@/lib/ai/generation-media", () => ({
  saveToMediaLibrary: mocks.saveToMediaLibrary,
}));
vi.mock("./history-records", async (importOriginal) => ({
  ...await importOriginal<typeof import("./history-records")>(),
  appendProjectLedger: mocks.appendProjectLedger,
}));
vi.mock("./local-image-token", () => ({ getLocalImageToken: async () => "test-token" }));
vi.mock("@/lib/media/image-storage", () => ({ readImageAsBase64: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

const request = {
  inputImageUrl: "data:image/png;base64,aW5wdXQ=",
  prompt: "测试处理",
  unclothNodeId: "uncloth-1",
  params: resolveUnclothParams({}),
};
const savedUrl = "project-file://project-a/media/ai-image/2026-10/result.png";

function pendingGeneration() {
  const started = deferred<void>();
  const response = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>(() => {
    started.resolve();
    return response.promise;
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    started: started.promise,
    fetchMock,
    complete: () => response.resolve(new Response(JSON.stringify({
      data: [{ b64_json: "b3V0cHV0" }],
    }), { status: 200 })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.project.activeProjectId = "project-a";
  mocks.ensureRuntime.mockResolvedValue(true);
  mocks.saveImage.mockResolvedValue({ success: true, url: savedUrl });
  mocks.saveToMediaLibrary.mockReturnValue("media-1");
  mocks.appendProjectLedger.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("runUnclothChain persistence fencing", () => {
  it("rejects a superseded request in the same project before any save", async () => {
    let current = true;
    const assertStillCurrent = () => { if (!current) throw new Error("来源已变化"); };
    const generation = pendingGeneration();
    const outcome = runUnclothChain(request, assertStillCurrent).then(
      () => undefined, (error: unknown) => error,
    );
    await generation.started;
    current = false;
    generation.complete();

    expect(await outcome).toEqual(new Error("来源已变化"));
    expect(mocks.saveImage).not.toHaveBeenCalled();
    expect(mocks.saveToMediaLibrary).not.toHaveBeenCalled();
    expect(mocks.appendProjectLedger).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it.each(["project-b", null])("rejects late generation after switching to %s before any save", async (nextProject) => {
    const generation = pendingGeneration();
    const outcome = runUnclothChain(request).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    await generation.started;
    mocks.project.activeProjectId = nextProject;
    generation.complete();

    const result = await outcome;
    expect(mocks.saveImage).not.toHaveBeenCalled();
    expect(mocks.saveToMediaLibrary).not.toHaveBeenCalled();
    expect(mocks.appendProjectLedger).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.value).toBeUndefined();
  });

  it("preserves the project image, media and ledger contracts for an unchanged request", async () => {
    const generation = pendingGeneration();
    const outcome = runUnclothChain(request);
    await generation.started;
    generation.complete();

    await expect(outcome).resolves.toEqual({ imageUrl: savedUrl, mediaId: "media-1" });
    expect(mocks.saveImage).toHaveBeenCalledExactlyOnceWith({
      projectId: "project-a",
      relativePath: expect.stringMatching(/^media\/ai-image\/\d{4}-\d{2}\/uncloth_.*\.png$/),
      source: "data:image/png;base64,b3V0cHV0",
    });
    expect(mocks.saveToMediaLibrary).toHaveBeenCalledExactlyOnceWith(savedUrl, request.prompt, "ai-image");
    expect(mocks.appendProjectLedger).toHaveBeenCalledExactlyOnceWith({
      projectId: "project-a",
      relativePath: "media/ai-image/2026-10/ledger.json",
      entry: {
        ts: expect.any(Number), prompt: request.prompt, model: "krea2-uncloth",
        file: "2026-10/result.png", references: [request.inputImageUrl], source: "image-studio-uncloth",
      },
    });
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith("无衣物处理完成");
    expect(JSON.parse(generation.fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      prompt: request.prompt, input_image: request.inputImageUrl, params: request.params,
    });
  });

  it("stops media and ledger writes if the project switches while saveImage is pending", async () => {
    const saving = deferred<void>();
    const saved = deferred<{ success: boolean; url: string }>();
    mocks.saveImage.mockImplementation(() => { saving.resolve(); return saved.promise; });
    const generation = pendingGeneration();
    const outcome = runUnclothChain(request).then(
      () => undefined, (error: unknown) => error,
    );
    await generation.started;
    generation.complete();
    await saving.promise;
    mocks.project.activeProjectId = "project-b";
    saved.resolve({ success: true, url: savedUrl });

    expect(await outcome).toBeInstanceOf(Error);
    expect(mocks.saveImage.mock.calls[0][0].projectId).toBe("project-a");
    expect(mocks.saveToMediaLibrary).not.toHaveBeenCalled();
    expect(mocks.appendProjectLedger).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
