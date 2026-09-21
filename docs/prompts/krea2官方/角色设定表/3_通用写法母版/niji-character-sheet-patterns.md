# Niji Character Sheet Patterns

## Default Parameters

Use these as a starting point for anime character sheets:

```text
--niji 7 --ar 16:9 --s 150
```

Adjust:

- Stylize 80 to 140: suggested exploration range for stricter model sheets. Write one value, e.g. `--s 120`.
- Stylize 160 to 240: suggested exploration range for more aesthetic interpretation. Write one value, e.g. `--s 180`.
- `--ar 16:9`: full design board with multiple panels.
- `--ar 3:2`: cleaner production sheet if 16:9 feels too wide.
- Niji 7 character reference: use an ordinary Image Prompt with explicit identity traits. In Discord, put the image URL before the prompt; optional `--iw` accepts 0 to 2, default 1. This is guidance, not an identity lock.
- `--oref <image>`: Midjourney V7 only, with `--v 7`; do not combine with `--niji 7`. Niji 7 also does not support `--cref`.
- `--sref <image or code>`: use for project style consistency.
- Style Reference controls aesthetic appearance, not character identity.
- Optional Raw uses the documented `--raw` syntax where supported. Quality is left at the target model default; verify compatibility before adding a quality override.

## Master Template

```text
[Character name], [core role], [anime character design sheet], [2D cel animation production model sheet], clean white background, full body front view, full body side view, full body back view, large head close-up, eye close-up, expression close-ups, clothing detail close-ups, equipment detail close-ups, consistent proportions across all views

[Character function and first impression], [age range], [emotional pressure], [audience read in one phrase]

hair design: [hair color], [cut], [silhouette], [distinction from existing cast]

face and eyes: [beauty type], [face shape], [eye color], [eye shape], [gaze], [signature emotion]

outfit design: [faction], [uniform / clothing structure], [color system], [materials], [rank or role marks], [functional details]

details: [badges], [gloves], [belt], [device], [boots], [weapon or tool], [signature object]

layout: [front view], [side view], [back view], [head close-up], [eye close-up], [expression row], [detail panels]

style: [project visual family], clean lineart, crisp cel shading, high-end Japanese anime production art, [lighting and color mood], [world language]

--niji 7 --ar 16:9 --s [value]
```

## Female Ice Officer Template

Use for cold military women, commanders, executive officers, or elegant antagonists.

```text
[Name], stunning ice queen female military officer, [faction and rank], anime character design sheet, 2D cel animation production model sheet, clean white background, front side back turnaround, large head close-up, eye close-up, expression row, uniform detail panels, consistent proportions

beautiful young woman in her mid twenties, calm and unreachable, elegant like a ceremonial blade, quiet command presence, restrained emotion, hidden sadness under perfect discipline

hair design: [distinct hair color], refined military bob cut, precise silhouette, asymmetric side lock, clean sharp ends

face and eyes: stunning anime beauty, bishoujo but severe, porcelain pale skin, sharp refined features, narrow elegant eyes, [signature eye color], memorable gaze, no glasses

uniform design: white military officer uniform, high collar, double-breasted structured coat, sharp shoulders, black inner high-neck layer, black long gloves, black officer boots, rank insignia, formal capelet or short mantle, ceremonial but functional

details: faction badge on chest, squad insignia on shoulder, hidden hand mark under glove, waist device, compact restraint sidearm, ear communication module, polished institutional fabric, subtle accent color matching eyes

layout: full body front view standing at attention, side view, back view, large face close-up, eye close-up, collar and epaulet close-up, glove close-up, belt device close-up, boot close-up, expression row neutral / cold inspection / faint surprise / suppressed pain / command mode

style: modern Japanese anime character sheet, clean lineart, crisp cel shading, elegant military costume design, high-end anime production art, cold institutional lighting

--niji 7 --ar 16:9 --s 160
```

## Armored Trooper Template

Use for anonymous soldiers, cleanup squads, police-state units, or faction troops.

```text
[Faction] armored soldiers, faceless tactical troopers, anime character design sheet, 2D cel animation production model sheet, clean white background, front side back turnaround, helmet close-up, armor detail panels, equipment detail panels, consistent soldier proportions

human-scale armored soldiers, full body covered in [armor material and color], black flexible inner suit at joints, sealed helmet, no visible face, [faction color] scanning lines, small warning marks, disciplined formation, anonymous institutional pressure

armor design: [shape language], reinforced shoulders, chest plate with faction insignia, segmented arm guards, black gloves, armored thigh plates, knee guards, tactical boots, compact back signal unit, neck-sealed collar

helmet design: smooth full-face helmet, opaque visor, thin sensor slit, side communication module, danger indicator, scan interface glow

equipment: [non-lethal or lethal tool], restraint baton, wrist-mounted lock device, cable cuffs, drone control module, capture gear

layout: front full body, side view, back view, helmet close-up, visor close-up, chest armor close-up, wrist device close-up, weapon close-up, boot close-up, small formation pose

style: modern Japanese anime character sheet, clean lineart, crisp cel shading, detailed armor design, cinematic sci-fi anime, faction design language

--niji 7 --ar 16:9 --s 150
```

## Style Consistency Checklist

Before finalizing a prompt:

- Does the sheet format match the existing project character sheets?
- Does the character have a unique silhouette from the existing cast?
- Are hair and eye colors distinct from nearby lead characters?
- Are costume materials grounded in the faction and world logic?
- Are detail panels useful for later animation production?
- Are parameters at the end?
- Have all bracket placeholders been replaced, with a single numeric stylize value?
- If using references, are they supported by the selected model, and are identity guidance and style guidance distinguished?

## Iteration Diagnosis

- Looks too ordinary: add first-impression phrase and specific role pressure.
- Not pretty enough: strengthen beauty language early, before uniform details.
- Eyes weak: specify iris color, shape, highlight, gaze, and emotional effect.
- Outfit too generic: add rank, closures, badges, gloves, belt device, boots, and faction material.
- Too 3D: lower stylize and reinforce `2D cel animation production model sheet`, `clean lineart`, `crisp cel shading`.
- Not a usable sheet: restate `front side back turnaround`, `head close-up`, `detail panels`.

## Official Compatibility Sources

Checked 2026-09-10. These sources establish parameter behavior; the creative templates above are starting points, not generation-tested results.

- [Niji 7 announcement](https://nijijourney.com/blog/niji-7): model selection, literal prompting, Style Reference, and lack of Character Reference support.
- [Omni Reference](https://docs.midjourney.com/hc/en-us/articles/36285124473997-Omni-Reference): Midjourney V7-only reference feature.
- [Image Prompts](https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts): ordinary image guidance and Niji 7 image-weight range.
- [Style Reference](https://docs.midjourney.com/hc/en-us/articles/32180011136653-Style-Reference): aesthetic guidance rather than identity copying.
- [Raw](https://docs.midjourney.com/hc/en-us/articles/32634113811853-Raw): current `--raw` syntax.
