import { AlertCircle } from "lucide-react";

type SplitScenesPromptWarningProps = {
  hasMissingPrompt: boolean;
};

export function SplitScenesPromptWarning({ hasMissingPrompt }: SplitScenesPromptWarningProps) {
  if (!hasMissingPrompt) return null;

  return (
    <div className="flex items-start gap-2 p-2 rounded-md bg-warning/10 border border-warning/20">
      <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
      <div className="text-xs text-warning dark:text-warning">
        <p>部分分镜缺少提示词，点击分镜下方的文字区域可编辑。</p>
      </div>
    </div>
  );
}
