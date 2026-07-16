import { useCallback, useEffect, useRef } from "react";

export function useMergedGenerationCancellation() {
  const cancelledRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    controllerRef.current?.abort();
    cancelledRef.current = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller.signal;
  }, []);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const finish = useCallback((signal: AbortSignal) => {
    if (controllerRef.current?.signal === signal) {
      controllerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  return { cancelledRef, start, stop, finish };
}
