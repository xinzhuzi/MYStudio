import { useEffect, useMemo, useState } from "react";
import { Key, Link2, Plus, Shield, Trash2, Workflow } from "lucide-react";
import { FeatureBindingPanel } from "@/components/api-manager";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { IProvider } from "@/stores/api-config-store";
import { AgentSettingsSection } from "./AgentSettingsSection";
import { ApiServiceSettingsSection } from "./ApiServiceSettingsSection";
import { getProviderDisplayName } from "./settings-model-utils";

export const API_MANAGER_SECTIONS = [
  { value: "service", label: "模型服务", desc: "供应商、API Key、Base URL、模型列表与测试" },
  { value: "mapping", label: "模型映射", desc: "按文本、图片、视频、TTS、视觉能力绑定模型" },
  { value: "agents", label: "Agent 配置", desc: "工作流逻辑任务到模型的部署关系" },
] as const;

type ApiManagerSectionId = typeof API_MANAGER_SECTIONS[number]["value"];

interface ApiSettingsTabProps {
  providers: IProvider[];
  configuredCount: number;
  syncingProviderId: string | null;
  testingProviderId: string | null;
  modelTestMessages: Record<string, string>;
  onAdd: () => void;
  onDelete: (provider: IProvider) => void;
  onEdit: (provider: IProvider) => void;
  onSync: (provider: IProvider) => void;
  onTest: (provider: IProvider, model: string) => void;
}

function SectionIcon({ value }: { value: ApiManagerSectionId }) {
  if (value === "service") return <Key className="h-4 w-4" />;
  if (value === "mapping") return <Link2 className="h-4 w-4" />;
  return <Workflow className="h-4 w-4" />;
}

export function ApiSettingsTab({
  providers,
  configuredCount,
  syncingProviderId,
  testingProviderId,
  modelTestMessages,
  onAdd,
  onDelete,
  onEdit,
  onSync,
  onTest,
}: ApiSettingsTabProps) {
  const [activeSection, setActiveSection] = useState<ApiManagerSectionId>("service");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) || providers[0] || null,
    [providers, selectedProviderId],
  );

  useEffect(() => {
    if (!selectedProviderId && providers[0]) {
      setSelectedProviderId(providers[0].id);
      return;
    }
    if (selectedProviderId && !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0]?.id ?? null);
    }
  }, [providers, selectedProviderId]);

  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-8">
        <div className="api-manager-notice-bar flex flex-col gap-4 rounded-xl border border-border bg-muted/45 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Shield className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-foreground">提示</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                所有 API Key 仅存储在您的浏览器本地存储中，不会上传到任何服务器。支持多 Key 轮换，失败时自动切换。
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 self-start lg:self-center">
            <span className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              已配置: {configuredCount}/{providers.length}
            </span>
            <Button onClick={onAdd} size="sm">
              <Plus className="mr-1 h-4 w-4" />
              添加供应商
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-6 items-start">
          <aside className="space-y-3">
            <div className="rounded-xl border border-border bg-card p-2">
              {API_MANAGER_SECTIONS.map((section) => (
                <button
                  key={section.value}
                  type="button"
                  onClick={() => setActiveSection(section.value)}
                  className={cn(
                    "w-full rounded-lg px-3 py-3 text-left transition-colors",
                    activeSection === section.value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium"><SectionIcon value={section.value} />{section.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{section.desc}</span>
                </button>
              ))}
            </div>

            {providers.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-2">
                <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">供应商</div>
                <div className="space-y-1">
                  {providers.map((provider) => (
                    <div
                      key={provider.id}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                        selectedProvider?.id === provider.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProviderId(provider.id);
                          setActiveSection("service");
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate">{getProviderDisplayName(provider)}</span>
                        <span className="text-xs text-muted-foreground">{provider.model.length} 个模型</span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground opacity-70 hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                        title="删除供应商"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(provider);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <div className="min-w-0 space-y-6">
            {activeSection === "mapping" && <FeatureBindingPanel />}
            {activeSection === "agents" && <AgentSettingsSection />}
            {activeSection === "service" && (
              <ApiServiceSettingsSection
                provider={selectedProvider}
                syncingProviderId={syncingProviderId}
                testingProviderId={testingProviderId}
                modelTestMessages={modelTestMessages}
                onEdit={onEdit}
                onSync={onSync}
                onTest={onTest}
              />
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
