/**
 * split-scenes 工具 — 从 split-scenes.tsx 拆出(Child 2 R3,第5个上帝文件)。
 *
 * 提取 SplitScenesProps 接口 + formatDirectorDeletedSceneNumber 纯函数,
 * 降低 split-scenes.tsx(原 1011 行)的主文件行数。
 * split-scenes 组件体已通过 10+ 个 use-storyboard-* hooks 高度模块化。
 */

export interface SplitScenesProps {
  onBack?: () => void;
  /** Retained for import compatibility; the local video controller owns generation. */
  onGenerateVideos?: () => void;
}

export const formatDirectorDeletedSceneNumber = (sceneId: number) => sceneId + 1;
