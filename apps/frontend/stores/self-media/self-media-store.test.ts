import { beforeEach, describe, expect, it } from "vitest";
import { mergeSelfMediaState, useSelfMediaStore } from "./self-media-store";
import type { SelfMediaDraft, SelfMediaTask } from "@/types/self-media";

function task(id: string, projectId: string, status: SelfMediaTask["status"]): SelfMediaTask {
  return {
    id,
    attemptId: `attempt-${id}`,
    projectId,
    providerId: "aitoearn-local",
    accountId: "account-1",
    sourceAssetIds: ["asset-1"],
    status,
    progress: status === "success" ? 100 : 20,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:01:00.000Z",
  };
}

function draft(): SelfMediaDraft {
  return {
    id: "draft-1",
    projectId: "project-1",
    contentType: "video",
    title: "标题",
    description: "描述",
    topics: [],
    assets: [{ assetId: "asset-1", projectId: "project-1", kind: "video" }],
    accountIds: ["account-1"],
    visibility: "public",
    platformOptions: { platform: "xhs" },
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
}

describe("self-media project task recovery", () => {
  beforeEach(() => {
    useSelfMediaStore.setState({
      activeProjectId: "project-1",
      drafts: [],
      tasks: [task("stale", "project-1", "running")],
      history: [],
      accounts: [],
    });
  });

  it("replaces only the active project from the main-process journal", () => {
    useSelfMediaStore.getState().replaceProjectTasks("project-1", [
      task("running", "project-1", "running"),
      task("done", "project-1", "success"),
    ]);
    expect(useSelfMediaStore.getState().tasks.map((item) => item.id)).toEqual(["running", "done"]);
    expect(useSelfMediaStore.getState().history.map((item) => item.id)).toEqual(["done"]);
  });

  it("rejects a recovered list for another project", () => {
    expect(() => useSelfMediaStore.getState().replaceProjectTasks(
      "project-2",
      [task("foreign", "project-2", "running")],
    )).toThrow("active project");
  });

  it("adds an immediately terminal task to project history", () => {
    const completed = task("completed", "project-1", "success");
    useSelfMediaStore.getState().upsertTask(completed);
    expect(useSelfMediaStore.getState().history).toEqual([{ ...completed, finishedAt: completed.updatedAt }]);
  });

  it("hydrates only allowlisted drafts, tasks, and terminal history", () => {
    const completed = task("completed", "project-1", "success");
    const merged = mergeSelfMediaState({
      activeProjectId: "project-1",
      drafts: [{ ...draft(), ignored: "discarded" }, { ...draft(), id: "secret", apiKey: "must-not-load" }],
      tasks: [task("running", "project-1", "running"), { ...task("secret", "project-1", "running"), token: "must-not-load" }],
      history: [{ ...completed, finishedAt: completed.updatedAt }, { ...completed, id: "secret-history", cookie: "must-not-load" }],
    } as unknown, useSelfMediaStore.getState());

    expect(merged.drafts).toHaveLength(1);
    expect("ignored" in merged.drafts[0]).toBe(false);
    expect(merged.tasks.map((item) => item.id)).toEqual(["running"]);
    expect(merged.history).toEqual([{ ...completed, finishedAt: completed.updatedAt }]);
  });
});
