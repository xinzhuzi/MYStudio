export type DiagnosticsBridge = NonNullable<Window["diagnosticsLog"]>;
export function getDiagnosticsBridge(): DiagnosticsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.diagnosticsLog;
}
