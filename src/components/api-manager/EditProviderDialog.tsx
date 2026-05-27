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
import { toast } from "sonner";
import type { IProvider } from "@/lib/api-key-manager";
import { getApiKeyCount } from "@/lib/api-key-manager";

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

  // Initialize form when provider changes
  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setBaseUrl(provider.baseUrl);
      setApiKey(provider.apiKey);
      // 加载已有模型
      setModel(provider.model?.join(', ') || '');
    }
  }, [provider]);

  const handleSave = () => {
    if (!provider) return;

    if (!name.trim()) {
      toast.error("请输入名称");
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
    });

    onOpenChange(false);
    toast.success("已保存更改");
  };

  const keyCount = getApiKeyCount(apiKey);

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
              <Label>API Keys</Label>
              <span className="text-xs text-muted-foreground">
                {keyCount} 个 Key
              </span>
            </div>
            <Textarea
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入 API Keys（每行一个，或用逗号分隔）"
              className="font-mono text-sm min-h-[150px]"
            />
            <p className="text-xs text-muted-foreground">
              💡 支持多个 Key 轮换使用，失败时自动切换到下一个
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
