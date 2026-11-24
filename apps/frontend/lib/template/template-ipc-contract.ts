/**
 * B5 推广模板 IPC 契约——渲染进程与主进程通信协议。
 * 复用 self-media 的 SelfMediaIpcReply 信封格式。
 */
import type { PromotionTemplate } from "@/types/promotion-template";
import type { SelfMediaIpcReply } from "../self-media/ipc-contract";

export const TEMPLATE_IPC = {
  list: "template:list",
  listByProduct: "template:list-by-product",
  get: "template:get",
  upsert: "template:upsert",
  delete: "template:delete",
  deleteByProduct: "template:delete-by-product",
} as const;

export interface TemplateListRequest {}

export interface TemplateListByProductRequest {
  productId: string;
}

export interface TemplateGetRequest {
  id: string;
}

export interface TemplateUpsertRequest {
  template: PromotionTemplate;
}

export interface TemplateDeleteRequest {
  id: string;
}

export interface TemplateDeleteByProductRequest {
  productId: string;
}

export type TemplateListReply = SelfMediaIpcReply<PromotionTemplate[]>;
export type TemplateGetReply = SelfMediaIpcReply<PromotionTemplate | null>;
export type TemplateUpsertReply = SelfMediaIpcReply<PromotionTemplate>;
export type TemplateDeleteReply = SelfMediaIpcReply<{ deleted: boolean }>;
