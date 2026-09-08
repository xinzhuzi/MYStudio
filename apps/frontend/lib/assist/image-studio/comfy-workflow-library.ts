// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import {
  analyzeComfyWorkflowText,
  detectMissingClassTypes,
} from "@/lib/assist/image-studio/comfy-workflow-import";
import {
  createHttpComfyWorkflowLibraryTransport,
  isElectronRenderer,
} from "@/lib/assist/image-studio/comfy-sidecar-bridge";

/**
 * ComfyUI 工作流库服务(09-08 二期):走契约 /comfy/workflows* 端点的
 * typed client。传输层(transport)可注入——后端未就绪时用内存 mock,
 * UI 独立开发;集成期 preload 注入 window.comfyWorkflowLibrary 后
 * resolveComfyWorkflowLibraryTransport() 自动切真实通道(替换位见
 * getComfyWorkflowLibraryTransport 注释)。
 *
 * 契约面(父任务 design.md 十一节):
 *   GET  /comfy/workflows              → 库内工作流树(名称/节点数/缺失插件标记)
 *   GET  /comfy/workflows/{id}/content → JSON 原文
 *   POST /comfy/workflows/import       {files:[{name,content}]}(同名冲突由前端弹窗先问)
 *   POST /comfy/workflows/{id}/rename | move | delete(删除先引用扫描→二次确认+快照)
 */

/** 库内工作流条目(列表行) */
export interface ComfyWorkflowLibraryEntry {
  id: string;
  /** 显示名(去 .json 后缀) */
  name: string;
  /** 所属文件夹;null=根层 */
  folderId: string | null;
  nodeCount: number;
  /** 缺失插件标记(对照 object_info 算出的缺失 class_type) */
  missingClassTypes: string[];
  updatedAt: number;
}

/** 文件夹(树节点;扁平存储,树形由前端组装) */
export interface ComfyWorkflowLibraryFolder {
  id: string;
  name: string;
  /** 父文件夹;null=根层 */
  parentId: string | null;
}

export interface ComfyWorkflowLibraryTree {
  folders: ComfyWorkflowLibraryFolder[];
  workflows: ComfyWorkflowLibraryEntry[];
}

/** 外部导入文件(名称+JSON 原文) */
export interface ComfyWorkflowImportFile {
  name: string;
  content: string;
}

/** 同名冲突处理(grill Q8:跳过/覆盖/两者保留,逐文件或批量) */
export type ComfyWorkflowImportConflictMode = "skip" | "overwrite" | "keep-both";

export type ComfyWorkflowImportFileResult =
  | { name: string; status: "imported"; id: string }
  | { name: string; status: "skipped"; reason: "conflict" }
  | { name: string; status: "renamed"; id: string; renamedTo: string }
  | { name: string; status: "failed"; error: string };

/** 删除引用扫描(grill Q11:删前扫引用,引用清单→警告→二次确认) */
export interface ComfyWorkflowDeleteScan {
  /** 引用清单(kind=引用来源类型,如画布/工作流节点) */
  references: { kind: string; name: string }[];
}

export interface ComfyWorkflowLibraryTransport {
  /** GET /comfy/workflows */
  list(): Promise<ComfyWorkflowLibraryTree>;
  /** GET /comfy/workflows/{id}/content */
  content(id: string): Promise<string>;
  /** POST /comfy/workflows/import(冲突处理模式随请求下发) */
  importFiles(
    files: ComfyWorkflowImportFile[],
    mode: ComfyWorkflowImportConflictMode,
  ): Promise<ComfyWorkflowImportFileResult[]>;
  /** POST /comfy/workflows/{id}/rename */
  renameWorkflow(id: string, name: string): Promise<{ ok: boolean; error?: string }>;
  /** POST /comfy/workflows/{id}/move */
  moveWorkflow(id: string, folderId: string | null): Promise<{ ok: boolean; error?: string }>;
  /** 删除第一步:引用扫描(不执行删除) */
  scanDeleteReferences(id: string): Promise<ComfyWorkflowDeleteScan>;
  /** 删除第二步:二次确认后执行(后端做快照备份) */
  deleteWorkflow(id: string): Promise<{ ok: boolean; error?: string }>;
  createFolder(name: string, parentId: string | null): Promise<ComfyWorkflowLibraryFolder>;
  renameFolder(id: string, name: string): Promise<{ ok: boolean; error?: string }>;
  deleteFolder(id: string): Promise<{ ok: boolean; error?: string }>;
  /** /comfy/engine 的 object_info 摘要(可用 class_type 全集,缺插件检测用) */
  listAvailableClassTypes(): Promise<string[]>;
}

/** 客户端:包一层传输通道(名称修剪等入参归一;后续可加缓存/重试) */
export interface ComfyWorkflowLibraryClient {
  refresh(): Promise<ComfyWorkflowLibraryTree>;
  content(id: string): Promise<string>;
  importFiles(
    files: ComfyWorkflowImportFile[],
    mode: ComfyWorkflowImportConflictMode,
  ): Promise<ComfyWorkflowImportFileResult[]>;
  renameWorkflow(id: string, name: string): Promise<{ ok: boolean; error?: string }>;
  moveWorkflow(id: string, folderId: string | null): Promise<{ ok: boolean; error?: string }>;
  scanDeleteReferences(id: string): Promise<ComfyWorkflowDeleteScan>;
  deleteWorkflow(id: string): Promise<{ ok: boolean; error?: string }>;
  createFolder(name: string, parentId: string | null): Promise<ComfyWorkflowLibraryFolder>;
  renameFolder(id: string, name: string): Promise<{ ok: boolean; error?: string }>;
  deleteFolder(id: string): Promise<{ ok: boolean; error?: string }>;
  listAvailableClassTypes(): Promise<string[]>;
}

export function createComfyWorkflowLibraryClient(
  transport: ComfyWorkflowLibraryTransport,
): ComfyWorkflowLibraryClient {
  return {
    refresh: () => transport.list(),
    content: (id) => transport.content(id),
    importFiles: (files, mode) => transport.importFiles(files, mode),
    renameWorkflow: (id, name) => transport.renameWorkflow(id, name.trim() || "未命名工作流"),
    moveWorkflow: (id, folderId) => transport.moveWorkflow(id, folderId),
    scanDeleteReferences: (id) => transport.scanDeleteReferences(id),
    deleteWorkflow: (id) => transport.deleteWorkflow(id),
    createFolder: (name, parentId) => transport.createFolder(name.trim() || "新文件夹", parentId),
    renameFolder: (id, name) => transport.renameFolder(id, name.trim() || "文件夹"),
    deleteFolder: (id) => transport.deleteFolder(id),
    listAvailableClassTypes: () => transport.listAvailableClassTypes(),
  };
}

/**
 * 真实通道挂点(集成期替换位):preload 暴露 `window.comfyWorkflowLibrary`
 * (实现 ComfyWorkflowLibraryTransport)时优先;preload 未注入时 Electron
 * 渲染层回落 HTTP 直连 sidecar(comfy-sidecar-bridge,09-08 集成,零 preload
 * 改动);jsdom/网页模式返回 undefined,由 resolve… 回落注入的 fallback
 * (mock),保证 UI 可独立开发/测试。
 */
export function getComfyWorkflowLibraryTransport(): ComfyWorkflowLibraryTransport | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = (window as { comfyWorkflowLibrary?: ComfyWorkflowLibraryTransport }).comfyWorkflowLibrary;
  if (injected) return injected;
  return isElectronRenderer() ? createHttpComfyWorkflowLibraryTransport() : undefined;
}

/** 通道解析:真实桥优先,缺席回落 fallback(再回落空 mock) */
export function resolveComfyWorkflowLibraryTransport(
  fallback?: ComfyWorkflowLibraryTransport,
): ComfyWorkflowLibraryTransport {
  return getComfyWorkflowLibraryTransport() ?? fallback ?? createInMemoryComfyWorkflowLibraryTransport();
}

/** mock 库内工作流记录 */
interface InMemoryWorkflowRecord {
  name: string;
  content: string;
  folderId: string | null;
  updatedAt: number;
}

/**
 * 内存 mock 传输(后端未就绪期 UI 开发/测试用):导入走真分析器算
 * 节点数/缺失标记;同名冲突三模式语义与契约一致(skip 原样保留 /
 * overwrite 原地覆盖 / keep-both 自动改名「名 2」「名 3」)。
 */
export function createInMemoryComfyWorkflowLibraryTransport(seed?: {
  folders?: { id: string; name: string; parentId: string | null }[];
  workflows?: { id?: string; name: string; content: string; folderId?: string | null }[];
  /** object_info 摘要(缺插件检测口径);不给=全部视为可用 */
  availableClassTypes?: string[];
  /** 删除引用扫描返回的引用清单(测删除保护流程用) */
  deleteScanReferences?: { kind: string; name: string }[];
}): ComfyWorkflowLibraryTransport {
  const folders: ComfyWorkflowLibraryFolder[] = (seed?.folders ?? []).map((f) => ({ ...f }));
  const workflows = new Map<string, InMemoryWorkflowRecord>();
  const available = seed?.availableClassTypes ? new Set(seed.availableClassTypes) : null;
  let seq = 0;
  const nextId = () => `wf-${(seq += 1)}`;
  const baseName = (fileName: string) => fileName.replace(/\.json$/i, "");
  const findByName = (name: string): string | undefined => {
    for (const [id, record] of workflows) {
      if (record.name === name) return id;
    }
    return undefined;
  };

  for (const wf of seed?.workflows ?? []) {
    workflows.set(wf.id ?? nextId(), {
      name: baseName(wf.name),
      content: wf.content,
      folderId: wf.folderId ?? null,
      updatedAt: Date.now(),
    });
  }

  const entryOf = (id: string, record: InMemoryWorkflowRecord): ComfyWorkflowLibraryEntry => {
    const analyzed = analyzeComfyWorkflowText(record.content);
    const descriptor = analyzed.ok ? analyzed.descriptor : null;
    return {
      id,
      name: record.name,
      folderId: record.folderId,
      nodeCount: descriptor?.nodeCount ?? 0,
      missingClassTypes: available
        ? detectMissingClassTypes(descriptor?.classTypesUsed ?? [], available)
        : [],
      updatedAt: record.updatedAt,
    };
  };

  return {
    list: async () => ({
      folders: folders.map((f) => ({ ...f })),
      workflows: [...workflows.entries()].map(([id, record]) => entryOf(id, record)),
    }),
    content: async (id) => {
      const record = workflows.get(id);
      if (!record) throw new Error("工作流不存在");
      return record.content;
    },
    importFiles: async (files, mode) => {
      const results: ComfyWorkflowImportFileResult[] = [];
      for (const file of files) {
        const name = baseName(file.name);
        const analyzed = analyzeComfyWorkflowText(file.content);
        if (!analyzed.ok) {
          results.push({ name: file.name, status: "failed", error: analyzed.error });
          continue;
        }
        const existingId = findByName(name);
        if (existingId === undefined) {
          const id = nextId();
          workflows.set(id, { name, content: file.content, folderId: null, updatedAt: Date.now() });
          results.push({ name: file.name, status: "imported", id });
          continue;
        }
        if (mode === "skip") {
          results.push({ name: file.name, status: "skipped", reason: "conflict" });
          continue;
        }
        if (mode === "keep-both") {
          let renamed = `${name} 2`;
          let n = 2;
          while (findByName(renamed) !== undefined) {
            n += 1;
            renamed = `${name} ${n}`;
          }
          const id = nextId();
          workflows.set(id, { name: renamed, content: file.content, folderId: null, updatedAt: Date.now() });
          results.push({ name: file.name, status: "renamed", id, renamedTo: renamed });
          continue;
        }
        const existing = workflows.get(existingId)!;
        workflows.set(existingId, { ...existing, content: file.content, updatedAt: Date.now() });
        results.push({ name: file.name, status: "imported", id: existingId });
      }
      return results;
    },
    renameWorkflow: async (id, name) => {
      const record = workflows.get(id);
      if (!record) return { ok: false, error: "工作流不存在" };
      record.name = name;
      record.updatedAt = Date.now();
      return { ok: true };
    },
    moveWorkflow: async (id, folderId) => {
      const record = workflows.get(id);
      if (!record) return { ok: false, error: "工作流不存在" };
      record.folderId = folderId;
      record.updatedAt = Date.now();
      return { ok: true };
    },
    scanDeleteReferences: async () => ({ references: seed?.deleteScanReferences ?? [] }),
    deleteWorkflow: async (id) => {
      if (!workflows.has(id)) return { ok: false, error: "工作流不存在" };
      workflows.delete(id);
      return { ok: true };
    },
    createFolder: async (name, parentId) => {
      const folder = { id: `folder-${(seq += 1)}`, name, parentId };
      folders.push(folder);
      return folder;
    },
    renameFolder: async (id, name) => {
      const folder = folders.find((f) => f.id === id);
      if (!folder) return { ok: false, error: "文件夹不存在" };
      folder.name = name;
      return { ok: true };
    },
    deleteFolder: async (id) => {
      const index = folders.findIndex((f) => f.id === id);
      if (index === -1) return { ok: false, error: "文件夹不存在" };
      folders.splice(index, 1);
      // 文件夹删除后,其中的工作流回落根层(不丢数据)
      for (const record of workflows.values()) {
        if (record.folderId === id) record.folderId = null;
      }
      return { ok: true };
    },
    listAvailableClassTypes: async () => [...(available ?? [])],
  };
}
