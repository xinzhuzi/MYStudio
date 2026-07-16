// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IProvider } from "@/stores/api-config-store";

const mocks = vi.hoisted(() => ({
  provider: {
    id: "provider-1",
    platform: "openai-compatible",
    name: "Provider One",
    baseUrl: "https://api.example.test/v1",
    apiKey: "sk-test",
    model: ["gpt-4o-mini"],
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

vi.mock("@/stores/api-config-store", () => ({
  useAPIConfigStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      providers: [mocks.provider],
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
vi.mock("@/stores/studio-config-store", () => ({ useStudioConfigStore: () => studioBindings }));
vi.mock("@/stores/app-settings-store", () => ({
  useAppSettingsStore: () => ({ defaultAspectRatio: "16:9", defaultResolution: "2K" }),
}));
vi.mock("@/lib/api-manager/model-test", () => ({
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

type ApiTabProps = {
  providers: IProvider[];
  onAdd: () => void;
  onEdit: (provider: IProvider) => void;
};
vi.mock("./ApiSettingsTab", () => ({
  ApiSettingsTab: ({ providers, onAdd, onEdit }: ApiTabProps) => (
    <div>
      <button type="button" onClick={onAdd}>open-add</button>
      <button type="button" onClick={() => onEdit(providers[0])}>open-edit</button>
    </div>
  ),
}));

type AddDialogProps = {
  open: boolean;
  onSubmit: (provider: Omit<IProvider, "id">) => void;
};
type EditDialogProps = {
  open: boolean;
  provider: IProvider | null;
  onSave: (provider: IProvider) => void;
};
vi.mock("@/components/api-manager", () => ({
  AddProviderDialog: ({ open, onSubmit }: AddDialogProps) => open ? (
    <button type="button" onClick={() => onSubmit({
      platform: mocks.provider.platform,
      name: mocks.provider.name,
      baseUrl: mocks.provider.baseUrl,
      apiKey: mocks.provider.apiKey,
      model: mocks.provider.model,
    })}>submit-add</button>
  ) : null,
  EditProviderDialog: ({ open, provider, onSave }: EditDialogProps) => open && provider ? (
    <button type="button" onClick={() => onSave({ ...provider, name: "Provider Edited" })}>submit-edit</button>
  ) : null,
}));

import { ApiSettingsContainer, ApiSettingsMigration } from "./ApiSettingsContainer";

beforeEach(() => {
  vi.clearAllMocks();
  studioBindings = [];
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
    render(<ApiSettingsContainer />);

    fireEvent.click(screen.getByText("open-add"));
    fireEvent.click(screen.getByText("submit-add"));

    expect(mocks.addProvider).toHaveBeenCalledOnce();
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

    fireEvent.click(screen.getByText("open-edit"));
    fireEvent.click(screen.getByText("submit-edit"));

    expect(mocks.updateProvider).toHaveBeenCalledWith({ ...mocks.provider, name: "Provider Edited" });
    await waitFor(() => expect(mocks.testModel).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.syncProviderModels).toHaveBeenCalledWith("provider-1"));
  });

  it("migrates studio bindings from an always-mounted boundary", () => {
    studioBindings = [{ feature: "script_analysis", providerId: "provider-1" }];
    render(<ApiSettingsMigration />);

    expect(mocks.migrateStudioBindings).toHaveBeenCalledWith(studioBindings);
  });
});
