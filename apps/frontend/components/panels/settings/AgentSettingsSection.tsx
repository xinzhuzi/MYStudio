import { useMemo } from "react";
import { Workflow, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  API_AGENT_DEPLOYMENT_GROUPS,
  getAgentDeploymentModelType,
  useAPIConfigStore,
  type AgentDeploymentConfig,
  type AgentDeploymentKey,
  type AgentUseMode,
} from "@/stores/api-config-store";
import { parseApiKeys } from "@/lib/api-key-manager";
import {
  MODEL_TYPE_LABELS,
  getProviderDisplayName,
  inferProviderAdapterModelType,
  type AdapterModelType,
} from "./settings-model-utils";

function isCompatibleModelType(requiredType: AdapterModelType, modelType: AdapterModelType) {
  return requiredType === modelType || (requiredType === "text" && modelType === "vision");
}

export function AgentSettingsSection() {
  const {
    providers,
    agentUseMode,
    agentDeployments,
    setAgentUseMode,
    setAgentDeployment,
  } = useAPIConfigStore();
  const visibleProviders = useMemo(
    () => providers.filter((provider) => provider.platform !== "memefast" || parseApiKeys(provider.apiKey).length > 0),
    [providers],
  );
  const modelOptions = useMemo(
    () => visibleProviders.flatMap((provider) => provider.model.map((model) => ({
      providerId: provider.id,
      model,
      type: inferProviderAdapterModelType(model),
      value: `${provider.id}:${model}`,
      label: `${getProviderDisplayName(provider)} / ${model}`,
    }))),
    [visibleProviders],
  );
  const deploymentByKey = useMemo(
    () => new Map(agentDeployments.map((deployment) => [deployment.key, deployment])),
    [agentDeployments],
  );
  const groupedKeys = useMemo(
    () => new Set(API_AGENT_DEPLOYMENT_GROUPS.flatMap((group) => group.keys)),
    [],
  );
  const extraDeployments = useMemo(
    () => agentDeployments.filter((deployment) => !groupedKeys.has(deployment.key)),
    [agentDeployments, groupedKeys],
  );

  const getOptions = (key: AgentDeploymentKey) => {
    const requiredType = getAgentDeploymentModelType(key);
    return modelOptions.filter((option) => isCompatibleModelType(requiredType, option.type));
  };

  const getValue = (deployment: { vendorId?: string; modelId?: string }) => {
    if (!deployment.modelId) return "";
    return deployment.vendorId ? `${deployment.vendorId}:${deployment.modelId}` : deployment.modelId;
  };

  const handleModelChange = (key: AgentDeploymentKey, value: string) => {
    const splitAt = value.indexOf(":");
    setAgentDeployment({
      key,
      vendorId: splitAt > 0 ? value.slice(0, splitAt) : undefined,
      modelId: splitAt > 0 ? value.slice(splitAt + 1) : value || undefined,
    });
  };

  const handleAutoAssign = () => {
    let assignedCount = 0;
    let skippedCount = 0;
    for (const deployment of agentDeployments) {
      if (deployment.disabled) continue;
      const requiredType = getAgentDeploymentModelType(deployment.key);
      const currentValue = getValue(deployment);
      const currentOption = modelOptions.find((option) => option.value === currentValue);
      if (currentOption && isCompatibleModelType(requiredType, currentOption.type)) continue;
      const nextOption = getOptions(deployment.key)[0];
      if (!nextOption) {
        skippedCount += 1;
        continue;
      }
      setAgentDeployment({ key: deployment.key, vendorId: nextOption.providerId, modelId: nextOption.model });
      assignedCount += 1;
    }
    if (assignedCount > 0) toast.success(`已自动分配 ${assignedCount} 个 Agent`);
    else if (skippedCount > 0) toast.warning("没有找到可用于部分 Agent 的匹配模型");
    else toast.info("当前 Agent 绑定已经匹配模型能力");
  };

  const groups = [...API_AGENT_DEPLOYMENT_GROUPS, ...(extraDeployments.length > 0 ? [{
    id: "extra",
    label: "其他",
    desc: "历史配置或插件扩展留下的自定义 Agent",
    keys: extraDeployments.map((deployment) => deployment.key),
  }] : [])];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-5">
        <div>
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Agent 配置
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            「自动分配」一键为每个 Agent 绑定能力匹配的可用模型。简单模式：文本类任务统一复用「通用AI」模型，无需逐个配置；高级模式：每个 Agent 各自绑定独立模型，便于按任务精细调优（图像 / 视频 / 语音类始终按各自绑定）。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleAutoAssign} disabled={modelOptions.length === 0}>
            <Zap className="h-4 w-4 mr-1" />
            自动分配
          </Button>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={agentUseMode}
            onChange={(event) => setAgentUseMode(event.target.value as AgentUseMode)}
          >
            <option value="simple">简单模式</option>
            <option value="advanced">高级模式</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {groups.map((group) => {
          const deployments = group.keys
            .map((key) => deploymentByKey.get(key))
            .filter((deployment): deployment is AgentDeploymentConfig => Boolean(deployment));
          if (deployments.length === 0) return null;
          return (
            <div key={group.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <div className="text-sm font-semibold text-foreground">{group.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{group.desc}</div>
              </div>
              <div className="divide-y divide-border">
                {deployments.map((deployment) => {
                  const requiredType = getAgentDeploymentModelType(deployment.key);
                  const options = getOptions(deployment.key);
                  const currentValue = getValue(deployment);
                  const currentOption = modelOptions.find((option) => option.value === currentValue);
                  const currentMatches = currentOption ? isCompatibleModelType(requiredType, currentOption.type) : !currentValue;
                  return (
                    <div key={deployment.key} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(180px,240px)_minmax(0,1fr)_96px] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-foreground">{deployment.name}</div>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{MODEL_TYPE_LABELS[requiredType]}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{deployment.desc}</div>
                      </div>
                      <div className="min-w-0">
                        <select
                          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                          value={currentValue}
                          onChange={(event) => handleModelChange(deployment.key, event.target.value)}
                          disabled={deployment.disabled}
                        >
                          <option value="">未绑定（需要 {MODEL_TYPE_LABELS[requiredType]} 模型）</option>
                          {!currentMatches && currentValue && <option value={currentValue}>当前绑定类型不匹配：{currentValue}</option>}
                          {options.map((option) => (
                            <option key={`${deployment.key}:${option.value}`} value={option.value}>{option.label}（{MODEL_TYPE_LABELS[option.type]}）</option>
                          ))}
                        </select>
                        {options.length === 0 && <div className="mt-1 text-xs text-muted-foreground">没有可用的 {MODEL_TYPE_LABELS[requiredType]} 模型</div>}
                      </div>
                      <Button
                        variant={deployment.disabled ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setAgentDeployment({ key: deployment.key, disabled: !deployment.disabled })}
                      >
                        {deployment.disabled ? "已停用" : "启用中"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
