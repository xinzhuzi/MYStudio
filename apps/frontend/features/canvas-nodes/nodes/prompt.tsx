// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useRef, useState } from "react";
import { Type } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildMentionToken,
  mentionTriggerState,
  type MentionCandidate,
} from "@/lib/studio/image-workflow/mention-token";
import { useCanvasDraftValue } from "../draft-input";
import { MentionPicker } from "../mention-picker";
import type { ImageWorkflowNode, ImageWorkflowPromptNode } from "@/types/studio";
import type { CanvasNodeDefinition } from "../node-registry";

/** 提示词节点定义(09-08 P2):正/负双出口(口别 id 与校验单源同口径) */
export const promptNodeDefinition: CanvasNodeDefinition = {
  typeId: "prompt",
  label: "提示词",
  icon: Type,
  iconClassName: "border-info/30 bg-info/10 text-info",
  width: 480,
  defaultExpanded: true,
  handles: [
    {
      kind: "source",
      id: "positive",
      label: "正向",
      position: "Right",
      top: "40%",
      className: "border-info/40! bg-info/20!",
      title: "正向提示词出口:连到下游输入口",
      badge: "正",
      badgeClassName: "text-info/80",
      badgeTop: "36%",
    },
    {
      kind: "source",
      id: "negative",
      label: "反向",
      position: "Right",
      top: "75%",
      className: "border-destructive/50! bg-destructive/15!",
      title: "反向提示词出口:连到同一输入口即与正向拼装",
      badge: "负",
      badgeClassName: "text-destructive/80",
      badgeTop: "71%",
    },
  ],
  summary: (node) => {
    const prompt = typeof node.prompt === "string" ? node.prompt.trim() : "";
    const negative = typeof node.negativePrompt === "string" ? node.negativePrompt.trim() : "";
    const lines = [`正向:${prompt ? prompt.slice(0, 40) : "(未填写)"}`];
    if (negative) lines.push(`负向:${negative.slice(0, 30)}`);
    return lines.join("\n");
  },
};

/**
 * 提示词编辑器(09-09 单源上提,两画布共用):
 * - 草稿态=09-02 光标/输入法终局方案(聚焦期间本地持值+防抖提交),
 *   上提后分镜画布同享(同属 React Flow 受控节点六跳结构);
 * - getMentionCandidates 传入=@ 引用浮层(图片工作室);缺省=纯文本框。
 *   候选工厂仅在浮层打开时调用(画布节点全量映射不进常规渲染路径)。
 * - 占位文案/最小高度经 props 保持两画布现值。
 */
export function PromptNodeEditor({
  node,
  onUpdate,
  getMentionCandidates,
  promptPlaceholder = "描述要生成的图片",
  promptMinClass = "min-h-[120px]",
  negativeMinClass = "min-h-[54px]",
}: {
  node: ImageWorkflowPromptNode;
  onUpdate: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
  getMentionCandidates?: () => MentionCandidate[];
  promptPlaceholder?: string;
  promptMinClass?: string;
  negativeMinClass?: string;
}) {
  const [composing, setComposing] = useState(false);
  const promptInput = useCanvasDraftValue({
    committed: node.prompt,
    commit: (value) => onUpdate(node.id, { prompt: value } as Partial<ImageWorkflowNode>),
  });
  const negativeInput = useCanvasDraftValue({
    committed: node.negativePrompt ?? "",
    commit: (value) => onUpdate(node.id, { negativePrompt: value } as Partial<ImageWorkflowNode>),
  });
  // @引用浮层(09-02-at-mention-refs):组合期不触发(IME 兼容)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{ x: number; y: number; query: string } | null>(null);
  const mentionCandidates: MentionCandidate[] = mention && getMentionCandidates ? getMentionCandidates() : [];
  const syncMention = () => {
    if (!getMentionCandidates) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const state = mentionTriggerState(textarea.value, textarea.selectionStart ?? 0);
    if (!state.active || composing) return setMention(null);
    const rect = textarea.getBoundingClientRect();
    setMention({ x: 8, y: rect.height + 4, query: state.query });
  };
  return (
    <div className="relative space-y-3">
      <Textarea
        ref={textareaRef}
        value={promptInput.value}
        onChange={(event) => {
          promptInput.onChange(event.target.value);
          syncMention();
        }}
        onBlur={promptInput.onBlur}
        onKeyUp={syncMention}
        onClick={syncMention}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        placeholder={promptPlaceholder}
        className={cn(
          "nodrag nopan [field-sizing:content] border-border bg-background/80 text-sm leading-6 text-foreground",
          promptMinClass,
        )}
      />
      {mention ? (
        <MentionPicker
          x={mention.x}
          y={mention.y}
          query={mention.query}
          candidates={mentionCandidates}
          onPick={(candidate) => {
            const textarea = textareaRef.current;
            setMention(null);
            if (!textarea) return;
            const before = textarea.value.slice(0, textarea.selectionStart ?? 0);
            const after = textarea.value.slice(textarea.selectionStart ?? 0);
            const at = before.lastIndexOf("@");
            if (at < 0) return;
            const token = `${buildMentionToken(candidate)} `;
            const next = `${before.slice(0, at)}${token}${after}`;
            promptInput.setValue(next);
          }}
          onClose={() => setMention(null)}
        />
      ) : null}
      <Textarea
        value={negativeInput.value}
        onChange={(event) => negativeInput.onChange(event.target.value)}
        onBlur={negativeInput.onBlur}
        placeholder="反向提示词(可选)——从右侧「负」口连出去才生效,直连整节点时正负一起发"
        className={cn(
          "nodrag nopan [field-sizing:content] border-border bg-background/80 text-xs leading-5 text-foreground",
          negativeMinClass,
        )}
      />
    </div>
  );
}
