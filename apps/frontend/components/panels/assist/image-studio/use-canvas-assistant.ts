// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useEffect, useState } from "react";
import { callFeatureMultimodalAPI } from "@/lib/ai/feature-router";
import {
  buildAssistantReferences,
  type AssistantReferencePack,
} from "@/lib/studio/image-workflow/assistant-references";
import { dispatchCanvasCommand } from "@/lib/studio/canvas-commands";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import { aiManager } from "@/lib/ai/ai-manager";

/**
 * 画布助手状态机(09-03 弹窗化重构,自 assistant-panel 抽出):
 * 纯逻辑零 JSX——引用组装/问答(带图走 image_understanding 多模态,纯文走
 * aiManager.text)/插回为提示词节点/按此生图(三连 ops)。
 * 视图见 canvas-assistant-dialog;画布动作全经 ops 指令层,零 store 直写。
 */

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** system=插入/生成/错误等状态消息,不出现操作按钮 */
  kind?: "answer" | "system";
}

const ASSISTANT_SYSTEM_PROMPT = `你是图片工作室里的画布助手。用户会给你当前画布上选中的节点及其上游参考(图片与提示词)。根据这些上下文回答问题或给出建议:改进提示词的写法、指出画面问题、建议构图调整等。回答简洁实用,使用中文。`;

export function useCanvasAssistant({ selectedNodeId }: { selectedNodeId: string | null }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [references, setReferences] = useState<AssistantReferencePack>({
    images: [],
    texts: [],
    summaryZh: "",
  });

  // 引用随选中变化重算(store 图以 getState 读,不订阅图避免重渲染风暴)
  useEffect(() => {
    let cancelled = false;
    void buildAssistantReferences({
      graph: useImageStudioStore.getState().workflows.find(
        (workflow) => workflow.id === useImageStudioStore.getState().activeWorkflowId,
      ),
      selectedNodeId,
    }).then((pack) => {
      if (!cancelled) setReferences(pack);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId]);

  /** override=快捷问法直发(绕过输入框草稿);缺省发输入框当前值 */
  const send = useCallback(async (override?: string) => {
    const question = (override ?? input).trim();
    if (!question || running) return;
    setInput("");
    setRunning(true);
    setMessages((current) => [
      ...current,
      { id: `u_${Date.now()}`, role: "user", text: question },
    ]);
    try {
      let answer: string;
      const contextText = references.texts
        .map((text) => `【${text.title}】${text.body}`)
        .join("\n");
      if (references.images.length > 0) {
        // 带图:多模态(缩略已过管线)
        const content: Array<Record<string, unknown>> = [
          { type: "text", text: question },
          ...references.images.map((image) => ({
            type: "image_url",
            image_url: { url: image },
          })),
        ];
        answer = await callFeatureMultimodalAPI("image_understanding", [
          { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
          {
            role: "user",
            content: contextText
              ? [{ type: "text", text: `${contextText}\n\n${question}` }, ...content.slice(1)]
              : content,
          },
        ]);
      } else {
        const result = await aiManager.text({
          binding: { agent: "universalAi" },
          messages: [
            { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
            ...(contextText
              ? [{ role: "user" as const, content: `上下文:\n${contextText}` }]
              : []),
            { role: "user", content: question },
          ],
        });
        if (!result.success || !result.text) throw new Error(result.error || "模型未返回内容");
        answer = result.text;
      }
      setMessages((current) => [
        ...current,
        { id: `a_${Date.now()}`, role: "assistant", text: answer },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `e_${Date.now()}`,
          role: "assistant",
          text: `出错了:${error instanceof Error ? error.message : "请重试"}`,
        },
      ]);
    } finally {
      setRunning(false);
    }
  }, [input, references, running]);

  /** 追加一条状态消息(不挂操作按钮) */
  const pushSystemMessage = useCallback((text: string) => {
    setMessages((current) => [
      ...current,
      { id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role: "assistant", text, kind: "system" },
    ]);
  }, []);

  /** 插回画布:全经 ops 指令层(prompt 二期透传,零 store 直写) */
  const insertAsPromptNode = useCallback(
    (text: string) => {
      const graph = useImageStudioStore.getState().workflows.find(
        (workflow) => workflow.id === useImageStudioStore.getState().activeWorkflowId,
      );
      const source = graph?.nodes.find((node) => node.id === selectedNodeId);
      const result = dispatchCanvasCommand("image-studio", {
        kind: "add-node",
        surface: "image-studio",
        nodeType: "prompt",
        ...(source ? { connectFrom: { nodeId: source.id, handleType: "target" } } : {}),
      });
      if (result.ok) {
        dispatchCanvasCommand("image-studio", {
          kind: "update-node",
          surface: "image-studio",
          nodeId: result.detail?.nodeId ?? "",
          patch: { title: "助手建议", prompt: text },
        });
        pushSystemMessage("已插入为提示词节点。");
      }
    },
    [selectedNodeId, pushSystemMessage],
  );

  /** 按此生图:建组→写提示词→触发生成,三连 ops;
   *  生成状态机(状态/toast/落库/历史/事件广播)全在 useImageStudioGeneration,零重复 */
  const generateFromText = useCallback(
    (text: string) => {
      const graph = useImageStudioStore.getState().workflows.find(
        (workflow) => workflow.id === useImageStudioStore.getState().activeWorkflowId,
      );
      const source = graph?.nodes.find((node) => node.id === selectedNodeId);
      const add = dispatchCanvasCommand("image-studio", {
        kind: "add-node",
        surface: "image-studio",
        nodeType: "generated",
        ...(source ? { connectFrom: { nodeId: source.id, handleType: "target" } } : {}),
      });
      if (!add.ok) {
        pushSystemMessage(`无法开始生成:${add.reason}`);
        return;
      }
      const generatedNodeId = add.detail?.nodeId;
      if (!generatedNodeId) {
        pushSystemMessage("无法开始生成:建组回执缺节点 id");
        return;
      }
      if (add.detail?.promptNodeId) {
        dispatchCanvasCommand("image-studio", {
          kind: "update-node",
          surface: "image-studio",
          nodeId: add.detail.promptNodeId,
          patch: { prompt: text },
        });
      }
      const trigger = dispatchCanvasCommand("image-studio", {
        kind: "trigger-node-action",
        surface: "image-studio",
        nodeId: generatedNodeId,
        action: "generate",
      });
      pushSystemMessage(
        trigger.ok
          ? "已开始生成:成图节点已落在画布上,完成后自动显示(本地每张约 2-3 分钟)。"
          : `生成未能开始:${trigger.reason}`,
      );
    },
    [selectedNodeId, pushSystemMessage],
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  return {
    messages,
    input,
    setInput,
    running,
    references,
    send,
    insertAsPromptNode,
    generateFromText,
    clearMessages,
  };
}
