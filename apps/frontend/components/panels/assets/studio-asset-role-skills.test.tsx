// @vitest-environment jsdom
/**
 * 人物技能卡三级折叠链测试(10-26 用户实录「这个里面没有折叠」:
 * 功能实测全通,病灶=折叠手感不可感知——2.5px 全灰箭头+无按钮态;本件钉功能链
 * 与 10-26 手感修后行为:境界行展开术法、术法长描述默认两行截断点开全文)。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioAssetRoleSkills, parseRoleSkills } from "./studio-asset-role-skills";

const longDescription = "剑气凝于刃上挥出半月弧光,初重仅能斩出三尺,随重数加深至十丈开外,并附加破防效果。".repeat(4);
const payload = JSON.stringify([
  {
    dao: "剑主男",
    source: "t.md",
    skills: [
      { realm: "第1重", name: "剑气斩", type: "主动", prerequisite: null, description: longDescription },
      { realm: "第1重", name: "剑光盾", type: "被动", prerequisite: "剑气斩", description: "短描述" },
    ],
  },
]);

afterEach(() => cleanup());

describe("StudioAssetRoleSkills 折叠链", () => {
  it("卡默认折叠;点卡开→道途默认展开→境界行在场且术法收起", () => {
    render(<StudioAssetRoleSkills skills={payload} />);
    expect(screen.queryByText("剑主男")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /人物技能/ }));
    expect(screen.getByText("剑主男")).toBeTruthy();
    expect(screen.getByText("第1重")).toBeTruthy();
    expect(screen.queryByText("剑气斩")).toBeNull();
  });

  it("境界行点击展开术法;长描述默认截断(line-clamp),点术法条展开全文,再点收起", () => {
    render(<StudioAssetRoleSkills skills={payload} />);
    fireEvent.click(screen.getByRole("button", { name: /人物技能/ }));
    fireEvent.click(screen.getByRole("button", { name: /剑主男 第1重/ }));
    expect(screen.getByText("剑气斩")).toBeTruthy();
    const desc = screen.getByText(longDescription);
    expect(desc.className).toContain("line-clamp-2");
    fireEvent.click(screen.getByText("剑气斩"));
    expect(screen.getByText(longDescription).className).not.toContain("line-clamp-2");
    fireEvent.click(screen.getByText("剑气斩"));
    expect(screen.getByText(longDescription).className).toContain("line-clamp-2");
  });

  it("短描述(≤60字)不截断不可点;道途行点击整组收起;境界计数徽章在场", () => {
    render(<StudioAssetRoleSkills skills={payload} />);
    fireEvent.click(screen.getByRole("button", { name: /人物技能/ }));
    fireEvent.click(screen.getByRole("button", { name: /剑主男 第1重/ }));
    expect(screen.getByText("2")).toBeTruthy();
    // 短描述无截断类
    expect(screen.getByText("短描述").className).not.toContain("line-clamp-2");
    // 收道途
    fireEvent.click(screen.getByRole("button", { name: /剑主男 道途技能/ }));
    expect(screen.queryByText("第1重")).toBeNull();
  });

  it("parseRoleSkills 容错:空/坏 JSON/坏元素全吐空数组", () => {
    expect(parseRoleSkills(null)).toEqual([]);
    expect(parseRoleSkills("")).toEqual([]);
    expect(parseRoleSkills("{broken")).toEqual([]);
    expect(parseRoleSkills(JSON.stringify([{ dao: 1, skills: [] }]))).toEqual([]);
  });
});
