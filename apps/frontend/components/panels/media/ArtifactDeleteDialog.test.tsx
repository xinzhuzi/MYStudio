// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { DeletionPlan } from "@/types/artifacts";
import { ArtifactDeleteDialog } from "./ArtifactDeleteDialog";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(() => cleanup());

function makePlan(overrides: Partial<DeletionPlan> = {}): DeletionPlan {
  return {
    planId: "plan-1",
    schemaVersion: "1.0.0",
    projectId: "project-1",
    chapterId: "chapter-001",
    scope: "chapter",
    selectedArtifactIds: [],
    createdAt: 1,
    fingerprint: "fingerprint-1",
    deleteItems: [{
      artifactId: "export:export-video:chapter-001-final",
      kind: "export-video",
      stage: "export",
      name: "chapter-001-final.mp4",
      bytes: 2048,
      physicalPath: "/project/exports/chapter-001/chapter-001-final.mp4",
      physicalHash256: "sha256-delete",
      physicalRefs: [{
        type: "project-file",
        path: "exports/chapter-001/chapter-001-final.mp4",
        bytes: 1024,
      }],
      upstreamOwnerIds: ["production:production-track:track-1"],
      reason: "章节独占导出",
    }],
    migrateItems: [{
      artifactId: "assets:character-variant:variant-1",
      kind: "character-variant",
      stage: "assets",
      name: "保留角色变体",
      bytes: 4096,
      physicalPath: "/project/workflow-images/chapter-001/variant.png",
    }],
    retainItems: [{
      artifactId: "assets:base-character:character-1",
      kind: "base-character",
      stage: "assets",
      name: "共享角色",
      bytes: 8192,
      upstreamOwnerIds: ["chapter-002"],
    }],
    blockerItems: [],
    backupImpact: [{
      format: "mixed-multi-chapter-backup",
      filePath: "/project/backups/studio-state.json.bak",
      action: "rewrite",
      reason: "仅剔除 chapter-001",
    }],
    byteTotals: {
      deleteBytes: 2048,
      migrateBytes: 4096,
      retainBytes: 8192,
      totalBytes: 14336,
    },
    confirmationRequired: { type: "chapter-title", value: "第一章" },
    executionAllowed: true,
    ...overrides,
  };
}

describe("ArtifactDeleteDialog", () => {
  it("shows exact scope, byte totals and complete per-item evidence", () => {
    render(
      <ArtifactDeleteDialog
        isOpen
        plan={makePlan()}
        onClose={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    expect(screen.getByText("删除后无法恢复")).toBeTruthy();
    const summary = screen.getByLabelText("删除范围摘要");
    expect(within(summary).getByText("project-1")).toBeTruthy();
    expect(within(summary).getByText("chapter-001")).toBeTruthy();
    expect(within(summary).getByText("第一章")).toBeTruthy();
    expect(within(summary).getByText("2 KB")).toBeTruthy();
    expect(within(summary).getByText("4 KB")).toBeTruthy();
    expect(within(summary).getByText("8 KB")).toBeTruthy();
    expect(within(summary).getByText("14 KB")).toBeTruthy();
    expect(screen.queryByText("1 B")).toBeNull();

    expect(screen.getByText("/project/exports/chapter-001/chapter-001-final.mp4")).toBeTruthy();
    expect(screen.getByText("project-file · exports/chapter-001/chapter-001-final.mp4 · 1 KB")).toBeTruthy();
    expect(screen.getByText("production:production-track:track-1")).toBeTruthy();
    expect(screen.getByText("sha256-delete")).toBeTruthy();
    expect(screen.getByText("/project/backups/studio-state.json.bak")).toBeTruthy();
  });

  it("requires the exact chapter confirmation before executing", async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <ArtifactDeleteDialog
        isOpen
        plan={makePlan()}
        onClose={onClose}
        onExecute={onExecute}
      />,
    );

    const confirmButton = screen.getByRole("button", { name: "确认删除" });
    const input = screen.getByPlaceholderText("输入确认值");
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "第一章 " } });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "第一章" } });
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(onExecute).toHaveBeenCalledWith({ type: "chapter", chapterTitle: "第一章" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps execution disabled when the plan contains blockers", () => {
    render(
      <ArtifactDeleteDialog
        isOpen
        plan={makePlan({
          executionAllowed: false,
          blockerItems: [{
            artifactId: "unknown:media-file:blocker-1",
            kind: "media-file",
            stage: "media-library",
            name: "未知归属文件",
            reason: "无法判定章节归属",
          }],
        })}
        onClose={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("输入确认值"), { target: { value: "第一章" } });
    expect(screen.getByRole("button", { name: "确认删除" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("无法判定章节归属")).toBeTruthy();
  });
});
