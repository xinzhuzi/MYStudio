// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseStudioAssetRoleAttributes,
  StudioAssetRoleAttributes,
} from "./studio-asset-role-attributes";
import { StudioAssetDetailDialog } from "./StudioAssetDetailDialog";

afterEach(cleanup);

describe("studio asset role attributes", () => {
  it("parses the existing markdown labels and ignores unrelated fields", () => {
    expect(parseStudioAssetRoleAttributes([
      "- **姓名**：玄止",
      "- **性别**：男",
      "* **年龄**: 二十七",
      "- **身份**：巡夜使",
      "- **未知字段**：忽略",
    ].join("\n"))).toEqual([
      { label: "性别", value: "男" },
      { label: "年龄", value: "二十七" },
      { label: "身份", value: "巡夜使" },
    ]);
  });

  it("renders wide fields with the preserved two-column layout", () => {
    const { container } = render(
      <StudioAssetRoleAttributes
        setting={[
          "- **性别**：女",
          "- **出身背景**：北境旧族",
          "- **境界**：金丹",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("人物属性")).toBeTruthy();
    expect(container.textContent).toContain("性别：女");
    expect(screen.getByTitle("出身背景：北境旧族").className).toContain("col-span-2");
    expect(screen.getByTitle("境界：金丹").className).not.toContain("col-span-2");
  });

  it("renders nothing when the source has no supported attributes", () => {
    const { container } = render(
      <StudioAssetRoleAttributes setting="- **姓名**：玄止" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders role attributes through the real asset detail dialog fallback", async () => {
    render(
      <StudioAssetDetailDialog
        asset={{
          id: "role-玄止",
          source: "manying-local",
          type: "role",
          name: "玄止",
          setting: "- **身份**：巡夜使",
        }}
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(await screen.findByTitle("身份：巡夜使")).toBeTruthy();
  });
});
