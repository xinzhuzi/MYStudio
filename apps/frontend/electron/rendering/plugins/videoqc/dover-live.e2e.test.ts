/**
 * DOVER L3 live E2E — 真实 TS controller → managed python worker 全链验证。
 *
 * 默认 skip（CI/常规回归不跑）；本地真机验证：
 *   DOVER_LIVE=1 MYSTUDIO_LIVE_VIDEO=<成片路径> npm test -- dover-live
 * 无 DOVER_LIVE 或成片不存在时整组跳过，绝不影响全量回归。
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createVideoQcRuntimeController } from "./dover-runtime-controller";

const liveEnabled = process.env.DOVER_LIVE === "1";
const liveVideo = process.env.MYSTUDIO_LIVE_VIDEO ?? "";
const storageBase = join(homedir(), "Library", "Application Support", "漫影工作室");
const backendRoot = resolve(__dirname, "../../../../../backend");
const modelWeight = join(storageBase, "model", "videoqc", "dover_mobile.pth");
const runnable = liveEnabled && existsSync(liveVideo) && existsSync(modelWeight);

describe.skipIf(!runnable)("DOVER L3 live E2E (real controller + managed python)", () => {
  it("probe → ready(真权重在场)", async () => {
    const controller = createVideoQcRuntimeController({
      storageBasePath: () => storageBase,
      backendRoot,
    });
    await controller.refresh();
    expect(controller.status().modelReady).toBe(true);
  }, 120_000);

  it("runVideoQcScore(whole) → accepted,官方口径分数", async () => {
    const controller = createVideoQcRuntimeController({
      storageBasePath: () => storageBase,
      backendRoot,
    });
    const outcome = await controller.runVideoQcScore({
      projectId: "live-e2e",
      chapterId: "live-chapter",
      videoPath: liveVideo,
      mode: "whole",
    });

    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted" || outcome.mode !== "whole") return;
    expect(outcome.overall.fused).toBeGreaterThanOrEqual(0);
    expect(outcome.overall.fused).toBeLessThanOrEqual(1);
    [outcome.overall.aesthetic, outcome.overall.technical].forEach((value) => {
      expect(Number.isFinite(value)).toBe(true);
    });
    expect(outcome.elapsedMs).toBeGreaterThan(0);
  }, 10 * 60_000);
});
