// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import { buildCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import { buildFiveShotPlan, createFixtureAssets } from "./render-five-shot";

const TOKEN = "a".repeat(64);

describe("Remotion five-shot fixture", () => {
  it("covers five visuals, three audio tracks, subtitles, panZoom and four transitions", () => {
    const plan = buildFiveShotPlan(Array.from({ length: 8 }, (_, index) => `/tmp/fixture-${index}`));
    expect(plan.clips.filter((clip) => clip.trackKind === "image" || clip.trackKind === "video")).toHaveLength(5);
    expect(plan.clips.filter((clip) => clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx")).toHaveLength(3);
    expect(plan.clips.some((clip) => clip.trackKind === "text")).toBe(true);
    expect(plan.effects).toEqual([expect.objectContaining({ effectId: "panZoom" })]);
    expect(plan.transitions.map((transition) => transition.effectId)).toEqual([
      "fade", "crossfade", "flash", "blackout",
    ]);
  });

  it("keeps projected audio inside the transition-shortened composition", () => {
    const plan = buildFiveShotPlan(Array.from({ length: 8 }, (_, index) => `/tmp/fixture-${index}`));
    const mediaUrlByClipId = Object.fromEntries(
      plan.clips
        .filter((clip) => clip.source.path)
        .map((clip) => [clip.id, `http://127.0.0.1:43123/${TOKEN}/${clip.id}`]),
    );
    const validation = validateCompositionProps(buildCompositionProps(plan, mediaUrlByClipId));
    expect(validation).toEqual({ success: true, value: expect.any(Object) });
  });

  it("creates five visual files and three audio files", async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-five-shot-"));
    try {
      const assetPaths = await createFixtureAssets(fixtureDir);
      expect(assetPaths).toHaveLength(8);
      expect(assetPaths.slice(0, 5).map((assetPath) => path.extname(assetPath))).toEqual([
        ".png", ".png", ".mp4", ".png", ".png",
      ]);
      expect(assetPaths.every((assetPath) => fs.statSync(assetPath).size > 0)).toBe(true);
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
