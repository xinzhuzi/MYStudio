// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * JSON cleaning and parsing utilities
 * Based on CineGen-AI geminiService.ts cleanJsonString
 */

/**
 * Clean JSON string from AI response
 * Removes markdown code fences and extra whitespace
 */
export function cleanJsonString(str: string): string {
  if (!str) return "{}";
  
  let cleaned = str;
  
  // Remove markdown code fences (```json ... ``` or ``` ... ```)
  cleaned = cleaned.replace(/```json\s*/gi, "");
  cleaned = cleaned.replace(/```\s*/g, "");
  
  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // Try to find JSON object or array bounds
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");
  
  // If we found valid JSON bounds, extract just the JSON
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    if (firstBracket === -1 || firstBrace < firstBracket) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1 && lastBracket !== -1 && firstBracket < lastBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }
  
  return cleaned;
}

/**
 * Safely parse JSON with cleaning
 */
export function safeParseJson<T>(str: string, fallback: T): T {
  try {
    const cleaned = cleanJsonString(str);
    return JSON.parse(cleaned) as T;
  } catch (error) {
    console.error("[JSON Parse Error]", error);
    return fallback;
  }
}

/**
 * Ensure string IDs in parsed objects
 * AI sometimes returns numeric IDs, this ensures they're strings
 */
export function normalizeIds<T extends { id?: string | number }>(
  items: T[]
): (T & { id: string })[] {
  return items.map((item) => ({
    ...item,
    id: String(item.id || ""),
  }));
}

/**
 * Clean and validate array from AI response
 */
export function cleanArray<T>(
  data: unknown,
  validator?: (item: unknown) => item is T
): T[] {
  if (!Array.isArray(data)) return [];
  
  if (validator) {
    return data.filter(validator);
  }
  
  return data as T[];
}

/**
 * Extract JSON from text that may contain extra content
 */
export function extractJson(text: string): string | null {
  // Try to find JSON object
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  
  // Try to find JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  
  return null;
}
