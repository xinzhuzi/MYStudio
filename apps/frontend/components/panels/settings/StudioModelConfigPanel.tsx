import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStudioConfigStore } from "@/stores/studio-config-store";
import type { ModelBinding } from "@/types/studio";
import { toast } from "sonner";

export const STUDIO_MODEL_BINDING_LABELS: Record<ModelBinding["key"], string> = {
  scriptAgent: "剧本总控",
  storySkeletonAgent: "故事骨架",
  adaptationStrategyAgent: "改编策略",
  storyboardImage: "分镜图片",
  videoTrack: "视频片段",
  tts: "TTS",
  universalAi: "通用任务",
};

export function StudioModelConfigPanel() {
  const { vendors, bindings, lastValidationMessage, upsertVendor, setBinding, validateConfig } = useStudioConfigStore();
  const relayVendor = vendors[0];
  const modelOptions = useMemo(
    () => vendors.flatMap((vendor) => vendor.models.map((model) => ({ id: model.id, label: `${vendor.name} / ${model.name}` }))),
    [vendors],
  );
  const [relayBaseUrl, setRelayBaseUrl] = useState(relayVendor?.relayBaseUrl ?? "");
  const [apiKey, setApiKey] = useState(relayVendor?.inputValues.apiKey ?? "");
  const [enabled, setEnabled] = useState(Boolean(relayVendor?.enabled));
  const [modelsJson, setModelsJson] = useState(JSON.stringify(relayVendor?.models ?? [], null, 2));

  const saveRelay = () => {
    if (!relayVendor) return;
    try {
      const models = JSON.parse(modelsJson);
      if (!Array.isArray(models)) {
        throw new Error("模型定义必须是数组");
      }
      upsertVendor({ ...relayVendor, relayBaseUrl, enabled, inputValues: { ...relayVendor.inputValues, apiKey }, models });
      toast.success("中转站和模型配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型 JSON 格式无效");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">漫影工作室配置中心</h3>
        <p className="mt-1 text-sm text-muted-foreground">配置中转站、模型能力和工作流任务绑定；当前版本保存配置，不主动执行模型请求。</p>
      </div>
      <div className="grid grid-cols-[420px_1fr] gap-4">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-sm">中转站</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label>启用</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={enabled ? "1" : "0"} onChange={(event) => setEnabled(event.target.value === "1")}>
              <option value="0">关闭</option>
              <option value="1">启用</option>
            </select>
            <Label>Base URL</Label>
            <Input value={relayBaseUrl} onChange={(event) => setRelayBaseUrl(event.target.value)} placeholder="https://relay.example.com/v1" />
            <Label>API Key</Label>
            <Input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="V1 只保存，不请求" />
            <Label>模型定义 JSON</Label>
            <Textarea
              value={modelsJson}
              onChange={(event) => setModelsJson(event.target.value)}
              className="min-h-[280px] font-mono text-xs"
              placeholder='[{"id":"relay:text","name":"文本模型","type":"text","capabilities":{},"defaultParams":{}}]'
            />
            <div className="flex gap-2">
              <Button onClick={saveRelay}>保存</Button>
              <Button variant="secondary" onClick={() => validateConfig()}>校验</Button>
            </div>
            {lastValidationMessage && <div className="rounded-md bg-muted p-2 text-xs">{lastValidationMessage}</div>}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-sm">任务绑定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(STUDIO_MODEL_BINDING_LABELS).map(([key, label]) => {
              const current = bindings.find((binding) => binding.key === key);
              return (
                <div key={key} className="grid grid-cols-[160px_1fr] items-center gap-3 rounded-md border border-border p-2">
                  <div className="text-sm">{label}</div>
                  <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={current?.modelId ?? ""} onChange={(event) => setBinding({ key: key as ModelBinding["key"], modelId: event.target.value })}>
                    <option value="">未绑定</option>
                    {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
