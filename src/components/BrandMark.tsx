import dragonEmblemUrl from "@/assets/brand/dragon-emblem-source.png";
import { cn } from "@/lib/utils";

export const BRAND_MARK_SOURCE = dragonEmblemUrl;
export const BRAND_MARK_ALT = "漫影工作室";

type BrandMarkProps = {
  className?: string;
  imageClassName?: string;
  alt?: string;
  title?: string;
};

export function BrandMark({
  className,
  imageClassName,
  alt = BRAND_MARK_ALT,
  title,
}: BrandMarkProps) {
  return (
    <span className={cn("flex items-center justify-center overflow-hidden", className)}>
      <img
        src={BRAND_MARK_SOURCE}
        alt={alt}
        title={title}
        className={cn("h-full w-full object-contain", imageClassName)}
        draggable={false}
      />
    </span>
  );
}
