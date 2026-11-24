/**
 * B2 产品目录 IPC handler——主进程注册产品 CRUD 与导出端点。
 * 遵循 self-media-ipc.ts 的 trusted-sender 守卫与 reply 信封格式。
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import {
  deleteProduct,
  ensureProductsTable,
  exportProductsJson,
  getProduct,
  listProducts,
  upsertProduct,
} from "../../storage/products-sqlite";
import {
  PRODUCT_IPC,
  type ProductDeleteReply,
  type ProductDeleteRequest,
  type ProductExportReply,
  type ProductExportWithDialogReply,
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

export function registerProductIpcHandlers(): { dispose: () => void } {
  ensureProductsTable();

  const channels = [
    PRODUCT_IPC.list,
    PRODUCT_IPC.get,
    PRODUCT_IPC.upsert,
    PRODUCT_IPC.delete,
    PRODUCT_IPC.export,
    PRODUCT_IPC.exportWithDialog,
  ];

  const rejectUntrustedSender = (event: Electron.IpcMainInvokeEvent) => {
    if (isTrustedSenderFrame(event)) return null;
    return { success: false as const, error: { code: "untrusted-sender", message: "拒绝来自非应用渲染帧的调用" } };
  };

  ipcMain.handle(PRODUCT_IPC.list, async (event): Promise<ProductListReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    try {
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
      await deleteProduct(request.id);
      return { success: true, value: { deleted: true } };
    } catch (error) {
      return { success: false, error: { code: "product-delete-failed", message: error instanceof Error ? error.message : "产品删除失败" } };
    }
  });

  ipcMain.handle(PRODUCT_IPC.export, async (event): Promise<ProductExportReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    try {
      const value = await exportProductsJson();
      return { success: true, value };
    } catch (error) {
      return { success: false, error: { code: "product-export-failed", message: error instanceof Error ? error.message : "产品导出失败" } };
    }
  });

  ipcMain.handle(PRODUCT_IPC.exportWithDialog, async (event): Promise<ProductExportWithDialogReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    try {
      const products = await exportProductsJson();
      const win = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        title: "导出产品数据",
        defaultPath: "products.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);
      if (result.canceled || !result.filePath) {
        return { success: true, value: { cancelled: true } };
      }
      await writeFile(result.filePath, JSON.stringify(products, null, 2), "utf-8");
      return { success: true, value: { savedPath: result.filePath } };
    } catch (error) {
      return { success: false, error: { code: "product-export-dialog-failed", message: error instanceof Error ? error.message : "产品导出失败" } };
    }
  });

  const dispose = () => channels.forEach((channel) => ipcMain.removeHandler(channel));
  return { dispose };
}
