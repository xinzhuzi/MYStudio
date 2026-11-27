import { useEffect, useState } from "react";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { useProjectStore } from "@/stores/project/project-store";

/**
 * D22/R10 剧本库回落读取:「无 App 内草稿时读漫剧剧本库文件」的单一入口
 * (真源自 AssetsTab 的 effect 抽出;ScriptTab 的只读回落展示共用同一 hook)。
 *
 * - 读取路径:`novel/drama/${chapterId}_漫剧.md`
 * - `enabled` false(该章已有草稿)时不调用读桥,省一次 IPC
 * - 桥缺席(非 Electron 宿主)/缺 projectId/缺章 id:保持空态,不算失败
 * - seq 守卫防切章竞态串章(旧 effect 同款)
 * - `failed`:读桥调用发生(桥在、章/项目齐、enabled)但读取未成功(reject 或 success:false)
 */
export function useLibraryDramaScript(args: {
  chapterId?: string;
  enabled: boolean;
}): { text: string | null; failed: boolean } {
  const { chapterId, enabled } = args;
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setText(null);
    setFailed(false);
    if (!enabled || !chapterId || !activeProjectId) return;
    const bridge = getProjectFilesBridge();
    if (!bridge?.readText) return;
    let seq = true;
    const relativePath = `novel/drama/${chapterId}_漫剧.md`;
    bridge
      .readText({ projectId: activeProjectId, relativePath })
      .then((res) => {
        if (!seq) return;
        if (res.success && res.text) {
          setText(res.text);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (seq) setFailed(true);
      });
    return () => {
      seq = false;
    };
  }, [chapterId, activeProjectId, enabled]);

  return { text, failed };
}
