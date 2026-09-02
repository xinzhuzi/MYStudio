// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useRef } from "react";
import {
  Copy,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCanvasAssistant } from "./use-canvas-assistant";

/**
 * 画布助手弹窗(09-03-canvas-assistant-dialog):从侧栏弹窗化+逻辑视图拆分。
 * 实际作用亮在明面——针对选中节点提问,回答一键「插为提示词节点」/「按此生图」
 * (三动作卡);空态给快捷问法,点击即发。纯视图,全部逻辑在 use-canvas-assistant。
 */

const QUICK_ASKS_SELECTED = [
  "帮我改进这条提示词",
  "这张图有什么问题?",
  "给主体写 3 个风格不同的变体",
] as const;

const QUICK_ASKS_BARE = [
  "帮我把一句话扩写成生图提示词",
  "推荐一个赛博朋克城市夜景的提示词",
  "什么是负面提示词?怎么写?",
] as const;

export function CanvasAssistantDialog({
  open,
  onOpenChange,
  selectedNodeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedNodeId: string | null;
}) {
  const {
    messages,
    input,
    setInput,
    running,
    references,
    send,
    insertAsPromptNode,
    generateFromText,
    clearMessages,
  } = useCanvasAssistant({ selectedNodeId });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(640px,84vh)] w-[min(560px,92vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
        data-image-studio-assistant
      >
        <DialogHeader className="sr-only">
          <DialogTitle>画布助手</DialogTitle>
          <DialogDescription>针对选中节点提问,回答可一键插回画布或直接生图</DialogDescription>
        </DialogHeader>

        {/* 标题区:名字+实际作用一句话(关闭用 DialogContent 自带右上钮,双钮用户已打回) */}
        <div className="space-y-1 border-b border-border px-4 py-3 pr-12">
          <div className="flex items-center gap-1.5 text-sm font-medium text-card-foreground">
            <MessageSquareText className="h-4 w-4 text-info" />
            画布助手
          </div>
          <p className="text-xs text-muted-foreground">
            针对选中节点提问;回答可一键插为提示词节点,或直接开生成。
          </p>
        </div>

        {/* 引用摘要:本次对话带了哪些上下文 */}
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted/60 px-2.5 py-0.5">
            {references.summaryZh || "未选中节点(纯文本对话)"}
          </span>
        </div>

        {/* 消息流 */}
        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="space-y-2.5 rounded-md border border-border bg-background/60 px-3 py-4">
              <p className="text-center text-xs text-muted-foreground">
                {selectedNodeId ? "问问选中的节点怎么改,或直接试:" : "不用选中节点也能问,试试:"}
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {(selectedNodeId ? QUICK_ASKS_SELECTED : QUICK_ASKS_BARE).map((quickAsk) => (
                  <button
                    key={quickAsk}
                    type="button"
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground"
                    onClick={() => void send(quickAsk)}
                  >
                    {quickAsk}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-md px-2.5 py-2 text-xs leading-5 ${
                message.role === "user"
                  ? "ml-8 bg-primary/15 text-foreground"
                  : "mr-2 border border-border bg-background/60 text-card-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.role === "assistant" && message.kind !== "system" && message.text.length > 8 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => insertAsPromptNode(message.text)}
                  >
                    <Sparkles className="mr-1 h-3 w-3" />
                    插为提示词节点
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => generateFromText(message.text)}
                  >
                    <ImagePlus className="mr-1 h-3 w-3" />
                    按此生图
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    title="复制回答"
                    aria-label="复制回答"
                    onClick={() => void navigator.clipboard?.writeText(message.text)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
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

        {/* 输入区 */}
        <div className="flex items-end gap-1.5 border-t border-border p-3">
          <Textarea
            rows={2}
            value={input}
            placeholder="问点什么…(Enter 发送)"
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
          <div className="border-t border-border px-3 py-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-full text-[11px] text-muted-foreground"
              onClick={clearMessages}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              清空对话
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
