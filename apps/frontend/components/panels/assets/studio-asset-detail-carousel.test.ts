import { describe, expect, it, vi } from "vitest";

import { subscribeAssetCarouselIndex } from "./studio-asset-detail-carousel";
import type { CarouselApi } from "@/components/ui/carousel";

describe("subscribeAssetCarouselIndex", () => {
  it("publishes the current index and follows later carousel selections", () => {
    let selectedIndex = 1;
    let selectListener: (() => void) | undefined;
    const api = {
      selectedScrollSnap: vi.fn(() => selectedIndex),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "select") selectListener = listener;
      }),
    } as unknown as CarouselApi;
    const onIndexChange = vi.fn();

    subscribeAssetCarouselIndex(api, onIndexChange);
    expect(onIndexChange).toHaveBeenCalledWith(1);
    expect(api?.on).toHaveBeenCalledWith("select", expect.any(Function));

    selectedIndex = 2;
    selectListener?.();
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
  });

  it("ignores an unavailable carousel API", () => {
    const onIndexChange = vi.fn();

    subscribeAssetCarouselIndex(undefined, onIndexChange);

    expect(onIndexChange).not.toHaveBeenCalled();
  });
});
