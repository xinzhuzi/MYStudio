import type { ChangeEvent } from "react";
import { ImagePlus, X } from "lucide-react";

interface ScreenplayReferenceImagesProps {
  images: File[];
  imageUrls: string[];
  isSubmitting: boolean;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
}

export function ScreenplayReferenceImages({
  images,
  imageUrls,
  isSubmitting,
  onImageChange,
  onRemove,
}: ScreenplayReferenceImagesProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">参考图片（可选）</label>
        <span className="text-xs text-muted-foreground">{images.length}/3</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {images.map((_image, index) => (
          <div key={index} className="relative group">
            <img
              src={imageUrls[index]}
              alt={`Reference ${index + 1}`}
              className="w-16 h-16 object-cover rounded-md border"
            />
            <button
              onClick={() => onRemove(index)}
              className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {images.length < 3 && (
          <div
            className={`relative w-16 h-16 border-2 border-dashed rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors ${isSubmitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            onClick={() => {
              if (isSubmitting) return;
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.multiple = true;
              input.onchange = (event) =>
                onImageChange(event as unknown as ChangeEvent<HTMLInputElement>);
              input.click();
            }}
          >
            <ImagePlus className="h-5 w-5 pointer-events-none" />
          </div>
        )}
      </div>
    </div>
  );
}
