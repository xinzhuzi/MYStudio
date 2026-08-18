import type { SeriesMeta } from "@/types/script";
import type { ScriptProjectData } from "./script-store-types";

export interface ActiveScriptProjectState {
  activeProjectId: string | null;
  projects: Record<string, ScriptProjectData>;
}

/** 从剧本链产出推导兜底 seriesMeta(展示用 + 首次编辑的落盘基底)。
 *
 *  setSeriesMeta 的唯一调用方是整本剧本导入服务;走小说管线建的项目
 *  (scriptData/rawScript 有产出)从未写过 seriesMeta,概览因此永远停在
 *  「项目入口」导览分支。这里按「EP/第N集」后缀剥离出书名做读时推导;
 *  完全没有剧本内容的空项目仍返回 null,保持新项目导览。 */
export function deriveSeriesMetaFallback(project: ScriptProjectData): SeriesMeta | null {
  const epTitle = project.scriptData?.title?.trim() || "";
  const rawHead = project.rawScript.match(/^#\s*(.+)$/m)?.[1]?.trim() || "";
  const source = epTitle || rawHead;
  if (!source) return null;
  const seriesTitle =
    source
      .replace(/\s*EP\d+\s*[:：].*$/, "")
      .replace(/\s*第[一二三四五六七八九十百千零\d]+\s*[集话回].*$/, "")
      .trim() || source;
  return { title: seriesTitle, characters: project.scriptData?.characters ?? [] };
}

/** 推导结果的引用记忆化:同一 project 对象恒等映射同一包装对象。
 *  useActiveScriptProject 直连 Zustand useSyncExternalStore——若选择器每次
 *  返回新引用会被判定为快照变化,触发「重渲染→再选择→再新引用」死循环,
 *  渲染主线程打满(installed smoke CDP evaluate 超时的根因)。 */
const derivedMetaWrapCache = new WeakMap<ScriptProjectData, ScriptProjectData>();

export function selectActiveScriptProject(
  state: ActiveScriptProjectState,
): ScriptProjectData | null {
  const id = state.activeProjectId;
  if (!id) return null;
  const project = state.projects[id];
  if (!project) return null;
  if (project.seriesMeta) return project;
  const derived = deriveSeriesMetaFallback(project);
  if (!derived) return project;
  let wrapped = derivedMetaWrapCache.get(project);
  if (!wrapped) {
    wrapped = { ...project, seriesMeta: derived };
    derivedMetaWrapCache.set(project, wrapped);
  }
  return wrapped;
}
