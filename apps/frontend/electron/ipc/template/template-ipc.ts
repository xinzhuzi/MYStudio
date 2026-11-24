/**
 * B5 推广模板 IPC handler——主进程注册模板 CRUD 端点。
 * 遵循 self-media-ipc.ts 的 trusted-sender 守卫与 reply 信封格式。
 */
import { ipcMain } from "electron";
import {
  deleteTemplate,
  deleteTemplatesByProduct,
  ensureTemplatesTable,
  getTemplate,
  listTemplates,
  listTemplatesByProduct,
  upsertTemplate,
} from "../../storage/promotion-templates-sqlite";
import {
  TEMPLATE_IPC,
  type TemplateDeleteByProductRequest,
  type TemplateDeleteReply,
  type TemplateDeleteRequest,
  type TemplateGetReply,
  type TemplateGetRequest,
  type TemplateListByProductRequest,
  type TemplateListReply,
  type TemplateUpsertReply,
  type TemplateUpsertRequest,
} from "../../../lib/template/template-ipc-contract";
import type { PromotionTemplate } from "../../../types/promotion-template";
import { isTrustedSenderFrame } from "../trusted-sender";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTemplateInput(value: unknown): value is PromotionTemplate {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" && value.id.trim().length > 0
    && typeof value.productId === "string"
    && typeof value.name === "string"
    && typeof value.platform === "string"
  );
}

export interface TemplateIpcContext {
  /** 资产库惰性就绪闸(promotion_templates 表与 assets.db 同库;注册期 basePath 尚未解析)。 */
  ensureAssetsDatabaseReady: () => void;
}

export function registerTemplateIpcHandlers(context: TemplateIpcContext): { dispose: () => void } {
  // 1123 启动崩溃根修:注册期不碰库(资产根由资产 IPC 惰性初始化,启动时恒空),
  // 建表下移到 handler 首次调用——表已建则按库路径缓存零开销。
  const ensureReady = () => {
    context.ensureAssetsDatabaseReady();
    ensureTemplatesTable();
  };

  const channels = [
    TEMPLATE_IPC.list,
    TEMPLATE_IPC.listByProduct,
    TEMPLATE_IPC.get,
    TEMPLATE_IPC.upsert,
    TEMPLATE_IPC.delete,
    TEMPLATE_IPC.deleteByProduct,
  ];

  const rejectUntrustedSender = (event: Electron.IpcMainInvokeEvent) => {
    if (isTrustedSenderFrame(event)) return null;
    return { success: false as const, error: { code: "untrusted-sender", message: "拒绝来自非应用渲染帧的调用" } };
  };

  ipcMain.handle(TEMPLATE_IPC.list, async (event): Promise<TemplateListReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    try {
      ensureReady();
      const value = await listTemplates();
      return { success: true, value };
    } catch (error) {
      return { success: false, error: { code: "template-list-failed", message: error instanceof Error ? error.message : "模板列表加载失败" } };
    }
  });

  ipcMain.handle(TEMPLATE_IPC.listByProduct, async (event, request: TemplateListByProductRequest): Promise<TemplateListReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (!request?.productId || typeof request.productId !== "string") {
      return { success: false, error: { code: "invalid-request", message: "产品 ID 无效" } };
    }
    try {
      ensureReady();
      const value = await listTemplatesByProduct(request.productId);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: { code: "template-list-by-product-failed", message: error instanceof Error ? error.message : "产品模板列表加载失败" } };
    }
  });

  ipcMain.handle(TEMPLATE_IPC.get, async (event, request: TemplateGetRequest): Promise<TemplateGetReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (!request?.id || typeof request.id !== "string") {
      return { success: false, error: { code: "invalid-request", message: "模板 ID 无效" } };
    }
    try {
      ensureReady();
      const value = await getTemplate(request.id);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: { code: "template-get-failed", message: error instanceof Error ? error.message : "模板读取失败" } };
    }
  });

  ipcMain.handle(TEMPLATE_IPC.upsert, async (event, request: TemplateUpsertRequest): Promise<TemplateUpsertReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (!request || !isTemplateInput(request.template)) {
      return { success: false, error: { code: "invalid-template", message: "模板数据无效" } };
    }
    try {
      ensureReady();
      await upsertTemplate(request.template);
      return { success: true, value: request.template };
    } catch (error) {
      return { success: false, error: { code: "template-upsert-failed", message: error instanceof Error ? error.message : "模板保存失败" } };
    }
  });

  ipcMain.handle(TEMPLATE_IPC.delete, async (event, request: TemplateDeleteRequest): Promise<TemplateDeleteReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (!request?.id || typeof request.id !== "string") {
      return { success: false, error: { code: "invalid-request", message: "模板 ID 无效" } };
    }
    try {
      ensureReady();
      await deleteTemplate(request.id);
      return { success: true, value: { deleted: true } };
    } catch (error) {
      return { success: false, error: { code: "template-delete-failed", message: error instanceof Error ? error.message : "模板删除失败" } };
    }
  });

  ipcMain.handle(TEMPLATE_IPC.deleteByProduct, async (event, request: TemplateDeleteByProductRequest): Promise<TemplateDeleteReply> => {
    const rejected = rejectUntrustedSender(event);
    if (rejected) return rejected;
    if (!request?.productId || typeof request.productId !== "string") {
      return { success: false, error: { code: "invalid-request", message: "产品 ID 无效" } };
    }
    try {
      ensureReady();
      await deleteTemplatesByProduct(request.productId);
      return { success: true, value: { deleted: true } };
    } catch (error) {
      return { success: false, error: { code: "template-delete-by-product-failed", message: error instanceof Error ? error.message : "产品模板删除失败" } };
    }
  });

  const dispose = () => channels.forEach((channel) => ipcMain.removeHandler(channel));
  return { dispose };
}
