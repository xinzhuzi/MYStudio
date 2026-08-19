import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { LiveJobFeedback } from "@/components/ui/live-job-feedback";

interface ScriptImportProgressProps {
  importStatus?: "idle" | "importing" | "ready" | "error";
  calibrationStatus?: "idle" | "calibrating" | "completed" | "error";
  synopsisStatus?: "idle" | "generating" | "completed" | "error";
  viewpointAnalysisStatus?: "idle" | "analyzing" | "completed" | "error";
  characterCalibrationStatus?: "idle" | "calibrating" | "completed" | "error";
  sceneCalibrationStatus?: "idle" | "calibrating" | "completed" | "error";
  secondPassTypes?: Set<string>;
}

export function ScriptImportProgress({
  importStatus,
  calibrationStatus,
  synopsisStatus,
  viewpointAnalysisStatus,
  characterCalibrationStatus,
  sceneCalibrationStatus,
  secondPassTypes,
}: ScriptImportProgressProps) {
  const isActive =
    importStatus === "importing"
    || calibrationStatus === "calibrating"
    || synopsisStatus === "generating"
    || viewpointAnalysisStatus === "analyzing"
    || characterCalibrationStatus === "calibrating"
    || sceneCalibrationStatus === "calibrating";
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (isActive && startedAt === null) setStartedAt(Date.now());
    if (!isActive && startedAt !== null) setStartedAt(null);
  }, [isActive, startedAt]);

  if (!isActive) return null;

  const isSecondPass = Boolean(secondPassTypes && secondPassTypes.size > 0);

  return (
    <div className="p-4 rounded-xl bg-primary/10 border-2 border-primary/30 space-y-3">
      <div className="flex items-center gap-3 text-primary">
        <LiveJobFeedback active startedAt={startedAt ?? undefined} />
        <span className="text-lg font-bold">
          {isSecondPass ? "🔄 二次校准中..." : "正在处理中..."}
        </span>
      </div>
      <div className="space-y-2">
        {isSecondPass ? (
          <>
            {secondPassTypes?.has("shots") && (
              <div className={`flex items-center gap-3 py-1 ${viewpointAnalysisStatus === "analyzing" ? "text-primary font-bold" : viewpointAnalysisStatus === "completed" ? "text-success font-medium" : "text-muted-foreground"}`}>
                {viewpointAnalysisStatus === "analyzing" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : viewpointAnalysisStatus === "completed" ? (
                  <span className="text-lg">✓</span>
                ) : (
                  <span className="w-5 h-5 rounded-full border-2 border-current" />
                )}
                <span className="text-base">AI 校准分镜</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning dark:bg-warning/30">二次</span>
              </div>
            )}
            {secondPassTypes?.has("characters") && (
              <div className={`flex items-center gap-3 py-1 ${characterCalibrationStatus === "calibrating" ? "text-primary font-bold" : characterCalibrationStatus === "completed" ? "text-success font-medium" : "text-muted-foreground"}`}>
                {characterCalibrationStatus === "calibrating" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : characterCalibrationStatus === "completed" ? (
                  <span className="text-lg">✓</span>
                ) : (
                  <span className="w-5 h-5 rounded-full border-2 border-current" />
                )}
                <span className="text-base">AI 角色校准</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning dark:bg-warning/30">二次</span>
              </div>
            )}
            {secondPassTypes?.has("scenes") && (
              <div className={`flex items-center gap-3 py-1 ${sceneCalibrationStatus === "calibrating" ? "text-primary font-bold" : sceneCalibrationStatus === "completed" ? "text-success font-medium" : "text-muted-foreground"}`}>
                {sceneCalibrationStatus === "calibrating" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : sceneCalibrationStatus === "completed" ? (
                  <span className="text-lg">✓</span>
                ) : (
                  <span className="w-5 h-5 rounded-full border-2 border-current" />
                )}
                <span className="text-base">AI 场景校准</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning dark:bg-warning/30">二次</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className={`flex items-center gap-3 py-1 ${importStatus === "importing" ? "text-primary font-bold" : importStatus === "ready" ? "text-success font-medium" : "text-muted-foreground"}`}>
              {importStatus === "importing" ? <Loader2 className="h-5 w-5 animate-spin" /> : importStatus === "ready" ? <span className="text-lg">✓</span> : <span className="w-5 h-5 rounded-full border-2 border-current" />}
              <span className="text-base">导入剧本</span>
            </div>
            <div className={`flex items-center gap-3 py-1 ${calibrationStatus === "calibrating" ? "text-primary font-bold" : calibrationStatus === "completed" ? "text-success font-medium" : "text-muted-foreground"}`}>
              {calibrationStatus === "calibrating" ? <Loader2 className="h-5 w-5 animate-spin" /> : calibrationStatus === "completed" ? <span className="text-lg">✓</span> : <span className="w-5 h-5 rounded-full border-2 border-current" />}
              <span className="text-base">AI 标题校准</span>
            </div>
            <div className={`flex items-center gap-3 py-1 ${synopsisStatus === "generating" ? "text-primary font-bold" : synopsisStatus === "completed" ? "text-success font-medium" : "text-muted-foreground"}`}>
              {synopsisStatus === "generating" ? <Loader2 className="h-5 w-5 animate-spin" /> : synopsisStatus === "completed" ? <span className="text-lg">✓</span> : <span className="w-5 h-5 rounded-full border-2 border-current" />}
              <span className="text-base">AI 大纲生成</span>
            </div>
            <div className={`flex items-center gap-3 py-1 ${viewpointAnalysisStatus === "analyzing" ? "text-primary font-bold" : viewpointAnalysisStatus === "completed" ? "text-success font-medium" : "text-muted-foreground"}`}>
              {viewpointAnalysisStatus === "analyzing" ? <Loader2 className="h-5 w-5 animate-spin" /> : viewpointAnalysisStatus === "completed" ? <span className="text-lg">✓</span> : <span className="w-5 h-5 rounded-full border-2 border-current" />}
              <span className="text-base">AI 分镜校准</span>
            </div>
            <div className={`flex items-center gap-3 py-1 ${characterCalibrationStatus === "calibrating" ? "text-primary font-bold" : characterCalibrationStatus === "completed" ? "text-success font-medium" : "text-muted-foreground"}`}>
              {characterCalibrationStatus === "calibrating" ? <Loader2 className="h-5 w-5 animate-spin" /> : characterCalibrationStatus === "completed" ? <span className="text-lg">✓</span> : <span className="w-5 h-5 rounded-full border-2 border-current" />}
              <span className="text-base">AI 角色校准</span>
            </div>
            <div className={`flex items-center gap-3 py-1 ${sceneCalibrationStatus === "calibrating" ? "text-primary font-bold" : sceneCalibrationStatus === "completed" ? "text-success font-medium" : "text-muted-foreground"}`}>
              {sceneCalibrationStatus === "calibrating" ? <Loader2 className="h-5 w-5 animate-spin" /> : sceneCalibrationStatus === "completed" ? <span className="text-lg">✓</span> : <span className="w-5 h-5 rounded-full border-2 border-current" />}
              <span className="text-base">AI 场景校准</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
