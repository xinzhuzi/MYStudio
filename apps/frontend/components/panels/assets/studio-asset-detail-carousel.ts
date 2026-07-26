import type { CarouselApi } from "@/components/ui/carousel";

export function subscribeAssetCarouselIndex(
  api: CarouselApi,
  onIndexChange: (index: number) => void,
) {
  if (!api) return;

  const updateIndex = () => onIndexChange(api.selectedScrollSnap());
  updateIndex();
  api.on("select", updateIndex);
}
