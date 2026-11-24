import { describe, expect, it, vi } from "vitest";

const { handlers, templateMocks, ensureAssetsDatabaseReady } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  templateMocks: {
    ensureTemplatesTable: vi.fn(),
    listTemplates: vi.fn(async () => [] as unknown[]),
    listTemplatesByProduct: vi.fn(async () => [] as unknown[]),
    getTemplate: vi.fn(async () => null),
    upsertTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    deleteTemplatesByProduct: vi.fn(),
  },
  ensureAssetsDatabaseReady: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
}));
vi.mock("../../storage/promotion-templates-sqlite", () => templateMocks);
vi.mock("../trusted-sender", () => ({ isTrustedSenderFrame: () => true }));

import { TEMPLATE_IPC } from "../../../lib/template/template-ipc-contract";
import { registerTemplateIpcHandlers } from "./template-ipc";

describe("registerTemplateIpcHandlers(1123 启动崩溃根修)", () => {
  it("注册期不碰资产库:资产根此时尚未解析,碰库会拼出相对 assets.db", () => {
    registerTemplateIpcHandlers({ ensureAssetsDatabaseReady });
    expect(ensureAssetsDatabaseReady).not.toHaveBeenCalled();
    expect(templateMocks.ensureTemplatesTable).not.toHaveBeenCalled();
  });

  it("handler 首次调用顺序:资产库就绪 → 建表 → 查库", async () => {
    const order: string[] = [];
    ensureAssetsDatabaseReady.mockImplementation(() => order.push("root"));
    templateMocks.ensureTemplatesTable.mockImplementation(() => order.push("table"));
    templateMocks.listTemplates.mockImplementation(async () => {
      order.push("query");
      return [];
    });
    const list = handlers.get(TEMPLATE_IPC.list)!;
    const reply = await list({ senderFrame: null });
    expect(reply).toEqual({ success: true, value: [] });
    expect(order).toEqual(["root", "table", "query"]);
  });
});
