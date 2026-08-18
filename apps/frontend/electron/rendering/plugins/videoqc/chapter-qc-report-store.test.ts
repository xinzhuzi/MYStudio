import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chapterQcReportPath, readChapterQcReport, writeChapterQcReport } from "./chapter-qc-report-store";
import type { ChapterQcReportV1 } from "./chapter-qc-types";

function report(chapterId: string, createdAt: number): ChapterQcReportV1 {
  return {
    schemaVersion: 1,
    projectId: "p1",
    chapterId,
    outputPath: "/tmp/out.mp4",
    createdAt,
    layers: { structural: { status: "passed" }, ffmpegScan: { status: "pending" }, aesthetic: { status: "pending" }, semantic: { status: "pending" } },
    findings: [],
    summary: { blockers: 0, warns: 0, infos: 0 },
  };
}

describe("chapter-qc-report-store", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-report-"));

  it("chapterId 段校验拒绝非法字符", () => {
    expect(() => chapterQcReportPath(dir, "../escape")).toThrow(/非法字符/);
    expect(chapterQcReportPath(dir, "chapter-001")).toBe(join(dir, "qc", "chapters", "chapter-001", "current.json"));
  });

  it("写后可读;覆盖写时旧版挪 previous.json", async () => {
    const chapterId = "chapter-001";
    await writeChapterQcReport(dir, chapterId, report(chapterId, 1000));
    const first = await readChapterQcReport(dir, chapterId);
    expect(first?.createdAt).toBe(1000);

    await writeChapterQcReport(dir, chapterId, report(chapterId, 2000));
    const second = await readChapterQcReport(dir, chapterId);
    expect(second?.createdAt).toBe(2000);
    const previous = JSON.parse(readFileSync(join(dir, "qc", "chapters", chapterId, "previous.json"), "utf-8"));
    expect(previous.createdAt).toBe(1000);
  });

  it("无报告返回 null;坏 JSON 返回 null", async () => {
    expect(await readChapterQcReport(dir, "chapter-none")).toBeNull();
    const badDir = join(dir, "qc", "chapters", "chapter-bad");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(chapterQcReportPath(dir, "chapter-bad"), "{oops", "utf-8");
    expect(await readChapterQcReport(dir, "chapter-bad")).toBeNull();
    expect(existsSync(join(badDir, "current.json"))).toBe(true);
  });

  it("原子写不留 tmp 残留", async () => {
    const chapterId = "chapter-003";
    await writeChapterQcReport(dir, chapterId, report(chapterId, 1));
    const currentDir = join(dir, "qc", "chapters", chapterId);
    expect(existsSync(join(currentDir, "current.json.tmp"))).toBe(false);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
