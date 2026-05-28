import { describe, expect, it } from "vitest";
import {
  getProjectWorkspaceLabel,
  SAVE_STATUS_COPY,
} from "./ProjectHeader";

describe("ProjectHeader copy", () => {
  it("describes the current workspace instead of a workflow phase", () => {
    expect(getProjectWorkspaceLabel("studio", "script")).toBe("当前工作区：漫影工作流");
    expect(getProjectWorkspaceLabel("media", "script")).toBe("当前工作区：视频管理");
    expect(getProjectWorkspaceLabel("export", "script")).toBe("当前工作区：成片与导出");
  });

  it("uses Chinese save status labels", () => {
    expect(SAVE_STATUS_COPY).toEqual({
      saved: "已保存",
      saving: "保存中...",
      unsaved: "未保存",
    });
  });
});
