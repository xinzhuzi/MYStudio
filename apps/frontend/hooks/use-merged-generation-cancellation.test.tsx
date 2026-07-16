// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useMergedGenerationCancellation } from "./use-merged-generation-cancellation";

describe("useMergedGenerationCancellation", () => {
  it("starts a fresh run and aborts it when stopped", () => {
    const { result } = renderHook(() => useMergedGenerationCancellation());
    const signal = result.current.start();

    expect(result.current.cancelledRef.current).toBe(false);
    expect(signal.aborted).toBe(false);

    result.current.stop();

    expect(result.current.cancelledRef.current).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it("aborts the previous run when a new run starts", () => {
    const { result } = renderHook(() => useMergedGenerationCancellation());
    const firstSignal = result.current.start();
    const secondSignal = result.current.start();

    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    expect(result.current.cancelledRef.current).toBe(false);

    result.current.finish(secondSignal);
    expect(secondSignal.aborted).toBe(false);
  });

  it("aborts an active run on unmount", () => {
    const { result, unmount } = renderHook(() => useMergedGenerationCancellation());
    const signal = result.current.start();
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
