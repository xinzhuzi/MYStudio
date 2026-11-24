// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTemplateStore } from "./template-store";
import type { PromotionTemplate } from "@/types/promotion-template";

function template(overrides: Partial<PromotionTemplate> = {}): PromotionTemplate {
  return {
    id: "tpl-1",
    productId: "product-1",
    name: "通用模板",
    platform: "xhs",
    titleTemplate: "{{product.name}} 上线",
    bodyTemplate: "{{product.description}}",
    defaultTags: ["漫剧"],
    mediaSlots: 3,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

type TemplateBridgeLike = NonNullable<(Window & typeof globalThis)["templateBridge"]>;

let bridge: {
  list: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function installBridge(overrides: Partial<TemplateBridgeLike> = {}): void {
  bridge = {
    list: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as typeof bridge;
  (window as typeof window & { templateBridge?: TemplateBridgeLike }).templateBridge =
    bridge as unknown as TemplateBridgeLike;
}

beforeEach(() => {
  useTemplateStore.setState({ templates: [], loading: false });
  delete (window as typeof window & { templateBridge?: TemplateBridgeLike }).templateBridge;
});

afterEach(() => {
  delete (window as typeof window & { templateBridge?: TemplateBridgeLike }).templateBridge;
});

describe("useTemplateStore sync actions", () => {
  it("replaces the list with setTemplates", () => {
    useTemplateStore.getState().setTemplates([template(), template({ id: "tpl-2" })]);
    expect(useTemplateStore.getState().templates.map((item) => item.id)).toEqual(["tpl-1", "tpl-2"]);
  });

  it("appends a new template and replaces an existing id with upsertTemplate", () => {
    useTemplateStore.getState().setTemplates([template(), template({ id: "tpl-2" })]);
    const revised = template({ id: "tpl-2", name: "改名" });
    useTemplateStore.getState().upsertTemplate(revised);
    useTemplateStore.getState().upsertTemplate(template({ id: "tpl-3" }));

    const state = useTemplateStore.getState();
    expect(state.templates.map((item) => item.id)).toEqual(["tpl-1", "tpl-2", "tpl-3"]);
    expect(state.templates[1]).toBe(revised);
  });

  it("removes a single template or every template of a product", () => {
    useTemplateStore.getState().setTemplates([
      template({ id: "tpl-1", productId: "product-1" }),
      template({ id: "tpl-2", productId: "product-1" }),
      template({ id: "tpl-3", productId: "product-2" }),
    ]);

    useTemplateStore.getState().removeTemplate("tpl-2");
    expect(useTemplateStore.getState().templates.map((item) => item.id)).toEqual(["tpl-1", "tpl-3"]);

    useTemplateStore.getState().removeTemplatesByProduct("product-1");
    expect(useTemplateStore.getState().templates.map((item) => item.id)).toEqual(["tpl-3"]);
  });

  it("toggles loading with setLoading", () => {
    useTemplateStore.getState().setLoading(true);
    expect(useTemplateStore.getState().loading).toBe(true);
    useTemplateStore.getState().setLoading(false);
    expect(useTemplateStore.getState().loading).toBe(false);
  });
});

describe("useTemplateStore bridge actions", () => {
  it("is a no-op without window.templateBridge (preload 未注入)", async () => {
    await useTemplateStore.getState().loadTemplates();
    await useTemplateStore.getState().saveTemplate(template());
    await useTemplateStore.getState().deleteTemplate("tpl-1");

    const state = useTemplateStore.getState();
    expect(state.templates).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("loads templates through the bridge and clears loading", async () => {
    installBridge({ list: vi.fn().mockResolvedValue({ success: true, value: [template(), template({ id: "tpl-2" })] }) });

    await useTemplateStore.getState().loadTemplates();

    expect(bridge.list).toHaveBeenCalledTimes(1);
    const state = useTemplateStore.getState();
    expect(state.templates.map((item) => item.id)).toEqual(["tpl-1", "tpl-2"]);
    expect(state.loading).toBe(false);
  });

  it("keeps the previous list when the bridge replies failure", async () => {
    useTemplateStore.getState().setTemplates([template()]);
    installBridge({ list: vi.fn().mockResolvedValue({ success: false, error: { code: "DB_ERROR", message: "boom" } }) });

    await useTemplateStore.getState().loadTemplates();

    expect(useTemplateStore.getState().templates.map((item) => item.id)).toEqual(["tpl-1"]);
    expect(useTemplateStore.getState().loading).toBe(false);
  });

  it("clears loading even when the bridge throws", async () => {
    installBridge({ list: vi.fn().mockRejectedValue(new Error("ipc gone")) });

    await expect(useTemplateStore.getState().loadTemplates()).rejects.toThrow("ipc gone");
    expect(useTemplateStore.getState().loading).toBe(false);
  });

  it("caches the main-process copy returned by saveTemplate", async () => {
    const persisted = template({ id: "tpl-9", updatedAt: 1_700_000_050_000 });
    installBridge({ upsert: vi.fn().mockResolvedValue({ success: true, value: persisted }) });

    await useTemplateStore.getState().saveTemplate(template({ id: "tpl-9" }));

    expect(bridge.upsert).toHaveBeenCalledWith({ template: template({ id: "tpl-9" }) });
    expect(useTemplateStore.getState().templates).toEqual([persisted]);
  });

  it("does not cache a failed save", async () => {
    installBridge({ upsert: vi.fn().mockResolvedValue({ success: false, error: { code: "DB_ERROR", message: "boom" } }) });

    await useTemplateStore.getState().saveTemplate(template());

    expect(useTemplateStore.getState().templates).toEqual([]);
  });

  it("removes the template locally after a successful delete", async () => {
    useTemplateStore.getState().setTemplates([template(), template({ id: "tpl-2" })]);
    installBridge({ delete: vi.fn().mockResolvedValue({ success: true, value: { deleted: true } }) });

    await useTemplateStore.getState().deleteTemplate("tpl-1");

    expect(bridge.delete).toHaveBeenCalledWith({ id: "tpl-1" });
    expect(useTemplateStore.getState().templates.map((item) => item.id)).toEqual(["tpl-2"]);
  });

  it("keeps the template when the bridge refuses the delete", async () => {
    useTemplateStore.getState().setTemplates([template()]);
    installBridge({ delete: vi.fn().mockResolvedValue({ success: false, error: { code: "NOT_FOUND", message: "missing" } }) });

    await useTemplateStore.getState().deleteTemplate("tpl-1");

    expect(useTemplateStore.getState().templates.map((item) => item.id)).toEqual(["tpl-1"]);
  });
});
