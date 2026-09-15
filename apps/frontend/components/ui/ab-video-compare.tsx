// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 视频 A/B 同步对比基件(09-15 teman-absorption P1b,自研仿设计):
 * 双 <video> 叠放+CSS clipPath 滑帘;rAF 同步循环保持 B 跟随 A;
 * **syncToken 令牌防竞态**:换源/重播/卸载令牌+1,旧循环检测失效自动退出
 * (快速换源不再错乱);seek=seeked 事件+超时兜底。
 * 帧对齐:仅双源 frame_count 已知(非估算)且相同时启用
 * (frame=round(a.currentTime×a_fps) → b.currentTime=frame/b_fps);
 * 元数据缺失按时间对齐并提示「按时间对齐(估)」(禁错误弹窗,UI 少提示裁定)。
 * 纯展示基件:探测桥可注入,零 panels/features 依赖。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** 双源视频元数据(探测桥产物形状) */
export interface ABVideoMeta {
  durationS?: number;
  fps?: number;
  frameCount?: number;
  frameCountEstimated?: boolean;
}

export interface ResolvedVideoAlignment {
  /** frame=帧对齐;time=按时间;time-estimated=按时间(元数据缺失,须示「估」) */
  mode: "frame" | "time" | "time-estimated";
  fpsA?: number;
  fpsB?: number;
  /** 对齐说明(大白话 tooltip;帧对齐=undefined) */
  note?: string;
}

/**
 * 对齐模式裁定(纯函数):
 * - 双源 frame_count 已知且相同 → 帧对齐;
 * - 双源 frame_count 已知但不同 → 按时间(注明帧数不同);
 * - 任一侧元数据缺失/帧数为估算 → 按时间对齐(估)。
 */
export function resolveVideoAlignment(metaA?: ABVideoMeta | null, metaB?: ABVideoMeta | null): ResolvedVideoAlignment {
  const frameKnownA = Boolean(metaA?.frameCount) && metaA?.frameCountEstimated !== true;
  const frameKnownB = Boolean(metaB?.frameCount) && metaB?.frameCountEstimated !== true;
  const fpsA = metaA?.fps;
  const fpsB = metaB?.fps;
  if (frameKnownA && frameKnownB && metaA?.frameCount === metaB?.frameCount && fpsA && fpsB) {
    return { mode: "frame", fpsA, fpsB };
  }
  if (frameKnownA && frameKnownB) {
    return { mode: "time", note: "两版帧数不同,按时间对齐" };
  }
  return { mode: "time-estimated", note: "按时间对齐（估）" };
}

/** seek=seeked 事件+超时兜底的 Promise(2s;失败/超时都 resolve,不抛) */
export function seekVideoElement(video: HTMLVideoElement, timeS: number, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    video.addEventListener("seeked", finish);
    try {
      video.currentTime = timeS;
    } catch {
      finish();
    }
  });
}

export interface VideoSyncLoopOptions {
  master: HTMLVideoElement;
  follower: HTMLVideoElement;
  alignment: ResolvedVideoAlignment;
  /** 漂移阈值(秒),超过才校正;默认 60ms(≈1帧@16fps,更细交给帧对齐模式) */
  thresholdS?: number;
  /** syncToken 失效检查:返回 true 时循环退出且不再排程 */
  isCancelled: () => boolean;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  onTick?: (info: { masterTimeS: number; followerTimeS: number; correctedToS?: number }) => void;
}

/**
 * rAF 同步循环(纯逻辑,导出供单测直调):
 * 每帧比对 A/B 时刻,漂移超阈值时校正 B(帧对齐模式经 frame 换算)。
 * 令牌失效/stop() 后彻底退出——旧循环不再排程,快速换源零错乱。
 */
export function startVideoSyncLoop(options: VideoSyncLoopOptions): { stop: () => void } {
  const {
    master,
    follower,
    alignment,
    thresholdS = 0.06,
    isCancelled,
    onTick,
  } = options;
  const requestFrame = options.requestFrame ?? ((callback: () => void) => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => window.cancelAnimationFrame(handle));
  let handle: number | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || isCancelled()) return;
    const masterTimeS = master.currentTime;
    let targetS = masterTimeS;
    if (alignment.mode === "frame" && alignment.fpsA && alignment.fpsB) {
      const frame = Math.round(masterTimeS * alignment.fpsA);
      targetS = frame / alignment.fpsB;
    }
    const driftS = targetS - follower.currentTime;
    let correctedToS: number | undefined;
    if (Math.abs(driftS) > thresholdS) {
      try {
        follower.currentTime = targetS;
        correctedToS = targetS;
      } catch {
        // 个别环境 currentTime 只读拖不动:跳过本帧校正,循环继续
      }
    }
    onTick?.({ masterTimeS, followerTimeS: follower.currentTime, correctedToS });
    if (!stopped && !isCancelled()) handle = requestFrame(tick);
  };
  handle = requestFrame(tick);
  return {
    stop() {
      stopped = true;
      if (handle !== null) cancelFrame(handle);
    },
  };
}

export interface ABVideoCompareProps {
  urlA: string;
  urlB: string;
  labelA?: string;
  labelB?: string;
  /** 可选注入的元数据探测(面板把桥传进来;基件不 import 桥) */
  probeVideo?: (url: string) => Promise<ABVideoMeta | null>;
  height?: number | string;
  className?: string;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;
type AudioChannel = "a" | "b" | "mute";

export function ABVideoCompare({
  urlA,
  urlB,
  labelA = "A",
  labelB = "B",
  probeVideo,
  height = 420,
  className,
}: ABVideoCompareProps) {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  /** syncToken:换源/重播/卸载 +1,旧 rAF 循环检测失效自动退出 */
  const syncTokenRef = useRef(0);
  const [dividerRatio, setDividerRatio] = useState(0.5);
  const [playing, setPlaying] = useState(false);
  const [audioChannel, setAudioChannel] = useState<AudioChannel>("a");
  const [speed, setSpeed] = useState<number>(1);
  const [metaA, setMetaA] = useState<ABVideoMeta | null>(null);
  const [metaB, setMetaB] = useState<ABVideoMeta | null>(null);
  const [progressRatio, setProgressRatio] = useState(0);
  const draggingRef = useRef(false);

  const alignment = useMemo(() => resolveVideoAlignment(metaA, metaB), [metaA, metaB]);

  // 换源:令牌+1 杀旧循环;重置滑帘/进度;探测元数据(注入的探测也走令牌防回写旧源)
  useEffect(() => {
    syncTokenRef.current += 1;
    setDividerRatio(0.5);
    setProgressRatio(0);
    setPlaying(false);
    if (!probeVideo) return;
    const token = syncTokenRef.current;
    let alive = true;
    void Promise.all([probeVideo(urlA), probeVideo(urlB)]).then(([nextA, nextB]) => {
      if (!alive || token !== syncTokenRef.current) return; // 旧探测结果丢弃
      setMetaA(nextA);
      setMetaB(nextB);
    });
    return () => {
      alive = false;
    };
  }, [urlA, urlB, probeVideo]);

  // rAF 同步循环:B 跟随 A;依赖变更(源/对齐模式/播放态)自动停旧起新
  // (双保险=cleanup+令牌)。playing 入依赖:togglePlay 令牌+1 杀旧循环后,
  // 须有新循环接手——否则播放中漂移无人校正(重播换令牌的另一半)。
  useEffect(() => {
    const master = videoARef.current;
    const follower = videoBRef.current;
    if (!master || !follower) return;
    const token = syncTokenRef.current;
    const loop = startVideoSyncLoop({
      master,
      follower,
      alignment,
      isCancelled: () => token !== syncTokenRef.current,
    });
    return () => {
      syncTokenRef.current += 1; // 卸载/重跑即失效旧令牌
      loop.stop();
    };
  }, [urlA, urlB, alignment, playing]);

  // 声道三态与倍速作用到双 video
  useEffect(() => {
    const videos = [videoARef.current, videoBRef.current];
    for (const video of videos) {
      if (!video) continue;
      video.muted = audioChannel !== (video === videoARef.current ? "a" : "b");
      video.playbackRate = speed;
    }
  }, [audioChannel, speed, urlA, urlB]);

  const durationS = metaA?.durationS ?? videoARef.current?.duration ?? 0;

  const togglePlay = useCallback(() => {
    const master = videoARef.current;
    const follower = videoBRef.current;
    if (!master || !follower) return;
    syncTokenRef.current += 1; // 重播也换令牌(防旧循环残留)
    if (playing) {
      master.pause();
      follower.pause();
      setPlaying(false);
    } else {
      void master.play().catch(() => undefined);
      void follower.play().catch(() => undefined);
      setPlaying(true);
    }
  }, [playing]);

  const seekByRatio = useCallback(
    async (ratio: number) => {
      const master = videoARef.current;
      const follower = videoBRef.current;
      if (!master || !follower) return;
      const total = metaA?.durationS ?? master.duration ?? 0;
      const targetA = total > 0 ? ratio * total : 0;
      let targetB = targetA;
      if (alignment.mode === "frame" && alignment.fpsA && alignment.fpsB) {
        targetB = Math.round(targetA * alignment.fpsA) / alignment.fpsB;
      }
      setProgressRatio(ratio);
      await seekVideoElement(master, targetA);
      await seekVideoElement(follower, targetB);
    },
    [alignment, metaA?.durationS],
  );

  // 进度跟随主视频播放(播放中由时间更新事件推进,不依赖 rAF)
  useEffect(() => {
    const master = videoARef.current;
    if (!master) return;
    const onTimeUpdate = () => {
      if (draggingRef.current) return;
      const total = master.duration || metaA?.durationS || 0;
      if (total > 0) setProgressRatio(Math.min(1, master.currentTime / total));
    };
    master.addEventListener("timeupdate", onTimeUpdate);
    return () => master.removeEventListener("timeupdate", onTimeUpdate);
  }, [metaA?.durationS, urlA]);

  const pointerRatio = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return null;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };

  const dividerPercent = Math.round(dividerRatio * 100);

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`} data-ab-video-compare>
      <div
        role="slider"
        aria-label="对比分割线位置"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={dividerPercent}
        tabIndex={0}
        data-ab-video-stage={dividerPercent}
        data-ab-video-align-mode={alignment.mode}
        className="relative w-full select-none overflow-hidden rounded-md border border-border/70 bg-black"
        style={{ height: typeof height === "number" ? `${height}px` : height, touchAction: "none" }}
        onPointerDown={(event) => {
          draggingRef.current = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // 指针捕获不可用(旧环境):拖拽仍跟随 move 事件
          }
          const ratio = pointerRatio(event);
          if (ratio !== null) setDividerRatio(ratio);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          const ratio = pointerRatio(event);
          if (ratio !== null) setDividerRatio(ratio);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setDividerRatio((ratio) => Math.max(0, ratio - step));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setDividerRatio((ratio) => Math.min(1, ratio + step));
          }
        }}
      >
        {/* B 垫底(右半可见);A 叠上,clipPath 滑帘只露左半 */}
        <video
          ref={videoBRef}
          src={urlB}
          preload="metadata"
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
          data-ab-video-b
        />
        <video
          ref={videoARef}
          src={urlA}
          preload="metadata"
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 ${100 - dividerPercent}% 0 0)` }}
          data-ab-video-a
        />
        <div
          aria-hidden
          data-ab-video-divider
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white/95"
          style={{ left: `${dividerPercent}%` }}
        >
          <span className="absolute top-1/2 left-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-black/60">
            <span className="absolute h-4 w-0.5 bg-white/80" />
            <span className="absolute h-0.5 w-4 bg-white/80" />
          </span>
        </div>
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white/90" data-ab-video-label="a">
          {labelA}
        </span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white/90" data-ab-video-label="b">
          {labelB}
        </span>
        {alignment.note ? (
          <span
            className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/65 px-2 py-0.5 text-[11px] text-white/85"
            data-ab-video-align-note
            title={alignment.note}
          >
            {alignment.note}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
        <button
          type="button"
          data-ab-video-play
          className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-foreground transition-colors hover:bg-muted"
          onClick={togglePlay}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progressRatio * 1000)}
          aria-label="播放进度"
          data-ab-video-progress
          className="min-w-[120px] flex-1"
          onChange={(event) => {
            const ratio = Number(event.currentTarget.value) / 1000;
            setProgressRatio(ratio);
            draggingRef.current = true;
          }}
          onPointerUp={() => {
            draggingRef.current = false;
            void seekByRatio(progressRatio);
          }}
          onKeyUp={() => {
            draggingRef.current = false;
            void seekByRatio(progressRatio);
          }}
        />
        <label className="flex items-center gap-1" title={alignment.note ?? (alignment.mode === "frame" ? "两版帧数相同,逐帧对齐" : undefined)}>
          声音
          <select
            aria-label="声音来源"
            data-ab-video-audio
            className="rounded border border-border/60 bg-background px-1.5 py-1 text-foreground"
            value={audioChannel}
            onChange={(event) => setAudioChannel(event.currentTarget.value as AudioChannel)}
          >
            <option value="a">{labelA}</option>
            <option value="b">{labelB}</option>
            <option value="mute">静音</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          倍速
          <select
            aria-label="播放倍速"
            data-ab-video-speed
            className="rounded border border-border/60 bg-background px-1.5 py-1 text-foreground"
            value={String(speed)}
            onChange={(event) => setSpeed(Number(event.currentTarget.value))}
          >
            {SPEED_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}x</option>
            ))}
          </select>
        </label>
        {durationS > 0 ? (
          <span className="font-mono" data-ab-video-duration>
            {durationS.toFixed(1)}s
          </span>
        ) : null}
      </div>
    </div>
  );
}
