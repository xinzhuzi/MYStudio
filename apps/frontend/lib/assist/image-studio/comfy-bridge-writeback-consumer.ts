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
      if (item.imageB64) {
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
