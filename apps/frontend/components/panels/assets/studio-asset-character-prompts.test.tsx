// @vitest-environment jsdom
/**
 * 人物提示词面板测试(10-26 用户令:JSON 数据化呈现+文生图/图生图标注):
 * 目录用构造夹具(不绑真源文件内容),钉三件事——路由徽标逐条渲染、阶段联动
 * (选中=该境五条;无=引导文案)、卡片点击展开全文。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioAssetCharacterPrompts } from "./studio-asset-character-prompts";
import type { CharacterPromptCatalog } from "@/lib/studio/asset-character-json";

const catalog: CharacterPromptCatalog = {
  faceBase: { key: "hd_face_base", route: "t2i", routeNote: "人脸基准正射(t2i)", title: "人脸基准", text: "人脸基准全文" },
  bodyBase: { key: "body_base", route: "t2i", routeNote: "素体基底", title: "人物基底·素体", text: "素体基底全文" },
  realms: [
    {
      stage: "筑基期",
      rawKey: "2.筑基期",
      entries: [
        { key: "筑基期:主体词_独立t2i备用", route: "t2i", routeNote: "独立直出", title: "筑基期·独立主体词", text: `${"独立主体词长文。".repeat(30)}` },
        { key: "筑基期:编辑指令", route: "i2i", routeNote: "单参考换装编辑", title: "筑基期·换装编辑指令", text: "换装编辑全文" },
        { key: "筑基期:正视图指令", route: "i2i", routeNote: "双参考换衣编辑", title: "筑基期·正视图指令", text: "正视图全文" },
      ],
    },
  ],
};

afterEach(() => cleanup());

describe("StudioAssetCharacterPrompts", () => {
  it("基底恒显+阶段选中渲染该境条目,路由徽标逐条标注", () => {
    render(<StudioAssetCharacterPrompts catalog={catalog} stage="筑基期" />);
    expect(screen.getByText("人脸基准")).toBeTruthy();
    expect(screen.getByText("人物基底·素体")).toBeTruthy();
    expect(screen.getByText("筑基期·独立主体词")).toBeTruthy();
    expect(screen.getByText("筑基期·正视图指令")).toBeTruthy();
    // 10-26 三次令:路由标注整组不渲染
    expect(screen.queryByText("文生图")).toBeNull();
    expect(screen.queryByText("图生图")).toBeNull();
  });

  it("无阶段选择只显基底组(引导提示已按 10-26 令删除)", () => {
    render(<StudioAssetCharacterPrompts catalog={catalog} stage={null} />);
    expect(screen.queryByText(/选择上方「阶段」/)).toBeNull();
    expect(screen.queryByText(/阶段选择器未显示/)).toBeNull();
    expect(screen.queryByText("筑基期·独立主体词")).toBeNull();
    expect(screen.getByText("人脸基准")).toBeTruthy();
  });

  it("卡片点击展开显示全文", () => {
    render(<StudioAssetCharacterPrompts catalog={catalog} stage="筑基期" />);
    const longText = "独立主体词长文。".repeat(30);
    expect(screen.getByText(longText, { exact: false }).className).toContain("line-clamp-2");
    fireEvent.click(screen.getByText("筑基期·独立主体词"));
    expect(screen.getByText(longText).className).not.toContain("line-clamp-2");
  });
});
