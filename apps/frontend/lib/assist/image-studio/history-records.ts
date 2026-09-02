// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { HistoryEntry } from "@/stores/assist/freedom-store";

/**
 * 生成记录数据层(09-03 弹窗):localStorage 历史与项目内磁盘 ledger 的
 * 合并、宽容解析。写入侧(use-image-studio-generation / run-node-generation)
 * 自 09-03 起带复原所需输入快照;旧记录缺键=降级复原(仅提示词+成图)。
 */

/** 复原所需输入快照;全部可选=旧记录零键可用 */
export interface GenerationRecordParams {
  source?: string;
  references?: string[];
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  count?: number;
  batchUrls?: string[];
}

export interface GenerationRecord {
  id: string;
  prompt: string;
  model: string;
  resultUrl: string;
  createdAt: number;
  mediaId?: string;
  params: GenerationRecordParams;
  /** local=localStorage 历史可删;ledger=磁盘镜像(随图存,不在面板删除) */
  origin: "local" | "ledger";
}

/** 磁盘 ledger 条目(09-03 增丰后形状;旧条目只有前四个键) */
export interface GenerationLedgerEntry {
  ts: number;
  prompt: string;
  model: string;
  file: string;
  negativePrompt?: string | null;
  aspectRatio?: string;
  resolution?: string | null;
  references?: string[];
  source?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item !== "");
  return items.length > 0 ? items : undefined;
}

/** 宽容解析:任意来源(本地 params / ledger 顶层键)→ 结构化快照,非法键忽略 */
export function readGenerationParams(raw: Record<string, unknown> | undefined): GenerationRecordParams {
  if (!raw || typeof raw !== "object") return {};
  const count = typeof raw.count === "number" && Number.isFinite(raw.count) ? raw.count : undefined;
  return {
    source: asString(raw.source),
    references: asStringArray(raw.references),
    negativePrompt: asString(raw.negativePrompt),
    aspectRatio: asString(raw.aspectRatio),
    resolution: asString(raw.resolution),
    count,
    batchUrls: asStringArray(raw.batchUrls),
  };
}

/** 解码文件名(容错:坏编码原样返回) */
function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** localStorage 历史 + 磁盘 ledger 合并:按图片身份(解码文件名)去重,新→旧排序 */
export function mergeGenerationRecords(
  local: HistoryEntry[],
  ledger: GenerationLedgerEntry[],
): GenerationRecord[] {
  const localRecords: GenerationRecord[] = local
    .filter((entry) => entry.type === "image")
    .map((entry) => ({
      id: entry.id,
      prompt: entry.prompt,
      model: entry.model,
      resultUrl: entry.resultUrl,
      createdAt: entry.createdAt,
      mediaId: entry.mediaId,
      params: readGenerationParams(entry.params),
      origin: "local" as const,
    }));
  /** 图片身份键:解码后的文件名(跨 localStorage URL/ledger 相对路径一致);
   *  无文件形态(极端)退回时间+提示词。毫秒级 ts 对不齐也不再出重复行 */
  const identityOf = (record: { resultUrl: string; createdAt: number; prompt: string }): string => {
    const tail = record.resultUrl.split("?")[0].split("#")[0].split("/").pop() ?? "";
    const decoded = tail ? decodeURIComponentSafe(tail) : "";
    return decoded || `${record.createdAt}_${record.prompt}`;
  };
  const localIdentities = new Set(localRecords.map(identityOf));
  const localKeys = new Set(localRecords.map((record) => `${record.createdAt}_${record.prompt}`));
  const ledgerRecords: GenerationRecord[] = ledger.map((item) => ({
    id: `disk_${item.ts}_${item.file}`,
    prompt: item.prompt,
    model: item.model,
    resultUrl: item.file,
    createdAt: item.ts,
    params: readGenerationParams(item as unknown as Record<string, unknown>),
    origin: "ledger" as const,
  }));
  return [
    ...localRecords,
    ...ledgerRecords.filter(
      (record) => !localIdentities.has(identityOf(record)) && !localKeys.has(`${record.createdAt}_${record.prompt}`),
    ),
  ].sort((a, b) => b.createdAt - a.createdAt);
}

interface ProjectFilesBridge {
  readText: (payload: { projectId: string; relativePath: string }) => Promise<{ text?: string } | string>;
}

/** 读项目内最近两月 ledger(桥不可用/无项目=空数组,面板回落 localStorage-only) */
export async function readLedgerEntries(projectId: string | null): Promise<GenerationLedgerEntry[]> {
  const bridge = (window as unknown as { projectFiles?: ProjectFilesBridge }).projectFiles;
  if (!bridge?.readText || !projectId) return [];
  const months = [0, 1].map((offset) => {
    const date = new Date();
    date.setMonth(date.getMonth() - offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
  const collected: GenerationLedgerEntry[] = [];
  for (const month of months) {
    try {
      const result = await bridge.readText({
        projectId,
        relativePath: `media/ai-image/${month}/ledger.json`,
      });
      const text = typeof result === "string" ? result : result?.text;
      if (!text) continue;
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        collected.push(...parsed.filter((item): item is GenerationLedgerEntry =>
          item && typeof item === "object" && typeof (item as GenerationLedgerEntry).file === "string",
        ));
      }
    } catch {
      // 无该月 ledger 或坏文件:跳过
    }
  }
  return collected;
}

/** 来源大白话(未知值原样展示,数据≠铁律不吞) */
export function generationSourceLabel(source: string | undefined): string {
  if (!source) return "—";
  if (source === "image-studio-canvas") return "图片工作室画布";
  return source;
}
