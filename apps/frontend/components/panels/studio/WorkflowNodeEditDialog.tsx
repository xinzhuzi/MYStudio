import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useThemeStore } from "@/stores/app/theme-store";
import { formatJsonDocument } from "@/lib/studio/storyboard-json";
import {
  CINEMATIC_CAMERA_PRESETS,
  DEFAULT_CINEMATIC_DOF_APERTURE,
  DEFAULT_CINEMATIC_PARALLAX_STRENGTH,
  getCinematicPresetLabel,
  isCinematicCameraPreset,
  validateStoryboardCinematic,
  type CinematicCameraPreset,
  type StoryboardCinematicConfig,
} from "@/lib/studio/cinematic-preset";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { toast } from "sonner";

const jsonEditorScrollTheme = EditorView.theme({
  ".cm-scroller": {
    overflowY: "auto",
  },
});

type DraftShot = Record<string, unknown>;
type CinematicDraftPatch = Omit<Partial<StoryboardCinematicConfig>, "preset"> & {
  preset?: CinematicCameraPreset | "";
};

function parseDraftShots(value: string): DraftShot[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(isRecord);
  } catch {
    return undefined;
  }
}

function updateCinematicDraft(
  raw: string,
  shotIndex: number,
  patch: CinematicDraftPatch,
): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const next = parsed.map((entry, index) => {
      if (index !== shotIndex || !isRecord(entry)) return entry;
      const current = isRecord(entry.cinematic) ? entry.cinematic : {};
      if (patch.preset === "") {
        const nextShot = { ...entry };
        delete nextShot.cinematic;
        return nextShot;
      }
      const nextPreset = patch.preset ?? current.preset;
      if (!isCinematicCameraPreset(nextPreset)) return entry;
      const { preset: _preset, ...valuePatch } = patch;
      return {
        ...entry,
        cinematic: {
          ...current,
          preset: nextPreset,
          parallaxStrength: typeof current.parallaxStrength === "number"
            ? current.parallaxStrength
            : DEFAULT_CINEMATIC_PARALLAX_STRENGTH,
          dofAperture: typeof current.dofAperture === "number"
            ? current.dofAperture
            : DEFAULT_CINEMATIC_DOF_APERTURE,
          ...valuePatch,
        },
      };
    });
    return JSON.stringify(next, null, 2);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is DraftShot {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function CinematicStoryboardControls({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const shots = parseDraftShots(value)?.flatMap((shot, index) => {
    const shotId = typeof shot.id === "string" && shot.id.trim()
      ? shot.id
      : typeof shot.index === "number"
        ? `镜头 ${shot.index}`
        : undefined;
    return shotId ? [{ shot, index, shotId }] : [];
  }) ?? [];
  if (shots.length === 0) return null;

  const commit = (
    shotIndex: number,
    patch: CinematicDraftPatch,
  ) => {
    const next = updateCinematicDraft(value, shotIndex, patch);
    if (!next) {
      toast.error("请先修复 canonical 分镜 JSON，再编辑 cinematic 预设");
      return;
    }
    onValueChange(next);
  };

  return (
    <section
      className="shrink-0 max-h-56 overflow-y-auto rounded-md border border-border bg-muted/20 p-3"
      aria-label="电影级镜头预设"
      data-cinematic-controls
    >
      <div className="mb-2">
        <h3 className="text-sm font-medium text-foreground">电影级镜头预设</h3>
        <p className="text-xs text-muted-foreground">无（2D）不会写入深度配置；选择预设后才启用强度参数。</p>
      </div>
      <div className="space-y-3">
        {shots.map(({ shot, index, shotId }) => {
          const rawCinematic = shot.cinematic;
          const cinematic = isRecord(rawCinematic) ? rawCinematic : undefined;
          const rawPreset = typeof cinematic?.preset === "string" ? cinematic.preset : "";
          const preset = isCinematicCameraPreset(rawPreset) ? rawPreset : "";
          const cinematicError = rawCinematic === undefined
            ? undefined
            : validateStoryboardCinematic(rawCinematic);
          const parallaxStrength = typeof cinematic?.parallaxStrength === "number"
            ? cinematic.parallaxStrength
            : DEFAULT_CINEMATIC_PARALLAX_STRENGTH;
          const dofAperture = typeof cinematic?.dofAperture === "number"
            ? cinematic.dofAperture
            : DEFAULT_CINEMATIC_DOF_APERTURE;
          return (
            <div key={`${shotId}-${index}`} className="grid gap-2 rounded border border-border/70 bg-background/30 p-2">
              <label className="grid gap-1 text-xs text-muted-foreground">
                {shotId} cinematic 预设
                <select
                  className="h-8 rounded border border-border bg-background px-2 text-foreground"
                  aria-label={`${shotId} cinematic 预设`}
                  data-cinematic-preset-select={shotId}
                  value={preset || rawPreset}
                  onChange={(event) => {
                    const nextPreset = event.currentTarget.value;
                    commit(index, { preset: nextPreset as CinematicCameraPreset | "" });
                  }}
                >
                  <option value="">无（2D）</option>
                  {CINEMATIC_CAMERA_PRESETS.map((option) => (
                    <option key={option} value={option}>{getCinematicPresetLabel(option)}</option>
                  ))}
                  {rawPreset && !isCinematicCameraPreset(rawPreset) ? (
                    <option value={rawPreset}>当前值无效：{rawPreset}</option>
                  ) : null}
                </select>
              </label>
              {cinematicError ? <p className="text-xs text-destructive" role="alert">{cinematicError}</p> : null}
              {preset ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    parallaxStrength <output className="text-foreground">{parallaxStrength.toFixed(2)}</output>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={parallaxStrength}
                      aria-label={`${shotId} parallaxStrength`}
                      data-cinematic-parallax-strength={shotId}
                      onChange={(event) => { commit(index, { parallaxStrength: Number(event.currentTarget.value) }); }}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    dofAperture <output className="text-foreground">{dofAperture.toFixed(1)}</output>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.1"
                      value={dofAperture}
                      aria-label={`${shotId} dofAperture`}
                      data-cinematic-dof-aperture={shotId}
                      onChange={(event) => { commit(index, { dofAperture: Number(event.currentTarget.value) }); }}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function WorkflowNodeEditDialog({
  open,
  title,
  value,
  writable,
  onValueChange,
  onClose,
  onSave,
  onEnterStage,
  jsonMode = false,
  readOnlyJson = false,
}: {
  open: boolean;
  title: string;
  value: string;
  writable: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onEnterStage: () => void;
  jsonMode?: boolean;
  readOnlyJson?: boolean;
}) {
  const theme = useThemeStore((state) => state.theme);
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 border-border bg-card text-card-foreground sm:max-w-[92vw]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {readOnlyJson
              ? "只读查看当前章节 Remotion 分镜清单；它由 canonical 分镜 JSON 派生，不会独立写回。"
              : writable && jsonMode
                ? "编辑当前章节供 Remotion 视频生产使用的 canonical 分镜源数据。保存前会校验章节、镜头序号、素材引用和渲染状态；生成图片等 mediaRef 会保留。"
                : writable
              ? "编辑当前节点 FlowData Markdown，保存后会回写工作流数据。"
              : "该节点由结构化数据生成，可查看 Markdown 摘要；请进入对应阶段编辑明细。"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          {jsonMode ? <CodeMirror
            className="h-full"
            value={value}
            height="100%"
            theme={theme === "dark" ? "dark" : "light"}
            extensions={[json(), EditorView.lineWrapping, jsonEditorScrollTheme]}
            onChange={onValueChange}
            readOnly={!writable}
          /> : <MdEditor
            modelValue={value}
            onChange={onValueChange}
            theme={theme}
            language="zh-CN"
            toolbarsExclude={["github"]}
            readOnly={!writable}
            style={{ height: "100%" }}
          />}
        </div>
        {jsonMode && writable && !readOnlyJson ? (
          <CinematicStoryboardControls value={value} onValueChange={onValueChange} />
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {jsonMode && writable ? (
            <Button
              variant="outline"
              onClick={() => {
                const formatted = formatJsonDocument(value);
                if (formatted.value) onValueChange(formatted.value);
                else toast.error(formatted.error ?? "JSON 格式化失败");
              }}
            >
              格式化
            </Button>
          ) : null}
          {readOnlyJson ? null : writable ? (
            <Button onClick={onSave}>保存</Button>
          ) : (
            <Button type="button" onClick={onEnterStage}>
              进入阶段
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
