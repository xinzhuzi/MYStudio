// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 悬浮球任务中心(09-12 Trellis 09-12-orb-task-center):球=全应用进出口枢纽,
// 后台任务态是缺失出口。本 hook 纯订阅派生五类任务源,零写回、零 toast:
// - media/agent: studio-store run-task-slice 台账(mediaTasks/agentRuns,逐条视图);
// - remotion: 主进程渲染队列全局订阅(use-remotion-global-tasks,逐条视图);
// - tts/director/sclass: 生成中聚合计数(域内折叠一条,不逐条刷屏);
// 完成提醒=状态迁移 diff(hook 内 prev map/计数 refs),migration 即 bump+recent,
// 不依赖任何视图挂载。组件局部任务态(分镜批量/一键成片)一期不埋点(见 prd 非目标)。

import { useEffect, useMemo, useRef, useState } from "react";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { useDirectorStore } from "@/stores/director/director-store";
import { useSClassStore } from "@/stores/sclass/sclass-store";
import type { Tab } from "@/stores/navigation/media-panel-store";
import type { MediaGenerationTaskKind } from "@/types/studio-production-types";
import { useRemotionGlobalTasks } from "./use-remotion-global-tasks";

export type OrbTaskStatus = "queued" | "running" | "success" | "failed";
export type OrbTaskSource =
  | "remotion"
  | "media"
  | "agent"
  | "tts"
  | "director"
  | "sclass";

export interface OrbTaskView {
  id: string;
  source: OrbTaskSource;
  label: string;
  status: OrbTaskStatus;
  /** 0..1,有进度源的才给(remotion 一期状态徽标无进度;director/sclass 有)。 */
  progress?: number;
  targetTab?: Tab;
  errorReason?: string;
}

export interface OrbTaskCenter {
  /** 活跃任务(queued/running),空数组引用稳定。 */
  tasks: OrbTaskView[];
  /** 本会话内新近终态(新在前,上限 5)——完成提醒的数据面。 */
  recent: OrbTaskView[];
  /** 每次终态迁移 +1:徽章闪动动画以 key 重放。 */
  bumpTick: number;
}

const EMPTY_TASKS: OrbTaskView[] = [];
const RECENT_MAX = 5;

const MEDIA_KIND_LABELS: Record<MediaGenerationTaskKind, string> = {
  storyboardImage: "分镜图生成",
  derivedAssetImage: "衍生图生成",
  ttsAudio: "配音生成",
  modelVideo: "视频生成",
  ffmpegTrack: "音轨合成",
  finalExport: "成片导出",
};

const AGENT_KEY_LABELS: Record<string, string> = {
  eventAnalysis: "事件分析",
  storySkeleton: "故事骨架",
  adaptationStrategy: "改编策略",
  scriptDraft: "剧本草稿",
  productionPlan: "制作计划",
  directorPlan: "导演计划",
  deriveAssets: "衍生资产",
};

/** 进度归一:0..1 与 0..100 双口径兜底(导演 sceneProgress=0-100,sclass 亦百分比口径)。 */
function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const ratio = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, ratio));
}

const isActive = (status: OrbTaskStatus) =>
  status === "queued" || status === "running";
const isTerminal = (status: OrbTaskStatus) =>
  status === "success" || status === "failed";

export function useTaskCenter(): OrbTaskCenter {
  // ── media/agent: studio-store 台账(逐条) ─────────────────────────────
  const mediaTasks = useStudioStore((s) => s.mediaTasks);
  const agentRuns = useStudioStore((s) => s.agentRuns);

  // 视图保留全状态(终态也要在场,迁移 diff 才能看到"上一帧活跃→这一帧终态");
  // 活跃汇总处再过滤。
  const mediaViews = useMemo<OrbTaskView[]>(
    () =>
      mediaTasks
        .filter(
          (task) =>
            task.status === "queued" ||
            task.status === "running" ||
            task.status === "success" ||
            task.status === "failed",
        )
        .map((task) => ({
          id: `media:${task.id}`,
          source: "media" as const,
          label: MEDIA_KIND_LABELS[task.kind] ?? "生成任务",
          status: task.status as OrbTaskStatus,
          targetTab: "studio" as const,
          errorReason: task.errorReason,
        })),
    [mediaTasks],
  );

  const agentViews = useMemo<OrbTaskView[]>(
    () =>
      agentRuns
        .filter(
          (run) =>
            run.status === "running" ||
            run.status === "success" ||
            run.status === "failed",
        )
        .map((run) => ({
          id: `agent:${run.id}`,
          source: "agent" as const,
          label:
            (run.inputSummary && AGENT_KEY_LABELS[run.key]
              ? `${AGENT_KEY_LABELS[run.key]} · ${run.inputSummary}`
              : AGENT_KEY_LABELS[run.key] ?? run.inputSummary) ?? "AI 任务",
          status: run.status as OrbTaskStatus,
          targetTab: "studio" as const,
          errorReason: run.errorReason,
        })),
    [agentRuns],
  );

  // ── remotion: 主进程队列全局订阅(逐条) ─────────────────────────────
  const remotionViews = useRemotionGlobalTasks();

  // ── tts/director/sclass: 生成中聚合计数(域内折叠) ───────────────────
  const ttsProjects = useTtsStore((s) => s.projects);
  const sceneProgress = useDirectorStore((s) => s.sceneProgress);
  const sclassProjects = useSClassStore((s) => s.projects);

  const ttsCounts = useMemo(() => {
    let active = 0;
    let failed = 0;
    for (const project of Object.values(ttsProjects)) {
      for (const line of Object.values(project.voiceLines)) {
        if (line.status === "generating") active += 1;
        else if (line.status === "failed") failed += 1;
      }
    }
    return { active, failed };
  }, [ttsProjects]);

  const directorCounts = useMemo(() => {
    let active = 0;
    let failed = 0;
    let progressSum = 0;
    for (const scene of sceneProgress.values()) {
      if (scene.status === "generating") {
        active += 1;
        progressSum += normalizeProgress(scene.progress ?? 0);
      } else if (scene.status === "failed") failed += 1;
    }
    return {
      active,
      failed,
      progress: active > 0 ? progressSum / active : undefined,
    };
  }, [sceneProgress]);

  const sclassCounts = useMemo(() => {
    let active = 0;
    let failed = 0;
    let progressSum = 0;
    const groups = Object.values(sclassProjects).flatMap((project) => [
      ...project.shotGroups,
      ...Object.values(project.singleShotOverrides),
    ]);
    for (const item of groups) {
      if (item.videoStatus === "generating") {
        active += 1;
        progressSum += normalizeProgress(item.videoProgress ?? 0);
      } else if (item.videoStatus === "failed") failed += 1;
    }
    return {
      active,
      failed,
      progress: active > 0 ? progressSum / active : undefined,
    };
  }, [sclassProjects]);

  const countDomains = useMemo(
    () => [
      {
        source: "tts" as const,
        unit: "条",
        label: "配音生成",
        ...ttsCounts,
      },
      {
        source: "director" as const,
        unit: "镜头",
        label: "导演模式生成",
        ...directorCounts,
      },
      {
        source: "sclass" as const,
        unit: "镜头",
        label: "S级视频生成",
        ...sclassCounts,
      },
    ],
    [ttsCounts, directorCounts, sclassCounts],
  );

  // ── 终态 diff → recent + bump(完成提醒数据面;零 toast) ──────────────
  const [recent, setRecent] = useState<OrbTaskView[]>([]);
  const [bumpTick, setBumpTick] = useState(0);
  const recentIdRef = useRef(0);
  // 逐条域上一帧状态(media/agent/remotion)
  const prevEntryStatusRef = useRef<Map<string, OrbTaskStatus>>(new Map());
  // 计数域上一帧计数(tts/director/sclass);null=首帧只记录不发射
  const prevCountRef = useRef<Record<
    string,
    { active: number; failed: number }
  > | null>(null);

  const pushRecent = (view: Omit<OrbTaskView, "id">) => {
    recentIdRef.current += 1;
    const id = `recent-${recentIdRef.current}`;
    setRecent((prev) => [{ ...view, id }, ...prev].slice(0, RECENT_MAX));
    setBumpTick((tick) => tick + 1);
  };

  const perEntryViews = useMemo(
    () => [...remotionViews, ...mediaViews, ...agentViews],
    [remotionViews, mediaViews, agentViews],
  );

  useEffect(() => {
    // 逐条域:queued/running → success/failed 迁移即提醒
    const prevMap = prevEntryStatusRef.current;
    for (const view of perEntryViews) {
      const prev = prevMap.get(view.id);
      if (prev && isActive(prev) && isTerminal(view.status)) {
        pushRecent({
          source: view.source,
          label: view.label,
          status: view.status,
          errorReason: view.errorReason,
        });
      }
    }
    prevEntryStatusRef.current = new Map(
      perEntryViews.map((view) => [view.id, view.status]),
    );
    // 计数域:活跃计数下降=有任务离场;失败计数上升部分计为失败,其余推断为完成
    const prevCounts = prevCountRef.current;
    const nextCounts: Record<string, { active: number; failed: number }> = {};
    for (const domain of countDomains) {
      nextCounts[domain.source] = { active: domain.active, failed: domain.failed };
      if (!prevCounts) continue;
      const prev = prevCounts[domain.source];
      if (!prev) continue;
      const failedDelta = Math.max(0, domain.failed - prev.failed);
      const leftCount = prev.active - domain.active;
      if (leftCount <= 0 && failedDelta <= 0) continue;
      if (failedDelta > 0) {
        pushRecent({
          source: domain.source,
          label: `${domain.label}失败 · ${failedDelta} ${domain.unit}`,
          status: "failed",
        });
      }
      const successCount = Math.max(0, leftCount - failedDelta);
      if (successCount > 0) {
        pushRecent({
          source: domain.source,
          label: `${domain.label}完成 · ${successCount} ${domain.unit}`,
          status: "success",
        });
      }
    }
    prevCountRef.current = nextCounts;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pushRecent 为稳定 setState 封装
  }, [perEntryViews, countDomains]);

  // ── 活跃视图汇总(顺序:渲染/媒体台账/AI/计数域) ─────────────────────
  const tasks = useMemo(() => {
    const countViews: OrbTaskView[] = [];
    for (const domain of countDomains) {
      if (domain.active <= 0) continue;
      countViews.push({
        id: `count:${domain.source}`,
        source: domain.source,
        label: `${domain.label} · ${domain.active} ${domain.unit}`,
        status: "running",
        progress: domain.progress,
      });
    }
    if (
      remotionViews.length === 0 &&
      mediaViews.length === 0 &&
      agentViews.length === 0 &&
      countViews.length === 0
    ) {
      return EMPTY_TASKS;
    }
    return [
      ...remotionViews.filter((view) => isActive(view.status)),
      ...mediaViews.filter((view) => isActive(view.status)),
      ...agentViews.filter((view) => isActive(view.status)),
      ...countViews,
    ];
  }, [remotionViews, mediaViews, agentViews, countDomains]);

  return { tasks, recent, bumpTick };
}
