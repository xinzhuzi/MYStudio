// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Edit Provider Dialog
 * For editing existing API providers
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { IProvider, ProviderApiProtocol } from "@/lib/ai/core";
import {
  PROVIDER_API_PROTOCOL_OPTIONS,
  getProviderApiProtocolBlockReason,
} from "@/lib/ai/core";
import { getApiKeyCount } from "@/lib/ai/core";
import { LOCAL_TTS_BASE_URL } from "@/lib/tts/client";

interface EditProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: IProvider | null;
  onSave: (provider: IProvider) => void;
}

export function EditProviderDialog({
  open,
  onOpenChange,
  provider,
  onSave,
}: EditProviderDialogProps) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  // 1011 断点D(apiProtocol 配置期必填):custom 平台编辑时协议必填——存量未声明
  // 协议的条目(列表页带警示徽标)须在本次编辑补声明后才能保存
  const [apiProtocol, setApiProtocol] = useState<ProviderApiProtocol | "">("");

  // custom 平台协议无法从平台名推断;具名平台由平台推断表兜底,不展示该字段
  const isCustomPlatform = provider?.platform === "custom";

  // Initialize form when provider changes
  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setBaseUrl(provider.baseUrl || (provider.platform === "manying-local-tts" || provider.platform === "tts-compatible" ? LOCAL_TTS_BASE_URL : ""));
      setApiKey(provider.apiKey);
      // 加载已有模型
      setModel(provider.model?.join(', ') || '');
      setApiProtocol(provider.apiProtocol ?? "");
    }
  }, [provider]);

  const handleSave = () => {
    if (!provider) return;

    if (!name.trim()) {
      toast.error("请输入名称");
      return;
    }
    // 1011:custom 平台未声明协议 → 拦保存,提示语说清按 OpenAI 兼容兜底的后果
    const protocolBlockReason = getProviderApiProtocolBlockReason({
      platform: provider.platform,
      apiProtocol: apiProtocol || undefined,
    });
    if (protocolBlockReason) {
      toast.error(protocolBlockReason);
      return;
    }

    // 解析模型列表（支持逗号或换行分隔）
    const models = model
      .split(/[,\n]/)
      .map(m => m.trim())
      .filter(m => m.length > 0);

    onSave({
      ...provider,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: models,
      // custom 平台存表单必填选择的协议;具名平台保留原声明(可能为 undefined,推断表兜底)
      apiProtocol: isCustomPlatform ? (apiProtocol || undefined) : provider.apiProtocol,
    });

    onOpenChange(false);
    toast.success("已保存更改");
  };

  const keyCount = getApiKeyCount(apiKey);
  const apiKeyOptional = provider?.platform === "manying-local-tts" || provider?.platform === "tts-compatible";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(760px,calc(100vw-32px))] max-w-none">
        <DialogHeader>
          <DialogTitle>编辑供应商</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-4 md:grid-cols-2">
          {/* Platform (read-only) */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">平台</Label>
            <Input value={provider?.platform || ""} disabled className="bg-muted" />
          </div>

          {/* API Protocol (custom 平台必填:协议无法从平台名推断,1011) */}
          {isCustomPlatform && (
            <div className="space-y-2">
              <Label>接口协议(必填)</Label>
              <Select value={apiProtocol} onValueChange={(value) => setApiProtocol(value as ProviderApiProtocol)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择接口协议" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_API_PROTOCOL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                自定义平台无法从平台名推断协议;不声明将按 OpenAI 兼容兜底,可能打错协议口导致模型调用空返回
              </p>
            </div>
          )}

          {/* Name */}
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="供应商名称"
            />
          </div>

          {/* Base URL */}
          <div className="space-y-2 md:col-span-2">
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>

          {/* API Keys */}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label>API Keys{apiKeyOptional ? "（可选）" : ""}</Label>
              <span className="text-xs text-muted-foreground">
                {keyCount} 个 Key
              </span>
            </div>
            <Textarea
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyOptional ? "本地后端无需填写" : "输入 API Keys（每行一个，或用逗号分隔）"}
              className="font-mono text-sm min-h-[150px]"
            />
            <p className="text-xs text-muted-foreground">
              {apiKeyOptional ? "本地 TTS 后端不需要 API Key" : "支持多个 Key 轮换使用，失败时自动切换到下一个"}
            </p>
          </div>

          {/* Model */}
          <div className="space-y-2 md:col-span-2">
            <Label>模型</Label>
            <Textarea
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="输入模型名称，如 deepseek-v3。多个模型可换行或用逗号分隔"
              className="font-mono text-sm min-h-[96px]"
            />
            <p className="text-xs text-muted-foreground">
              多个模型用逗号分隔，第一个为默认模型
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
