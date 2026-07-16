// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SplitScenesPromptWarning } from "./split-scenes-prompt-warning";

afterEach(cleanup);

describe("SplitScenesPromptWarning", () => {
  it("keeps the established missing-prompt warning visible only when the parent reports a gap", () => {
    const { rerender } = render(<SplitScenesPromptWarning hasMissingPrompt />);

    expect(screen.getByText("部分分镜缺少提示词，点击分镜下方的文字区域可编辑。")).toBeTruthy();

    rerender(<SplitScenesPromptWarning hasMissingPrompt={false} />);

    expect(screen.queryByText("部分分镜缺少提示词，点击分镜下方的文字区域可编辑。")).toBeNull();
  });
});
