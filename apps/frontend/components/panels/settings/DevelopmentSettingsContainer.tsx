import { DevelopmentSettingsTab } from "./DevelopmentSettingsTab";
import { useDevelopmentSettings } from "./useDevelopmentSettings";

export function DevelopmentSettingsContainer() {
  const development = useDevelopmentSettings();
  return (
    <DevelopmentSettingsTab
      settings={development.settings}
      onChange={development.setSettings}
      hasDevTools={development.hasDevTools}
      isOpeningDevTools={development.isOpeningDevTools}
      onOpenDevTools={development.openDevTools}
      hasDiagnostics={development.hasDiagnostics}
      diagnosticsInfo={development.diagnosticsInfo}
      isDiagnosticsLoading={development.isDiagnosticsLoading}
      isExportingDiagnostics={development.isExportingDiagnostics}
      isClearingDiagnostics={development.isClearingDiagnostics}
      onRefreshDiagnostics={development.refreshDiagnostics}
      onOpenDiagnosticsFolder={development.openDiagnosticsFolder}
      onExportDiagnostics={development.exportDiagnostics}
      onClearDiagnostics={development.clearDiagnostics}
    />
  );
}
