import { Info, Loader2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { getApiKeyCount } from "@/lib/api-key-manager";
import type { ImageHostProvider } from "@/stores/api-config-store";

type ImageHostSettingsTabProps = {
  providers: ImageHostProvider[];
  testingProviderId: string | null;
  onAdd: () => void;
  onUpdate: (provider: ImageHostProvider) => void;
  onTest: (provider: ImageHostProvider) => void;
  onEdit: (provider: ImageHostProvider) => void;
  onDelete: (providerId: string) => void;
};

export function ImageHostSettingsTab({
  providers,
  testingProviderId,
  onAdd,
  onUpdate,
  onTest,
  onEdit,
  onDelete,
}: ImageHostSettingsTabProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-8">
        <div>
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Upload className="h-5 w-5" />
            图床配置
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            图床用于存储视频生成过程中的临时图片（如尾帧提取、帧传递等）
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">图床服务商</Label>
            <Button size="sm" variant="outline" onClick={onAdd}>
              <Plus className="h-4 w-4 mr-1" />
              添加
            </Button>
          </div>

          {providers.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无图床配置</div>
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => {
                const keyCount = getApiKeyCount(provider.apiKey);
                const endpoint = provider.uploadPath || provider.baseUrl;
                const configured = provider.enabled && !!endpoint && (provider.apiKeyOptional || keyCount > 0);
                return (
                  <div key={provider.id} className="p-4 border border-border rounded-xl bg-card space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{provider.name}</span>
                          <span className={configured
                            ? "text-xs px-2 py-0.5 bg-green-500/10 text-green-500 rounded"
                            : "text-xs px-2 py-0.5 bg-muted text-muted-foreground rounded"}
                          >
                            {configured ? "已配置" : "未配置"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {provider.platform} · {endpoint || "未设置地址"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {provider.apiKeyOptional && keyCount === 0
                            ? "游客上传（无需 Key）"
                            : `${keyCount} 个 Key`}
                        </p>
                      </div>
                      <Switch
                        checked={provider.enabled}
                        onCheckedChange={(checked) => onUpdate({ ...provider, enabled: checked })}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!provider.enabled || testingProviderId === provider.id}
                        onClick={() => onTest(provider)}
                      >
                        {testingProviderId === provider.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : "测试连接"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onEdit(provider)}>编辑</Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(provider.id)}>删除</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
          <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              图床用于存储视频生成过程中的临时图片，主要用于「视觉连续性」功能。
              如果不配置图床，跨分镜的帧传递功能将受限。
              启用多个图床会按顺序轮流使用，失败自动切换。
            </p>
            <p className="text-sm">
              默认已启用 SCDN 图床，不需要填写KEY；ImgBB 默认保持关闭，如需使用请手动开启并自行测试可用性。
            </p>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
