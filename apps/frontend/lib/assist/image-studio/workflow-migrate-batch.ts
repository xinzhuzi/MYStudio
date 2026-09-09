// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 存量流批量迁移入库(09-09 comfyui-frontend-swap 阶段2 批2):
 * 全部 imageWorkflows → 迁移器双格式导出 → 参考图占位名上传闭环
 * (best-effort:可读协议传,不可读取记注)→ UI 格式一次性批量导入
 * 工作流库(importFiles 既有批量面)。API 格式随 ui.extra 携带,取用即得。
 */

import { toast } from "sonner";

import { getComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import type {
  ComfyWorkflowImportConflictMode,
  ComfyWorkflowImportFile,
  ComfyWorkflowImportFileResult,
  ComfyWorkflowLibraryTransport,
} from "@/lib/assist/image-studio/comfy-workflow-library";
import { comfyImageUrlToB64 } from "@/lib/assist/image-studio/comfy-execute";
import { createHttpComfyWorkflowLibraryTransport } from "@/lib/assist/image-studio/comfy-sidecar-bridge";
import { exportImageWorkflowToComfy, planMigration, referencePlaceholder } from "@/lib/assist/image-studio/workflow-export-comfy";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ImageWorkflowGraph } from "@/types/studio";

export interface MigrateBatchDeps {
  flows: ImageWorkflowGraph[];
  transport: Pick<ComfyWorkflowLibraryTransport, "importFiles">;
  uploadReference: (name: string, imageB64: string) => Promise<boolean>;
  readImageB64: (url: string) => Promise<string | null>;
}

export interface MigrateBatchSummary {
  total: number;
  imported: number;
  failed: number;
  skippedNoBlocks: number;
  referencesUploaded: number;
  referencesSkipped: number;
  notes: string[];
}

/** 参考图上传闭环:块内前 2 张(模板槽上限)按占位名上传,同名覆写。 */
async function uploadBlockReferences(
  graph: ImageWorkflowGraph,
  deps: MigrateBatchDeps,
  notes: string[],
  counters: { uploaded: number; skipped: number },
): Promise<void> {
  for (const block of planMigration(graph).blocks) {
    for (const [index, reference] of block.references.slice(0, 2).entries()) {
      const name = referencePlaceholder(index, reference.imageUrl);
      const b64 = await deps.readImageB64(reference.imageUrl).catch(() => null);
      if (!b64) {
        counters.skipped += 1;
        notes.push(`${graph.name}:参考图读取失败暂跳过(${reference.imageUrl.slice(0, 48)};asset-file 资产源读取桥=待续)`);
        continue;
      }
      const pure = b64.startsWith("data:") ? b64.slice(b64.indexOf(",") + 1) : b64;
      const ok = await deps.uploadReference(name, pure);
      if (ok) {
        counters.uploaded += 1;
      } else {
        counters.skipped += 1;
        notes.push(`${graph.name}:参考图上传失败(${name};引擎须在运行)`);
      }
    }
  }
}

export async function migrateWorkflowsToLibrary(
  deps: Partial<MigrateBatchDeps> = {},
  options: { conflictMode?: ComfyWorkflowImportConflictMode } = {},
): Promise<MigrateBatchSummary> {
  const resolved: MigrateBatchDeps = {
    flows: deps.flows ?? useStudioStore.getState().imageWorkflows,
    transport: deps.transport ?? createHttpComfyWorkflowLibraryTransport(),
    uploadReference:
      deps.uploadReference ??
      (async (name, imageB64) => {
        const client = getComfyEngineClient();
        if (!client) return false;
        return (await client.uploadBridgeReference(name, imageB64))?.accepted === true;
      }),
    readImageB64: deps.readImageB64 ?? ((url) => comfyImageUrlToB64(url)),
  };
  const files: ComfyWorkflowImportFile[] = [];
  const notes: string[] = [];
  const counters = { uploaded: 0, skipped: 0 };
  let skippedNoBlocks = 0;
  for (const flow of resolved.flows) {
    if (!planMigration(flow).blocks.length) {
      skippedNoBlocks += 1;
      continue;
    }
    const result = exportImageWorkflowToComfy(flow);
    await uploadBlockReferences(flow, resolved, notes, counters);
    // API 格式随身携带(ui.extra.apiFormat):库内取用即得,无头复跑免重导
    const ui = { ...result.ui, extra: { ...(result.ui as { extra?: Record<string, unknown> }).extra, apiFormat: result.api, manyingMigration: result.report } };
    files.push({ name: `迁移 · ${flow.name}.json`, content: JSON.stringify(ui, null, 1) });
  }
  let imported = 0;
  let failed = 0;
  if (files.length > 0) {
    const results: ComfyWorkflowImportFileResult[] = await resolved.transport.importFiles(
      files,
      options.conflictMode ?? "keep-both",
    );
    for (const item of results) {
      if (item.status === "failed") {
        failed += 1;
        notes.push(`导入失败:${item.name}(${item.error ?? "未知原因"})`);
      } else {
        imported += 1;
      }
    }
  }
  return {
    total: resolved.flows.length,
    imported,
    failed,
    skippedNoBlocks,
    referencesUploaded: counters.uploaded,
    referencesSkipped: counters.skipped,
    notes: notes.slice(0, 30),
  };
}

/** 面板入口用的薄包装:后台跑+toast 汇总(长任务禁模态铁律)。 */
export async function migrateWorkflowsToLibraryWithToast(deps: Partial<MigrateBatchDeps> = {}): Promise<MigrateBatchSummary> {
  const summary = await migrateWorkflowsToLibrary(deps);
  if (summary.total === 0) {
    toast.info("当前没有存量画布可迁移");
    return summary;
  }
  const refSuffix = summary.referencesSkipped > 0 ? `;参考图 ${summary.referencesUploaded} 张已传、${summary.referencesSkipped} 张跳过(见日志注记)` : `;参考图 ${summary.referencesUploaded} 张已上传`;
  toast.success(`存量画布迁移入库:${summary.imported} 入库 / ${summary.failed} 失败${refSuffix}`);
  for (const note of summary.notes.slice(0, 3)) {
    toast.warning(note);
  }
  return summary;
}
