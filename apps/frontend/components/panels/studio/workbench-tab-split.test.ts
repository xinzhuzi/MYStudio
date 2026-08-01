import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("WorkbenchTab split boundaries", () => {
  it("keeps the native Studio host free of legacy track-card rendering", () => {
    const tabSource = readFileSync(
      "frontend/components/panels/studio/WorkbenchTab.tsx",
      "utf8",
    );
    expect(tabSource).not.toContain('from "./WorkbenchTrackCard"');
    expect(tabSource).not.toContain("<CardHeader");
    expect(tabSource).not.toContain("<CardContent");
    expect(tabSource).toContain("章节共享音频配置");
    expect(tabSource).toContain("createRemotionChapterManifestFingerprint");
    expect(tabSource).toContain("selectAudioFile");
    expect(tabSource).toContain("对白 ducking");
    expect(tabSource).toContain("分镜音频操作");
    expect(tabSource).toContain("导入 SFX");
    expect(tabSource).toContain("重试分镜");
    expect(tabSource).toContain("取消分镜");
    expect(tabSource).toContain("useRemotionQueueScope");
  });
});
