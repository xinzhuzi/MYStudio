// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useEffect, useState } from "react";
import { InteractionEffects } from "@/components/InteractionEffects";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/ui/sonner";
import { UpdateDialog } from "@/components/UpdateDialog";
import { COLOR_PRESETS, useThemeStore } from "@/stores/theme-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { migrateToProjectStorage, recoverFromLegacy } from "@/lib/storage-migration";
import type { AvailableUpdateInfo } from "@/types/update";

let hasTriggeredStartupUpdateCheck = false;

function App() {
  const { theme, colorPreset } = useThemeStore();
  const { updateSettings, setUpdateSettings } = useAppSettingsStore();
  const [startupMaintenanceDone, setStartupMaintenanceDone] = useState(false);
  const [startupUpdate, setStartupUpdate] = useState<AvailableUpdateInfo | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  // 首屏先渲染，存储迁移和数据恢复延后到后台执行。
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      (async () => {
        const startedAt = performance.now();
        console.info("[App] Startup maintenance started");
        try {
          await useAppSettingsStore.persist.rehydrate();
          await migrateToProjectStorage();
          await recoverFromLegacy();
        } catch (err) {
          console.error('[App] Startup maintenance error:', err);
        } finally {
          console.info(`[App] Startup maintenance finished in ${Math.round(performance.now() - startedAt)}ms`);
          if (!cancelled) {
            setStartupMaintenanceDone(true);
          }
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // 同步主题到 html 元素
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    COLOR_PRESETS.forEach((preset) => {
      root.classList.remove(`theme-preset-${preset.id}`);
    });
    root.classList.add(theme);
    root.classList.add(`theme-preset-${colorPreset}`);
  }, [theme, colorPreset]);

  useEffect(() => {
    if (
      !startupMaintenanceDone ||
      hasTriggeredStartupUpdateCheck ||
      !updateSettings.autoCheckEnabled ||
      !window.appUpdater
    ) {
      return;
    }

    hasTriggeredStartupUpdateCheck = true;
    let cancelled = false;

    (async () => {
      const result = await window.appUpdater?.checkForUpdates();
      if (
        cancelled ||
        !result ||
        !result.success ||
        !result.hasUpdate ||
        !result.update ||
        result.update.latestVersion === updateSettings.ignoredVersion
      ) {
        return;
      }

      setStartupUpdate(result.update);
      setUpdateDialogOpen(true);
    })().catch((error) => {
      console.warn("[App] Auto update check failed:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [startupMaintenanceDone, updateSettings.autoCheckEnabled, updateSettings.ignoredVersion]);

  return (
    <InteractionEffects>
      <div className="h-screen w-screen overflow-hidden">
        <Layout />
        <UpdateDialog
          open={updateDialogOpen}
          onOpenChange={setUpdateDialogOpen}
          updateInfo={startupUpdate}
          onIgnoreVersion={(version) => {
            setUpdateSettings({ ignoredVersion: version });
            setStartupUpdate(null);
          }}
        />
        <Toaster richColors position="top-center" />
      </div>
    </InteractionEffects>
  );
}

export default App;
