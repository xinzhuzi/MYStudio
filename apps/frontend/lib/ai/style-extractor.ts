// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { callFeatureMultimodalAPI } from '@/lib/ai/feature-router';
import { readImageAsBase64 } from '@/lib/image-storage';
import { prepareReferenceImageForTransfer } from '@/lib/ai/image-transfer';

export interface StyleExtractionResult {
  styleTokens: string;
  sceneTokens: string;
  category: 'real' | '3d' | '2d' | 'stop_motion';
  summaryZh: string;
}

const SYSTEM_PROMPT = `# Role
You are a world-class visual style analyst for AI image generation.

# Task
Analyze the user's input (text description and/or reference images) and extract TWO categories of keywords:

## 1. styleTokens - Pure Visual Style
ONLY visual aesthetics that define HOW things look, NOT what is shown:
- Rendering style: photorealistic, anime, 3D render, oil painting, watercolor
- Lighting: harsh sunlight, soft diffused, rim light, chiaroscuro
- Color grading: teal and orange, desaturated, warm tones, high contrast
- Texture/Material feel: film grain, matte finish, glossy, gritty
- Camera/lens: 35mm film, shallow depth of field, anamorphic lens flare
- Art direction: post-apocalyptic aesthetic, cyberpunk neon, vintage retro

## 2. sceneTokens - Scene & Composition
Physical objects, environments, poses, and composition:
- Environment: desert wasteland, neon-lit alley, classroom
- Props/objects: shotgun, welding goggles, leather jacket
- Character actions/poses: standing with arms crossed, running
- Camera angle/framing: three-quarter portrait, low angle
- Weather/atmosphere: dusty, rainy, foggy

## 3. category
Determine the overall visual category:
- "real" - photorealistic, live-action, cinematic film look
- "3d" - 3D rendered, CGI, Unreal Engine, Pixar style
- "2d" - anime, illustration, cartoon, hand-drawn, watercolor
- "stop_motion" - claymation, puppet, stop-motion

# Rules
- ALL tokens must be in English
- Use comma-separated phrases (2-5 words each)
- styleTokens should be REUSABLE across different subjects (characters, scenes)
- sceneTokens are SPECIFIC to particular content
- If input is only reference images with no text, describe the style you observe
- summaryZh is a 1-2 sentence Chinese summary of the overall style

# Output Format
Return RAW JSON (no markdown):
{
  "styleTokens": "token1, token2, ...",
  "sceneTokens": "token1, token2, ...",
  "category": "real",
  "summaryZh": "中文简述"
}`;

async function resolveImageUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  const dataUrl = await readImageAsBase64(src);
  return dataUrl || src;
}

export async function extractStyleTokens(
  textPrompt: string,
  imageUrls: string[] = [],
): Promise<StyleExtractionResult> {
  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  const userText = textPrompt.trim()
    ? `Please analyze this style description and extract styleTokens / sceneTokens:\n\n${textPrompt}`
    : 'Please analyze the reference image(s) below and extract styleTokens / sceneTokens.';
  contentParts.push({ type: 'text', text: userText });

  for (const url of imageUrls.slice(0, 3)) {
    const dataUrl = await resolveImageUrl(url);
    if (dataUrl) {
      const transferImage = await prepareReferenceImageForTransfer(dataUrl);
      contentParts.push({ type: 'image_url', image_url: { url: transferImage } });
    }
  }

  const content = await callFeatureMultimodalAPI('image_understanding', [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: contentParts },
  ], { temperature: 0.3, responseFormat: 'json_object' });
  const cleanContent = content.replace(/```json\s*|\s*```/g, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleanContent);
  } catch {
    console.error('[StyleExtractor] Failed to parse JSON:', content);
    throw new Error('AI 返回的格式无法解析');
  }

  const result: StyleExtractionResult = {
    styleTokens: String(parsed.styleTokens || '').trim(),
    sceneTokens: String(parsed.sceneTokens || '').trim(),
    category: ['real', '3d', '2d', 'stop_motion'].includes(parsed.category) ? parsed.category : '2d',
    summaryZh: String(parsed.summaryZh || parsed.summary_zh || '').trim(),
  };

  console.log('[StyleExtractor] Extracted:', {
    styleTokens: `${result.styleTokens.substring(0, 80)}...`,
    sceneTokens: `${result.sceneTokens.substring(0, 80)}...`,
    category: result.category,
  });

  return result;
}
