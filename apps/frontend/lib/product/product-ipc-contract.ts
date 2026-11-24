/**
 * B2 产品目录 IPC 契约——渲染进程与主进程通信协议。
 * 复用 self-media 的 SelfMediaIpcReply 信封格式。
 */
import type { Product, ProductExportRecord } from "@/types/product";
import type { SelfMediaIpcReply } from "../self-media/ipc-contract";

export const PRODUCT_IPC = {
  list: "product:list",
  get: "product:get",
  upsert: "product:upsert",
  delete: "product:delete",
  export: "product:export",
  exportWithDialog: "product:export-with-dialog",
} as const;

export interface ProductListRequest {}

export interface ProductGetRequest {
  id: string;
}

export interface ProductUpsertRequest {
  product: Product;
}

export interface ProductDeleteRequest {
  id: string;
}

export interface ProductExportRequest {}

export type ProductListReply = SelfMediaIpcReply<Product[]>;
export type ProductGetReply = SelfMediaIpcReply<Product | null>;
export type ProductUpsertReply = SelfMediaIpcReply<Product>;
export type ProductDeleteReply = SelfMediaIpcReply<{ deleted: boolean }>;
export type ProductExportReply = SelfMediaIpcReply<ProductExportRecord[]>;
export type ProductExportWithDialogReply = SelfMediaIpcReply<{ savedPath: string } | { cancelled: true }>;
