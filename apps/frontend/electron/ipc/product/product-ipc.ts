/**
 * B2 产品目录 IPC handler——主进程注册产品 CRUD 端点。
 * 遵循 self-media-ipc.ts 的 trusted-sender 守卫与 reply 信封格式。
 */
import { ipcMain } from "electron";
import {
  deleteProduct,
  ensureProductsTable,
  getProduct,
  listProducts,
  upsertProduct,
} from "../../storage/products-sqlite";
import {
  PRODUCT_IPC,
  type ProductDeleteReply,
  type ProductDeleteRequest,
  type ProductGetReply,
  type ProductGetRequest,
  type ProductListReply,
  type ProductUpsertReply,
  type ProductUpsertRequest,
} from "../../../lib/product/product-ipc-contract";
import type { Product } from "../../../types/product";
import { isTrustedSenderFrame } from "../trusted-sender";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProductInput(value: unknown): value is Product {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" && value.id.trim().length > 0
    && typeof value.name === "string"
    && typeof value.slug === "string"
  );
}

export interface ProductIpcContext {
  /** 资产库惰性就绪闸(products 表与 assets.db 同库;注册期 basePath 尚未解析)。 */
  ensureAssetsDatabaseReady: () => void;
}

export function registerProductIpcHandlers(context: ProductIpcContext): { dispose: () => void } {
  // 1123 启动崩溃根修:注册期不碰库(资产根由资产 IPC 惰性初始化,启动时恒空),
  // 建表下移到 handler 首次调用——表已建则按库路径缓存零开销。
  const ensureReady = () => {
    context.ensureAssetsDatabaseReady();
    ensureProductsTable();
  };

  const channels = [
    PRODUCT_IPC.list,
    PRODUCT_IPC.get,
    PRODUCT_IPC.upsert,
    PRODUCT_IPC.delete,
  ];

  const rejectUntrustedSender = (event: Electron.IpcMainInvokeEvent) => {
    if (isTrustedSenderFrame(event)) return null;
    return { success: false as const, error: { code: "untrusted-sender", message: "拒绝来自非应用渲染帧的调用" } };
  };

  ipcMain.handle(PRODUCT_IPC.list, async (event): Promise<ProductListReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    try {
      ensureReady();
      const value = await listProducts();
      return { success: true, value };
    } catch (error) {
      return { success: false, error: { code: "product-list-failed", message: error instanceof Error ? error.message : "产品列表加载失败" } };
    }
  });

  ipcMain.handle(PRODUCT_IPC.get, async (event, request: ProductGetRequest): Promise<ProductGetReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (!request?.id || typeof request.id !== "string") {
      return { success: false, error: { code: "invalid-request", message: "产品 ID 无效" } };
    }
    try {
      ensureReady();
      const value = await getProduct(request.id);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: { code: "product-get-failed", message: error instanceof Error ? error.message : "产品读取失败" } };
    }
  });

  ipcMain.handle(PRODUCT_IPC.upsert, async (event, request: ProductUpsertRequest): Promise<ProductUpsertReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (!request || !isProductInput(request.product)) {
      return { success: false, error: { code: "invalid-product", message: "产品数据无效" } };
    }
    try {
      ensureReady();
      await upsertProduct(request.product);
      return { success: true, value: request.product };
    } catch (error) {
      return { success: false, error: { code: "product-upsert-failed", message: error instanceof Error ? error.message : "产品保存失败" } };
    }
  });

  ipcMain.handle(PRODUCT_IPC.delete, async (event, request: ProductDeleteRequest): Promise<ProductDeleteReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (!request?.id || typeof request.id !== "string") {
      return { success: false, error: { code: "invalid-request", message: "产品 ID 无效" } };
    }
    try {
      ensureReady();
      await deleteProduct(request.id);
      return { success: true, value: { deleted: true } };
    } catch (error) {
      return { success: false, error: { code: "product-delete-failed", message: error instanceof Error ? error.message : "产品删除失败" } };
    }
  });

  const dispose = () => channels.forEach((channel) => ipcMain.removeHandler(channel));
  return { dispose };
}
