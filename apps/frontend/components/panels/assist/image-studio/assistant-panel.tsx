import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, MessageSquare, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callFeatureMultimodalAPI } from "@/lib/ai/feature-router";
import {
  buildAssistantReferences,
  type AssistantReferencePack,
} from "@/lib/studio/image-workflow/assistant-references";
import { dispatchCanvasCommand } from "@/lib/studio/canvas-commands";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import { aiManager } from "@/lib/ai/ai-manager";

/**
 * 画布助手面板(09-02-canvas-assistant,压轴;二期=09-03-canvas-assistant-phase2):
 * 选中节点+上游自动引用;问答(带图走 image_understanding 多模态,纯文走
 * aiManager.text);回答可插回为提示词节点或**直接生图**(建组→写提示词→触发,
 * 三连 ops 指令,生成状态机复用画布既有编排)。交互形态参考 infinite-canvas
 * 画布助手,实现从零(AGPL)。
 */

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** system=插入/生成/错误等状态消息,不出现操作按钮 */
  kind?: "answer" | "system";
}

const ASSISTANT_SYSTEM_PROMPT = `你是图片工作室里的画布助手。用户会给你当前画布上选中的节点及其上游参考(图片与提示词)。根据这些上下文回答问题或给出建议:改进提示词的写法、指出画面问题、建议构图调整等。回答简洁实用,使用中文。`;

export function AssistantPanel({
  selectedNodeId,
  onClose,
}: {
  selectedNodeId: string | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [references, setReferences] = useState<AssistantReferencePack>({
    images: [],
    texts: [],
    summaryZh: "",
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 引用随选中变化重算(store 图以 getState 读,面板不订阅图避免重渲染风暴)
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || running) return;
    setInput("");
    setRunning(true);
    const userMessage: AssistantMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      text: question,
    };
    setMessages((current) => [...current, userMessage]);
    try {
      let answer: string;
      if (references.images.length > 0) {
        // 带图:多模态(缩略已过管线)
        const content: Array<Record<string, unknown>> = [
          { type: "text", text: question },
          ...references.images.map((image) => ({
            type: "image_url",
            image_url: { url: image },
          })),
        ];
        const contextText = references.texts
          .map((text) => `【${text.title}】${text.body}`)
          .join("\n");
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
        const contextText = references.texts
          .map((text) => `【${text.title}】${text.body}`)
          .join("\n");
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

  /** 面板内生图(二期):建组→写提示词→触发生成,三连 ops;
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

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card/60" data-image-studio-assistant>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-card-foreground">
          <MessageSquare className="h-4 w-4 text-info" />
          画布助手
        </div>
        <Button size="icon" variant="ghost" aria-label="关闭助手" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-3 py-1.5 text-xs text-muted-foreground">
        {references.summaryZh || "未选中节点(纯文本对话)"}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <div className="rounded-md border border-border bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground">
            选中一个节点,问问怎么改提示词、哪里可以更好。
          </div>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-md px-2.5 py-2 text-xs leading-5 ${
              message.role === "user"
                ? "ml-6 bg-primary/15 text-foreground"
                : "mr-2 border border-border bg-background/60 text-card-foreground"
            }`}
          >
            <p className="whitespace-pre-wrap">{message.text}</p>
            {message.role === "assistant" && message.kind !== "system" && message.text.length > 8 ? (
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground"
                  onClick={() => insertAsPromptNode(message.text)}
                >
                  <Sparkles className="h-3 w-3" />
                  插为提示词节点
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground"
                  onClick={() => generateFromText(message.text)}
                >
                  <ImagePlus className="h-3 w-3" />
                  按此生图
                </button>
              </div>
            ) : null}
          </div>
        ))}
        {running ? (
          <div className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            思考中…
          </div>
        ) : null}
      </div>

      <div className="flex items-end gap-1.5 border-t border-border p-2">
        <Textarea
          rows={2}
          value={input}
          placeholder="问点什么…"
          className="min-h-[40px] flex-1 border-border bg-background/80 text-xs"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button size="icon" aria-label="发送" disabled={running || !input.trim()} onClick={() => void send()}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {messages.length > 0 ? (
        <div className="border-t border-border px-2 py-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-full text-[11px] text-muted-foreground"
            onClick={() => setMessages([])}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            清空对话
          </Button>
        </div>
      ) : null}
    </div>
  );
}
