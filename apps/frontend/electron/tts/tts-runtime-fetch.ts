/**
 * tts-runtime 网络抓取与子进程默认实现 — 从 tts-runtime.ts 拆出(08-11-structure-refactor)。
 *
 * 包含 fetch JSON/Bytes/归档下载默认实现、lsof 进程发现、进程终止,
 * 以及 execFileAsync(promisify) 工具 — tts-runtime.ts 会 re-import execFileAsync
 * 以保持 createTtsRuntimeController 函数体逐字节不变。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTtsBackendHttpError } from "./tts-runtime-errors";

export interface FetchJsonOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchBytesResult {
  data: ArrayBuffer;
  mimeType?: string;
}

export interface RuntimeArchiveProgress {
  downloadedBytes: number;
  totalBytes?: number;
  progress?: number;
}

export interface RuntimeArchiveResult {
  ok: boolean;
  status: number;
  data?: ArrayBuffer | Uint8Array;
  totalBytes?: number;
}

export const execFileAsync = promisify(execFile);

export function defaultFetchJson(url: string, options: FetchJsonOptions) {
  return fetch(url, options).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw createTtsBackendHttpError(text, response.status);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return response.text();
    }
    return response.json();
  });
}

export function defaultFetchBytes(url: string, options: FetchJsonOptions) {
  return fetch(url, options).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw createTtsBackendHttpError(text, response.status);
    }
    return {
      data: await response.arrayBuffer(),
      mimeType: response.headers.get("content-type") ?? undefined,
    };
  });
}

export async function defaultFetchRuntimeArchive(
  url: string,
  _destinationPath: string,
  onProgress?: (progress: RuntimeArchiveProgress) => void,
): Promise<RuntimeArchiveResult> {
  const response = await fetch(url);
  const totalHeader = response.headers.get("content-length");
  const totalBytes = totalHeader ? Number(totalHeader) : undefined;
  if (!response.ok) {
    return { ok: false, status: response.status, totalBytes };
  }
  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    onProgress?.({
      downloadedBytes: data.byteLength,
      totalBytes: totalBytes || data.byteLength,
      progress: totalBytes ? Math.round((data.byteLength / totalBytes) * 100) : undefined,
    });
    return { ok: true, status: response.status, data, totalBytes };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    downloadedBytes += value.byteLength;
    onProgress?.({
      downloadedBytes,
      totalBytes,
      progress: totalBytes ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : undefined,
    });
  }
  const data = new Uint8Array(downloadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.({
    downloadedBytes,
    totalBytes: totalBytes || downloadedBytes,
    progress: 100,
  });
  return { ok: true, status: response.status, data, totalBytes: totalBytes || downloadedBytes };
}

export async function defaultFindListeningPids(port: number) {
  try {
    const { stdout } = await execFileAsync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN", "-nP"]);
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

export function defaultKillProcess(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
