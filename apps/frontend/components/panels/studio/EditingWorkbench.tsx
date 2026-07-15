import { useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Clapperboard,
  Download,
  Film,
  ImageIcon,
  PauseCircle,
  Redo2,
  Scissors,
  Sparkles,
  Type,
  Undo2,
  Upload,
  Volume2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EditingCommand } from "@/lib/studio/editing/command-core";
import { buildEditingEffectPreview } from "@/lib/studio/editing/effect-preview";
import type {
  EditingClip,
  EditingProjectV1,
  TimelineRenderEvidence,
  TimelineRenderProgress,
} from "@/types/editing";
import { toPreviewSrc } from "./WorkbenchTrackCard";
import { EditingProposalPanel } from "./EditingProposalPanel";
import { useAudioWaveform } from "./useAudioWaveform";

interface EditingWorkbenchProps {
  project?: EditingProjectV1;
  drafting: boolean;
  rendering: boolean;
  renderProgress?: TimelineRenderProgress;
  renderEvidence?: TimelineRenderEvidence;
  error?: string;
  canUndo: boolean;
  canRedo: boolean;
  onCreateDraft: () => void;
  onRender: () => void;
  onCancelRender: () => void;
  onExecuteCommand: (command: EditingCommand) => boolean;
  onImportSubtitles: (file: File) => Promise<void>;
  onExportSubtitles: () => Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
}

export function EditingWorkbench(props: EditingWorkbenchProps) {
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const selectedClip = props.project?.clips.find((clip) => clip.id === selectedClipId);

  useEffect(() => {
    if (!props.project) {
      setSelectedClipId(undefined);
      return;
    }
    if (!props.project.clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(props.project.clips[0]?.id);
    }
  }, [props.project, selectedClipId]);

  return (
    <section
      aria-label="漫剧剪辑工作台"
      className="overflow-hidden rounded-xl border border-foreground/10 bg-[#121514] shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
    >
      <EditingWorkbenchHeader {...props} />
      {props.project ? (
        <div className="grid min-h-[620px] bg-[radial-gradient(circle_at_40%_15%,rgba(56,189,148,0.05),transparent_34%),linear-gradient(180deg,#151918,#101312)] xl:grid-cols-[230px_minmax(0,1fr)_280px] xl:grid-rows-[minmax(360px,1fr)_250px]">
          <EditingAssetPanel
            project={props.project}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
            onExecuteCommand={props.onExecuteCommand}
          />
          <EditingPreviewPanel project={props.project} clip={selectedClip} />
          <EditingPropertiesPanel
            project={props.project}
            clip={selectedClip}
            onExecuteCommand={props.onExecuteCommand}
          />
          <EditingTimelinePanel
            project={props.project}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
          />
        </div>
      ) : (
        <div className="flex min-h-[430px] items-center justify-center bg-[radial-gradient(circle_at_center,rgba(56,189,148,0.07),transparent_36%)] p-8 text-center">
          <div className="max-w-md">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200">
              <Clapperboard className="h-7 w-7" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-foreground">还没有可编辑时间线</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              从当前导演分镜、已选视频、逐镜口播和字幕生成确定性草案。重复执行会复用相同输入，人工版本不会被覆盖。
            </p>
            <Button className="mt-5" onClick={props.onCreateDraft} disabled={props.drafting}>
              <Sparkles className="h-4 w-4" />
              {props.drafting ? "正在编排" : "一键剪辑"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function EditingWorkbenchHeader(props: EditingWorkbenchProps) {
  const progress = props.renderProgress;
  return (
    <header className="border-b border-foreground/10 bg-[#181c1b]/95 px-4 py-3 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-200">
            <Film className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold tracking-wide">生产剪辑台</h2>
              {props.project ? (
                <Badge variant="outline" className="border-foreground/10 text-[10px] text-muted-foreground">
                  REV {props.project.revision}
                </Badge>
              ) : null}
              {props.project?.manuallyEdited ? (
                <Badge variant="outline" className="border-amber-300/25 bg-amber-300/[0.06] text-[10px] text-amber-200">
                  人工保护
                </Badge>
              ) : null}
              {props.project?.stale ? (
                <Badge variant="outline" className="border-rose-300/25 bg-rose-300/[0.06] text-[10px] text-rose-200">
                  上游已变化
                </Badge>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {progress
                ? `${progress.stage} · ${Math.round(progress.ratio * 100)}%${progress.message ? ` · ${progress.message}` : ""}`
                : props.project?.name ?? "EditingProject 尚未创建"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.project ? (
            <>
              <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 text-xs text-foreground/80 transition-colors hover:bg-white/[0.05]">
                <Upload className="h-3.5 w-3.5" />
                导入字幕
                <input
                  type="file"
                  accept=".srt,.ass"
                  className="sr-only"
                  aria-label="导入字幕文件"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void props.onImportSubtitles(file).catch(() => undefined);
                    event.target.value = "";
                  }}
                />
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => void props.onExportSubtitles().catch(() => undefined)}>
                <Download className="h-4 w-4" />
                导出 SRT
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onUndo}
            disabled={!props.canUndo}
            aria-label="撤销上一次剪辑"
          >
            <Undo2 className="h-4 w-4" />
            撤销
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onRedo}
            disabled={!props.canRedo}
            aria-label="重做下一次剪辑"
          >
            <Redo2 className="h-4 w-4" />
            重做
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={props.onCreateDraft} disabled={props.drafting || props.rendering}>
            <Sparkles className="h-4 w-4" />
            {props.drafting ? "编排中" : "一键剪辑"}
          </Button>
          {props.rendering ? (
            <Button type="button" variant="destructive" size="sm" onClick={props.onCancelRender}>
              <PauseCircle className="h-4 w-4" />
              取消成片
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={props.onRender}>
              <Clapperboard className="h-4 w-4" />
              一键成片
            </Button>
          )}
        </div>
      </div>
      {props.error ? (
        <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
          {props.error}
        </div>
      ) : null}
      {props.renderEvidence ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-emerald-300/15 bg-emerald-300/[0.05] px-3 py-2 text-[11px] text-emerald-100/80">
          <span>{props.renderEvidence.width}×{props.renderEvidence.height}</span>
          <span>{props.renderEvidence.duration.toFixed(2)}s</span>
          <span>{props.renderEvidence.streams.join(" + ")}</span>
          <span className="min-w-0 truncate">SHA {props.renderEvidence.sha256.slice(0, 12)}</span>
        </div>
      ) : null}
    </header>
  );
}

function EditingAssetPanel(props: {
  project: EditingProjectV1;
  selectedClipId?: string;
  onSelectClip: (clipId: string) => void;
  onExecuteCommand: (command: EditingCommand) => boolean;
}) {
  return (
    <aside className="border-b border-foreground/10 bg-black/10 p-3 xl:row-span-2 xl:border-b-0 xl:border-r" aria-label="素材区">
      <PanelTitle label="ASSETS" detail={`${props.project.clips.length} clips`} />
      <div className="mt-3 space-y-1.5">
        {props.project.clips.map((clip) => (
          <button
            key={clip.id}
            type="button"
            onClick={() => props.onSelectClip(clip.id)}
            className={cn(
              "group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/40",
              props.selectedClipId === clip.id
                ? "border-emerald-300/25 bg-emerald-300/[0.08]"
                : "border-transparent bg-white/[0.025] hover:border-white/10 hover:bg-white/[0.05]",
            )}
          >
            <ClipKindIcon clip={clip} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{clip.name}</span>
              <span className="mt-0.5 block truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                {clip.source.kind} · {formatTime(clip.durationUs)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <EditingProposalPanel project={props.project} onExecuteCommand={props.onExecuteCommand} />
    </aside>
  );
}

function EditingPreviewPanel({ project, clip }: { project: EditingProjectV1; clip?: EditingClip }) {
  const preview = clip ? buildEditingEffectPreview(project, clip.id) : undefined;
  return (
    <div className="border-b border-foreground/10 p-4 xl:border-r" aria-label="预览区">
      <PanelTitle label="PREVIEW" detail={clip?.name ?? "未选择片段"} />
      <div className="mt-3 flex min-h-[300px] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[linear-gradient(135deg,#090b0b,#151918)] shadow-inner">
        <ClipPreview clip={clip} preview={preview} />
      </div>
      <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{preview?.effects.length ? `${preview.capability} · ${preview.effects.map((effect) => effect.effectId).join(" + ")}` : "Browser Preview"}</span>
        <span>FFmpeg Final</span>
      </div>
      {preview?.effects.length ? <p className="mt-2 text-[11px] text-amber-100/70">{preview.notice}</p> : null}
    </div>
  );
}

function EditingPropertiesPanel(props: {
  project: EditingProjectV1;
  clip?: EditingClip;
  onExecuteCommand: (command: EditingCommand) => boolean;
}) {
  const [startSeconds, setStartSeconds] = useState("0");
  const [durationSeconds, setDurationSeconds] = useState("0");
  const [trimSeconds, setTrimSeconds] = useState("0");
  const [volume, setVolume] = useState("1");
  const [muted, setMuted] = useState(false);
  const [fadeInSeconds, setFadeInSeconds] = useState("0");
  const [fadeOutSeconds, setFadeOutSeconds] = useState("0");
  const [envelope, setEnvelope] = useState("");
  const [subtitleText, setSubtitleText] = useState("");
  const trackKind = props.project.tracks.find((track) => track.id === props.clip?.trackId)?.kind;
  const isAudio = trackKind === "voice" || trackKind === "bgm" || trackKind === "sfx";
  const isSubtitle = trackKind === "text" && props.clip?.source.kind === "text";

  useEffect(() => {
    setStartSeconds(((props.clip?.startUs ?? 0) / 1_000_000).toFixed(3));
    setDurationSeconds(((props.clip?.durationUs ?? 0) / 1_000_000).toFixed(3));
    setTrimSeconds(((props.clip?.trimStartUs ?? 0) / 1_000_000).toFixed(3));
    setVolume(String(props.clip?.volume ?? 1));
    setMuted(props.clip?.muted ?? false);
    setFadeInSeconds(((props.clip?.fadeInUs ?? 0) / 1_000_000).toFixed(3));
    setFadeOutSeconds(((props.clip?.fadeOutUs ?? 0) / 1_000_000).toFixed(3));
    setEnvelope(formatEnvelope(props.clip?.envelope));
    setSubtitleText(props.clip?.source.text ?? "");
  }, [props.clip]);

  const applyTrim = () => {
    if (!props.clip) return;
    props.onExecuteCommand({
      type: "clip.trim",
      clipId: props.clip.id,
      startUs: secondsToUs(startSeconds),
      durationUs: secondsToUs(durationSeconds),
      trimStartUs: secondsToUs(trimSeconds),
      issuedAt: Date.now(),
    });
  };
  const applyAudio = () => {
    if (!props.clip || !isAudio) return;
    props.onExecuteCommand({
      type: "clip.updateAudio",
      clipId: props.clip.id,
      volume: Number(volume),
      muted,
      fadeInUs: secondsToUs(fadeInSeconds),
      fadeOutUs: secondsToUs(fadeOutSeconds),
      envelope: parseEnvelope(envelope),
      issuedAt: Date.now(),
    });
  };
  const applySubtitleText = () => {
    if (!props.clip || !isSubtitle) return;
    props.onExecuteCommand({
      type: "clip.updateText",
      clipId: props.clip.id,
      text: subtitleText,
      issuedAt: Date.now(),
    });
  };
  const splitClip = () => {
    if (!props.clip || props.clip.durationUs < 2) return;
    const splitAtUs = props.clip.startUs + Math.floor(props.clip.durationUs / 2);
    props.onExecuteCommand({
      type: "clip.split",
      clipId: props.clip.id,
      splitAtUs,
      newClipId: `${props.clip.id}-split-${crypto.randomUUID()}`,
      issuedAt: Date.now(),
    });
  };

  return (
    <aside className="border-b border-foreground/10 bg-black/10 p-4" aria-label="属性区">
      <PanelTitle label="PROPERTIES" detail={props.clip?.source.kind ?? "clip"} />
      {props.clip ? (
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-sm font-medium">{props.clip.name}</div>
            <div className="mt-1 break-all text-[10px] leading-4 text-muted-foreground">{props.clip.source.path ?? props.clip.source.text}</div>
          </div>
          <div className="grid gap-3">
            <TimeField label="开始（秒）" value={startSeconds} onChange={setStartSeconds} />
            <TimeField label="时长（秒）" value={durationSeconds} onChange={setDurationSeconds} />
            <TimeField label="源偏移（秒）" value={trimSeconds} onChange={setTrimSeconds} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={applyTrim}>
              应用裁切
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={splitClip}>
              <Scissors className="h-4 w-4" />
              中点切分
            </Button>
          </div>
          {isAudio ? (
            <div className="space-y-3 rounded-lg border border-amber-300/10 bg-amber-300/[0.03] p-3">
              <div className="grid grid-cols-2 gap-2">
                <TimeField label="音量" value={volume} onChange={setVolume} step="0.05" />
                <label className="flex items-center gap-2 self-end rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} aria-label="静音" />
                  静音
                </label>
                <TimeField label="淡入（秒）" value={fadeInSeconds} onChange={setFadeInSeconds} />
                <TimeField label="淡出（秒）" value={fadeOutSeconds} onChange={setFadeOutSeconds} />
              </div>
              <label className="grid gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                包络（秒:增益，逗号分隔）
                <Input value={envelope} onChange={(event) => setEnvelope(event.target.value)} className="h-8 border-white/10 bg-black/20 text-xs normal-case tracking-normal" />
              </label>
              <Button type="button" variant="outline" size="sm" onClick={applyAudio} className="w-full">应用音频</Button>
            </div>
          ) : null}
          {isSubtitle ? (
            <div className="space-y-3 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.03] p-3">
              <label className="grid gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                字幕文本
                <Textarea value={subtitleText} onChange={(event) => setSubtitleText(event.target.value)} className="min-h-24 text-xs normal-case tracking-normal" />
              </label>
              {props.clip.subtitle?.warnings?.length ? (
                <div className="text-[10px] leading-4 text-amber-200/80">{props.clip.subtitle.warnings.join("；")}</div>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={applySubtitleText} className="w-full">应用字幕文本</Button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
            <Metric label="速度" value={`${props.clip.speed}×`} />
            <Metric label="音量" value={`${props.clip.volume}`} />
            <Metric label="轨道" value={props.clip.trackId} />
            <Metric label="版本" value={`r${props.project.revision}`} />
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-xs text-muted-foreground">选择一个 clip 查看属性。</div>
      )}
    </aside>
  );
}

function EditingTimelinePanel(props: {
  project: EditingProjectV1;
  selectedClipId?: string;
  onSelectClip: (clipId: string) => void;
}) {
  const maxEndUs = Math.max(
    1,
    ...props.project.clips.map((clip) => clip.startUs + clip.durationUs),
  );
  const orderedTracks = [...props.project.tracks].sort((a, b) => a.order - b.order);
  const ticks = Array.from({ length: 6 }, (_, index) => (maxEndUs * index) / 5);
  return (
    <div className="min-w-0 p-4 xl:col-span-2" aria-label="时间线区">
      <PanelTitle label="TIMELINE" detail={`${formatTime(maxEndUs)} total`} />
      <div className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/20">
        <div className="min-w-[760px]">
          <div className="ml-32 flex h-7 items-end border-b border-white/10 px-2">
            {ticks.map((tick) => (
              <div key={tick} className="flex-1 border-l border-white/10 pl-1 pb-1 text-[9px] text-muted-foreground">
                {(tick / 1_000_000).toFixed(1)}s
              </div>
            ))}
          </div>
          {orderedTracks.map((track) => {
            const clips = track.clipIds
              .map((id) => props.project.clips.find((clip) => clip.id === id))
              .filter((clip): clip is EditingClip => Boolean(clip));
            return (
              <div key={track.id} className="grid grid-cols-[128px_minmax(620px,1fr)] border-b border-white/[0.06] last:border-b-0">
                <div className="flex items-center gap-2 border-r border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className={cn("h-2 w-2 rounded-full", trackDotClass(track.kind))} />
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-medium">{track.name}</span>
                    <span className="block text-[9px] uppercase tracking-widest text-muted-foreground">{track.kind}</span>
                  </span>
                </div>
                <div className="relative h-14 bg-[linear-gradient(90deg,transparent_24.8%,rgba(255,255,255,0.035)_25%,transparent_25.2%,transparent_49.8%,rgba(255,255,255,0.035)_50%,transparent_50.2%,transparent_74.8%,rgba(255,255,255,0.035)_75%,transparent_75.2%)]">
                  {clips.map((clip) => (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => props.onSelectClip(clip.id)}
                      aria-label={`选择片段 ${clip.name}`}
                      style={{
                        left: `${(clip.startUs / maxEndUs) * 100}%`,
                        width: `${Math.max(1.6, (clip.durationUs / maxEndUs) * 100)}%`,
                      }}
                      className={cn(
                        "absolute top-2 h-10 overflow-hidden rounded-md border px-2 text-left text-[10px] transition-all focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50",
                        clipClass(clip.trackId, track.kind),
                        props.selectedClipId === clip.id && "z-10 ring-2 ring-emerald-200/60",
                      )}
                    >
                      {(track.kind === "voice" || track.kind === "bgm" || track.kind === "sfx") ? <TimelineWaveform clip={clip} /> : null}
                      <span className="relative z-10 block truncate font-medium">{clip.name}</span>
                      <span className="relative z-10 block truncate opacity-60">{formatTime(clip.durationUs)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimelineWaveform({ clip }: { clip: EditingClip }) {
  const waveform = useAudioWaveform(clip, 24);
  return (
    <span className="absolute inset-0 flex items-center gap-px px-1 opacity-35" aria-label={`${clip.name} 波形`}>
      {waveform.status === "ready"
        ? waveform.peaks.map((peak, index) => (
            <span key={index} className="min-w-0 flex-1 rounded-full bg-current" style={{ height: `${Math.max(8, peak * 90)}%` }} />
          ))
        : <span className="h-px w-full bg-current/50" />}
    </span>
  );
}

function ClipPreview({
  clip,
  preview,
}: {
  clip?: EditingClip;
  preview?: ReturnType<typeof buildEditingEffectPreview>;
}) {
  if (!clip) return <span className="text-xs text-muted-foreground">选择素材以预览</span>;
  const sourcePath = clip.source.path;
  if (clip.source.kind === "text") {
    return <div className="max-w-xl px-8 text-center text-xl font-semibold leading-9 text-white drop-shadow-lg">{clip.source.text}</div>;
  }
  if (!sourcePath) return <span className="text-xs text-muted-foreground">素材路径不可用</span>;
  if (clip.trackId.includes("voice") || /\.(wav|mp3|m4a|aac|flac|ogg)$/i.test(sourcePath)) {
    return <audio className="w-4/5" controls src={toPreviewSrc(sourcePath)} aria-label={`${clip.name} 音频预览`} />;
  }
  if (clip.source.kind === "storyboardImage" || /\.(png|jpe?g|webp|gif|bmp)$/i.test(sourcePath)) {
    return (
      <img
        className="max-h-[330px] max-w-full object-contain transition-[filter,transform] duration-300"
        style={{ filter: preview?.filter, transform: preview?.transform, transformOrigin: preview?.transformOrigin }}
        src={toPreviewSrc(sourcePath)}
        alt={`${clip.name} 预览`}
      />
    );
  }
  return (
    <video
      className="max-h-[330px] max-w-full transition-[filter,transform] duration-300"
      style={{ filter: preview?.filter, transform: preview?.transform, transformOrigin: preview?.transformOrigin }}
      controls
      muted
      src={toPreviewSrc(sourcePath)}
      aria-label={`${clip.name} 视频预览`}
      onLoadedMetadata={(event) => {
        event.currentTarget.playbackRate = preview?.playbackRate ?? 1;
      }}
    />
  );
}

function ClipKindIcon({ clip }: { clip: EditingClip }) {
  const className = "h-3.5 w-3.5";
  if (clip.source.kind === "text") return <Type className={className} />;
  if (clip.source.kind === "audio") return <Volume2 className={className} />;
  if (clip.source.kind === "storyboardImage") return <ImageIcon className={className} />;
  if (clip.source.kind === "storyboardVideo" || clip.source.kind === "videoCandidate") return <Film className={className} />;
  return <AudioLines className={className} />;
}

function PanelTitle({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] font-semibold tracking-[0.22em] text-emerald-100/70">{label}</span>
      <span className="min-w-0 truncate text-[10px] text-muted-foreground">{detail}</span>
    </div>
  );
}

function TimeField(props: { label: string; value: string; onChange: (value: string) => void; step?: string }) {
  return (
    <label className="grid gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
      {props.label}
      <Input
        type="number"
        min="0"
        step={props.step ?? "0.001"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-8 border-white/10 bg-black/20 text-xs normal-case tracking-normal"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.025] p-2">
      <div>{label}</div>
      <div className="mt-1 truncate text-foreground/80">{value}</div>
    </div>
  );
}

function secondsToUs(value: string) {
  return Math.round(Number(value) * 1_000_000);
}

function formatEnvelope(points: EditingClip["envelope"]) {
  return points?.map((point) => `${point.timeUs / 1_000_000}:${point.gain}`).join(", ") ?? "";
}

function parseEnvelope(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.split(/[,\n]+/).map((part) => {
    const [time, gain] = part.trim().split(":");
    return { timeUs: secondsToUs(time ?? ""), gain: Number(gain) };
  });
}

function formatTime(valueUs: number) {
  return `${(valueUs / 1_000_000).toFixed(2)}s`;
}

function trackDotClass(kind: EditingProjectV1["tracks"][number]["kind"]) {
  if (kind === "video" || kind === "image") return "bg-cyan-300";
  if (kind === "voice" || kind === "bgm" || kind === "sfx") return "bg-amber-300";
  if (kind === "text") return "bg-emerald-300";
  return "bg-fuchsia-300";
}

function clipClass(_trackId: string, kind: EditingProjectV1["tracks"][number]["kind"]) {
  if (kind === "video" || kind === "image") return "border-cyan-300/20 bg-cyan-300/10 text-cyan-50";
  if (kind === "voice" || kind === "bgm" || kind === "sfx") return "border-amber-300/20 bg-amber-300/10 text-amber-50";
  if (kind === "text") return "border-emerald-300/20 bg-emerald-300/10 text-emerald-50";
  return "border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-50";
}
