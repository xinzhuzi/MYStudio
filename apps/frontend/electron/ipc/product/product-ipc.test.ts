import { describe, expect, it, vi } from "vitest";

const { handlers, productMocks, ensureAssetsDatabaseReady } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  productMocks: {
    ensureProductsTable: vi.fn(),
    listProducts: vi.fn(async () => [] as unknown[]),
    getProduct: vi.fn(async () => null),
    upsertProduct: vi.fn(),
    deleteProduct: vi.fn(),
  },
  ensureAssetsDatabaseReady: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
}));
vi.mock("../../storage/products-sqlite", () => productMocks);
vi.mock("../trusted-sender", () => ({ isTrustedSenderFrame: () => true }));

import { PRODUCT_IPC } from "../../../lib/product/product-ipc-contract";
import { registerProductIpcHandlers } from "./product-ipc";

describe("registerProductIpcHandlers(1123 启动崩溃根修)", () => {
  it("注册期不碰资产库:资产根此时尚未解析,碰库会拼出相对 assets.db", () => {
    registerProductIpcHandlers({ ensureAssetsDatabaseReady });
    expect(ensureAssetsDatabaseReady).not.toHaveBeenCalled();
    expect(productMocks.ensureProductsTable).not.toHaveBeenCalled();
  });

  it("handler 首次调用顺序:资产库就绪 → 建表 → 查库", async () => {
    const order: string[] = [];
    ensureAssetsDatabaseReady.mockImplementation(() => order.push("root"));
    productMocks.ensureProductsTable.mockImplementation(() => order.push("table"));
    productMocks.listProducts.mockImplementation(async () => {
      order.push("query");
      return [];
    });
    const list = handlers.get(PRODUCT_IPC.list)!;
    const reply = await list({ senderFrame: null });
    expect(reply).toEqual({ success: true, value: [] });
    expect(order).toEqual(["root", "table", "query"]);
  });

  it("资产根异常态(如 ASSET_HOME_ORPHANED)→ 返回错误信封而非主进程未捕获异常", async () => {
    ensureAssetsDatabaseReady.mockImplementation(() => {
      throw new Error("ASSET_HOME_ORPHANED");
    });
    const list = handlers.get(PRODUCT_IPC.list)!;
    const reply = (await list({ senderFrame: null })) as { success: boolean; error?: { message: string } };
    expect(reply.success).toBe(false);
    expect(reply.error?.message).toContain("ASSET_HOME_ORPHANED");
  });
});
