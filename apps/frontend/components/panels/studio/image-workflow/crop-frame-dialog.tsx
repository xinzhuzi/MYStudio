import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Lock, LockOpen, RotateCcw, Scissors, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CROP_DEFAULT,
  CROP_HANDLES,
  moveCropRect,
  resizeCropRect,
  cropPixelSize,
  simplestRatio,
  type CropHandle,
  type NormRect,
} from "@/lib/studio/image-workflow/crop-geometry";

/**
 * 裁剪对话框(09-01-extraction-crop):归一化框+8手柄+三分线+锁比例+实时尺寸。
 * 交互形态参考 infinite-canvas 裁剪设计(研究档§二),实现从零(AGPL)。
 * 确认只回调归一化 rect——像素裁剪与落图在 canvas 层经 infra 管线。
 */
export function CropFrameDialog({
  open,
  imageUrl,
  sourceTitle,
  onClose,
  onConfirm,
}: {
  open: boolean;
  imageUrl: string | null;
  sourceTitle: string;
  onClose: () => void;
  onConfirm: (rect: NormRect) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<NormRect>(CROP_DEFAULT);
  const [locked, setLocked] = useState(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!open || !imageUrl) return;
    setRect(CROP_DEFAULT);
    setLocked(false);
    setImageSize(null);
    const image = new Image();
    image.onload = () => setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = imageUrl;
  }, [open, imageUrl]);

  const dragRef = useRef<{
    mode: "move" | "resize";
    handle?: CropHandle;
    startClient: { x: number; y: number };
    startRect: NormRect;
  } | null>(null);

  const startDrag = (mode: "move" | "resize", event: ReactPointerEvent, handle?: CropHandle) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      handle,
      startClient: { x: event.clientX, y: event.clientY },
      startRect: rect,
    };
  };

  const onDragMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!drag || !box) return;
    const dx = (event.clientX - drag.startClient.x) / box.width;
    const dy = (event.clientY - drag.startClient.y) / box.height;
    setRect(
      drag.mode === "move"
        ? moveCropRect(drag.startRect, dx, dy)
        : resizeCropRect(drag.startRect, drag.handle ?? "se", dx, dy, locked, {
            width: box.width,
            height: box.height,
          }),
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const pixelSize = imageSize ? cropPixelSize(rect, imageSize) : null;

  return (
    <Dialog open={open && Boolean(imageUrl)} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-[820px]">
        <DialogHeader>
          <DialogTitle>裁剪「{sourceTitle}」</DialogTitle>
        </DialogHeader>

        <div className="flex justify-center">
          <div
            ref={boxRef}
            className="relative inline-block max-w-full select-none overflow-hidden rounded-lg bg-black"
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                className="block max-h-[62vh] max-w-full opacity-90"
                draggable={false}
              />
            ) : null}
            {/* 四块遮罩围出选区 */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/55" style={{ height: `${rect.y * 100}%` }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${(1 - rect.y - rect.height) * 100}%` }} />
            <div className="pointer-events-none absolute bg-black/55" style={{ left: 0, top: `${rect.y * 100}%`, width: `${rect.x * 100}%`, height: `${rect.height * 100}%` }} />
            <div className="pointer-events-none absolute bg-black/55" style={{ right: 0, top: `${rect.y * 100}%`, width: `${(1 - rect.x - rect.width) * 100}%`, height: `${rect.height * 100}%` }} />

            {/* 选区框:拖移+三分线+8手柄 */}
            <div
              className="absolute cursor-move border-2 border-white"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
              onPointerDown={(event) => startDrag("move", event)}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/50" />
              <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/50" />
              <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/50" />
              <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/50" />
              {CROP_HANDLES.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-label={`调整裁剪框 ${handle}`}
                  className="absolute size-3 rounded-full border border-black bg-white"
                  style={handleStyle(handle)}
                  onPointerDown={(event) => startDrag("resize", event, handle)}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-3">
            <span>裁剪尺寸 {pixelSize ? `${pixelSize.width} × ${pixelSize.height}` : "读取中"}</span>
            <span>比例 {pixelSize ? simplestRatio(pixelSize.width, pixelSize.height) : "—"}</span>
            <span>原图 {imageSize ? `${imageSize.width} × ${imageSize.height}` : "读取中"}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setLocked((value) => !value)}>
            {locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
            {locked ? "锁定比例" : "自由比例"}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setRect(CROP_DEFAULT)}>
            <RotateCcw className="h-4 w-4" />
            重置
          </Button>
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
            取消
          </Button>
          <Button onClick={() => onConfirm(rect)}>
            <Scissors className="h-4 w-4" />
            确认裁剪
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function handleStyle(handle: CropHandle): CSSProperties {
  const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
  const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
  return { top, left, cursor: `${handle}-resize` };
}
