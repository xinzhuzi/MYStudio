import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Brush, Eraser, RotateCcw, WandSparkles, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";

/**
 * 蒙版局部重绘对话框(09-01-extraction-mask):
 * 双缓冲(隐藏原分辨率蒙版画布+预览画布)+画笔/擦除+笔刷大小+修改要求。
 * 交互形态参考 infinite-canvas 蒙版对话框(研究档§三),实现从零(AGPL)。
 * 确认时导出蒙版 ImageData,叠加合成在 canvas 层经 mask-export 完成。
 */
export function MaskInpaintDialog({
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
  onConfirm: (payload: { request: string; maskData: MaskCanvasSnapshot }) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ active: boolean; last: { x: number; y: number } | null }>({
    active: false,
    last: null,
  });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [request, setRequest] = useState("");
  const [brushSize, setBrushSize] = useState(80);
  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [error, setError] = useState("");

  // 开框重置 + 读原图尺寸
  useEffect(() => {
    if (!open || !imageUrl) return;
    setRequest("");
    setBrushSize(80);
    setMode("paint");
    setError("");
    setImageSize(null);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      for (const canvas of [maskCanvasRef.current, previewCanvasRef.current]) {
        if (canvas?.getContext("2d")) canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    image.src = imageUrl;
  }, [open, imageUrl]);

  const canvasPoint = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
  };

  const drawStroke = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const maskCanvas = maskCanvasRef.current;
    const context = maskCanvas?.getContext("2d");
    if (!maskCanvas || !context) return;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.strokeStyle = "#000";
    context.fillStyle = "#000";
    context.globalCompositeOperation = mode === "paint" ? "source-over" : "destination-out";
    if (!from || (from.x === to.x && from.y === to.y)) {
      context.beginPath();
      context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    renderPreview(maskCanvas, previewCanvasRef.current);
  };

  const renderPreview = (maskCanvas: HTMLCanvasElement, preview: HTMLCanvasElement | null) => {
    const context = preview?.getContext("2d");
    if (!preview || !context) return;
    context.clearRect(0, 0, preview.width, preview.height);
    // 主题 accent 金半透明预览(与导出叠加色一致)
    context.fillStyle = "rgba(246, 197, 71, 0.45)";
    context.fillRect(0, 0, preview.width, preview.height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(maskCanvas, 0, 0);
    context.globalCompositeOperation = "source-over";
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = { active: true, last: null };
    drawStroke(null, canvasPoint(event.currentTarget, event.clientX, event.clientY));
    if (mode === "paint") setError("");
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current.active) return;
    event.preventDefault();
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY);
    drawStroke(drawingRef.current.last, point);
    drawingRef.current.last = point;
  };
  const onPointerUp = () => {
    drawingRef.current = { active: false, last: null };
  };

  const resetMask = () => {
    for (const canvas of [maskCanvasRef.current, previewCanvasRef.current]) {
      const context = canvas?.getContext("2d");
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    }
    setError("");
  };

  const maskHasPaint = (): boolean => {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return false;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) return true;
    }
    return false;
  };

  const submit = () => {
    const trimmed = request.trim();
    if (!trimmed) return setError("请输入修改要求");
    if (!maskHasPaint()) return setError("请先涂抹要修改的区域");
    const canvas = maskCanvasRef.current;
    if (!canvas || !imageSize) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    onConfirm({
      request: trimmed,
      maskData: {
        data: new Uint8ClampedArray(context.getImageData(0, 0, canvas.width, canvas.height).data),
        width: canvas.width,
        height: canvas.height,
      },
    });
  };

  return (
    <Dialog open={open && Boolean(imageUrl)} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-[980px]">
        <DialogHeader>
          <DialogTitle>局部重绘「{sourceTitle}」</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_300px]">
          <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-border">
            <div className="relative inline-block max-w-full select-none overflow-hidden rounded-lg">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="block max-h-[62vh] max-w-full" draggable={false} />
              ) : null}
              {imageSize ? (
                <>
                  <canvas ref={maskCanvasRef} width={imageSize.width} height={imageSize.height} className="hidden" />
                  <canvas
                    ref={previewCanvasRef}
                    width={imageSize.width}
                    height={imageSize.height}
                    className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  />
                </>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-[360px] flex-col gap-5">
            <div className="text-sm text-muted-foreground">
              {imageSize ? `${imageSize.width} × ${imageSize.height}px` : "读取中"}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant={mode === "paint" ? "default" : "outline"} size="sm" onClick={() => setMode("paint")}>
                <Brush className="h-4 w-4" />
                画笔
              </Button>
              <Button variant={mode === "erase" ? "default" : "outline"} size="sm" onClick={() => setMode("erase")}>
                <Eraser className="h-4 w-4" />
                擦除
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">笔刷大小</span>
                <span className="font-semibold tabular-nums">{brushSize}px</span>
              </div>
              <Slider min={8} max={160} step={2} value={[brushSize]} onValueChange={(value) => setBrushSize(value[0] ?? brushSize)} />
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">修改要求</div>
              <Textarea
                rows={6}
                value={request}
                placeholder="例如:把选中区域改成金属材质,保持原图光影"
                onChange={(event) => {
                  setRequest(event.target.value);
                  setError("");
                }}
              />
              {error ? <div className="text-xs font-medium text-destructive">{error}</div> : null}
            </div>

            <div className="mt-auto flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={resetMask}>
                <RotateCcw className="h-4 w-4" />
                重置
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  <X className="h-4 w-4" />
                  取消
                </Button>
                <Button size="sm" onClick={submit}>
                  <WandSparkles className="h-4 w-4" />
                  AI 修改
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="sr-only">
          <span>蒙版重绘</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 蒙版画布快照(原分辨率 ImageData) */
export interface MaskCanvasSnapshot {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
