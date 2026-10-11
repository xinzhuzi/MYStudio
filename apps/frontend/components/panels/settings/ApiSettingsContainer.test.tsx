// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IProvider } from "@/stores/ai/api-config-store";

const mocks = vi.hoisted(() => ({
  provider: {
    id: "provider-1",
    platform: "openai-compatible",
    name: "Provider One",
    baseUrl: "https://api.example.test/v1",
    apiKey: "sk-test",
    model: ["gpt-4o-mini"],
  },
  // 1011 断点D:存量 custom 平台且缺 apiProtocol 的条目(不迁移,列表页挂警示徽标)
  legacyCustomProvider: {
    id: "provider-legacy",
    platform: "custom",
    name: "存量自定义中转",
    baseUrl: "https://relay.example.test/v1",
    apiKey: "sk-legacy",
    model: ["glm-5.1"],
  },
  addProvider: vi.fn(),
  updateProvider: vi.fn(),
  removeProvider: vi.fn(),
  syncProviderModels: vi.fn(),
  migrateStudioBindings: vi.fn(),
  upsertProviderAdapterCode: vi.fn(),
  getModelThinkingOverride: vi.fn(),
  testModel: vi.fn(),
  logEvent: vi.fn(),
}));
let studioBindings: unknown[] = [];
// 每个用例自定供应商列表(闭包在渲染期读取,防 vi.mock 提升期 TDZ)
let storeProviders: IProvider[] = [];

vi.mock("@/stores/ai/api-config-store", () => ({
  useAPIConfigStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      providers: storeProviders,
      concurrency: 1,
      setConcurrency: vi.fn(),
      modelThinkingOverrides: {},
      setModelThinkingOverride: vi.fn(),
      addProvider: mocks.addProvider,
      updateProvider: mocks.updateProvider,
      removeProvider: mocks.removeProvider,
      syncProviderModels: mocks.syncProviderModels,
      migrateStudioBindings: mocks.migrateStudioBindings,
      upsertProviderAdapterCode: mocks.upsertProviderAdapterCode,
      getModelThinkingOverride: mocks.getModelThinkingOverride,
    };
    return selector ? selector(state) : state;
  },
}));
vi.mock("@/stores/app/studio-config-store", () => ({ useStudioConfigStore: () => studioBindings }));
vi.mock("@/stores/app/app-settings-store", () => ({
  useAppSettingsStore: () => ({ defaultAspectRatio: "16:9", defaultResolution: "2K" }),
}));
vi.mock("@/lib/ai/model-test", () => ({
  prepareModelTestRequest: () => ({ success: true, dryRun: false }),
}));
vi.mock("@/lib/ai/thinking-mode", () => ({ resolveThinkingEnabled: () => false }));
vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: () => "model-test-1",
  logEvent: mocks.logEvent,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() },
}));

// ui/select 测试替身:Radix Select 在 jsdom 需指针捕获,这里换成常驻渲染的
// 选项按钮 + context 传递 onValueChange,保住被测表单的真实状态流(选值→提交)。
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const selectContext = React.createContext<{
    value: string;
    onValueChange?: (value: string) => void;
  }>({ value: "" });
  type SelectProps = { children?: React.ReactNode; value?: string; onValueChange?: (value: string) => void };
  return {
    Select: ({ children, value, onValueChange }: SelectProps) => (
      <selectContext.Provider value={{ value: value ?? "", onValueChange }}>{children}</selectContext.Provider>
    ),
    SelectTrigger: ({ children }: SelectProps) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
    SelectContent: ({ children }: SelectProps) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => {
      const context = React.useContext(selectContext);
      return (
        <button type="button" data-testid={`option-${value}`} onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

import { toast } from "sonner";
import { ApiSettingsContainer, ApiSettingsMigration } from "./ApiSettingsContainer";

const PROTOCOL_BADGE_TEXT = "协议未声明·按 OpenAI 兼容兜底";

function openAddDialog() {
  fireEvent.click(screen.getByRole("button", { name: /添加供应商/ }));
  return screen.getByRole("dialog");
}

// 选项定位用精确文案(getByText 全串匹配):平台预设名与协议选项名刻意不同
// (「Anthropic 兼容接口」vs「Anthropic 兼容」),避免 data-testid 撞车
function fillCustomProviderForm(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByText("自定义"));
  fireEvent.change(within(dialog).getByPlaceholderText("供应商名称"), { target: { value: "GLM 自定义口" } });
  fireEvent.change(within(dialog).getByPlaceholderText("https://api.example.com/v1"), {
    target: { value: "https://open.bigmodel.cn/api/anthropic" },
  });
  fireEvent.change(within(dialog).getByPlaceholderText("输入 API Key"), { target: { value: "sk-glm" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  studioBindings = [];
  storeProviders = [mocks.provider as IProvider];
  mocks.addProvider.mockReturnValue(mocks.provider);
  mocks.testModel.mockResolvedValue({
    success: true,
    message: "模型测试通过",
    protocol: "openai-compatible",
  });
  mocks.syncProviderModels.mockResolvedValue({ success: true, count: 3 });
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { testModel: mocks.testModel },
  });
});

afterEach(cleanup);

describe("ApiSettingsContainer", () => {
  it("adds a provider, tests its first model, applies protocol detection, and syncs models", async () => {
    storeProviders = [];
    render(<ApiSettingsContainer />);

    const dialog = openAddDialog();
    fireEvent.click(within(dialog).getByText("OpenAI 兼容中转站"));
    fireEvent.change(within(dialog).getByPlaceholderText("输入 API Key"), { target: { value: "sk-test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加" }));

    expect(mocks.addProvider).toHaveBeenCalledOnce();
    expect(mocks.addProvider).toHaveBeenCalledWith(expect.objectContaining({
      platform: "openai-compatible",
      apiProtocol: "openai-compatible",
    }));
    expect(mocks.upsertProviderAdapterCode).toHaveBeenCalledWith("provider-1", expect.any(String));
    await waitFor(() => expect(mocks.testModel).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.updateProvider).toHaveBeenCalledWith({
      ...mocks.provider,
      apiProtocol: "openai-compatible",
    }));
    await waitFor(() => expect(mocks.syncProviderModels).toHaveBeenCalledWith("provider-1"));
  });

  it("saves edited providers through the same automatic test and sync flow", async () => {
    render(<ApiSettingsContainer />);

    fireEvent.click(screen.getByRole("button", { name: /编辑输入项/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("Provider One"), { target: { value: "Provider Edited" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mocks.updateProvider).toHaveBeenCalledWith({ ...mocks.provider, name: "Provider Edited" }));
    await waitFor(() => expect(mocks.testModel).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.syncProviderModels).toHaveBeenCalledWith("provider-1"));
  });

  it("migrates studio bindings from an always-mounted boundary", () => {
    studioBindings = [{ feature: "script_analysis", providerId: "provider-1" }];
    render(<ApiSettingsMigration />);

    expect(mocks.migrateStudioBindings).toHaveBeenCalledWith(studioBindings);
  });
});

describe("ApiSettingsContainer apiProtocol 配置期必填(1011)", () => {
  it("custom 平台未选协议 → 保存被拦,提示说清 OpenAI 兼容兜底后果,弹窗不关", () => {
    render(<ApiSettingsContainer />);

    const dialog = openAddDialog();
    fillCustomProviderForm(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "添加" }));

    expect(mocks.addProvider).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("OpenAI 兼容兜底"));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("协议"));
    // 拦截后弹窗保持打开,用户当场补选
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("custom 平台选了协议 → 可保存,apiProtocol 随表单入库", () => {
    render(<ApiSettingsContainer />);

    const dialog = openAddDialog();
    fillCustomProviderForm(dialog);
    fireEvent.click(within(dialog).getByText("Anthropic 兼容"));
    fireEvent.click(within(dialog).getByRole("button", { name: "添加" }));

    expect(mocks.addProvider).toHaveBeenCalledOnce();
    expect(mocks.addProvider).toHaveBeenCalledWith(expect.objectContaining({
      platform: "custom",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiProtocol: "anthropic-compatible",
    }));
    // 保存成功后弹窗关闭
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("存量 custom 平台缺协议条目渲染警示徽标,点击徽标跳编辑补声明", async () => {
    storeProviders = [mocks.legacyCustomProvider as IProvider];
    render(<ApiSettingsContainer />);

    // 侧栏条目 + 供应商详情两处警示(同一提示语)
    const badges = screen.getAllByText(PROTOCOL_BADGE_TEXT);
    expect(badges.length).toBeGreaterThanOrEqual(1);
    // DOM 序:侧栏(aside)在前 —— 点击侧栏徽标跳编辑
    fireEvent.click(badges[0]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("编辑供应商")).toBeTruthy();
    // 编辑弹窗对 custom 平台给出必填协议下拉(存量未声明 → 空值待选)
    expect(within(dialog).getByText("Anthropic 兼容")).toBeTruthy();
  });

  it("存量 custom 条目编辑时未补协议 → 保存被拦;补选后可存", async () => {
    storeProviders = [mocks.legacyCustomProvider as IProvider];
    render(<ApiSettingsContainer />);

    fireEvent.click(screen.getByRole("button", { name: /编辑输入项/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(mocks.updateProvider).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("OpenAI 兼容兜底"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(within(dialog).getByText("Gemini 兼容"));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.updateProvider).toHaveBeenCalledWith(expect.objectContaining({
      id: "provider-legacy",
      apiProtocol: "gemini-compatible",
    })));
  });
});
