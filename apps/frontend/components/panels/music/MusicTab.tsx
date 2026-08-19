"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FolderOpen, Loader2, Music2, Settings2, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { MUSIC3_MAX_DURATION_S, MUSIC3_MIN_DURATION_S } from "@/types/music3-gen";
import type { Music3GenRuntimeStatus } from "@/types/music3-gen";

interface Music3TabBridge {
  status: () => Promise<Music3GenRuntimeStatus>;
  musicDir: (projectId: string) => Promise<{ dir?: string; error?: string }>;
  generate: (payload: {
    prompt: string;
    seed?: number;
    seconds?: number;
    engine?: "pocket" | "mlxserv";
    outputDir: string;
    projectId?: string;
  }) => Promise<{
    status: string;
    outputPath?: string;
    durationS?: number;
    engine?: string;
    code?: string;
    message?: string;
  }>;
}

function getMusic3Bridge(): Music3TabBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { music3GenRuntime?: Music3TabBridge }).music3GenRuntime
    : undefined;
}

interface GeneratedSong {
  outputPath: string;
  durationS?: number;
  seed?: number;
  engine?: string;
  prompt: string;
}

/** 生成中的活反馈:均衡器条; prefers-reduced-motion 时退化为静态条。 */
function Equalizer({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex h-6 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3, 4].map((index) =>
        reduced || !active ? (
          <span key={index} className="w-[3px] rounded-full bg-primary/50" style={{ height: 6 + ((index * 5) % 14) }} />
        ) : (
          <motion.span
            key={index}
            className="w-[3px] rounded-full bg-primary/70"
            initial={{ height: 6 }}
            animate={{ height: [6, 20 - ((index * 3) % 9), 10, 18 - (index % 5) * 2, 6] }}
            transition={{ duration: 1.1 + index * 0.13, repeat: Infinity, ease: "easeInOut" }}
          />
        ),
      )}
    </div>
  );
}

function formatElapsed(startedAt: number): string {
  const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 侧边栏「音乐」面板主体(08-19 工作台音乐生成升级为独立侧边栏界面)。
 * MiniMax-Music3(bf16/mlx-serve)整曲生成,产物落 <项目根>/music/——目录经
 * 项目位置注册表动态拼接(渲染层只传 "__PROJECT_MUSIC__" 哨兵,不持绝对路径)。
 * 就绪门禁 fail-closed:引擎/权重不就绪时引导去设置,绝不自动下载。
 */
export function MusicTab(props: { projectId?: string; projectName: string }) {
  const bridge = getMusic3Bridge();
  const [readiness, setReadiness] = useState<"checking" | "ready" | "missing" | "unknown">("checking");
  const [weightsReason, setWeightsReason] = useState<string>("");
  const [musicDir, setMusicDir] = useState<string>("");
  const [prompt, setPrompt] = useState("大气磅礴的仙侠交响,前段压抑后段爆发");
  const [seed, setSeed] = useState("7");
  const [seconds, setSeconds] = useState("30");
  const [generating, setGenerating] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const [results, setResults] = useState<GeneratedSong[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!bridge) {
      setReadiness("unknown");
      return;
    }
    bridge.status().then((status) => {
      if (cancelled) return;
      const mlxServ = status.mlxServ;
      if (mlxServ?.weightsReady && mlxServ.binaryFound) {
        setReadiness("ready");
      } else {
        setReadiness("missing");
        setWeightsReason(
          mlxServ
            ? mlxServ.weightsReady
              ? "未找到 mlx-serve 引擎(设置页可自动安装)"
              : mlxServ.weightsReason || "权重未就绪"
            : "运行时状态不可用",
        );
      }
    }).catch(() => {
      if (!cancelled) setReadiness("unknown");
    });
    if (props.projectId) {
      bridge.musicDir(props.projectId).then((reply) => {
        if (!cancelled && reply.dir) setMusicDir(reply.dir);
      }).catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [bridge, props.projectId]);

  // 生成中每秒刷新已进行时长(分钟级任务的诚实反馈)
  useEffect(() => {
    if (!generating || startedAt === null) return;
    setElapsed(formatElapsed(startedAt));
    const timer = window.setInterval(() => setElapsed(formatElapsed(startedAt)), 1000);
    return () => window.clearInterval(timer);
  }, [generating, startedAt]);

  const goToSettings = useCallback(() => {
    const nav = useMediaPanelStore.getState();
    nav.requestSettingsTab("plugins");
    nav.setActiveTab("settings");
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!bridge || !props.projectId) {
      toast.error("请先打开一个项目");
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error("请输入音乐描述");
      return;
    }
    const parsedSeed = Number.parseInt(seed, 10);
    if (!Number.isInteger(parsedSeed)) {
      toast.error("种子必须是整数");
      return;
    }
    const parsedSeconds = Number.parseFloat(seconds);
    if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
      toast.error("时长必须是正数");
      return;
    }
    setGenerating(true);
    setStartedAt(Date.now());
    toast.info("整曲生成为分钟级:30 秒约 5.5 分钟、60 秒约 11 分钟(bf16 实测,首次含模型装载),请耐心等待");
    try {
      const result = await bridge.generate({
        prompt: trimmed,
        seed: parsedSeed,
        seconds: Math.min(MUSIC3_MAX_DURATION_S, Math.max(MUSIC3_MIN_DURATION_S, parsedSeconds)),
        engine: "mlxserv",
        outputDir: "__PROJECT_MUSIC__",
        projectId: props.projectId,
      });
      if (result.status === "accepted" && result.outputPath) {
        setResults((prev) => [
          { outputPath: result.outputPath!, durationS: result.durationS, seed: parsedSeed, engine: result.engine, prompt: trimmed },
          ...prev,
        ]);
        toast.success(`生成完成:${result.durationS ? `${result.durationS.toFixed(1)} 秒 · ` : ""}已落项目 music/ 目录`);
        if (result.message) toast.info(result.message);
        if (!musicDir) setMusicDir(result.outputPath!.substring(0, result.outputPath!.lastIndexOf("/")));
      } else {
        toast.error(result.message || "整曲生成失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "整曲生成失败");
    } finally {
      setGenerating(false);
      setStartedAt(null);
    }
  }, [bridge, musicDir, prompt, props.projectId, seconds, seed]);

  const title = useMemo(
    () => (props.projectName ? `为《${props.projectName}》生成音乐` : "项目音乐生成"),
    [props.projectName],
  );

  if (!bridge) {
    return (
      <section aria-label="音乐生成" className="mx-auto w-full max-w-3xl py-16 text-center">
        <p className="text-sm text-muted-foreground">本地音乐生成仅在桌面应用中可用。</p>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 py-4">
      {/* 头部:层级化排版(overline → 标题 → 状态胶囊) */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Music2 className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                MiniMax-Music3 · bf16 本地引擎
              </p>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            </div>
          </div>
          {readiness === "ready" ? (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-success/25 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-50 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              引擎就绪
            </span>
          ) : readiness === "checking" ? (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              检查引擎…
            </span>
          ) : readiness === "missing" ? (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-destructive/25 bg-destructive/[0.08] px-3 py-1.5 text-xs font-medium text-destructive/90">
              <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden />
              未就绪
            </span>
          ) : readiness === "unknown" ? (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
              状态未知
            </span>
          ) : null}
        </div>

        {readiness === "ready" ? (
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            同描述 + 同种子 = 同一文件(种子确定性);生成耗时按分钟计,完成后自动落盘项目 music/ 目录。
          </p>
        ) : null}

        {/* 生成目录:安静的信息芯片,不抢表单视觉 */}
        {musicDir ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">生成目录</span>
            <code
              className="min-w-0 max-w-[26rem] truncate rounded-md border border-border/70 bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground/80"
              title={musicDir}
            >
              {musicDir}
            </code>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => { void window.electronAPI?.openPath(musicDir); }}
            >
              <FolderOpen className="mr-1 h-3.5 w-3.5" aria-hidden />
              打开
            </Button>
          </div>
        ) : null}
      </header>

      {/* 不就绪:结构化引导(原因 + 两步走 + 行动),warning 材质 */}
      {readiness === "missing" ? (
        <section className="space-y-4 rounded-2xl border border-warning/25 bg-warning/[0.06] p-6 backdrop-blur-xl">
          <div className="flex items-start gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-warning/25 bg-warning/10 text-warning">
              <TriangleAlert className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1.5 pt-0.5">
              <h2 className="text-base font-semibold tracking-tight">引擎未就绪</h2>
              <p className="text-sm leading-6 text-foreground">{weightsReason}</p>
            </div>
          </div>
          <ol className="space-y-2.5 text-sm leading-6 text-muted-foreground">
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">1</span>
              <span>安装引擎:设置 → 本地配置 → 本地音乐生成 → 自动安装 mlx-serve(62 MB)</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">2</span>
              <span>获取权重:同页「一键获取 bf16 权重」(约 28.5 GB,需 48GB+ 内存;完成后自动指向)</span>
            </li>
          </ol>
          <Button onClick={goToSettings} className="w-full sm:w-auto">
            <Settings2 className="mr-2 h-4 w-4" aria-hidden />
            去设置
          </Button>
        </section>
      ) : null}

      {/* 就绪:生成台(表单做主角) */}
      {readiness === "ready" ? (
        <section aria-label="音乐生成" className="tts-glass-card space-y-5 rounded-2xl border border-border bg-card/50 p-6 backdrop-blur-xl">
          <div className="space-y-2">
            <Label htmlFor="music-prompt" className="text-sm font-medium">
              音乐描述
            </Label>
            <Textarea
              id="music-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              rows={3}
              placeholder="风格 / 情绪 / 乐器,如:少年热血仙侠主题曲,鼓点密集,笛声与电吉他交织"
              className="resize-none text-sm leading-6"
              disabled={generating}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28 space-y-2">
              <Label htmlFor="music-seed" className="text-xs text-muted-foreground">种子</Label>
              <Input
                id="music-seed"
                value={seed}
                onChange={(event) => setSeed(event.currentTarget.value)}
                inputMode="numeric"
                className="h-9 text-sm"
                disabled={generating}
              />
            </div>
            <div className="w-36 space-y-2">
              <Label htmlFor="music-seconds" className="text-xs text-muted-foreground">
                时长({MUSIC3_MIN_DURATION_S}-{MUSIC3_MAX_DURATION_S} 秒)
              </Label>
              <Input
                id="music-seconds"
                value={seconds}
                onChange={(event) => setSeconds(event.currentTarget.value)}
                inputMode="decimal"
                className="h-9 text-sm"
                disabled={generating}
              />
            </div>
            <div className="min-w-32 flex-1" />
            <Button onClick={() => void handleGenerate()} disabled={generating || !props.projectId} className="h-10 px-6">
              {generating ? (
                <>
                  <Equalizer active />
                  <span className="ml-2">生成中…</span>
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                  生成整曲
                </>
              )}
            </Button>
          </div>

          {/* 进行中反馈:均衡器 + 已进行时长 + 预期说明 */}
          {generating ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-muted/40 px-4 py-3">
              <Equalizer active />
              <span className="text-sm">
                <span className="font-medium">生成中</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">已进行 {elapsed}</span>
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                30 秒约 5.5 分钟 · 60 秒约 11 分钟;完成自动落盘,可切走等待
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 产物列表:卡片行,弹簧入场(临界阻尼,无过冲) */}
      {results.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">本次产物</h2>
            <p className="text-xs text-muted-foreground">
              落盘于项目 music/,可在 视频工作台 → 章节共享音频 → 导入 BGM 挂到章节
            </p>
          </div>
          <AnimatePresence initial={false}>
            {results.map((song) => (
              <motion.article
                key={song.outputPath}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", duration: 0.35, bounce: 0 }}
                className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 backdrop-blur-xl transition-colors hover:border-primary/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <Music2 className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground" title={song.prompt}>{song.prompt}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="font-mono text-[11px] font-normal">
                      {song.durationS ? `${song.durationS.toFixed(1)}s` : "—"}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[11px] font-normal text-muted-foreground">
                      seed {song.seed ?? "?"}
                    </Badge>
                    {song.engine === "pocket" ? (
                      <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">PocketAiHub 路线</Badge>
                    ) : null}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 shrink-0"
                  onClick={() => { void window.electronAPI?.openPath(song.outputPath); }}
                >
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  打开
                </Button>
              </motion.article>
            ))}
          </AnimatePresence>
        </section>
      ) : null}
    </div>
  );
}
