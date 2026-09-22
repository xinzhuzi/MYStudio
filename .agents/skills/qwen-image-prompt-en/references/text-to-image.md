# Text-to-Image prompts

Qwen-Image-2.1 accepts two prompt styles. Pick by scene complexity, not by taste.

## When to use which style

| Style | Shape | Use for |
|---|---|---|
| **Compact** | 1–3 fluent sentences | A single clear subject: a portrait, an object, a scene. Community testing on the same family measured *better* composition from 31 words than from 82 — extra clauses dilute priority. |
| **Long observational** | One English paragraph, ~20 sentences / 300–500 words | Posters, layouts, UI mockups, infographics, storyboards, any scene with many elements or precise placement. This is the official PE-T2I style the Qwen team ships as its prompt rewriter. |

## Compact style

Order the sentence: **subject → environment → style → composition/camera → lighting**. Be concrete; vague praise words ("beautiful", "stunning") become noise.

```text
A ceramic teapot on a weathered wooden table, morning sidelight through a
kitchen window, shallow depth of field, muted olive and cream palette,
photorealistic product shot.
```

Portrait flow (official guidance): demographics/build → clothing, hair, accessories → face, skin, makeup → pose, gaze, hands → background, lighting, mood.

## Long observational style (official PE-T2I spec)

Write as an observer describing the finished image. Whatever the user gives you — three words or three paragraphs — you expand to roughly the same level of detail, inventing freely where the user did not commit, and reproducing exactly where they did.

Build it in eight steps:

1. **Separate fixed from free elements.** User-supplied strings, object names, counts, colors, positions, and ratios are kept *verbatim* — a count of "three" must yield exactly three. Usage notes ("4K, no noise") are reflected in the description but never echoed as words.
2. **Decide the frame.** Ratio goes in the `wh_ratio` parameter only; the description never mentions ratios, resolutions, or pixel counts. Defaults: 3:2 landscape, 2:3 portrait; 1:1 for badges/icons/album covers, 16:9 for cinematic/presentation, 9:16 for phone screens and vertical banners. Among landscapes, 16:9 suits screen destinations (blog headers, decks) and 3:2 suits photographic/print contexts.
3. **Opening sentence (~20 words).** `The image is a ⟨landscape/portrait/square⟩ ⟨style⟩ ⟨photo/poster/illustration/…⟩ of ⟨subject⟩, ⟨background and palette⟩.` The media noun is mandatory; the style word (realistic, flat-vector, watercolour, isometric…) is named here and only here.
4. **Inventory the elements.** Before writing prose, assign every element a frame position (upper-left, across the top, lower-third, in the centre…). Aim for 8–14 position phrases spread across corners, edges, and centre.
5. **Walk the frame.** For layout images: background → top band (header/sky) → body (left → centre → right, 1–2 sentences each) → bottom band (footer/ground). For a single subject: background → placement → head and face → body and clothing → held items → remaining edges. About one sentence in three should *begin* with a position phrase: "On the right side of the frame, …".
6. **Commit all text.** Every readable string goes in, in reading order, inside double quotes with its presentation: `a bold black headline across the top reads "SPRING SALE"`. Chart axes, ticks, legends, and cell values are all spelled out. Text that must stay unreadable is described as "blurred, indistinct, too small to read" — never invented as legible. Roughly a third of good images contain no text at all; do not fabricate signage.
7. **One lighting sentence.** `The lighting is …` — source, direction, quality, shadows, highlights.
8. **One closing composition sentence.** `The overall composition is/uses/feels …` — balance, palette, style, mood. Exactly one.

### Style rules throughout

- Present tense, third person, declarative. No "you", no "create", no "make sure", no "the AI should".
- Hedge what is uncertain ("appears to be", "a notebook or a tablet"); be categorical only about user-fixed elements.
- Colors carry modifiers: deep navy, muted olive, pale cream, warm terracotta. Hex codes only if the user gave them.
- Name materials: brushed metal, matte plastic, glossy ceramic, frosted glass, weathered wood.
- Enumerate instead of summarizing — never "several items". Small counts as words: three, five, twelve.
- Describe people by observable surface (build, posture, gaze, expression, clothing color and fabric). Ages as life stages ("a young adult", "in her thirties"), not numbers.
- Generic classes over brands: "a silver laptop", "a mirrorless camera".
- Photography and design vocabulary is welcome: shallow depth of field, bokeh, backlit, negative space, drop shadow.
- Keep physics consistent — shadows oppose the light, reflections match foreground objects, scale stays coherent.

## Integration with the official rewriter

If the runtime includes the official prompt rewriter (`Qwen-Image-2.1-PE-T2I`), feed it the user's short request and use its output: a JSON `{"rewritten_prompt": …, "wh_ratio": …}`. The skill's long-form rules above mirror that rewriter, so a hand-written prompt following them is equivalent.
