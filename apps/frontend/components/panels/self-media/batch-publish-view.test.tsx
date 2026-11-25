// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelfMediaAccount, SelfMediaDraft, SelfMediaTask } from "@/types/self-media";
import { BATCH_PUBLISH_INTERVAL_MS } from "@/lib/self-media/batch-policy";
import { BatchPublishView } from "./batch-publish-view";

const mocks = vi.hoisted(() => ({
  accounts: [] as SelfMediaAccount[],
  tasks: [] as SelfMediaTask[],
  upsertTask: vi.fn(),
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

vi.mock("@/stores/media/media-store", () => ({
  useMediaStore: (selector: (state: { mediaFiles: Array<Record<string, unknown>> }) => unknown) =>
    selector({
      mediaFiles: [
        { id: "video-1", projectId: "project-1", type: "video", name: "成片.mp4", url: "project-file://project-1/video.mp4", ephemeral: false },
      ],
    }),
}));

vi.mock("@/stores/self-media/self-media-store", () => {
  const useSelfMediaStore = Object.assign(
    (selector: (state: {
      accounts: SelfMediaAccount[];
      tasks: SelfMediaTask[];
      upsertTask: typeof mocks.upsertTask;
    }) => unknown) => selector({ accounts: mocks.accounts, tasks: mocks.tasks, upsertTask: mocks.upsertTask }),
    {
      getState: () => ({
        activeProjectId: "project-1",
        accounts: mocks.accounts,
        tasks: mocks.tasks,
        upsertTask: (task: SelfMediaTask) => {
          mocks.upsertTask(task);
          mocks.tasks = [task, ...mocks.tasks.filter((item) => item.id !== task.id)];
        },
      }),
    },
  );
  return { useSelfMediaStore };
});

vi.mock("@/stores/product/product-store", () => ({
  useProductStore: Object.assign(
    (selector: (state: { products: unknown[] }) => unknown) => selector({ products: [] }),
    { getState: () => ({ products: [], setProducts: vi.fn() }) },
  ),
}));

vi.mock("@/stores/template/template-store", () => ({
  useTemplateStore: Object.assign(
    (selector: (state: { templates: unknown[] }) => unknown) => selector({ templates: [] }),
    { getState: () => ({ templates: [], loadTemplates: vi.fn(async () => undefined) }) },
  ),
}));

function createAccount(platform: SelfMediaAccount["platform"], id?: string): SelfMediaAccount {
  const capability = {
    providerId: "aitoearn-local" as const,
    platform,
    displayName: platform === "xhs" ? "小红书" : platform === "twitter" ? "X（Twitter）" : platform === "douyin" ? "抖音" : platform,
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: [] as string[],
  };
  return {
    id: id ?? `account-${platform}`,
    providerId: "aitoearn-local",
    platform,
    displayName: `${capability.displayName}账号`,
    status: "online",
    capabilities: capability,
  };
}

function ledgerTask(overrides: Partial<SelfMediaTask> & Pick<SelfMediaTask, "id" | "batchId" | "batchRole">): SelfMediaTask {
  return {
    attemptId: `attempt-${overrides.id}`,
    projectId: "project-1",
    providerId: "aitoearn-local",
    accountId: "account-xhs",
    sourceAssetIds: ["video-1"],
    status: "scheduled",
    progress: 0,
    platform: "xhs",
    scheduledAt: "2099-01-01T00:05:00.000Z",
    createdAt: "2026-11-25T01:00:00.000Z",
    updatedAt: "2026-11-25T02:00:00.000Z",
    ...overrides,
  };
}

function installBridge(createTask = vi.fn(), dailyCounts: Record<string, number> = {}) {
  const dailyPublishStats = vi.fn().mockResolvedValue({ success: true, value: { date: "2026-11-25", limit: 3, counts: dailyCounts } });
  Object.defineProperty(window, "selfMedia", {
    configurable: true,
    value: {
      createTask,
      dailyPublishStats,
      listTasks: vi.fn().mockResolvedValue({ success: true, value: [] }),
      onProgress: vi.fn(() => () => {}),
    },
  });
  Object.defineProperty(window, "productBridge", {
    configurable: true,
    value: { list: vi.fn().mockResolvedValue({ success: true, value: [] }) },
  });
  return { createTask, dailyPublishStats };
}

function scheduledReply(draft: SelfMediaDraft): { success: true; value: SelfMediaTask[] } {
  return {
    success: true,
    value: [{
      id: `task-${draft.accountIds[0]}`,
      attemptId: `attempt-${draft.accountIds[0]}`,
      draftId: draft.id,
      projectId: draft.projectId,
      providerId: "aitoearn-local",
      accountId: draft.accountIds[0],
      sourceAssetIds: ["video-1"],
      status: "scheduled",
      progress: 0,
      batchId: draft.batchId,
      batchRole: draft.batchRole,
      platform: (draft.platformOptions.platform as SelfMediaTask["platform"]) ?? undefined,
      scheduledAt: draft.scheduledAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
  };
}

function selectAccountsAndPublish() {
  // 选媒体资产(草稿契约要求至少一个资产),再点发布
  fireEvent.change(screen.getByLabelText("媒体资产"), { target: { value: "video-1" } });
  fireEvent.click(screen.getByRole("button", { name: "一键全平台发布" }));
}

beforeEach(() => {
  mocks.accounts = [];
  mocks.tasks = [];
  mocks.upsertTask.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.selfMedia;
  delete window.productBridge;
});

describe("BatchPublishView (L6 整批建单)", () => {
  it("creates one scheduled task per account with a shared batchId, ladder scheduledAt, and no result waiting", async () => {
    mocks.accounts = [createAccount("xhs"), createAccount("twitter")];
    const createTask = vi.fn(async ({ draft }: { draft: SelfMediaDraft }) => scheduledReply(draft));
    installBridge(createTask);

    render(<BatchPublishView />);
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((checkbox) => fireEvent.click(checkbox));
    await selectAccountsAndPublish();

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    const drafts = createTask.mock.calls.map(([arg]) => arg.draft as SelfMediaDraft);
    const batchIds = new Set(drafts.map((draft) => draft.batchId));
    expect(batchIds.size).toBe(1); // 同一 batchId 贯穿整批
    expect(drafts.map((draft) => draft.batchRole)).toEqual(["verification", "member"]);
    const times = drafts.map((draft) => Date.parse(draft.scheduledAt as string)).sort((a, b) => a - b);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(BATCH_PUBLISH_INTERVAL_MS - 1_000);
    // 渲染进程不等发布结果:回执是 scheduled 状态
    expect(drafts.every((draft) => typeof draft.scheduledAt === "string")).toBe(true);
  });

  it("creates no tasks when the selected accounts exceed the per-batch limit", async () => {
    mocks.accounts = Array.from({ length: 11 }, (_, index) => createAccount("douyin", `account-douyin-${index}`));
    const createTask = vi.fn();
    installBridge(createTask);

    render(<BatchPublishView />);
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((checkbox) => fireEvent.click(checkbox));
    selectAccountsAndPublish();

    await waitFor(() => expect(screen.getByText(/单批次最多/)).toBeTruthy());
    expect(createTask).not.toHaveBeenCalled();
  }, 15_000);

  it("stops the batch without creating the rest when the verification slot fails to create", async () => {
    mocks.accounts = [createAccount("xhs"), createAccount("twitter")];
    const createTask = vi.fn(async ({ draft }: { draft: SelfMediaDraft }) => {
      if (draft.batchRole === "verification") return { success: false as const, error: { code: "provider-disabled", message: "provider 尚未启用" } };
      return scheduledReply(draft);
    });
    installBridge(createTask);

    render(<BatchPublishView />);
    screen.getAllByRole("checkbox").forEach((checkbox) => fireEvent.click(checkbox));
    await selectAccountsAndPublish();

    await waitFor(() => expect(screen.getByText("首发验证（X（Twitter））失败，已终止批量发布。")).toBeTruthy());
    expect(createTask).toHaveBeenCalledTimes(1); // 首槽失败,不建其余
  });

  it("keeps creating the remaining members when the first slot is not a verification task", async () => {
    mocks.accounts = [createAccount("xhs", "account-xhs"), createAccount("xhs", "account-xhs-2")];
    const createTask = vi.fn(async ({ draft }: { draft: SelfMediaDraft }) => {
      if (draft.accountIds[0] === "account-xhs") return { success: false as const, error: { code: "provider-disabled", message: "provider 尚未启用" } };
      return scheduledReply(draft);
    });
    installBridge(createTask);

    render(<BatchPublishView />);
    screen.getAllByRole("checkbox").forEach((checkbox) => fireEvent.click(checkbox));
    await selectAccountsAndPublish();

    // 单平台批次没有首发验证:首条建单失败照建其余
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(screen.getByText("1 个任务建单失败，详见进度面板。")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("provider 尚未启用")).toBeTruthy());
  });

  it("rebuilds the progress panel from the ledger batchId after remount", async () => {
    mocks.tasks = [
      ledgerTask({ id: "task-m1", batchId: "batch-old", batchRole: "member", status: "success", progress: 100 }),
      ledgerTask({ id: "task-m2", batchId: "batch-old", batchRole: "member", accountId: "account-xhs-2", status: "failure", progress: 100, error: { code: "x", message: "上传失败", providerId: "aitoearn-local", retryable: true } }),
    ];
    installBridge();

    render(<BatchPublishView />);

    await waitFor(() => expect(screen.getByText("发布进度")).toBeTruthy());
    expect(screen.getByText("已完成 2/2")).toBeTruthy();
    expect(screen.getByText("上传失败")).toBeTruthy();
    // 平台徽标有可靠来源时显示
    expect(screen.getAllByText("小红书").length).toBeGreaterThanOrEqual(2);
  });

  it("disables the publish button while the current batch still has unfinished today-tasks", async () => {
    mocks.tasks = [
      ledgerTask({ id: "task-q", batchId: "batch-old", batchRole: "queued", accountId: "account-xhs-2" }),
      ledgerTask({ id: "task-p", batchId: "batch-old", batchRole: "member" }),
    ];
    installBridge();

    render(<BatchPublishView />);

    const button = await screen.findByRole("button", { name: /发布中…/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("falls back the display name to 平台名 · 账号 ID 末 6 位 when the account list misses the account", async () => {
    mocks.tasks = [ledgerTask({ id: "task-orphan", batchId: "batch-old", batchRole: "member", accountId: "xhs:abcdef123456" })];
    installBridge();

    render(<BatchPublishView />);

    await waitFor(() => expect(screen.getByText("小红书 · 123456")).toBeTruthy());
  });

  it("tolerates tasks without a platform: no crash and no platform badge", async () => {
    mocks.accounts = [createAccount("xhs")];
    const orphan = ledgerTask({ id: "task-no-platform", batchId: "batch-old", batchRole: "member" });
    delete (orphan as Partial<SelfMediaTask>).platform;
    mocks.tasks = [orphan];
    installBridge();

    render(<BatchPublishView />);

    await waitFor(() => expect(screen.getAllByText("小红书账号").length).toBeGreaterThanOrEqual(1)); // displayName 来自账号列表
    expect(screen.queryByText(/小红书 · /)).toBeNull();
  });

  it("shows creation failures under the new batch instead of the previous batch after a failed first slot", async () => {
    mocks.tasks = [ledgerTask({ id: "task-prev", batchId: "batch-prev", batchRole: "member", status: "success", progress: 100 })];
    mocks.accounts = [createAccount("xhs"), createAccount("twitter")];
    const createTask = vi.fn(async ({ draft }: { draft: SelfMediaDraft }) => {
      if (draft.batchRole === "verification") return { success: false as const, error: { code: "provider-disabled", message: "验证建单被拒" } };
      return scheduledReply(draft);
    });
    installBridge(createTask);

    render(<BatchPublishView />);
    screen.getAllByRole("checkbox").forEach((checkbox) => fireEvent.click(checkbox));
    await selectAccountsAndPublish();

    await waitFor(() => expect(screen.getByText("验证建单被拒")).toBeTruthy());
    // 面板显示的是本次点击批次的失败项(计入 failed,故 1/1),上一批的任务不在面板里
    expect(screen.queryByText("task-prev")).toBeNull();
    expect(screen.getByText(/已完成 1\/1/)).toBeTruthy();
  });
});
