import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  extractPartialContent,
  SCRIPT_STAGE_LABEL,
  type ScriptStageKey,
} from "@/lib/studio/script-planning";
import { Edit3 } from "lucide-react";
import { MdPreview } from "md-editor-rt";
import { useThemeStore } from "@/stores/theme-store";

export function ScriptOutputPanel(props: {
  activeStage: ScriptStageKey;
  hasGeneratedOutput: boolean;
  hasPrereq: boolean;
  output: string;
  streamingText: string | null;
  liveMd: string;
  reviewStreaming: string | null;
  reviewData: string | undefined;
  reviseMode: boolean;
  onEditOutput: () => void;
}) {
  const theme = useThemeStore((state) => state.theme);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">输出结果</Label>
        <div className="flex items-center gap-2">
          {props.hasGeneratedOutput ? (
            <Badge variant="outline">已生成</Badge>
          ) : (
            <Badge variant="secondary">未生成</Badge>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={!props.output}
            onClick={props.onEditOutput}
          >
            <Edit3 className="h-4 w-4" />
            可编辑
          </Button>
        </div>
      </div>
      <div className="min-h-[460px] rounded-md border border-border p-3 text-sm">
        {props.streamingText !== null ? (
          props.liveMd ? (
            <MdPreview
              modelValue={props.liveMd}
              theme={theme}
              language="zh-CN"
            />
          ) : (
            <p className="text-muted-foreground">生成中…</p>
          )
        ) : props.output ? (
          <MdPreview modelValue={props.output} theme={theme} language="zh-CN" />
        ) : (
          <p className="text-muted-foreground">
            {props.hasPrereq ? "点上方「一键生成」由 AI 产出" : "请先完成前置阶段"}
          </p>
        )}
      </div>
      {(props.reviewStreaming !== null || props.reviewData) && (
        <div className="space-y-1">
          <Label className="text-sm">
            审核报告（{SCRIPT_STAGE_LABEL[props.activeStage]}）
            {props.reviseMode ? " · 有待修复问题" : ""}
          </Label>
          <div className="rounded-md border border-border p-3 text-sm">
            {props.reviewStreaming !== null ? (
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap text-xs leading-5">
                {extractPartialContent(props.reviewStreaming) || "审核中…"}
              </pre>
            ) : (
              <MdPreview
                modelValue={props.reviewData ?? ""}
                theme={theme}
                language="zh-CN"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
