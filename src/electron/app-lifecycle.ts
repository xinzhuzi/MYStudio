export interface ActivateWindowDecision {
  isAppReady: boolean;
  openWindowCount: number;
}

export function shouldCreateWindowOnActivate({
  isAppReady,
  openWindowCount,
}: ActivateWindowDecision) {
  return isAppReady && openWindowCount === 0;
}

export interface SecondInstanceWindowDecision {
  isAppReady: boolean;
  hasUsableWindow: boolean;
}

export function shouldCreateWindowOnSecondInstance({
  isAppReady,
  hasUsableWindow,
}: SecondInstanceWindowDecision) {
  return isAppReady && !hasUsableWindow;
}

export interface BeforeQuitEventLike {
  preventDefault: () => void;
}

export interface BeforeQuitCleanupOptions {
  stopLocalServices: () => Promise<unknown>;
  quit: () => void;
  onError?: (error: unknown) => void;
}

export function createBeforeQuitCleanup({
  stopLocalServices,
  quit,
  onError,
}: BeforeQuitCleanupOptions) {
  let cleanupStarted = false;
  let cleanupFinished = false;

  return (event: BeforeQuitEventLike) => {
    if (cleanupFinished) return;
    event.preventDefault();

    if (cleanupStarted) return;
    cleanupStarted = true;

    void stopLocalServices()
      .catch((error) => {
        onError?.(error);
      })
      .finally(() => {
        cleanupFinished = true;
        quit();
      });
  };
}

export interface WindowAllClosedOptions {
  platform: NodeJS.Platform | string;
  stopLocalServices: () => Promise<unknown>;
  quit: () => void;
  onError?: (error: unknown) => void;
}

export function createWindowAllClosedHandler({
  platform,
  stopLocalServices,
  quit,
  onError,
}: WindowAllClosedOptions) {
  return () => {
    void stopLocalServices().catch((error) => {
      onError?.(error);
    });

    if (platform !== "darwin") {
      quit();
    }
  };
}
