"use client";

import { useProjectStore } from "@/stores/project/project-store";
import { MusicTab } from "./MusicTab";

export { MusicTab } from "./MusicTab";

/**
 * 侧边栏「音乐」面板(08-19 工作台音乐生成升级为独立侧边栏界面)。
 * 项目上下文取自项目 store(活跃项目);生成产物经 __PROJECT_MUSIC__ 哨兵
 * 落 <项目根>/music/(主进程动态拼接,见 music3-gen-ipc)。
 */
export function MusicPanel() {
  const activeProject = useProjectStore((state) => state.activeProject);
  // 用户裁定(08-20):内容铺满面板区,四边只留 20px,不做居中窄幅。
  return (
    <div className="h-full overflow-auto bg-background p-5">
      <MusicTab projectId={activeProject?.id} projectName={activeProject?.name ?? ""} />
    </div>
  );
}
