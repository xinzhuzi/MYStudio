import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChapterQc, readReport } from "./chapter-qc-orchestrator";

// 集成测试用真实 ffmpeg/ffprobe 合成 8s 成片,走完整 L1+L2 链;
// 环境无 ffmpeg 时跳过(CI 依赖与 build 脚本同款假设)。
const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const itFfmpeg = ffmpegAvailable ? it : it.skip;

let dir: string;
let videoPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "qc-orch-"));
  videoPath = join(dir, "current.mp4");
  if (!ffmpegAvailable) return;
  execFileSync(
    "ffmpeg",
    [
      "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=8",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      videoPath,
    ],
    { stdio: "ignore" },
  );
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runChapterQc 集成(真实 ffmpeg)", () => {
  itFfmpeg("成片不存在返回 null", async () => {
    const result = await runChapterQc(
      {
        remotionWorkspaceRootForProject: () => dir,
        videoUseWorkspaceRootForProject: () => join(dir, "video-use"),
        dataRoot: join(dir, "data"),
      },
      { projectId: "p1", chapterId: "c-missing" },
    );
    expect(result).toBeNull();
  });

  itFfmpeg("无工件/无 store 降级仍产出报告:L1+L2 通过,观感 skip,语义 pending", async () => {
    const deps = {
      remotionWorkspaceRootForProject: () => dir,
      videoUseWorkspaceRootForProject: () => join(dir, "video-use"),
      dataRoot: join(dir, "data"),
    };
    // current.mp4 放在 outputs/chapters/c-001/ 约定位置
    const { mkdirSync, copyFileSync } = await import("node:fs");
    mkdirSync(join(dir, "outputs", "chapters", "c-001"), { recursive: true });
    copyFileSync(videoPath, join(dir, "outputs", "chapters", "c-001", "current.mp4"));

    const report = await runChapterQc(deps, { projectId: "p1", chapterId: "c-001" });
    expect(report).not.toBeNull();
    expect(report!.layers.structural.status).toBe("passed");
    expect(report!.layers.ffmpegScan.status).toBe("passed");
    expect(report!.layers.aesthetic.status).toBe("skipped");
    expect(report!.layers.aesthetic.reason).toBe("skipped-no-controller");
    expect(report!.layers.semantic.status).toBe("pending");
    expect(report!.durationS).toBeGreaterThan(7.5);
    expect(report!.outputSha256).toMatch(/^[0-9a-f]{64}$/);

    // 报告落盘可读
    const persisted = await readReport(deps, { projectId: "p1", chapterId: "c-001" });
    expect(persisted?.summary).toEqual(report!.summary);
    expect(existsSync(join(dir, "qc", "chapters", "c-001", "current.json"))).toBe(true);
  }, 180_000);
});
