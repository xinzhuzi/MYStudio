// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ImageStudio } from "./ImageStudio";
import { useFreedomStore } from "@/stores/freedom-store";

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as any).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

describe("ImageStudio", () => {
  beforeEach(() => {
    useFreedomStore.setState({
      imagePrompt: "男性角色四视图设定图",
      selectedImageModel: "",
      imageGenerating: false,
      imageResult: null,
      imageHistory: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("requires a selected image model before generation", () => {
    render(<ImageStudio />);

    expect((screen.getByRole("button", { name: /生成图片/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
