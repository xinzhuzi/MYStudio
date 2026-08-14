// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactDeleteDialog } from "@/components/panels/media/ArtifactDeleteDialog";
import type { DeletionPlan } from "@/types/artifacts";

const plan: DeletionPlan = {
  planId: "plan-fixture",
  schemaVersion: "1.0.0",
  projectId: "project-fixture",
  chapterId: "chapter-fixture",
  scope: "chapter",
  selectedArtifactIds: [],
  createdAt: 1,
  fingerprint: "fingerprint-fixture",
  deleteItems: [{ artifactId: "novel:novel-chapter:chapter-fixture", kind: "novel-chapter", stage: "novel", name: "第一章", bytes: 10 }],
  migrateItems: [],
  retainItems: [{ artifactId: "assets:base-character:hero", kind: "base-character", stage: "assets", name: "主角", reason: "共享基础资产" }],
  blockerItems: [],
  backupImpact: [{ format: "chapter-only-backup", filePath: "backups/chapter-fixture.bak", action: "delete" }],
  byteTotals: { deleteBytes: 10, migrateBytes: 0, retainBytes: 0, totalBytes: 10 },
  confirmationRequired: { type: "chapter-id", value: "chapter-fixture" },
  executionAllowed: true,
};

describe("ArtifactDeleteDialog", () => {
  it("shows the irreversible warning and full backup impact", () => {
    render(<ArtifactDeleteDialog isOpen plan={plan} onClose={vi.fn()} onExecute={vi.fn()} />);
    expect(screen.getByText(/永久删除/)).toBeTruthy();
    expect(screen.getByText("backups/chapter-fixture.bak")).toBeTruthy();
    expect(screen.getByText("第一章")).toBeTruthy();
  });

  it("keeps execute disabled until the exact chapter id is entered", () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    render(<ArtifactDeleteDialog isOpen plan={plan} onClose={vi.fn()} onExecute={onExecute} />);
    const button = screen.getByRole("button", { name: /确认删除/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "chapter-fixtur" } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(onExecute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "chapter-fixture" } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onExecute).toHaveBeenCalledWith({ type: "chapter", chapterId: "chapter-fixture" });
  });
});
