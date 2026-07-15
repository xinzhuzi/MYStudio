import { useMemo, useState } from "react";
import { Key, Loader2, Pencil, RefreshCw, Search, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { parseApiKeys } from "@/lib/api-key-manager";
import { resolveThinkingEnabled } from "@/lib/ai/thinking-mode";
import { useAPIConfigStore, type IProvider } from "@/stores/api-config-store";
import {
  MODEL_TYPE_LABELS,
  filterModelsByFuzzyQuery,
  formatModelCapabilities,
  getProviderDisplayName,
  inferProviderAdapterModelType,
} from "./settings-model-utils";

interface ApiServiceSettingsSectionProps {
  provider: IProvider | null;
  syncingProviderId: string | null;
  testingProviderId: string | null;
  modelTestMessages: Record<string, string>;
  onEdit: (provider: IProvider) => void;
  onSync: (provider: IProvider) => void;
  onTest: (provider: IProvider, model: string) => void;
}

export function ApiServiceSettingsSection({
  provider,
  syncingProviderId,
  testingProviderId,
  modelTestMessages,
  onEdit,
  onSync,
  onTest,
}: ApiServiceSettingsSectionProps) {
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const concurrency = useAPIConfigStore((state) => state.concurrency);
  const setConcurrency = useAPIConfigStore((state) => state.setConcurrency);
  const thinkingOverrides = useAPIConfigStore((state) => state.modelThinkingOverrides);
  const setModelThinkingOverride = useAPIConfigStore((state) => state.setModelThinkingOverride);
  const filteredModels = useMemo(
    () => filterModelsByFuzzyQuery(provider?.model ?? [], modelSearchQuery),
    [modelSearchQuery, provider?.model],
  );
  const hasSearch = modelSearchQuery.trim().length > 0;

  if (!provider) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        暂无供应商，请先添加 API 供应商。
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Key className="h-4 w-4" />
                供应商配置
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{getProviderDisplayName(provider)}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onSync(provider)} disabled={syncingProviderId === provider.id}>
                {syncingProviderId === provider.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                同步模型
              </Button>
              <Button variant="outline" size="sm" onClick={() => onEdit(provider)}>
                <Pencil className="h-4 w-4 mr-1" />
                编辑输入项
              </Button>
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-xs text-muted-foreground">Base URL</div>
              <div className="mt-1 truncate font-mono text-xs text-foreground">{provider.baseUrl || "未设置"}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-xs text-muted-foreground">接口协议</div>
              <div className="mt-1 text-xs text-foreground">
                {provider.apiProtocol === "anthropic-compatible"
                  ? "Anthropic 兼容"
                  : provider.apiProtocol === "openai-compatible"
                    ? "OpenAI 兼容"
                    : provider.apiProtocol === "gemini-compatible"
                      ? "Gemini 兼容"
                      : "待测试"}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-xs text-muted-foreground">API Key</div>
              <div className="mt-1 text-xs text-foreground">
                {parseApiKeys(provider.apiKey).length > 0 ? `${parseApiKeys(provider.apiKey).length} 个` : "未配置"}
              </div>
            </div>
          </div>

          <div className="border-t border-border px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium text-foreground">模型列表</h4>
                <p className="mt-1 text-xs text-muted-foreground">配置保存后会保留在本地项目设置中，可手动同步或测试模型。</p>
              </div>
              <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                {hasSearch ? `${filteredModels.length} / ${provider.model.length} 个模型` : `${provider.model.length} 个模型`}
              </span>
            </div>

            {provider.model.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                暂无模型，请编辑供应商并填写模型，或尝试同步供应商模型。
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={modelSearchQuery}
                    onChange={(event) => setModelSearchQuery(event.target.value)}
                    placeholder="模糊搜索模型名称，例如 gpt 5"
                    aria-label="搜索模型名称"
                    className="h-9 bg-background/60 pl-9 pr-9 font-mono text-xs"
                  />
                  {hasSearch && (
                    <button
                      type="button"
                      onClick={() => setModelSearchQuery("")}
                      aria-label="清除模型搜索"
                      className="absolute right-2 top-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="hidden gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_88px_minmax(120px,160px)_64px_88px]">
                    <span>模型名</span><span>类型</span><span>能力</span><span>思考</span><span className="text-right">操作</span>
                  </div>
                  <div className="divide-y divide-border">
                    {filteredModels.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">没有找到匹配“{modelSearchQuery.trim()}”的模型</div>}
                    {filteredModels.map((model) => {
                      const modelType = inferProviderAdapterModelType(model);
                      const modelKey = `${provider.id}:${model || "__empty__"}`;
                      const supportsThinking = modelType === "text" || modelType === "vision";
                      return (
                        <div key={modelKey} className="grid grid-cols-1 gap-2 px-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_88px_minmax(120px,160px)_64px_88px] md:items-center md:gap-3 md:py-2">
                          <span className="truncate font-mono text-xs text-foreground">{model}</span>
                          <span className="w-fit rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{MODEL_TYPE_LABELS[modelType]}</span>
                          <span className="truncate text-xs text-muted-foreground">{formatModelCapabilities(model)}</span>
                          {supportsThinking ? (
                            <Switch
                              checked={resolveThinkingEnabled(model, thinkingOverrides[model])}
                              onCheckedChange={(checked) => setModelThinkingOverride(model, checked)}
                              aria-label={`${model} 思考模式`}
                              title="开启后，调用该模型时自动启用最高深度思考"
                              className="w-fit"
                            />
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                          <Button variant="outline" size="sm" onClick={() => onTest(provider, model)} disabled={testingProviderId === provider.id} className="w-fit md:justify-self-end">
                            {testingProviderId === provider.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "测试"}
                          </Button>
                          {modelTestMessages[modelKey] && <div className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground md:col-span-5">{modelTestMessages[modelKey]}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-5 border border-border rounded-xl bg-card space-y-4">
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <Settings className="h-4 w-4" />
          运行参数
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-xs text-muted-foreground">并发生成数</Label>
          <Input
            type="number"
            min={1}
            value={concurrency}
            onChange={(event) => {
              const value = parseInt(event.target.value);
              if (value >= 1) setConcurrency(value);
            }}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">同时生成的任务数量，多 Key 时会按顺序轮换。</span>
        </div>
      </div>
    </>
  );
}
