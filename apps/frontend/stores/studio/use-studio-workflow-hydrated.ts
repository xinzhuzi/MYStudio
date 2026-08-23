// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useSyncExternalStore } from "react";
import { useStudioStore } from "./studio-store";

/**
 * studio-workflow store 的水合状态（T4 水合竞态防线）：
 * 启动自动水合与切项目 persist.rehydrate() 两个窗口内为 false（zustand v5
 * rehydrate 开头会重置 hasHydrated），完成后为 true。
 * Canvas/生命周期 hook 在 false 期间禁止自动新建工作流，防止对空 store 的
 * 误写触发整库盲保存；storage 层另有 isHydrated fail-closed 拒写兜底。
 */
export function useStudioWorkflowHydrated(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const unsubStart = useStudioStore.persist.onHydrate(onStoreChange);
      const unsubFinish = useStudioStore.persist.onFinishHydration(onStoreChange);
      return () => {
        unsubStart();
        unsubFinish();
      };
    },
    () => useStudioStore.persist.hasHydrated(),
    () => true,
  );
}
