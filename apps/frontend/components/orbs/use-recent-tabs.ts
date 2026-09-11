// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-11 中转枢纽裁定:球要记录各模块跳转。「最近」=最近到访的模块(不含当前),
// 每次视图切换把「离开的那个模块」推到队首,localStorage 持久化,上限 4 条。

import { useEffect, useRef, useState } from "react";
import { useMediaPanelStore, type Tab } from "@/stores/navigation/media-panel-store";

const RECENT_TABS_KEY = "mystudio.orb.recent-tabs";
const RECENT_MAX = 4;

function loadRecent(): Tab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_TABS_KEY);
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Tab => typeof item === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** 模块跳转记录:watch activeTab,离栈者入列;返回最近到访(可能含当前,展示端过滤)。 */
export function useRecentTabs(): Tab[] {
  const activeTab = useMediaPanelStore((state) => state.activeTab);
  const [recent, setRecent] = useState<Tab[]>(loadRecent);
  const lastTabRef = useRef(activeTab);

  useEffect(() => {
    if (lastTabRef.current === activeTab) return;
    const left = lastTabRef.current;
    lastTabRef.current = activeTab;
    setRecent((prev) => {
      const next = [left, ...prev.filter((tab) => tab !== left && tab !== activeTab)].slice(0, RECENT_MAX);
      try {
        window.localStorage.setItem(RECENT_TABS_KEY, JSON.stringify(next));
      } catch {
        // 存储不可用时仅内存保持
      }
      return next;
    });
  }, [activeTab]);

  return recent;
}
