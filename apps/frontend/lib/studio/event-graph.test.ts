import { describe, expect, it } from "vitest";
import {
  buildProjectEventGraph,
  projectEventGraphToMemoryRecords,
  retrieveProjectMemory,
} from "./event-graph";
import type { NovelChapter } from "@/types/studio";

describe("project event graph and scoped memory", () => {
  it("builds event graph records from analyzed chapters", () => {
    const graph = buildProjectEventGraph({
      projectId: "project-a",
      now: 1000,
      chapters: [chapter("chapter-001", 1, "雨夜入镇", ["独孤剑尘", "晏燎"])],
    });

    expect(graph).toEqual([
      expect.objectContaining({
        id: "event-project-a-chapter-001",
        projectId: "project-a",
        episodeId: "chapter-001",
        chapterIndex: 1,
        entities: ["独孤剑尘", "晏燎"],
        timelineOrder: 1,
        source: "novelEventAnalysis",
      }),
    ]);
    expect(graph[0]?.retrievalText).toContain("事件：独孤剑尘入镇并救下晏燎");
  });

  it("retrieves only scoped project memory and can include prior episode context", () => {
    const projectA = projectEventGraphToMemoryRecords(
      buildProjectEventGraph({
        projectId: "project-a",
        now: 1000,
        chapters: [
          chapter("chapter-001", 1, "雨夜入镇", ["独孤剑尘"]),
          chapter("chapter-002", 2, "塾馆燃气", ["晏燎"]),
        ],
      }),
    );
    const projectB = projectEventGraphToMemoryRecords(
      buildProjectEventGraph({
        projectId: "project-b",
        now: 1000,
        chapters: [chapter("chapter-999", 1, "外部项目", ["独孤剑尘"])],
      }),
    );

    const context = retrieveProjectMemory([...projectA, ...projectB], {
      projectId: "project-a",
      episodeId: "chapter-002",
      chapterIndex: 2,
      entities: ["独孤剑尘"],
      purpose: "script",
    });

    expect(context.records.map((record) => record.projectId)).toEqual(["project-a", "project-a"]);
    expect(context.records.map((record) => record.episodeId)).toEqual(["chapter-002", "chapter-001"]);
    expect(context.markdown).toContain("项目记忆（编剧阶段范围检索）");
    expect(context.markdown).not.toContain("外部项目");
  });
});

function chapter(id: string, index: number, title: string, characters: string[]): NovelChapter {
  return {
    id,
    index,
    title,
    sourceText: `${title}正文`,
    importedAt: 1000,
    eventAnalysis: {
      chapterLabel: `第${index}章 ${title}`,
      characters,
      coreEvent: `${characters[0] ?? "角色"}入镇并救下晏燎`,
      mainlineRelation: "强（主线推进）",
      informationDensity: "高",
      estimatedDurationSec: 50,
      emotionTags: ["冲突", "悬疑"],
      rawLine: "",
    },
  };
}
