// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelfMediaDraft, SelfMediaTask } from "@/types/self-media";
import { SelfMediaPanel } from "./index";

const mocks = vi.hoisted(() => ({
  tasks: [] as SelfMediaTask[],
  drafts: [] as SelfMediaDraft[],
  upsertTask: vi.fn(),
  addHistoryRecord: vi.fn(),
  ensureProject: vi.fn(),
  replaceProjectTasks: vi.fn(),
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: Object.assign(
    <T,>(selector: (state: { activeProjectId: string | null }) => T) => selector({ activeProjectId: "project-1" }),
    { getState: () => ({ activeProjectId: "project-1" }) },
  ),
}));

vi.mock("@/stores/self-media/self-media-store", () => {
  const useSelfMediaStore = Object.assign(
    (selector: (state: {
      activeProjectId: string | null;
      tasks: SelfMediaTask[];
      drafts: SelfMediaDraft[];
      accounts: [];
      ensureProject: typeof mocks.ensureProject;
      upsertTask: typeof mocks.upsertTask;
      addHistoryRecord: typeof mocks.addHistoryRecord;
      replaceProjectTasks: typeof mocks.replaceProjectTasks;
    }) => unknown) => selector({
      activeProjectId: "project-1",
      tasks: mocks.tasks,
      drafts: mocks.drafts,
      accounts: [],
      ensureProject: mocks.ensureProject,
      upsertTask: mocks.upsertTask,
      addHistoryRecord: mocks.addHistoryRecord,
      replaceProjectTasks: mocks.replaceProjectTasks,
    }),
    { getState: () => ({ activeProjectId: "project-1", tasks: mocks.tasks }) },
  );
  return { useSelfMediaStore };
});

function createTask(overrides: Partial<SelfMediaTask> = {}): SelfMediaTask {
  return {
    id: "task-1",
    attemptId: "attempt-1",
    projectId: "project-1",
    providerId: "aitoearn-local",
    accountId: "account-1",
    sourceAssetIds: ["asset-1"],
    status: "running",
    progress: 42,
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

function installBridge(cancelTask = vi.fn(), createTask = vi.fn()) {
  Object.defineProperty(window, "selfMedia", {
    configurable: true,
    value: {
      listProviders: vi.fn().mockResolvedValue({ success: true, value: [] }),
      listTasks: vi.fn().mockResolvedValue({ success: true, value: mocks.tasks }),
      cancelTask,
      createTask,
      onProgress: vi.fn(() => () => {}),
    },
  });
  return cancelTask;
}

function openTasks() {
  render(<SelfMediaPanel />);
  fireEvent.click(screen.getByRole("button", { name: "任务" }));
}

beforeEach(() => {
  mocks.tasks = [];
  mocks.drafts = [];
  mocks.upsertTask.mockReset();
  mocks.addHistoryRecord.mockReset();
  mocks.ensureProject.mockReset();
  mocks.replaceProjectTasks.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.selfMedia;
});

describe("SelfMediaPanel task controls", () => {
  it("does not expose provider implementation status in the accounts view", () => {
    installBridge();

    render(<SelfMediaPanel />);

    expect(screen.queryByText("Provider 状态")).toBeNull();
    expect(screen.queryByText("AiToEarn 本地适配器")).toBeNull();
  });

  it("rehydrates recovered main-process tasks for the active project", async () => {
    const recovered = createTask({ id: "task-recovered", status: "audit" });
    installBridge();
    window.selfMedia!.listTasks = vi.fn().mockResolvedValue({ success: true, value: [recovered] });

    render(<SelfMediaPanel />);

    await waitFor(() => expect(mocks.replaceProjectTasks).toHaveBeenCalledWith("project-1", [recovered]));
  });

  it("cancels a running task through the typed bridge and writes the returned task", async () => {
    const task = createTask();
    mocks.tasks = [task];
    const canceled = { ...task, status: "canceled" as const, updatedAt: "2026-07-26T01:00:00.000Z" };
    const cancelTask = installBridge(vi.fn().mockResolvedValue({ success: true, value: canceled }));

    openTasks();
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));

    await waitFor(() => expect(cancelTask).toHaveBeenCalledWith({ projectId: "project-1", taskId: "task-1" }));
    expect(mocks.upsertTask).toHaveBeenCalledWith(canceled);
    expect(screen.getByText("任务 task-1 已取消。")).toBeTruthy();
  });

  it("keeps the task unchanged and surfaces a bridge cancellation error", async () => {
    mocks.tasks = [createTask()];
    installBridge(vi.fn().mockResolvedValue({ success: false, error: { code: "provider-error", message: "provider 暂不可用" } }));

    openTasks();
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));

    expect(await screen.findByText("provider 暂不可用")).toBeTruthy();
    expect(mocks.upsertTask).not.toHaveBeenCalled();
  });

  it("creates a retry through the typed bridge and reports its source linkage", async () => {
    const retryDraft: SelfMediaDraft = {
      id: "draft-retry", projectId: "project-1", contentType: "video", title: "重试", description: "", topics: [],
      assets: [{ assetId: "asset-1", projectId: "project-1", kind: "video" }], accountIds: ["account-1"],
      visibility: "public", platformOptions: {}, updatedAt: "2026-07-26T00:00:00.000Z",
    };
    const failed = createTask({ id: "task-failed", draftId: retryDraft.id, status: "failure", progress: 100 });
    const retry = createTask({
      id: "task-retry",
      attemptId: "attempt-retry",
      status: "draft",
      progress: 0,
      previousTaskId: failed.id,
    });
    mocks.tasks = [failed];
    mocks.drafts = [retryDraft];
    const createTaskBridge = vi.fn().mockResolvedValue({ success: true, value: [retry] });
    installBridge(vi.fn(), createTaskBridge);

    openTasks();
    fireEvent.click(screen.getByRole("button", { name: "重试任务" }));

    await waitFor(() => expect(createTaskBridge).toHaveBeenCalledWith({
      projectId: "project-1", providerId: "aitoearn-local", draft: retryDraft, previousTaskId: "task-failed",
    }));
    expect(await screen.findByText("已创建 1 个重试任务，关联原任务 task-failed。")).toBeTruthy();
  });

  it("does not expose retry actions for tasks that have not failed", () => {
    mocks.tasks = [createTask({ status: "scheduled", progress: 0 })];
    installBridge();

    openTasks();

    expect(screen.queryByRole("button", { name: "重试任务" })).toBeNull();
  });

  it("does not create a renderer-only retry when the self-media bridge is unavailable", async () => {
    mocks.tasks = [createTask({ id: "task-failed", status: "failure", progress: 100 })];

    openTasks();
    fireEvent.click(screen.getByRole("button", { name: "重试任务" }));

    expect(await screen.findByText("当前运行环境缺少创建重试任务所需的自媒体桥接，未创建重试任务。")).toBeTruthy();
  });

  it("does not create a renderer-only retry when createTask is missing", async () => {
    const retryDraft: SelfMediaDraft = {
      id: "draft-retry", projectId: "project-1", contentType: "video", title: "重试", description: "", topics: [],
      assets: [{ assetId: "asset-1", projectId: "project-1", kind: "video" }], accountIds: ["account-1"],
      visibility: "public", platformOptions: {}, updatedAt: "2026-07-26T00:00:00.000Z",
    };
    mocks.tasks = [createTask({ id: "task-failed", draftId: retryDraft.id, status: "failure", progress: 100 })];
    mocks.drafts = [retryDraft];
    installBridge();
    delete (window.selfMedia as { createTask?: unknown }).createTask;

    openTasks();
    fireEvent.click(screen.getByRole("button", { name: "重试任务" }));

    expect(await screen.findByText("当前运行环境缺少创建重试任务所需的自媒体桥接，未创建重试任务。")).toBeTruthy();
    expect(mocks.upsertTask).not.toHaveBeenCalled();
  });
});
