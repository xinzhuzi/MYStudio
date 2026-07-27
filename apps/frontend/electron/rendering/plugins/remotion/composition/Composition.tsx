// Backwards-compatible alias. The canonical shared composition lives in
// RemotionComposition.tsx; re-export it plus a stable `Composition` name for
// fixed-bundle registration so every import site resolves a single source.
export {
  RemotionComposition,
  RemotionComposition as Composition,
} from "./RemotionComposition";
