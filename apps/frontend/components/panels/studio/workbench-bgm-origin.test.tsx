// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { WorkbenchTab } from "./WorkbenchTab";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ComfyExecuteJobReply, ComfyExecuteProgress } from "@/lib/assist/image-studio/comfy-execute";
import type { RemotionChapterManifestV2 } from "@/types/remotion-workspace";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), content: vi.fn(), persist: vi.fn(), readAudio: vi.fn(),
  success: vi.fn(), fingerprint: vi.fn(), bindingFingerprint: vi.fn(),
}));
vi.mock("@/lib/assist/image-studio/comfy-execute", () => ({
  runComfyExecute: mocks.execute, persistComfyAudio: mocks.persist, comfyImageUrlToB64: mocks.readAudio,
}));
vi.mock("@/lib/assist/image-studio/comfy-workflow-library", () => ({
  getComfyWorkflowLibraryTransport: () => ({ content: mocks.content }),
}));
vi.mock("@/lib/studio/remotion/remotion-audio-fingerprint", () => ({
  createRemotionChapterManifestFingerprint: mocks.fingerprint,
  createRemotionAudioBindingFingerprint: mocks.bindingFingerprint,
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: vi.fn() } }));
vi.mock("./useEditingWorkbenchActions", () => ({ useEditingWorkbenchActions: () => ({ hyperFramesState: "blocked" }) }));
vi.mock("./useSceneSegmentExport", () => ({ useSceneSegmentExport: () => ({ scenes: [], pendingJobStatuses: [] }) }));
vi.mock("./VisualContinuityReviewPanel", () => ({ VisualContinuityReviewPanel: () => null }));
vi.mock("./VideoWorkflowReviewPanel", () => ({ VideoWorkflowReviewPanel: () => null }));
vi.mock("./ShotProductionOverview", () => ({ ShotProductionOverview: () => null }));
vi.mock("./SfxGenerateDialog", () => ({ SfxGenerateDialog: () => null }));
vi.mock("./NativeRemotionStudioHost", () => ({ NativeRemotionStudioHost: () => null }));
vi.mock("abcjs", () => ({ renderAbc: vi.fn() }));

type ExecuteResult = NonNullable<ComfyExecuteJobReply["result"]>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const audio: ExecuteResult = { audios: [{ b64: "QUJD", filename: "song.flac" }] };
const workflow = JSON.stringify({ "22": { class_type: "YuE2GenerateMusic", inputs: { seed: 42 } } });
const saved = { filePath: "/project-a/song.flac", url: "project-file://project-a/media/audio/song.flac" };
const importResult = {
  durationUs: 1_000_000,
  source: { kind: "project-file" as const, projectId: "project-a", relativePath: "remotion/audio/song.flac", contentSha256: "a".repeat(64) },
};
let read: Mock<any, any>;
let importAudio: Mock<any, any>;
let write: Mock<any, any>;
let closeSession: Mock<any, any>;

function manifest(projectId: string, chapterId: string): RemotionChapterManifestV2 {
  return { projectId, chapterId, revision: 1, sharedAudioBindings: [], shots: [] } as unknown as RemotionChapterManifestV2;
}
beforeEach(() => {
  vi.resetAllMocks();
  useProjectStore.setState({ activeProjectId: "project-a" });
  useStudioStore.setState({ activeChapterId: "chapter-a", continuityAssetVersions: [] });
  mocks.content.mockResolvedValue(workflow);
  mocks.execute.mockResolvedValue(audio);
  mocks.persist.mockResolvedValue(saved);
  mocks.readAudio.mockResolvedValue("QUJD");
  mocks.fingerprint.mockResolvedValue("f".repeat(64));
  mocks.bindingFingerprint.mockResolvedValue("b".repeat(64));
  read = vi.fn(async ({ projectId, chapterId }) => ({ status: "ready", manifest: manifest(projectId, chapterId) }));
  importAudio = vi.fn(async () => importResult);
  write = vi.fn(async () => undefined);
  closeSession = vi.fn(async () => undefined);
  window.remotionChapterManifest = { read, importAudio, write } as unknown as NonNullable<Window["remotionChapterManifest"]>;
  window.remotionStudio = { closeSession } as unknown as NonNullable<Window["remotionStudio"]>;
  window.studioAssets = { list: vi.fn(async () => ({ items: [{ id: "reference", name: "reference.flac", previewUrl: "asset-file://audio/reference.flac" }] })) } as unknown as NonNullable<Window["studioAssets"]>;
});
afterEach(() => {
  cleanup();
  delete window.remotionChapterManifest;
  delete window.remotionStudio;
  delete window.studioAssets;
});

async function mount() {
  const view = render(<WorkbenchTab projectId="project-a" episodeId="chapter-a" storyboards={[]} />);
  await waitFor(() => expect(view.container.querySelector<HTMLButtonElement>("[data-bgm-local-generate]")?.disabled).toBe(false));
  fireEvent.click(view.container.querySelector("[data-bgm-local-generate]")!);
  await waitFor(() => expect(view.container.querySelector('option[value="reference"]')).not.toBeNull());
  return view;
}
async function start(view: Awaited<ReturnType<typeof mount>>, lane: string) {
  if (lane === "cover") {
    fireEvent.change(view.container.querySelector("[data-bgm-cover-asset-select]")!, { target: { value: "reference" } });
  }
  if (lane === "render") {
    mocks.execute.mockResolvedValueOnce({ texts: [{ text: "X:1\nK:C\nC" }] });
    fireEvent.click(view.container.querySelector("[data-bgm-score-run]")!);
    await waitFor(() => expect(view.container.querySelector<HTMLButtonElement>("[data-bgm-score-render]")?.disabled).toBe(false));
    mocks.execute.mockClear();
    mocks.success.mockClear();
  }
  const execution = deferred<ExecuteResult>();
  mocks.execute.mockReturnValueOnce(execution.promise);
  const selector = ({ single: "generate-run", batch: "batch-run", score: "score-run", render: "score-render", cover: "cover-run" } as Record<string, string>)[lane];
  fireEvent.click(view.container.querySelector(`[data-bgm-${selector}]`)!);
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
  return execution;
}

describe("Workbench BGM async origin", () => {
  it.each(["single", "batch", "score", "cover"])("%s stops before submission when workflow loading outlives its scope", async (lane) => {
    const loading = deferred<string>();
    mocks.content.mockReturnValueOnce(loading.promise);
    const view = await mount();
    if (lane === "cover") fireEvent.change(view.container.querySelector("[data-bgm-cover-asset-select]")!, { target: { value: "reference" } });
    const selector = ({ single: "generate-run", batch: "batch-run", score: "score-run", cover: "cover-run" } as Record<string, string>)[lane];
    fireEvent.click(view.container.querySelector(`[data-bgm-${selector}]`)!);
    await waitFor(() => expect(mocks.content).toHaveBeenCalledOnce());
    act(() => {
      useStudioStore.setState({ activeChapterId: "chapter-b" });
      useStudioStore.setState({ activeChapterId: "chapter-a" });
    });
    await act(async () => { loading.resolve(workflow); });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.readAudio).not.toHaveBeenCalled();
    expect(importAudio).not.toHaveBeenCalled();
  });

  it.each(["single", "batch", "score", "render", "cover"])("%s suppresses A → B → A results and progress, and never submits another batch item", async (lane) => {
    const view = await mount();
    const pending = await start(view, lane);
    const onProgress = mocks.execute.mock.calls[0][1] as (progress: ComfyExecuteProgress) => void;
    act(() => {
      useProjectStore.setState({ activeProjectId: "project-b" });
      useProjectStore.setState({ activeProjectId: "project-a" });
      onProgress({ stage: "running", message: "stale-progress" });
    });
    await act(async () => { pending.resolve(lane === "score" ? { texts: [{ text: "stale-score" }] } : audio); });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    if (lane !== "score") expect(mocks.persist).toHaveBeenCalledWith("QUJD", "song.flac", "project-a");
    expect(importAudio).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain("stale-progress");
    expect(view.container.querySelector("[data-bgm-score-abc-input]")).toBeNull();
    expect(view.container.querySelector("[data-bgm-batch-results]")).toBeNull();
  });

  it.each(["project", "chapter"])("latches %s round trips while persistence is pending", async (kind) => {
    const storage = deferred<typeof saved>();
    mocks.persist.mockReturnValueOnce(storage.promise);
    const view = await mount();
    const pending = await start(view, "single");
    await act(async () => { pending.resolve(audio); });
    await waitFor(() => expect(mocks.persist).toHaveBeenCalledOnce());
    act(() => {
      if (kind === "project") {
        useProjectStore.setState({ activeProjectId: "project-b" });
        useProjectStore.setState({ activeProjectId: "project-a" });
      } else {
        useStudioStore.setState({ activeChapterId: "chapter-b" });
        useStudioStore.setState({ activeChapterId: "chapter-a" });
      }
    });
    await act(async () => { storage.resolve(saved); });
    expect(importAudio).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("does not reuse the new chapter manifest after an old import resolves", async () => {
    const imported = deferred<typeof importResult>();
    importAudio.mockReturnValueOnce(imported.promise);
    const view = await mount();
    const pending = await start(view, "single");
    await act(async () => { pending.resolve(audio); });
    await waitFor(() => expect(importAudio).toHaveBeenCalledOnce());
    view.rerender(<WorkbenchTab projectId="project-a" episodeId="chapter-b" storyboards={[]} />);
    await waitFor(() => expect(read).toHaveBeenCalledWith({ projectId: "project-a", chapterId: "chapter-b" }));
    await act(async () => { imported.resolve(importResult); });
    expect(write).not.toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("keeps successful same-scope save and bind behavior", async () => {
    const view = await mount();
    const pending = await start(view, "single");
    await act(async () => { pending.resolve(audio); });
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(mocks.persist).toHaveBeenCalledWith("QUJD", "song.flac", "project-a");
    expect(importAudio).toHaveBeenCalledWith({ projectId: "project-a", chapterId: "chapter-a", role: "bgm", sourcePath: saved.filePath });
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-a", chapterId: "chapter-a", expectedRevision: 1 }));
    expect(mocks.success).toHaveBeenCalledWith("本地 BGM 已生成并绑定到本章");
  });

  it("stops cover submission after its reference read becomes stale", async () => {
    const reference = deferred<string>();
    mocks.readAudio.mockReturnValueOnce(reference.promise);
    const view = await mount();
    fireEvent.change(view.container.querySelector("[data-bgm-cover-asset-select]")!, { target: { value: "reference" } });
    fireEvent.click(view.container.querySelector("[data-bgm-cover-run]")!);
    await waitFor(() => expect(mocks.readAudio).toHaveBeenCalledOnce());
    view.rerender(<WorkbenchTab projectId="project-a" episodeId="chapter-b" storyboards={[]} />);
    view.rerender(<WorkbenchTab projectId="project-a" episodeId="chapter-a" storyboards={[]} />);
    await act(async () => { reference.resolve("QUJD"); });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it.each(["binding", "manifest"])("does not write after a scope switch during %s fingerprinting", async (phase) => {
    const fingerprint = deferred<string>();
    (phase === "binding" ? mocks.bindingFingerprint : mocks.fingerprint).mockReturnValueOnce(fingerprint.promise);
    const view = await mount();
    const pending = await start(view, "single");
    await act(async () => { pending.resolve(audio); });
    await waitFor(() => expect(phase === "binding" ? mocks.bindingFingerprint : mocks.fingerprint).toHaveBeenCalledOnce());
    act(() => {
      useStudioStore.setState({ activeChapterId: "chapter-b" });
      useStudioStore.setState({ activeChapterId: "chapter-a" });
    });
    await act(async () => { fingerprint.resolve("f".repeat(64)); });
    expect(write).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("an old write completion cannot release the new operation lock or overwrite its manifest", async () => {
    const written = deferred<void>();
    write.mockReturnValueOnce(written.promise);
    const view = await mount();
    const first = await start(view, "single");
    await act(async () => { first.resolve(audio); });
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    act(() => {
      useProjectStore.setState({ activeProjectId: "project-b" });
      useProjectStore.setState({ activeProjectId: "project-a" });
    });
    await waitFor(() => expect(view.container.querySelector<HTMLButtonElement>("[data-bgm-generate-run]")?.disabled).toBe(false));
    mocks.execute.mockClear();
    const second = await start(view, "single");
    await act(async () => { written.resolve(); });
    expect(view.container.querySelector<HTMLButtonElement>("[data-bgm-generate-run]")?.disabled).toBe(true);
    expect(view.container.textContent).toContain("第 1 版");
    expect(closeSession).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    await act(async () => { second.resolve(audio); });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(mocks.success).toHaveBeenCalledOnce();
  });

  it("unmount leaves completed audio in its origin project without binding or publishing UI success", async () => {
    const view = await mount();
    const pending = await start(view, "single");
    view.unmount();
    await act(async () => { pending.resolve(audio); });
    expect(mocks.persist).toHaveBeenCalledWith("QUJD", "song.flac", "project-a");
    expect(importAudio).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("reports import failure without claiming that generation was bound", async () => {
    importAudio.mockRejectedValueOnce(new Error("import failed"));
    const view = await mount();
    const pending = await start(view, "single");
    await act(async () => { pending.resolve(audio); });
    expect(view.container.textContent).toContain("import failed");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(view.container.querySelector<HTMLButtonElement>("[data-bgm-generate-run]")?.disabled).toBe(false);
  });

  it("drops a previous asset listing after changing chapters", async () => {
    const view = await mount();
    const listing = deferred<{ items: Array<{ id: string; name: string; previewUrl: string }> }>();
    vi.mocked(window.studioAssets!.list).mockReturnValueOnce(listing.promise as ReturnType<NonNullable<Window["studioAssets"]>["list"]>);
    fireEvent.click(view.container.querySelector("[data-bgm-cover-refresh]")!);
    view.rerender(<WorkbenchTab projectId="project-a" episodeId="chapter-b" storyboards={[]} />);
    await act(async () => { listing.resolve({ items: [{ id: "old-reference", name: "old-reference", previewUrl: "asset-file://audio/old.flac" }] }); });
    expect(view.container.querySelector('option[value="old-reference"]')).toBeNull();
  });

  it("keeps same-scope batch choices bindable and clears them on a chapter round trip", async () => {
    const view = await mount();
    const pending = await start(view, "batch");
    await act(async () => { pending.resolve(audio); });
    await waitFor(() => expect(view.container.querySelector("[data-bgm-batch-pick]")).not.toBeNull());
    fireEvent.click(view.container.querySelector("[data-bgm-batch-pick]")!);
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(view.container.querySelector("[data-bgm-batch-results]")).toBeNull();
    mocks.execute.mockClear();
    const second = await start(view, "batch");
    await act(async () => { second.resolve(audio); });
    await waitFor(() => expect(view.container.querySelector("[data-bgm-batch-results]")).not.toBeNull());
    act(() => {
      useStudioStore.setState({ activeChapterId: "chapter-b" });
      useStudioStore.setState({ activeChapterId: "chapter-a" });
    });
    expect(view.container.querySelector("[data-bgm-batch-results]")).toBeNull();
    expect(write).toHaveBeenCalledOnce();
  });

  it("does not display an old rejection over a new operation", async () => {
    const view = await mount();
    const first = await start(view, "single");
    act(() => {
      useProjectStore.setState({ activeProjectId: "project-b" });
      useProjectStore.setState({ activeProjectId: "project-a" });
    });
    mocks.execute.mockClear();
    const second = await start(view, "single");
    await act(async () => { first.reject(new Error("old-execution-failed")); });
    expect(view.container.textContent).not.toContain("old-execution-failed");
    expect(view.container.querySelector<HTMLButtonElement>("[data-bgm-generate-run]")?.disabled).toBe(true);
    await act(async () => { second.resolve(audio); });
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
  });

  it("survives StrictMode effect replay and cleans up on unmount", async () => {
    const view = render(<StrictMode><WorkbenchTab projectId="project-a" episodeId="chapter-a" storyboards={[]} /></StrictMode>);
    await waitFor(() => expect(view.container.querySelector<HTMLButtonElement>("[data-bgm-local-generate]")?.disabled).toBe(false));
    fireEvent.click(view.container.querySelector("[data-bgm-local-generate]")!);
    const pending = await start(view, "single");
    await act(async () => { pending.resolve(audio); });
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    view.unmount();
    act(() => { useProjectStore.setState({ activeProjectId: "project-b" }); });
    expect(mocks.success).toHaveBeenCalledOnce();
  });
});
