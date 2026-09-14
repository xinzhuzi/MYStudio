// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * bridge 回写消费器(09-09 comfyui-frontend-swap 阶段1 渲染层接线):
 * 轮询 sidecar 收件箱(引擎 manying_generated 落盘项)→ 复用既有链
 * (persistComfyImage=media/ai-image/+媒体库+ledger;分镜=updateStoryboard
 * +mediaTask 台账)→ ack 清理。落账口径与旧画布一致,零新语义。
 */

import { toast } from "sonner";

import type { ComfyBridgeWritebackItem } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { persistComfyImage } from "@/lib/assist/image-studio/comfy-execute";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { storyboardSourceFingerprint } from "@/stores/studio/studio-store-continuity-helpers";
import type { StoryboardItem } from "@/types/studio";

export interface ComfyBridgeWritebackConsumerClient {
  getBridgeWritebacks(cursor: number): Promise<{ cursor: number; items: ComfyBridgeWritebackItem[] } | null>;
  ackBridgeWritebacks(upTo: number): Promise<number | null>;
}

export interface ConsumeComfyBridgeWritebacksDeps {
  client: ComfyBridgeWritebackConsumerClient;
  storyboards: () => StoryboardItem[];
  /** 分镜落账(默认实现=updateStoryboard+mediaTask 台账,镜像 image-workflow-slice)。 */
  applyToStoryboard: (storyboardId: string, url: string, item: ComfyBridgeWritebackItem) => void;
  applyVideoToStoryboard: (storyboardId: string, url: string, item: ComfyBridgeWritebackItem, policy: string) => void;
  projectId: () => string | null;
  writeProjectBinary: (projectId: string, relativePath: string, bytes: ArrayBuffer) => Promise<{
    success: boolean;
    url?: string;
    error?: string;
  }>;
  persist: (b64: string, title: string, options: { source: string; prompt: string }) => Promise<{ url: string | null }>;
  notify: (kind: "storyboard" | "media" | "memory" | "error", detail: string) => void;
}

/**
 * 回写目标解析:①精确 storyboard.id;②「S02」/「2」=index 全局唯一匹配
 * (跨章歧义=不解析,提示用 id)。镜号口径=显示用 S{index}。
 */
export function parseShotTarget(target: string | undefined, storyboards: StoryboardItem[]): string | null {
  const raw = (target ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const byId = storyboards.find((item) => item.id.toLowerCase() === lower);
  if (byId) return byId.id;
  const match = /^(?:s\s*)?(\d{1,3})$/i.exec(raw);
  if (match) {
    const index = Number.parseInt(match[1], 10);
    const candidates = storyboards.filter((item) => item.index === index);
    if (candidates.length === 1) return candidates[0].id;
  }
  return null;
}

function defaultApplyToStoryboard(storyboardId: string, url: string, item: ComfyBridgeWritebackItem): void {
  const store = useStudioStore.getState();
  const storyboard = store.storyboards.find((entry) => entry.id === storyboardId);
  if (!storyboard) return;
  store.updateStoryboard(storyboardId, { mediaRef: { kind: "image", path: url } });
  const checkpointRef = `comfy-bridge:${item.id}`;
  const taskId = store.startMediaTask({
    kind: "storyboardImage",
    targetId: storyboardId,
    episodeId: storyboard.episodeId,
    provider: "image",
    checkpointRef,
    inputFingerprint: storyboard ? storyboardSourceFingerprint(storyboard) : undefined,
  });
  store.finishMediaTask(taskId, {
    outputRef: url,
    outputRefs: [url],
    checkpointRef,
  });
}

function defaultApplyVideoToStoryboard(
  storyboardId: string,
  url: string,
  _item: ComfyBridgeWritebackItem,
  policy: string,
): void {
  const store = useStudioStore.getState();
  const storyboard = store.storyboards.find((entry) => entry.id === storyboardId);
  if (!storyboard) return;
  const candidateNumber = store.videoCandidates.filter(
    (candidate) => candidate.provider === "h3-comfyui" && candidate.trackId === storyboard.trackId,
  ).length + 1;
  store.updateStoryboard(storyboardId, {
    mediaRef: { kind: "video", path: url },
    outputVersion: (storyboard.outputVersion ?? 0) + 1,
  });
  store.addVideoCandidate({
    id: `h3-${storyboard.id}-${candidateNumber}`,
    trackId: storyboard.trackId,
    provider: "h3-comfyui",
    filePath: url,
    meta: { policy },
    state: "ready",
    createdAt: Date.now(),
  });
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function safePathSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error("视频回写目标路径不合法");
  return value;
}

function videoPolicy(item: ComfyBridgeWritebackItem): string {
  if (item.kind && item.kind !== "video") throw new Error("视频回写类型不合法");
  const policy = item.meta?.policy;
  if (typeof policy !== "string" || !policy.trim()) return "ambient";
  if (!/^[A-Za-z0-9._-]+$/.test(policy)) throw new Error("视频回写策略名不合法");
  return policy;
}

function assertVideoSubfolder(item: ComfyBridgeWritebackItem, storyboard: StoryboardItem): void {
  const expected = `video/漫影/${storyboard.episodeId}/${storyboard.id}`;
  if (item.meta?.subfolder !== expected) throw new Error("视频回写产物路径不在白名单");
}

let cursor = 0;

export function resetComfyBridgeCursorForTests(): void {
  cursor = 0;
}

export async function consumeComfyBridgeWritebacks(
  deps: Partial<ConsumeComfyBridgeWritebacksDeps> = {},
): Promise<{ processed: number; landed: number }> {
  const resolved: ConsumeComfyBridgeWritebacksDeps = {
    client: deps.client ?? { getBridgeWritebacks: async () => null, ackBridgeWritebacks: async () => 0 },
    storyboards: deps.storyboards ?? (() => useStudioStore.getState().storyboards),
    applyToStoryboard: deps.applyToStoryboard ?? defaultApplyToStoryboard,
    applyVideoToStoryboard: deps.applyVideoToStoryboard ?? defaultApplyVideoToStoryboard,
    projectId: deps.projectId ?? (() => useProjectStore.getState().activeProjectId),
    writeProjectBinary:
      deps.writeProjectBinary ??
      (async (projectId, relativePath, bytes) => {
        const bridge = getProjectFilesBridge();
        if (!bridge) return { success: false, error: "项目文件桥不可用" };
        return bridge.writeBinary({ projectId, relativePath, bytes });
      }),
    persist: deps.persist ?? ((b64, title, options) => persistComfyImage(b64, title, options)),
    notify:
      deps.notify ??
      ((kind, detail) => {
        if (kind === "storyboard") toast.success(`ComfyUI 画布出图已回写分镜(${detail})`);
        else if (kind === "media") toast.success("ComfyUI 画布出图已存入项目媒体(未指定回写分镜)");
        else if (kind === "memory") toast.warning("ComfyUI 画布出图仅内存预览(无活动项目,未能落盘)");
        else toast.error(`ComfyUI 画布回写消费失败:${detail}`);
      }),
  };
  const reply = await resolved.client.getBridgeWritebacks(cursor).catch(() => null);
  if (!reply || reply.items.length === 0) return { processed: 0, landed: 0 };
  let landed = 0;
  let lastGood = cursor;
  for (const item of reply.items) {
    if (item.id <= cursor) continue; // 防御:服务端应已滤,双保险防重复落账
    try {
      if (item.videoB64) {
        const storyboardId = parseShotTarget(item.shotTarget, resolved.storyboards());
        if (!storyboardId) throw new Error(`找不到视频回写目标:${item.shotTarget ?? ""}`);
        const storyboard = resolved.storyboards().find((entry) => entry.id === storyboardId);
        if (!storyboard) throw new Error(`分镜不存在:${storyboardId}`);
        const projectId = resolved.projectId();
        if (!projectId) throw new Error("当前没有活动项目,无法落盘视频");
        assertVideoSubfolder(item, storyboard);
        const policy = videoPolicy(item);
        const version = useStudioStore.getState().videoCandidates.filter(
          (candidate) => candidate.provider === "h3-comfyui" && candidate.trackId === storyboard.trackId,
        ).length + 1;
        const timestamp = item.ts ?? Date.now();
        const relativePath = [
          "remotion",
          "outputs",
          "shots",
          safePathSegment(storyboard.episodeId),
          safePathSegment(storyboard.id),
          "h3",
          `${policy}_v${version}_${timestamp}.mp4`,
        ].join("/");
        const written = await resolved.writeProjectBinary(projectId, relativePath, decodeBase64(item.videoB64));
        if (!written.success || !written.url) throw new Error(written.error ?? "项目视频落盘失败");
        resolved.applyVideoToStoryboard(storyboardId, written.url, item, policy);
        resolved.notify("storyboard", `${item.shotTarget ?? storyboardId} 单镜视频已回收入项目(${policy} 档)`);
        landed += 1;
      } else if (item.imageB64) {
        const title = item.shotTarget ? `comfy-${item.shotTarget}` : "comfy-canvas";
        const persisted = await resolved.persist(item.imageB64, title, {
          source: "comfy-bridge",
          prompt: item.prompt ?? "",
        });
        const storyboardId = parseShotTarget(item.shotTarget, resolved.storyboards());
        if (storyboardId && persisted.url) {
          resolved.applyToStoryboard(storyboardId, persisted.url, item);
          resolved.notify("storyboard", item.shotTarget ?? storyboardId);
          landed += 1;
        } else if (persisted.url) {
          resolved.notify("media", "");
        } else {
          resolved.notify("memory", "");
        }
      }
      lastGood = item.id;
    } catch (error) {
      resolved.notify("error", error instanceof Error ? error.message : String(error));
      break; // 落账失败即停:不 ack,下次轮询从该项重试(收件箱持久)
    }
  }
  if (lastGood > cursor) {
    cursor = lastGood;
    void resolved.client.ackBridgeWritebacks(cursor);
  }
  return { processed: reply.items.length, landed };
}
