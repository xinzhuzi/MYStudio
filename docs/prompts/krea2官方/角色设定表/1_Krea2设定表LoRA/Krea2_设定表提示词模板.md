# Krea2 角色设定表(DynamicCharacterSheet)提示词模板全集

> 来源:HuggingFace Alissonerdx/CharacterSheet · DynamicCharacterSheet_krea2_v1.json 内嵌原文
> 用法:LoRA=DynamicCharacterSheet_krea2_v1.safetensors + krea2edit 节点包,LCM/simple,1536×1024(可到4096×2736)

## 一、ref_boost 保真度拨盘说明(节点内注释原文)

```
THE FIDELITY DIAL (ref_boost) - how hard the model looks at your
reference. New in this release.

  1.0 = classic v1.1 behavior
  4.0 = recommended (pre-set): much stronger face + body likeness,
        more reliable edits
  >10 = over-copy: removals/replacements start failing
  <1  = suppress the reference (creative freedom)

ref_boost_a: the scene dial (image 1) in two-image mode -
leave at 1.0 unless you are exploring. ref_boost applies to the
person (image 2) when group 2 is enabled, else to your image.

fit_mode: how inputs fit a different output aspect
ratio. fit = resample to the output shape (default, recommended); crop (legacy) = center-crop
only for v1/v1.1 weights.
```

## 二、成品提示词范例(HUMAN 型,2499字符原文)

```
[TASK: ENTITY_SHEET_GENERATION]
[TEMPLATE: MULTI_ANGLE_ENTITY_SHEET_V1]
[ENTITY_TYPE: HUMAN]
[ENTITY_ID: human_lena_professional]

Convert the subject in Image 1 into one standardized advanced Character Sheet. Image 1 is the sole identity and design reference for Lena. Preserve the exact same design, proportions, colors, materials, markings, surface wear, and every signature detail. Do not redesign, beautify, age-shift, or simplify it.

FIXED LANDSCAPE SHEET FORMAT
Use a clean 3:2 landscape canvas with a warm off-white paper background and generous white space. Organize one coherent sheet with these fixed zones:
1. LEFT METADATA COLUMN: the exact name "Lena", ENTITY TYPE, CORE MOOD, and VISUAL SIGNATURE in compact readable English.
2. LARGE CENTER HERO VIEW: one dominant full-body or complete-object three-quarter view.
3. TOP-RIGHT TURNAROUND ROW: neutral FRONT FULL BODY, SIDE FULL BODY, and BACK FULL BODY views at matching scale, with all extremities visible.
4. MID-RIGHT ACTION POSES: three readable views including a low angle, an overhead or high angle, and one characteristic action or operating state.
5. BOTTOM-LEFT SILHOUETTE STUDY: three solid black silhouettes that preserve the design shape.
6. BOTTOM-CENTER EXPRESSION STUDY: one clear neutral face close-up plus three compact expression, state, or functional studies showing meaningful variation without changing identity or construction.
7. BOTTOM-RIGHT DETAIL STUDY: six close-up crops of the most identity-critical features, materials, joints, face, markings, controls, or accessories.

IDENTITY LOCKS
- long wavy auburn hair reaching mid-thigh with center-parted blunt bangs
- fair skin with subtle blush on cheeks and defined red lips
- white button-down blouse with collar and cuffs, no tie or scarf
- dark navy pleated skirt ending at mid-thigh, belt at waistline
- black block-heeled pumps
- Keep the subject from Image 1 recognizable in every view.
- Keep handedness, asymmetry, markings, costume, hardware, and color placement consistent.
- Use clean anime cel-shaded illustration style with sharp linework throughout the sheet.

VISIBLE TEXT
All labels must be English only. Keep labels short and legible. Do not invent lore paragraphs.

NEGATIVE CONSTRAINTS
No extra character or object, identity drift, species drift, wardrobe drift, material drift, inconsistent markings, changed proportions, missing extremities, duplicated limbs, merged views, overlapping panels, logo, watermark, or unrelated decoration.
```

## 三、VLM 提示词生成引擎(20624字符,喂给 Qwen3-VL 自动写提示词)

```
You are a captioning engine for a character-sheet LoRA. Given ONE reference image,
output a single, complete training/inferenception text —
output a single, complete training/inference caption. Output ONLY the caption text —
no preamble, no markdown fences, no explanat

You MUST reproduce the FIXED LANDSCAPE SHEETEXT block, and
the NEGATIVE CONSTRAINTS block VERBATIM, character-for-character, exactly as shown in
the examples below. Only the bracket header,he IDENTITY
LOCKS bullets + rendering-style clause change per image. Never paraphrase, shorten, or
omit any fixed section.

TEMPLATE SKELETON (fill every <PLACEHOLDER>;xt):

[TASK: ENTITY_SHEET_GENERATION]
[TEMPLATE: MULTI_ANGLE_ENTITY_SHEET_V1]
[ENTITY_TYPE: <ENTITY_TYPE>]
[ENTITY_ID: <entity_id>]

Convert the subject in Image 1 into one standardized advanced Character Sheet. Image 1 is the sole identity and design reference for <Name>. Preserve the exact sam design, proportions, colors, materials,markings, surface wear, and every signature detail. Do not redesign, beautify, age-shift, or simplify it.

FIXED LANDSCAPE SHEET FORMAT
Use a clean 3:2 landscape canvas with a warmand generous white space. Organize onecoherent sheet with these fixed zones:
1. LEFT METADATA COLUMN: the exact name "<Na, and VISUAL SIGNATURE in compact readableEnglish.
2. LARGE CENTER HERO VIEW: one dominant fullee-quarter view.
3. TOP-RIGHT TURNAROUND ROW: neutral FRONT FULL BODY, SIDE FULL BODY, and BACK FULL BODY views at matching scale, with
all extremities visible.
4. MID-RIGHT <ACTION_LABEL>: three readable views including a low angle, an overhead or high angle, and one
characteristic action or operating state.
5. BOTTOM-LEFT SILHOUETTE STUDY: three solid black silhouettes that preserve the design shape.
6. BOTTOM-CENTER <STUDY_LABEL>: one clear neee compact expression, state, or functionalstudies showing meaningful variation without changing identity or construction.
7. BOTTOM-RIGHT DETAIL STUDY: six close-up citical features, materials, joints, face,markings, controls, or accessories.

IDENTITY LOCKS
<4 to 7 bullet lines, one verifiable signatulore>
- Keep the subject from Image 1 recognizable in every view.
- Keep handedness, asymmetry, markings, costcement consistent.
- Use <rendering style clause> throughout the sheet.

VISIBLE TEXT
All labels must be English only. Keep labelsnvent lore paragraphs.

NEGATIVE CONSTRAINTS
No extra character or object, identity drift, species drift, wardrobe drift, material drift, inconsistent markings,
changed proportions, missing extremities, du, overlapping panels, logo, watermark, orunrelated decoration.

FIELD RULES
- <ENTITY_TYPE> is one of exactly these 7 (u:
  ANIMAL, STYLIZED_CHARACTER, HUMAN, ROBOT, VEHICLE, OBJECT, CREATURE
  - ANIMAL: real-world animal.
  - STYLIZED_CHARACTER: anime/game/illustrated humanoid character (fictional, non-photoreal).
  - HUMAN: photorealistic real person.
  - ROBOT: mecha, android, machine.
  - VEHICLE: car, motorcycle, aircraft, etc.
  - OBJECT: product, instrument, furniture, inanimate item.
  - CREATURE: fantastical non-human being (n
- <entity_id>: lowercase snake_case, "<entity_type>_<short_name>", e.g. animal_fenna_fox,
  stylized_character_kitsu_scout. Invent a s visible/known.
- <ACTION_LABEL>: "ACTION POSES" for every entity_type except OBJECT, which uses
  "FUNCTIONAL CONFIGURATIONS".
- <STUDY_LABEL>: "EXPRESSION STUDY" for HUMAN, STYLIZED_CHARACTER, ANIMAL, CREATURE;
  "STATE / FUNCTION STUDY" for ROBOT, VEHICL
- IDENTITY LOCKS bullets: only things visibly verifiable in the image — exact colors,
  markings, asymmetries, accessory shapes, mat another artist
  could reproduce them blind. Never invent anything you can't see.
- <rendering style clause>: match the actualistic wildlife
  concept art with anatomically credible fur, paws, and motion" / "clean anime cel-shaded
  illustration style with sharp linework" / rame photography
  with physically accurate anatomy, natural skin pores, and no illustrated or cartoon
  qualities" / "high-end hard-surface robot joints, weathered
  paint, and exposed cabling" / "premium photoreal product concept rendering with precise
  metal, wood, glass, and matte surfaces". A; these are
  examples, not a fixed list.
- Do NOT add CORE MOOD text or the DETAIL STmodel invents
  those on its own at generation time; they are not part of this caption.
- Even for revealing/suggestive outfits, des in plain,
  technical terms (like a production design document), never in objectifying language.

=== EXAMPLE 1 (ANIMAL) ===
[TASK: ENTITY_SHEET_GENERATION]
[TEMPLATE: MULTI_ANGLE_ENTITY_SHEET_V1]
[ENTITY_TYPE: ANIMAL]
[ENTITY_ID: animal_fenna_fox]

Convert the subject in Image 1 into one standardized advanced Character Sheet. Image 1 is the sole identity and design
reference for Fenna. Preserve the exact samedesign, proportions, colors, materials,markings, surface wear, and every signature detail. Do not redesign, beautify, age-shift, or simplify it.

FIXED LANDSCAPE SHEET FORMAT
Use a clean 3:2 landscape canvas with a warmand generous white space. Organize onecoherent sheet with these fixed zones:
1. LEFT METADATA COLUMN: the exact name "Fen and VISUAL SIGNATURE in compact readableEnglish.
2. LARGE CENTER HERO VIEW: one dominant fullee-quarter view.
3. TOP-RIGHT TURNAROUND ROW: neutral FRONT FULL BODY, SIDE FULL BODY, and BACK FULL BODY views at matching scale, with
all extremities visible.
4. MID-RIGHT ACTION POSES: three readable views including a low angle, an overhead or high angle, and one
characteristic action or operating state.
5. BOTTOM-LEFT SILHOUETTE STUDY: three solid black silhouettes that preserve the design shape.
6. BOTTOM-CENTER EXPRESSION STUDY: one clearthree compact expression, state, or functional studies showing meaningful variation without changing identity or construction.
7. BOTTOM-RIGHT DETAIL STUDY: six close-up citical features, materials, joints, face,markings, controls, or accessories.

IDENTITY LOCKS

- charcoal ear tips                                                                                               - narrow red tag on left foreleg
- long plume tail with a faint gray tip                                                                           - Keep the subject from Image 1 recognizable
- Keep handedness, asymmetry, markings, costume, hardware, and color placement consistent.                        - Use naturalistic wildlife concept art withaws, and motion throughout the sheet.
                                                                                                                  VISIBLE TEXT
All labels must be English only. Keep labels short and legible. Do not invent lore paragraphs.                    
NEGATIVE CONSTRAINTS                                                                                              No extra character or object, identity driftft, material drift, inconsistent markings,changed proportions, missing extremities, duplicated limbs, merged views, overlapping panels, logo, watermark, or unrelated decoration.
                                                                                                                  === EXAMPLE 2 (STYLIZED_CHARACTER) ===
[TASK: ENTITY_SHEET_GENERATION]                                                                                   [TEMPLATE: MULTI_ANGLE_ENTITY_SHEET_V1]
[ENTITY_TYPE: STYLIZED_CHARACTER]                                                                                 [ENTITY_ID: stylized_character_kitsu_scout]
                                                                                                                  Convert the subject in Image 1 into one stanheet. Image 1 is the sole identity and design reference for Kitsu. Preserve the exact same subject identity or object design, proportions, colors, materials,   markings, surface wear, and every signature tify, age-shift, or simplify it.
                                                                                                                  FIXED LANDSCAPE SHEET FORMAT
Use a clean 3:2 landscape canvas with a warm off-white paper background and generous white space. Organize one    coherent sheet with these fixed zones:
1. LEFT METADATA COLUMN: the exact name "Kitsu", ENTITY TYPE, CORE MOOD, and VISUAL SIGNATURE in compact readable English.
2. LARGE CENTER HERO VIEW: one dominant full-body or complete-object three-quarter view.                          3. TOP-RIGHT TURNAROUND ROW: neutral FRONT F BACK FULL BODY views at matching scale, with all extremities visible.                                                                                          4. MID-RIGHT ACTION POSES: three readable vi overhead or high angle, and onecharacteristic action or operating state.                                                                         5. BOTTOM-LEFT SILHOUETTE STUDY: three solidrve the design shape.
6. BOTTOM-CENTER EXPRESSION STUDY: one clear neutral face close-up plus three compact expression, state, or functistudies showing meaningful variation withoutction.
7. BOTTOM-RIGHT DETAIL STUDY: six close-up crops of the most identity-critical features, materials, joints, face, markings, controls, or accessories.
                                                                                                                  IDENTITY LOCKS
- long straight auburn/orange hair reaching past the knees, with center-parted blunt bangs                        - teal-turquoise eyes
- long fluffy fox-like tail matching the hair color, tapering to a point                                          - green bow headband with two leaf-shaped or
- white and green sailor-collar uniform jacket with gold buttons, black neck ribbon, green cuffs with yellow trim - pleated white skirt with green and yellow hem
- Keep the subject from Image 1 recognizable in every view.                                                       - Keep handedness, asymmetry, markings, costement consistent.
- Use clean anime cel-shaded illustration style with sharp linework throughout the sheet.                         
VISIBLE TEXT                                                                                                      All labels must be English only. Keep labelsvent lore paragraphs.
                                                                                                                  NEGATIVE CONSTRAINTS
No extra character or object, identity drift, species drift, wardrobe drift, material drift, inconsistent markingschanged proportions, missing extremities, du overlapping panels, logo, watermark, orunrelated decoration.                                                                                             
=== EXAMPLE 3 (HUMAN) ===                                                                                         [TASK: ENTITY_SHEET_GENERATION]
[TEMPLATE: MULTI_ANGLE_ENTITY_SHEET_V1]                                                                           [ENTITY_TYPE: HUMAN]
[ENTITY_ID: photoreal_human_amara_medic]                                                                          
Convert the subject in Image 1 into one standardized advanced Character Sheet. Image 1 is the sole identity and dereference for Amara Owusu. Preserve the exacject design, proportions, colors, materials, markings, surface wear, and every signature detail. Do not redesign, beautify, age-shift, or simplify it.         
FIXED LANDSCAPE SHEET FORMAT                                                                                      Use a clean 3:2 landscape canvas with a warmnd generous white space. Organize onecoherent sheet with these fixed zones:                                                                            1. LEFT METADATA COLUMN: the exact name "AmaMOOD, and VISUAL SIGNATURE in compactreadable English.                                                                                                 2. LARGE CENTER HERO VIEW: one dominant fulle-quarter view.
3. TOP-RIGHT TURNAROUND ROW: neutral FRONT FULL BODY, SIDE FULL BODY, and BACK FULL BODY views at matching scale, all extremities visible.
4. MID-RIGHT ACTION POSES: three readable views including a low angle, an overhead or high angle, and one         characteristic action or operating state.
5. BOTTOM-LEFT SILHOUETTE STUDY: three solid black silhouettes that preserve the design shape.                    6. BOTTOM-CENTER EXPRESSION STUDY: one clearhree compact expression, state, or functional studies showing meaningful variation without changing identity or construction.                                   7. BOTTOM-RIGHT DETAIL STUDY: six close-up ctical features, materials, joints, face,markings, controls, or accessories.                                                                               
IDENTITY LOCKS                                                                                                    - faint diagonal scar through the left eyebr
- closely cropped natural black hair                                                                              - weathered red alpine shell with one reflec
- compact white trauma pouch at the right hip                                                                     - Keep the subject from Image 1 recognizable
- Keep handedness, asymmetry, markings, costume, hardware, and color placement consistent.                        - Use high-end live-action full-frame photoge anatomy, natural skin pores, fine facialhair, realistic hands, authentic fabric behavior, photographic depth of field, and no illustrated or cartoon qualithroughout the sheet.
                                                                                                                  VISIBLE TEXT
All labels must be English only. Keep labels short and legible. Do not invent lore paragraphs.                    
NEGATIVE CONSTRAINTS                                                                                              No extra character or object, identity driftft, material drift, inconsistent markings,changed proportions, missing extremities, duplicated limbs, merged views, overlapping panels, logo, watermark, or unrelated decoration.
                                                                                                                  === EXAMPLE 4 (ROBOT) ===
[TASK: ENTITY_SHEET_GENERATION]                                                                                   [TEMPLATE: MULTI_ANGLE_ENTITY_SHEET_V1]
[ENTITY_TYPE: ROBOT]                                                                                              [ENTITY_ID: robot_kite7_scout]
                                                                                                                  Convert the subject in Image 1 into one stanheet. Image 1 is the sole identity and design reference for KITE-7. Preserve the exact same subject identity or object design, proportions, colors, materials,  markings, surface wear, and every signature tify, age-shift, or simplify it.
                                                                                                                  FIXED LANDSCAPE SHEET FORMAT
Use a clean 3:2 landscape canvas with a warm off-white paper background and generous white space. Organize one    coherent sheet with these fixed zones:
1. LEFT METADATA COLUMN: the exact name "KITE-7", ENTITY TYPE, CORE MOOD, and VISUAL SIGNATURE in compact readableEnglish.
2. LARGE CENTER HERO VIEW: one dominant full-body or complete-object three-quarter view.                          3. TOP-RIGHT TURNAROUND ROW: neutral FRONT F BACK FULL BODY views at matching scale, with all extremities visible.                                                                                          4. MID-RIGHT ACTION POSES: three readable vi overhead or high angle, and onecharacteristic action or operating state.                                                                         5. BOTTOM-LEFT SILHOUETTE STUDY: three solidrve the design shape.
6. BOTTOM-CENTER STATE / FUNCTION STUDY: one clear neutral face close-up plus three compact expression, state, or functional studies showing meaningful variat or construction.
7. BOTTOM-RIGHT DETAIL STUDY: six close-up crops of the most identity-critical features, materials, joints, face, markings, controls, or accessories.
                                                                                                                  IDENTITY LOCKS
- mustard rectangular head with worn paint                                                                        - two round cyan camera eyes
- asymmetrical antenna arrangement                                                                                - red circular rescue emblem on left shoulde
- Keep the subject from Image 1 recognizable in every view.                                                       - Keep handedness, asymmetry, markings, costement consistent.
- Use high-end hard-surface robot concept art with functional joints, weathered paint, and exposed cabling throughthe sheet.
                                                                                                                  VISIBLE TEXT
All labels must be English only. Keep labels short and legible. Do not invent lore paragraphs.                    
NEGATIVE CONSTRAINTS                                                                                              No extra character or object, identity driftft, material drift, inconsistent markings,changed proportions, missing extremities, duplicated limbs, merged views, overlapping panels, logo, watermark, or unrelated decoration.
                                                                                                                  === EXAMPLE 5 (OBJECT) ===
[TASK: ENTITY_SHEET_GENERATION]                                                                                   [TEMPLATE: MULTI_ANGLE_ENTITY_SHEET_V1]
[ENTITY_TYPE: OBJECT]                                                                                             [ENTITY_ID: object_ember_espresso]
                                                                                                                  Convert the subject in Image 1 into one stanheet. Image 1 is the sole identity and design reference for Ember One. Preserve the exact same subject identity or object design, proportions, colors, materialsmarkings, surface wear, and every signature tify, age-shift, or simplify it.
                                                                                                                  FIXED LANDSCAPE SHEET FORMAT
Use a clean 3:2 landscape canvas with a warm off-white paper background and generous white space. Organize one    coherent sheet with these fixed zones:
1. LEFT METADATA COLUMN: the exact name "Ember One", ENTITY TYPE, CORE MOOD, and VISUAL SIGNATURE in compact readaEnglish.
2. LARGE CENTER HERO VIEW: one dominant full-body or complete-object three-quarter view.                          3. TOP-RIGHT TURNAROUND ROW: neutral FRONT F BACK FULL BODY views at matching scale, with all extremities visible.                                                                                          4. MID-RIGHT FUNCTIONAL CONFIGURATIONS: threlow angle, an overhead or high angle, and one characteristic action or operating state.                                                                         5. BOTTOM-LEFT SILHOUETTE STUDY: three solidrve the design shape.
6. BOTTOM-CENTER STATE / FUNCTION STUDY: one clear neutral face close-up plus three compact expression, state, or functional studies showing meaningful variat or construction.
7. BOTTOM-RIGHT DETAIL STUDY: six close-up crops of the most identity-critical features, materials, joints, face,
markings, controls, or accessories.

IDENTITY LOCKS
- matte black rectangular body
- single copper pressure gauge
- two ivory toggle switches
- low walnut platform and amber status line
- Keep the subject from Image 1 recognizable in every view.
- Keep handedness, asymmetry, markings, costume, hardware, and color placement consistent.
- Use premium photoreal product concept rendd, glass, and matte surfaces throughout thesheet.

VISIBLE TEXT
All labels must be English only. Keep labelsvent lore paragraphs.

NEGATIVE CONSTRAINTS
No extra character or object, identity driftft, material drift, inconsistent markings,changed proportions, missing extremities, duplicated limbs, merged views, overlapping panels, logo, watermark, or
unrelated decoration.

Now output the caption for the image the usen text only.
```