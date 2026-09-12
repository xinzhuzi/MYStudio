"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-11 漫影专属文生图(本地模型模块):选主模型 + 提示词一键直出,不进
// ComfyUI 大画布。走 ComfyUI 桥 manying_t2i 模板(checkpoint 注入 UNETLoader),
// 引擎未跑由后端 ensure_engine_ready 自动拉起;出图自动入媒体库 + 模块内画廊。
// 09-12 加速档:manying_t2i_fast 模板挂 Krea2 Turbo 4 步蒸馏 LoRA(8→4 步,
// 模型在模板里钉死,不吃 checkpoint 注入——蒸馏 LoRA 只对 Krea2 Turbo 有效)。

import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getComfyEngineClient,
} from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { useComfyEngineSettings } from "@/components/panels/settings/comfy-engine/useComfyEngineSettings";
import { persistComfyImage } from "@/lib/assist/image-studio/comfy-execute";
import { ensureLocalImageSidecarRunning } from "@/lib/ai/image-generation-engine";
import {
  LOCAL_IMAGE_API_KEY,
  LOCAL_IMAGE_BASE_URL,
} from "@/stores/ai/api-config-provider-helpers";

/** 尺寸预设(与后端 comfyui_bridge.ASPECT_RATIOS 同构;渲染层只给常用五档)。 */
const ASPECT_OPTIONS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;

const DEFAULT_STEPS = 8;

/** 加速档步数只有 4(最快)/6(更稳)两档(模型卡口径);标准档仍是 1-40 自由填。 */
const FAST_STEP_OPTIONS = [4, 6] as const;

type GenMode = "standard" | "fast";

type GalleryItem = { id: string; url: string; title: string };

/** manying_t2i 的 UNETLoader 吃 diffusion_models 目录;没得选时的空态文案。 */
function pickModelOptions(groups: Array<{ category: string; files: Array<{ name: string }> }>) {
  return groups.find((group) => group.category === "diffusion_models")?.files ?? [];
}

export function LocalModelStudio() {
  const client = useMemo(() => getComfyEngineClient(), []);
  const engine = useComfyEngineSettings({ client });
  const [mode, setMode] = useState<GenMode>("standard");
  const [checkpoint, setCheckpoint] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECT_OPTIONS)[number]>("1:1");
  const [steps, setSteps] = useState(DEFAULT_STEPS);
  const [fastSteps, setFastSteps] = useState<(typeof FAST_STEP_OPTIONS)[number]>(4);
  const [seedText, setSeedText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);

  // 模型清单:进页拉一次(与引擎卡模型页同源;引擎未装/未跑也能读 FS)
  useEffect(() => {
    void engine.loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelFiles = useMemo(() => pickModelOptions(engine.models?.groups ?? []), [engine.models]);

  // 默认选中 K2 主模型(漫影图像流的主力权重),不在则首个
  useEffect(() => {
    if (checkpoint || modelFiles.length === 0) return;
    const preferred = modelFiles.find((file) => /krea2/i.test(file.name));
    setCheckpoint((preferred ?? modelFiles[0]).name);
  }, [modelFiles, checkpoint]);

  const generate = async () => {
    const isFast = mode === "fast";
    if (!prompt.trim()) {
      toast.error("先写提示词再生成");
      return;
    }
    if (!isFast && !checkpoint) {
      toast.error("没有可选的主模型(漫影生图用 diffusion_models 目录里的权重)");
      return;
    }
    setIsGenerating(true);
    try {
      await ensureLocalImageSidecarRunning();
      const seed = seedText.trim() ? Number(seedText.trim()) : null;
      if (seed != null && (!Number.isFinite(seed) || seed < 0)) {
        toast.error("固定种子请填非负数字,留空则每次随机");
        return;
      }
      const template = isFast ? "manying_t2i_fast" : "manying_t2i";
      const response = await fetch(`${LOCAL_IMAGE_BASE_URL}/v1/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOCAL_IMAGE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "comfyui-bridge",
          prompt: prompt.trim(),
          negative_prompt: negative.trim() || null,
          aspect_ratio: aspect,
          num_inference_steps: isFast ? fastSteps : steps,
          seed,
          template,
          // 加速档模型在模板里钉死(Krea2 Turbo + 蒸馏 LoRA),不注入 checkpoint
          ...(isFast ? {} : { checkpoint }),
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail.slice(0, 300) || `生图失败(HTTP ${response.status})`);
      }
      const payload = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = payload.data?.[0]?.b64_json;
      if (!b64) throw new Error("本地生图服务没有返回图片");
      const title = prompt.trim().slice(0, 24);
      const saved = await persistComfyImage(b64, title, {
        source: template,
        prompt: prompt.trim(),
        negativePrompt: negative.trim() || null,
      });
      const url = saved.url || `data:image/png;base64,${b64}`;
      setGallery((items) => [{ id: `${Date.now()}`, url, title }, ...items]);
      toast.success("图片已生成并存入媒体库");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生图失败,请稍后再试");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto" data-local-model-studio>
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
        <header className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="text-lg font-semibold text-foreground">漫影生图</h2>
          <span className="text-xs text-muted-foreground">选模型 · 写提示词 · 一键出图(引擎没跑会自动启动)</span>
        </header>

        {/* 表单卡 */}
        <section className="space-y-3 rounded-lg border border-border bg-card p-4" data-local-model-form data-local-model-mode={mode}>
          {/* 出图模式:标准自由选模型;加速档=Krea2 Turbo + 4 步蒸馏 LoRA(约快一倍) */}
          <div className="flex items-center gap-2" data-local-model-mode-switch>
            <Button
              type="button"
              size="sm"
              variant={mode === "standard" ? "default" : "outline"}
              className="h-8"
              aria-pressed={mode === "standard"}
              onClick={() => setMode("standard")}
              data-local-model-mode-standard
            >
              标准 · 8 步
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "fast" ? "default" : "outline"}
              className="h-8"
              aria-pressed={mode === "fast"}
              onClick={() => setMode("fast")}
              data-local-model-mode-fast
            >
              加速 · 4 步
            </Button>
            <span
              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              title={mode === "fast" ? "Krea2 专用 4 步蒸馏加速,模型固定,细节保留约 95%" : "自由选主模型,8 步出图"}
            >
              {mode === "fast" ? "Krea2 专用 4 步蒸馏加速,模型固定,细节保留约 95%" : "自由选主模型,8 步出图"}
            </span>
          </div>

          {mode === "fast" ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">主模型(Krea2 加速专用)</span>
            <div
              className="flex h-9 items-center truncate rounded-md border border-border bg-muted/40 px-2 text-sm text-muted-foreground"
              title="krea2_turbo_bf16.safetensors + 4 步蒸馏 LoRA(加速档固定搭配)"
              data-local-model-fixed-model
            >
              krea2_turbo_bf16 + 4 步蒸馏 LoRA
            </div>
          </label>
          ) : (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">主模型(diffusion_models)</span>
            <div className="flex items-center gap-2">
              <select
                value={checkpoint}
                onChange={(event) => setCheckpoint(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground"
                data-local-model-select
              >
                {modelFiles.length === 0 ? <option value="">(没有可选主模型)</option> : null}
                {modelFiles.map((file) => (
                  <option key={file.name} value={file.name}>
                    {file.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-2.5"
                onClick={() => void engine.loadModels()}
                data-local-model-refresh
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                刷新
              </Button>
            </div>
          </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">提示词</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              placeholder="想画什么,写在这里"
              className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
              data-local-model-prompt
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">负面提示词(可不填)</span>
            <textarea
              value={negative}
              onChange={(event) => setNegative(event.target.value)}
              rows={2}
              className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
              data-local-model-negative
            />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-foreground">尺寸</span>
              <select
                value={aspect}
                onChange={(event) => setAspect(event.target.value as (typeof ASPECT_OPTIONS)[number])}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground"
                data-local-model-aspect
              >
                {ASPECT_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            {mode === "fast" ? (
              <label className="space-y-1">
                <span className="block text-xs font-medium text-foreground">步数</span>
                <select
                  value={fastSteps}
                  onChange={(event) => setFastSteps(Number(event.target.value) as (typeof FAST_STEP_OPTIONS)[number])}
                  className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground"
                  data-local-model-fast-steps
                >
                  {FAST_STEP_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}{option === 4 ? "(最快)" : "(更稳)"}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="space-y-1">
                <span className="block text-xs font-medium text-foreground">步数</span>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={steps}
                  onChange={(event) => setSteps(Number(event.target.value) || DEFAULT_STEPS)}
                  className="h-9 w-20 rounded-md border border-border bg-card px-2 text-sm text-foreground"
                  data-local-model-steps
                />
              </label>
            )}
            <label className="space-y-1">
              <span className="block text-xs font-medium text-foreground">种子(留空随机)</span>
              <input
                value={seedText}
                onChange={(event) => setSeedText(event.target.value)}
                placeholder="随机"
                className="h-9 w-28 rounded-md border border-border bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground/60"
                data-local-model-seed
              />
            </label>
            <Button
              onClick={() => void generate()}
              disabled={isGenerating || (mode === "standard" && !checkpoint)}
              className="ml-auto h-9 gap-1.5"
              data-local-model-generate
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="h-4 w-4" aria-hidden />
              )}
              {isGenerating ? "生成中(引擎冷启动可能要等一会儿)…" : "生成图片"}
            </Button>
          </div>
        </section>

        {/* 本次会话画廊 */}
        <section className="space-y-2" data-local-model-gallery>
          <h3 className="text-sm font-medium text-foreground">本次生成({gallery.length})</h3>
          {gallery.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
              还没有生成过;出图会自动存入媒体库,这里同步展示
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {gallery.map((item) => (
                <figure key={item.id} className="overflow-hidden rounded-lg border border-border bg-card">
                    <img src={item.url} alt={item.title} className="aspect-square w-full object-cover" />
                  <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground" title={item.title}>
                    {item.title}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
