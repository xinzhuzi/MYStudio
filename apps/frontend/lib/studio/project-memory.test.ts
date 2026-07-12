import { describe, expect, it } from "vitest";
import {
  buildProjectEventGraph,
  buildProjectMemoryRecords,
  formatProjectMemoryContext,
  purgeProjectMemory,
  retrieveProjectMemory,
} from "./project-memory";
import type { NovelChapter } from "@/types/studio";

describe("project memory", () => {
  it("builds project-scoped event graph nodes from analyzed chapters", () => {
    const graph = buildProjectEventGraph({ projectId: "dao", chapters: chapters() });

    expect(graph).toEqual([
      expect.objectContaining({
        id: "dao:event:chapter-001",
        projectId: "dao",
        chapterId: "chapter-001",
        timelineOrder: 1,
        summary: "独孤救下小杂役",
        characters: ["独孤剑尘", "赵四"],
      }),
      expect.objectContaining({
        id: "dao:event:chapter-002",
        timelineOrder: 2,
        summary: "断剑旧案浮出",
      }),
    ]);
  });

  it("retrieves only project and episode scoped memory", () => {
    const records = [
      ...buildProjectMemoryRecords({ projectId: "dao", chapters: chapters(), createdAt: 1 }),
      ...buildProjectMemoryRecords({
        projectId: "other",
        chapters: [{ ...chapters()[0]!, id: "chapter-001", title: "其他项目" }],
        createdAt: 1,
      }),
    ];

    const result = retrieveProjectMemory({
      records,
      projectId: "dao",
      episodeId: "chapter-002",
      query: "断剑 独孤",
    });

    expect(result.map((item) => item.projectId)).toEqual(["dao"]);
    expect(result[0]).toMatchObject({ episodeId: "chapter-002", title: "第二章 旧案" });
    expect(formatProjectMemoryContext(result)).toContain("项目记忆");
  });

  it("purges removable project memory without touching other projects", () => {
    const records = [
      ...buildProjectMemoryRecords({ projectId: "dao", chapters: chapters(), createdAt: 1 }),
      ...buildProjectMemoryRecords({ projectId: "other", chapters: chapters(), createdAt: 1 }),
    ];

    const purged = purgeProjectMemory(records, "dao");

    expect(purged.every((item) => item.projectId === "other")).toBe(true);
    expect(purged.length).toBeGreaterThan(0);
  });
});

function chapters(): NovelChapter[] {
  return [
    {
      id: "chapter-001",
      index: 1,
      title: "第一章 入镇",
      sourceText: "独孤剑尘入镇。",
      importedAt: 1,
      eventAnalysis: {
        chapterLabel: "第一章",
        characters: ["独孤剑尘", "赵四"],
        coreEvent: "独孤救下小杂役",
        mainlineRelation: "主角入局",
        informationDensity: "高",
        estimatedDurationSec: 45,
        emotionTags: ["压迫", "隐忍"],
        rawLine: "|第一章|独孤剑尘、赵四|独孤救下小杂役|",
      },
    },
    {
      id: "chapter-002",
      index: 2,
      title: "第二章 旧案",
      sourceText: "断剑露出。",
      importedAt: 1,
      eventSummary: "断剑旧案浮出",
      eventState: "独孤压住旧伤。",
    },
  ];
}
