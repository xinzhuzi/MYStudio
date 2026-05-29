import type { StylePreset } from "./visual-styles";

const STYLE_THUMBNAIL_MODULES = import.meta.glob<string>(
  "../../assets/style-thumbnails/*.{png,jpg,jpeg,webp}",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

const STYLE_THUMBNAILS_BY_FILENAME = Object.fromEntries(
  Object.entries(STYLE_THUMBNAIL_MODULES).map(([path, source]) => [
    path.split("/").pop() ?? path,
    source,
  ]),
);

export function getStyleThumbnailSource(style: Pick<StylePreset, "thumbnail">) {
  return STYLE_THUMBNAILS_BY_FILENAME[style.thumbnail] ?? "";
}
