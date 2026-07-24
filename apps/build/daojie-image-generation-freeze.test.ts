import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appsRoot = new URL("../", import.meta.url).pathname;
const automationScript = readFileSync(`${appsRoot}/build/automate-daojie-chapter001-video.mjs`, "utf8");

function runHelper(payload: Record<string, unknown>, frozen: boolean) {
  return spawnSync("node", ["build/generate-storyboard-image.mjs"], {
    cwd: appsRoot,
    env: { ...process.env, MYSTUDIO_DAOJIE_IMAGE_GENERATION_FROZEN: frozen ? "1" : "" },
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

function runAutomation(args: string[], env: Record<string, string> = {}) {
  return spawnSync("node", ["build/automate-daojie-chapter001-video.mjs", ...args], {
    cwd: appsRoot,
    env: { ...process.env, MYSTUDIO_DAOJIE_IMAGE_GENERATION_FROZEN: "1", ...env },
    encoding: "utf8",
  });
}

describe("Daojie image-generation freeze guard", () => {
  it("blocks provider requests while frozen", () => {
    const result = runHelper({
      baseUrl: "http://127.0.0.1:9",
      apiKey: "test-key",
      model: "test-model",
      prompt: "test",
      singleAttempt: true,
    }, true);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("MYSTUDIO_DAOJIE_IMAGE_GENERATION_FROZEN=1");
    expect(`${result.stdout}\n${result.stderr}`).toContain("no provider request was sent");
  });

  it("keeps dry-run available while frozen", () => {
    const result = runHelper({ dryRun: true, prompt: "test", referenceImages: [] }, true);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).generationEndpointCalled).toBe(false);
  });

  it.each([
    ["--probe-generation", "probe-generation"],
    ["--continuity-pilot", "continuity-pilot"],
    ["--continuity-full-chapter", "continuity-full-chapter"],
    ["--continuity-asset-candidate", "continuity-asset-candidate"],
  ])("fails closed before running %s while frozen", (flag, mode) => {
    const result = runAutomation([flag]);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(`MYSTUDIO_DAOJIE_IMAGE_GENERATION_FROZEN=1: blocked Daojie image generation mode=${mode}`);
    expect(output).toContain("no provider request was sent");
  });

  it("fails closed before visual preflight for the default chapter command while frozen", () => {
    const result = runAutomation([]);
    const output = `${result.stdout}\n${result.stderr}`;
    const report = JSON.parse(
      readFileSync(`${appsRoot}/output/automation/daojie-chapter001-video-report.json`, "utf8"),
    );

    expect(result.status).not.toBe(0);
    expect(output).toContain("MYSTUDIO_DAOJIE_IMAGE_GENERATION_FROZEN=1: blocked Daojie image generation mode=chapter001-video");
    expect(output).toContain("no provider request was sent");
    expect(report).toMatchObject({
      ok: false,
      command: "npm run video:daojie:chapter001",
      failureStage: "visual-continuity-preflight",
    });
    expect(report.error).toContain("MYSTUDIO_DAOJIE_IMAGE_GENERATION_FROZEN=1");
    expect(report.error).toContain("no provider request was sent");
    expect(report.finalVideo).toBeUndefined();
    expect(report.finalVideoEvidence).toBeUndefined();
    expect(report.timelineRenderRecord).toBeUndefined();
    expect(report.legacyCompatibilityVideo).toBeUndefined();
    expect(report.storyboards).toBeUndefined();
    expect(report.storyboardsWithAssetLinks).toBeUndefined();
    expect(report.generatedFrameImages).toBeUndefined();
    expect(report.voiceoverManifest).toBeUndefined();
  });

  it("retains dry-run bypasses for continuity modes without executing them", () => {
    expect(automationScript).toContain("dryRun: process.env.MYSTUDIO_CONTINUITY_ASSET_CANDIDATE_DRY_RUN === '1'");
    expect(automationScript).toContain("dryRun: process.env.MYSTUDIO_CONTINUITY_PILOT_DRY_RUN === '1'");
    expect(automationScript).toContain("assertDaojieImageGenerationNotFrozen('continuity-asset-candidate', {");
    expect(automationScript).toContain("assertDaojieImageGenerationNotFrozen('continuity-pilot', {");
    expect(automationScript).toContain("assertDaojieImageGenerationNotFrozen('continuity-full-chapter', {");
  });
});
