// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAPIConfigStore } from "@/stores/ai/api-config-store";
import {
  getAIConcurrency,
  getAIConfigStore,
  getModelEndpointTypes,
  useAIConfigSelector,
} from "./store-adapter";

describe("AI config store adapter", () => {
  const initialConcurrency = useAPIConfigStore.getState().concurrency;
  const initialEndpointTypes = useAPIConfigStore.getState().modelEndpointTypes;

  afterEach(() => {
    useAPIConfigStore.setState({
      concurrency: initialConcurrency,
      modelEndpointTypes: initialEndpointTypes,
    });
  });

  it("reads the canonical store state", () => {
    useAPIConfigStore.setState({ concurrency: 7 });

    expect(getAIConfigStore().concurrency).toBe(7);
  });

  it("supports selector access without exposing the store path", () => {
    useAPIConfigStore.setState({ concurrency: 3 });

    const { result } = renderHook(() => useAIConfigSelector((state) => state.concurrency));

    expect(result.current).toBe(3);
  });

  it("returns endpoint metadata and an empty list for unknown models", () => {
    useAPIConfigStore.setState({ modelEndpointTypes: { "model-a": ["video"] } });

    expect(getModelEndpointTypes("model-a")).toEqual(["video"]);
    expect(getModelEndpointTypes("missing-model")).toEqual([]);
  });

  it("keeps the existing minimum concurrency fallback", () => {
    useAPIConfigStore.setState({ concurrency: 0 });

    expect(getAIConcurrency()).toBe(1);
  });
});
