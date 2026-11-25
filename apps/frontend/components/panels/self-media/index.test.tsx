// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF_MEDIA_CAPABILITY_MANIFEST } from "@/lib/self-media/capabilities";
import type { SelfMediaAccount, SelfMediaDraft, SelfMediaTask } from "@/types/self-media";
import { SelfMediaPanel } from "./index";

const mocks = vi.hoisted(() => ({
  tasks: [] as SelfMediaTask[],
  drafts: [] as SelfMediaDraft[],
  upsertTask: vi.fn(),
  addHistoryRecord: vi.fn(),
  ensureProject: vi.fn(),
  replaceProjectTasks: vi.fn(),
  setAccounts: vi.fn(),
  accounts: [] as SelfMediaAccount[],
  progressListeners: [] as Array<(event: { projectId: string; taskId: string; status: string; progress: number }) => void>,
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: Object.assign(
    <T,>(selector?: (state: { activeProjectId: string | null }) => T) => {
      const state = { activeProjectId: "project-1" };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ activeProjectId: "project-1" }) },
  ),
}));

vi.mock("@/stores/self-media/self-media-store", () => {
  const useSelfMediaStore = Object.assign(
    (selector: (state: {
      activeProjectId: string | null;
      tasks: SelfMediaTask[];
      drafts: SelfMediaDraft[];
      accounts: SelfMediaAccount[];
      ensureProject: typeof mocks.ensureProject;
      upsertTask: typeof mocks.upsertTask;
      addHistoryRecord: typeof mocks.addHistoryRecord;
      replaceProjectTasks: typeof mocks.replaceProjectTasks;
      setAccounts: typeof mocks.setAccounts;
    }) => unknown) => selector({
      activeProjectId: "project-1",
      tasks: mocks.tasks,
      drafts: mocks.drafts,
      accounts: mocks.accounts,
      ensureProject: mocks.ensureProject,
      upsertTask: mocks.upsertTask,
      addHistoryRecord: mocks.addHistoryRecord,
      replaceProjectTasks: mocks.replaceProjectTasks,
      setAccounts: mocks.setAccounts,
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

function createAccount(platform: keyof typeof SELF_MEDIA_CAPABILITY_MANIFEST): SelfMediaAccount {
  return {
    id: `account-${platform}`,
    providerId: "aitoearn-local",
    platform,
    displayName: `${SELF_MEDIA_CAPABILITY_MANIFEST[platform].displayName}账号`,
    status: "online",
    capabilities: SELF_MEDIA_CAPABILITY_MANIFEST[platform],
  };
}

function installBridge(
  cancelTask = vi.fn(),
  createTask = vi.fn(),
  options: {
    listProviders?: ReturnType<typeof vi.fn>;
    listAccounts?: ReturnType<typeof vi.fn>;
    startLogin?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const listProviders = options.listProviders ?? vi.fn().mockResolvedValue({
    success: true,
    value: [{
      id: "aitoearn-local",
      displayName: "本地发布",
      enabled: true,
      availablePlatforms: ["douyin", "xhs", "wxSph", "KWAI"],
    }],
  });
  const listAccounts = options.listAccounts ?? vi.fn().mockResolvedValue({ success: true, value: [] });
  const startLogin = options.startLogin ?? vi.fn().mockResolvedValue({ success: true, value: { started: true } });
  mocks.progressListeners = [];
  const onProgress = vi.fn((listener: (event: { projectId: string; taskId: string; status: string; progress: number }) => void) => {
    mocks.progressListeners.push(listener);
    return () => {};
  });
  Object.defineProperty(window, "selfMedia", {
    configurable: true,
    value: {
      listProviders,
      listAccounts,
      startLogin,
      listTasks: vi.fn().mockResolvedValue({ success: true, value: mocks.tasks }),
      dailyPublishStats: vi.fn().mockResolvedValue({ success: true, value: { date: "2026-11-25", limit: 3, counts: {} } }),
      cancelTask,
      createTask,
      onProgress,
    },
  });
  return { cancelTask, createTask, listProviders, listAccounts, startLogin, onProgress };
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
  mocks.setAccounts.mockReset();
  mocks.accounts = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.selfMedia;
});

describe("SelfMediaPanel task controls", () => {
  it("keeps the self-media header focused on its title", () => {
    render(<SelfMediaPanel />);

    expect(screen.getByRole("heading", { name: "自媒体发布台" })).toBeTruthy();
    expect(screen.queryByText("Self-media workspace")).toBeNull();
    expect(screen.queryByText("把 MYStudio 产物交给明确的发布 provider，账号、任务、历史与项目一起可追溯。")).toBeNull();
    expect(screen.queryByText("本地优先 · 不嵌入 Web")).toBeNull();
  });

  it("does not expose provider implementation status in the accounts view", () => {
    installBridge();

    render(<SelfMediaPanel />);

    expect(screen.queryByText("Provider 状态")).toBeNull();
    expect(screen.queryByText("AiToEarn 本地适配器")).toBeNull();
  });

  it("renders every platform from the shared capability manifest in account and compose controls", async () => {
    mocks.accounts = ["douyin", "xhs", "wxSph", "KWAI"].map((platform) => createAccount(platform as keyof typeof SELF_MEDIA_CAPABILITY_MANIFEST));
    installBridge();

    render(<SelfMediaPanel />);

    const platformCount = Object.keys(SELF_MEDIA_CAPABILITY_MANIFEST).length;
    expect(Object.values(SELF_MEDIA_CAPABILITY_MANIFEST)).toHaveLength(platformCount);
    expect(screen.getAllByRole("button", { name: "登录" })).toHaveLength(platformCount);
    for (const capability of Object.values(SELF_MEDIA_CAPABILITY_MANIFEST)) expect(screen.getByText(capability.displayName)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "发布" }));

    await waitFor(() => {
      for (const capability of Object.values(SELF_MEDIA_CAPABILITY_MANIFEST)) {
        const hasLocalTransport = ["douyin", "xhs", "wxSph", "KWAI"].includes(capability.platform);
        expect((screen.getByRole("button", { name: capability.displayName }) as HTMLButtonElement).disabled).toBe(!hasLocalTransport);
      }
    });
    expect((screen.getByRole("button", { name: "立即发布" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps all 15 account entries visible while disabling platforms without a configured transport", async () => {
    installBridge();
    render(<SelfMediaPanel />);

    for (const displayName of ["TikTok", "YouTube", "B站", "X（Twitter）", "微信公众号", "Facebook", "Instagram", "Threads", "Pinterest", "LinkedIn", "Google 商家资料"]) {
      await waitFor(() => {
        const card = screen.getByRole("heading", { name: displayName }).parentElement?.parentElement?.parentElement;
        expect(card).toBeTruthy();
        expect((within(card as HTMLElement).getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(true);
      });
    }
    for (const displayName of ["抖音", "小红书", "视频号", "快手"]) {
      const card = screen.getByRole("heading", { name: displayName }).parentElement?.parentElement?.parentElement;
      expect(card).toBeTruthy();
      expect((within(card as HTMLElement).getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("refreshes accounts through the enabled provider", async () => {
    const account = { id: "account-1", providerId: "aitoearn-local" as const, platform: "xhs" as const, displayName: "小红书账号", status: "online" as const, capabilities: SELF_MEDIA_CAPABILITY_MANIFEST.xhs };
    const listAccounts = vi.fn().mockResolvedValue({ success: true, value: [account] });
    const bridge = installBridge(vi.fn(), vi.fn(), { listAccounts });

    render(<SelfMediaPanel />);

    await waitFor(() => expect(listAccounts).toHaveBeenCalledWith({ projectId: "project-1", providerId: "aitoearn-local" }));
    expect(mocks.setAccounts).toHaveBeenCalledWith([account]);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(2));
    expect(bridge.listProviders).toHaveBeenCalledTimes(2);
  });

  it("starts login for a platform and refreshes its account list", async () => {
    const startLogin = vi.fn().mockResolvedValue({ success: true, value: { started: true } });
    const listAccounts = vi.fn().mockResolvedValue({ success: true, value: [] });
    installBridge(vi.fn(), vi.fn(), { listAccounts, startLogin });

    render(<SelfMediaPanel />);
    await waitFor(() => expect(listAccounts).toHaveBeenCalled());
    const xhsCard = screen.getByRole("heading", { name: "小红书" }).parentElement?.parentElement?.parentElement;
    expect(xhsCard).toBeTruthy();
    fireEvent.click(within(xhsCard as HTMLElement).getByRole("button", { name: "登录" }));

    await waitFor(() => expect(startLogin).toHaveBeenCalledWith({ projectId: "project-1", providerId: "aitoearn-local", platform: "xhs" }));
    await waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(2));
  });

  it("shows a connected account and its status inside the platform card", () => {
    mocks.accounts = [{ id: "account-1", providerId: "aitoearn-local", platform: "xhs", displayName: "已连接的小红书", status: "online", capabilities: SELF_MEDIA_CAPABILITY_MANIFEST.xhs }];
    installBridge();

    render(<SelfMediaPanel />);

    expect(screen.getByText("已连接的小红书")).toBeTruthy();
    expect(screen.getByText("在线")).toBeTruthy();
    expect(screen.getAllByText("1 个账号").length).toBeGreaterThanOrEqual(1);
  });

  it("only enables content types and publish actions supported by the selected platform", async () => {
    mocks.accounts = [createAccount("xhs"), createAccount("KWAI")];
    installBridge();
    render(<SelfMediaPanel />);
    fireEvent.click(screen.getByRole("button", { name: "发布" }));

    expect((screen.getByRole("button", { name: "LinkedIn" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "视频" }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole("button", { name: "图文" }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole("button", { name: "保存草稿" }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole("button", { name: "立即发布" }) as HTMLButtonElement).disabled).toBe(false);
    });

    await waitFor(() => expect((screen.getByRole("button", { name: "快手" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "快手" }));
    expect((screen.getByRole("button", { name: "视频" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "图文" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "保存草稿" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "小红书" }));
    expect((screen.getByRole("button", { name: "视频" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "图文" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("surfaces a corrupted task journal instead of silently showing no tasks", async () => {
    installBridge();
    window.selfMedia!.listTasks = vi.fn().mockResolvedValue({
      success: false,
      error: { code: "task-journal-corrupted", message: "自媒体任务日志已损坏或无法读取，已停止写入以防覆盖定时任务——请先备份或删除该文件后重启应用" },
    });

    render(<SelfMediaPanel />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("任务日志已损坏");
    expect(mocks.replaceProjectTasks).not.toHaveBeenCalled();
  });

  it("rehydrates recovered main-process tasks into the ledger (merged per task, not wholesale)", async () => {
    const recovered = createTask({ id: "task-recovered", status: "audit" });
    installBridge();
    window.selfMedia!.listTasks = vi.fn().mockResolvedValue({ success: true, value: [recovered] });

    render(<SelfMediaPanel />);

    // L6: 面板台账订阅改为逐条合并(upsertTask),不再整体 replaceProjectTasks
    await waitFor(() => expect(mocks.upsertTask).toHaveBeenCalledWith(recovered));
    expect(mocks.replaceProjectTasks).not.toHaveBeenCalled();
  });

  it("hides the retry button for failed batch tasks while keeping it for regular failures", async () => {
    mocks.tasks = [
      createTask({ id: "task-batch", status: "failure", progress: 100, batchId: "batch-1", batchRole: "member" }),
      createTask({ id: "task-plain", attemptId: "attempt-plain", status: "failure", progress: 100 }),
    ];
    installBridge();

    openTasks();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "重试任务" })).toHaveLength(1));
    // 仅存的「重试任务」属于普通失败任务(task-plain),批次任务没有
  });

  it("keeps the ledger updatedAt when a progress event arrives (no renderer clock overwrite)", async () => {
    const task = createTask({ id: "task-live", status: "running", progress: 10, updatedAt: "2026-07-26T05:00:00.000Z" });
    mocks.tasks = [task];
    const { onProgress } = installBridge();

    openTasks();
    await waitFor(() => expect(onProgress).toHaveBeenCalled());
    mocks.upsertTask.mockClear();
    const listener = mocks.progressListeners.at(-1)!;
    listener({ projectId: "project-1", taskId: "task-live", status: "success", progress: 100 });

    expect(mocks.upsertTask).toHaveBeenCalledTimes(1);
    const written = mocks.upsertTask.mock.calls[0]?.[0] as SelfMediaTask;
    expect(written.status).toBe("success");
    expect(written.updatedAt).toBe("2026-07-26T05:00:00.000Z"); // 保留台账时间,不用渲染时钟盖写
  });

  it("refetches the ledger after a terminal event and brings back error details and result links", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const task = createTask({ id: "task-refetch", status: "running", progress: 40, updatedAt: "2026-07-26T05:00:00.000Z" });
      mocks.tasks = [task];
      const { onProgress } = installBridge();
      const fetched = createTask({
        id: "task-refetch",
        status: "failure",
        progress: 100,
        updatedAt: "2026-07-26T05:01:00.000Z",
        resultUrl: "https://example.test/post/1",
        error: { code: "provider-request-failed", message: "上传失败", providerId: "aitoearn-local" as const, retryable: false },
      });
      const listTasks = window.selfMedia!.listTasks as ReturnType<typeof vi.fn>;
      listTasks.mockResolvedValue({ success: true, value: [fetched] });

      openTasks();
      await waitFor(() => expect(onProgress).toHaveBeenCalled());
      const listener = mocks.progressListeners.at(-1)!;
      listener({ projectId: "project-1", taskId: "task-refetch", status: "failure", progress: 100 });

      // 防抖 500ms 后重取,取回的错误详情/结果链接经合并写入
      await vi.advanceTimersByTimeAsync(600);
      await waitFor(() => {
        const written = mocks.upsertTask.mock.calls.find(([value]) => (value as SelfMediaTask).updatedAt === "2026-07-26T05:01:00.000Z");
        expect(written).toBeTruthy();
        expect((written?.[0] as SelfMediaTask).resultUrl).toBe("https://example.test/post/1");
        expect((written?.[0] as SelfMediaTask).error?.message).toBe("上传失败");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overwrite a newer local task when the refetched one is older", async () => {
    const task = createTask({ id: "task-older", status: "failure", progress: 100, updatedAt: "2026-07-26T05:00:00.000Z" });
    mocks.tasks = [task];
    installBridge();
    const stale = createTask({ id: "task-older", status: "running", progress: 10, updatedAt: "2026-07-26T04:00:00.000Z" });
    const listTasks = window.selfMedia!.listTasks as ReturnType<typeof vi.fn>;
    listTasks.mockResolvedValue({ success: true, value: [stale] });

    openTasks();

    // 取来的 updatedAt 比现有任务旧:合并规则把它挡在外面
    await waitFor(() => expect(listTasks).toHaveBeenCalled());
    expect(mocks.upsertTask).not.toHaveBeenCalledWith(expect.objectContaining({ updatedAt: "2026-07-26T04:00:00.000Z" }));
  });

  it("cancels a running task through the typed bridge and writes the returned task", async () => {
    const task = createTask();
    mocks.tasks = [task];
    const canceled = { ...task, status: "canceled" as const, updatedAt: "2026-07-26T01:00:00.000Z" };
    const { cancelTask } = installBridge(vi.fn().mockResolvedValue({ success: true, value: canceled }));

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
    // 台账初次合并会写一次未变化任务;清掉后再验证取消失败路径不写
    await waitFor(() => expect(mocks.upsertTask).toHaveBeenCalled());
    mocks.upsertTask.mockClear();
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
    await waitFor(() => expect(mocks.upsertTask).toHaveBeenCalled()); // 台账初次合并
    mocks.upsertTask.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "重试任务" }));

    expect(await screen.findByText("当前运行环境缺少创建重试任务所需的自媒体桥接，未创建重试任务。")).toBeTruthy();
    expect(mocks.upsertTask).not.toHaveBeenCalled();
  });
});
