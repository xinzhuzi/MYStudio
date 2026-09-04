// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { HistoryEntry } from "@/stores/assist/freedom-store";
import { buildProjectFileUrl, parseProjectFileUrl } from "@/lib/upscale/project-file-url";

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

/**
 * ledger file 键归一(09-04 修复):写入侧 appendProjectLedger 存的是受管 URL
 * 尾段(URL 编码形态,中文文件名必编码),而删除/拼装侧口径是解码形态。比对
 * 与 URL 重建统一走本函数,两套口径不再分家(分家的后果=台账条目永远删不掉)。
 */
export function decodeLedgerFileKey(file: string): string {
  return decodeURIComponentSafe(file);
}

/** localStorage 历史 + 磁盘 ledger 合并:按图片身份(解码文件名)去重,新→旧排序。
 *  projectId 非空时 ledger 条目地址归一化为 project-file:// 完整 URL(裸相对
 *  路径在展示层必坏:缩略图/大图/访达揭示全链——09-03 实锤);null=无项目,
 *  ledger 条目保持磁盘原样(旧行为,测试与降级场景)。 */
export function mergeGenerationRecords(
  local: HistoryEntry[],
  ledger: GenerationLedgerEntry[],
  projectId: string | null,
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
    // item.file 是受管 URL 尾段(编码形态);先解码再交给唯一拼装点重新编码——
    // 直接喂编码串会被 encodeURIComponent 二次编码(%→%25),缩略图/大图全链 404(09-04 实锤)
    resultUrl: projectId
      ? buildProjectFileUrl(projectId, `media/ai-image/${decodeLedgerFileKey(item.file)}`)
      : item.file,
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
  readText: (payload: {
    projectId: string;
    relativePath: string;
    /** raw=true 走主进程原始读取(16MB 上限,免预览通道 2MB/256KB 截断)——
     *  台账专用:2000 条上限的长中文 prompt 序列化可超 2MB,预览通道读不到
     *  会让追加侧误判「无台账」而清光历史(09-04 挂账根修) */
    raw?: boolean;
  }) => Promise<{ text?: string } | string>;
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
        raw: true,
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
  if (source === "image-studio-uncloth") return "图片工作室画布·无衣物";
  return source;
}

interface ProjectFilesWriteBridge {
  readText: (payload: {
    projectId: string;
    relativePath: string;
    raw?: boolean;
  }) => Promise<{ text?: string } | string>;
  writeText: (key: string, value: string) => Promise<unknown>;
  deleteFile?: (payload: { projectId: string; relativePath: string }) => Promise<{ success?: boolean } | unknown>;
}

/** 从 project-file URL 提取 ledger 身份(「2026-09/xxx.png」);非项目内
 *  media/ai-image 地址(data:/远程/local-image://)不属于本清理链,返回 null。 */
export function mediaAiImageLedgerIdentity(url: string): string | null {
  const parsed = parseProjectFileUrl(url);
  if (!parsed) return null;
  const match = /^media\/ai-image\/(\d{4}-\d{2})\/([^/]+)$/.exec(parsed.relativePath);
  if (!match || match[2] === "ledger.json") return null;
  return `${match[1]}/${decodeURIComponentSafe(match[2])}`;
}

/** 磁盘 ledger 条目移除(读改写,与写入侧 appendProjectLedger 同键同构):
 *  只删条目不动图文件。返回是否确有移除(条目本就不在= false,幂等);
 *  台账文件在但内容坏 JSON 时如实抛错(仍不写盘,宁留勿坏)。 */
export async function removeLedgerEntryByFile(input: {
  projectId: string;
  file: string;
}): Promise<boolean> {
  const bridge = (window as unknown as { projectFiles?: ProjectFilesWriteBridge }).projectFiles;
  if (!bridge?.readText || !bridge.writeText) return false;
  const month = input.file.split("/")[0] ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const relativePath = `media/ai-image/${month}/ledger.json`;
  let entries: GenerationLedgerEntry[] = [];
  try {
    const result = await bridge.readText({ projectId: input.projectId, relativePath, raw: true });
    const text = typeof result === "string" ? result : result?.text;
    const parsed = text ? JSON.parse(text) : [];
    if (Array.isArray(parsed)) entries = parsed;
  } catch (error) {
    // 坏 JSON(文件在但内容坏)=真实故障,如实上抛让面板报「台账更新失败」;
    // 仍不写盘(宁留勿坏)。文件不在时 readText 返回 {success:false} 不走这里,
    // 走下面的「条目不在」幂等分支。
    throw error instanceof Error ? error : new Error(String(error));
  }
  // 写入侧 item.file 存 URL 编码形态(中文文件名必编码),input.file 是解码
  // 身份(mediaAiImageLedgerIdentity 产物)——双口径任一命中即属该条目,
  // 单口径比对曾致台账条目永远删不掉(09-04 实锤)。
  const kept = entries.filter(
    (item) => item.file !== input.file && decodeLedgerFileKey(item.file) !== input.file,
  );
  if (kept.length === entries.length) return false;
  await bridge.writeText(
    `_p/${input.projectId}/${relativePath}`,
    JSON.stringify(kept.slice(-2000), null, 2),
  );
  return true;
}

/** 受管 URL 里的月份段(如「2026-09」);取不到回退当前月 */
export function ledgerMonthFolderOf(url: string): string {
  const match = /\/(\d{4}-\d{2})\//.exec(url);
  return match?.[1] ?? new Date().toISOString().slice(0, 7);
}

/** 受管 URL 尾段文件名(编码形态——台账 file 键的统一口径) */
export function ledgerFilenameOf(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  return clean.slice(clean.lastIndexOf("/") + 1) || "image.png";
}

/**
 * 磁盘 ledger 追加(读改写,09-04 从生成链抽出共享):新条目入列,保留末位
 * 2000 条;读取走 raw 通道(免预览 2MB 上限)。坏 JSON **不重建不清账**——
 * 重建空数组覆盖写等于把整本台账静默清光,宁缺一条不清历史。失败静默
 * (下一次生成重试;面板回落 localStorage)。
 */
export async function appendProjectLedger(input: {
  projectId: string;
  relativePath: string;
  entry: GenerationLedgerEntry;
}): Promise<void> {
  const bridge = (window as unknown as { projectFiles?: ProjectFilesWriteBridge }).projectFiles;
  if (!bridge?.writeText || !bridge.readText) return;
  let entries: GenerationLedgerEntry[] = [];
  try {
    const existing = await bridge.readText({
      projectId: input.projectId,
      relativePath: input.relativePath,
      raw: true,
    });
    const text = typeof existing === "string" ? existing : existing?.text;
    if (text) {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) entries = parsed;
    }
  } catch (error) {
    console.warn("[generation-ledger] 台账读取失败,跳过本次追加(不清账):", error);
    return;
  }
  entries.push(input.entry);
  // `_p/{pid}/…` 虚拟键与读侧(readText {projectId, relativePath})同构:
  // 外部位置项目动态重定向+store 布局收口(09-03 对拍实锤,勿回退裸键)。
  await bridge.writeText(
    `_p/${input.projectId}/${input.relativePath}`,
    JSON.stringify(entries.slice(-2000), null, 2),
  );
}

/** 删除项目内图文件(物理)。仅 project-file:// 且属当前项目的地址;
 *  其他 scheme(远程/data/local-image)不在本链,返回 false 不视为失败。 */
export async function deleteProjectImageFile(projectId: string, url: string): Promise<boolean> {
  const parsed = parseProjectFileUrl(url);
  if (!parsed || parsed.projectId !== projectId) return false;
  const bridge = (window as unknown as { projectFiles?: ProjectFilesWriteBridge }).projectFiles;
  if (!bridge?.deleteFile) return false;
  try {
    const result = await bridge.deleteFile({
      projectId: parsed.projectId,
      relativePath: parsed.relativePath,
    });
    return Boolean((result as { success?: boolean } | null)?.success);
  } catch {
    return false;
  }
}
