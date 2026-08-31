// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

import { useProjectStore } from "@/stores/project/project-store";
import { MusicTab } from "./MusicTab";

/**
 * 辅助面板第五工作室:音乐生成(08-31 自顶级侧边栏 tab 迁入,原 MusicPanel)。
 * 项目上下文取自项目 store(活跃项目);生成产物经 __PROJECT_MUSIC__ 哨兵
 * 落 <项目根>/music/(主进程动态拼接,见 music3-gen-ipc)。
 */
export function MusicStudio() {
  const activeProject = useProjectStore((state) => state.activeProject);
  // 用户裁定(08-20):内容铺满面板区,四边只留 20px,不做居中窄幅。
  // TabsContent 为 overflow-hidden,MusicTab 是垂直滚动布局 → 本层提供滚动容器。
  return (
    <div className="h-full overflow-auto bg-background p-5">
      <MusicTab projectId={activeProject?.id} projectName={activeProject?.name ?? ""} />
    </div>
  );
}
