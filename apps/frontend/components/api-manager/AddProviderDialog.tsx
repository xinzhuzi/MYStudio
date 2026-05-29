// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Add Provider Dialog
 * For adding new API providers with platform selection
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { IProvider, ModelCapability } from "@/lib/api-key-manager";
import { TTS_MODEL_GROUPS } from "@/lib/tts/model-catalog";
import { LOCAL_TTS_BASE_URL } from "@/lib/tts/client";

const LOCAL_TTS_MODELS = TTS_MODEL_GROUPS.flatMap((group) => group.models.map((model) => model.modelName));

/**
 * Toonflow-style 供应商预设。
 * 这些只是本地配置模板，不包含托管中转站默认项。
 */
export const API_PROVIDER_PRESETS: Array<{
  platform: string;
  name: string;
  baseUrl: string;
  description: string;
  services: string[];
  models: string[];
  capabilities?: ModelCapability[];
  apiKeyOptional?: boolean;
}> = [
  {
    platform: "openai-compatible",
    name: "OpenAI 兼容中转站",
    baseUrl: "https://api.example.com/v1",
    description: "适用于自建网关或 OpenAI-compatible 中转服务",
    services: ["文本", "图片", "视频", "TTS"],
    models: ["gpt-4o-mini"],
    capabilities: ["text", "vision", "image_generation", "video_generation", "tts"],
  },
  {
    platform: "anthropic-compatible",
    name: "Anthropic 兼容接口",
    baseUrl: "https://open.bigmodel.cn/api/anthropic/",
    description: "适用于 Anthropic Messages 格式接口，可填写智谱或其他兼容地址",
    services: ["文本", "视觉"],
    models: ["glm-5.1"],
    capabilities: ["text", "vision"],
  },
  {
    platform: "gemini-compatible",
    name: "Gemini 兼容接口",
    baseUrl: "https://generativelanguage.googleapis.com",
    description: "适用于 Gemini generateContent 格式接口",
    services: ["文本", "视觉"],
    models: ["gemini-2.5-flash"],
    capabilities: ["text", "vision", "image_generation"],
  },
  {
    platform: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    description: "OpenAI 官方兼容接口",
    services: ["文本", "图片", "视频", "TTS"],
    models: ["gpt-4o", "gpt-4.1", "gpt-5.1"],
    capabilities: ["text", "vision", "image_generation", "video_generation", "tts"],
  },
  {
    platform: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    description: "DeepSeek 文本与推理模型接口",
    services: ["文本"],
    models: ["deepseek-chat", "deepseek-reasoner"],
    capabilities: ["text", "reasoning"],
  },
  {
    platform: "volcengine",
    name: "火山引擎",
    baseUrl: "",
    description: "火山引擎模型接口，按实际服务地址填写 Base URL",
    services: ["文本", "图片", "视频"],
    models: [],
    capabilities: ["text", "vision", "image_generation", "video_generation"],
  },
  {
    platform: "klingai",
    name: "可灵 AI",
    baseUrl: "",
    description: "可灵图片与视频模型接口，按实际服务地址填写 Base URL",
    services: ["图片", "视频"],
    models: [],
    capabilities: ["image_generation", "video_generation"],
  },
  {
    platform: "minimax",
    name: "MiniMax",
    baseUrl: "",
    description: "MiniMax 文本、视频与 TTS 模型接口",
    services: ["文本", "视频", "TTS"],
    models: [],
    capabilities: ["text", "video_generation", "tts"],
  },
  {
    platform: "tts-compatible",
    name: "TTS 后端",
    baseUrl: LOCAL_TTS_BASE_URL,
    description: "默认使用本地 TTS 后端；改成第三方或自建地址时可填写 API Key",
    services: ["TTS"],
    models: [...LOCAL_TTS_MODELS, "tts-1", "gpt-4o-mini-tts"],
    capabilities: ["tts"],
    apiKeyOptional: true,
  },
  {
    platform: "vidu",
    name: "Vidu",
    baseUrl: "",
    description: "Vidu 视频模型接口，按实际服务地址填写 Base URL",
    services: ["视频"],
    models: [],
    capabilities: ["video_generation"],
  },
  {
    platform: "runninghub",
    name: "RunningHub",
    baseUrl: "https://www.runninghub.cn/openapi/v2",
    description: "Qwen 视角切换 / 多角度生成",
    services: ["视角切换", "图生图"],
    models: ["2009613632530812930"],
    capabilities: ["image_generation"],
  },
  {
    platform: "custom",
    name: "自定义",
    baseUrl: "",
    description: "自定义 OpenAI 兼容 API 供应商",
    services: [],
    models: [],
  },
];

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (provider: Omit<IProvider, "id">) => void;
  existingPlatforms?: string[];
}

export function AddProviderDialog({
  open,
  onOpenChange,
  onSubmit,
  existingPlatforms = [],
}: AddProviderDialogProps) {
  const [platform, setPlatform] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  // Get selected preset
  const selectedPreset = API_PROVIDER_PRESETS.find((p) => p.platform === platform);
  const isCustom = platform === "custom";
  const apiKeyOptional = selectedPreset?.apiKeyOptional === true;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setPlatform("");
      setName("");
      setBaseUrl("");
      setApiKey("");
      setModel("");
    }
  }, [open]);

  // Auto-fill when platform changes
  useEffect(() => {
    if (selectedPreset && !isCustom) {
      setName(selectedPreset.name);
      setBaseUrl(selectedPreset.baseUrl);
      // 自动填充默认模型
      if (selectedPreset.models && selectedPreset.models.length > 0) {
        setModel(selectedPreset.models[0]);
      }
    }
  }, [platform, selectedPreset, isCustom]);

  const handleSubmit = () => {
    if (!platform) {
      toast.error("请选择平台");
      return;
    }
    if (!name.trim()) {
      toast.error("请输入名称");
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      toast.error("自定义平台需要输入 Base URL");
      return;
    }
    if (!apiKeyOptional && !apiKey.trim()) {
      toast.error("请输入 API Key");
      return;
    }

    // 保存该平台的所有预设模型，确保 provider.model 不为空
    const presetModels = selectedPreset?.models || [];
    const modelArray = presetModels.length > 0 
      ? presetModels 
      : (model ? [model] : []);
    
    onSubmit({
      platform,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: modelArray,
      capabilities: selectedPreset?.capabilities,
    });

    onOpenChange(false);
    toast.success(`已添加 ${name}`);
  };

  // Filter out already existing platforms; custom entries can be added repeatedly.
  const availablePlatforms = API_PROVIDER_PRESETS.filter(
    (p) => p.platform === "custom" || !existingPlatforms.includes(p.platform)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(760px,calc(100vw-32px))] max-w-none">
        <DialogHeader>
          <DialogTitle>添加 API 供应商</DialogTitle>
          <DialogDescription className="hidden">添加一个新的 API 供应商</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-4 md:grid-cols-2">
          {/* Platform Selection */}
          <div className="space-y-2">
            <Label>平台</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger>
                <SelectValue placeholder="选择平台" />
              </SelectTrigger>
              <SelectContent>
              {availablePlatforms.map((preset) => (
                  <SelectItem key={preset.platform} value={preset.platform}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="供应商名称"
            />
          </div>

          {/* Base URL (only for custom or editable) */}
          {(isCustom || platform) && (
            <div className="space-y-2 md:col-span-2">
              <Label>Base URL {!isCustom && "(可选修改)"}</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={isCustom ? "https://api.example.com/v1" : ""}
              />
            </div>
          )}

          {/* API Key */}
          <div className="space-y-2 md:col-span-2">
            <Label>API Key{apiKeyOptional ? "（可选）" : ""}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyOptional ? "本地后端无需填写" : "输入 API Key"}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {apiKeyOptional ? "本地 TTS 后端不需要 API Key" : "支持多个 Key，用逗号分隔"}
            </p>
          </div>

          {/* Model - optional input */}
          <div className="space-y-2 md:col-span-2">
            <Label>模型 (可选)</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="输入模型名称，如 gpt-4o"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit}>添加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
