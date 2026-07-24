export function canApplyLocalTtsUpdate(mounted: boolean): boolean {
  return mounted;
}

export function applyLocalTtsRuntimeStatus<T>(
  mounted: boolean,
  status: T,
  setStatus: (status: T) => void,
): boolean {
  if (!canApplyLocalTtsUpdate(mounted)) return false;
  setStatus(status);
  return true;
}
