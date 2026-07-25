// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Character Bible Service
 * Manages character consistency across scenes
 */

import type { AICharacter } from '../types';

/**
 * Extended character data with analysis info
 */
export interface CharacterBible {
  id: string;
  screenplayId: string;
  
  // Basic info
  name: string;
  type: AICharacter['type'];
  
  // Visual description (for image generation)
  visualTraits: string;
  
  // Style tokens for consistency
  styleTokens: string[];
  
  // Color palette
  colorPalette: string[];
  
  // Chinese personality description
  personality: string;
  
  // Reference images
  referenceImages: ReferenceImage[];
  
  // Generated three-view images (for consistency)
  threeViewImages?: {
    front?: string;
    side?: string;
    back?: string;
  };
  
  // Metadata
  createdAt: number;
  updatedAt: number;
}

export interface ReferenceImage {
  id: string;
  url: string;
  analysisResult?: any;
  isPrimary: boolean;
}

/**
 * Character Bible Manager
 * Handles character storage and consistency
 */
export class CharacterBibleManager {
  private characters: Map<string, CharacterBible> = new Map();
  
  /**
   * Add a new character
   */
  addCharacter(character: Omit<CharacterBible, 'id' | 'createdAt' | 'updatedAt'>): CharacterBible {
    const id = `char_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    
    const newCharacter: CharacterBible = {
      ...character,
      id,
      createdAt: now,
      updatedAt: now,
    };
    
    this.characters.set(id, newCharacter);
    return newCharacter;
  }
  
  /**
   * Update character
   */
  updateCharacter(id: string, updates: Partial<CharacterBible>): CharacterBible | null {
    const existing = this.characters.get(id);
    if (!existing) return null;
    
    const updated: CharacterBible = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    
    this.characters.set(id, updated);
    return updated;
  }
  
  /**
   * Get character by ID
   */
  getCharacter(id: string): CharacterBible | null {
    return this.characters.get(id) || null;
  }
  
  /**
   * Get all characters for a screenplay
   */
  getCharactersForScreenplay(screenplayId: string): CharacterBible[] {
    return Array.from(this.characters.values())
      .filter(c => c.screenplayId === screenplayId);
  }
  
  /**
   * Delete character
   */
  deleteCharacter(id: string): boolean {
    return this.characters.delete(id);
  }
  
  /**
   * Build character prompt string for scene generation
   * Combines visual traits from all characters
   */
  buildCharacterPrompt(characterIds: string[]): string {
    const characters = characterIds
      .map(id => this.characters.get(id))
      .filter((c): c is CharacterBible => c !== null);
    
    if (characters.length === 0) return '';
    
    return characters
      .map(c => `[${c.name}]: ${c.visualTraits}`)
      .join('; ');
  }
  
  /**
   * Build style tokens from characters
   */
  buildStyleTokens(characterIds: string[]): string[] {
    const characters = characterIds
      .map(id => this.characters.get(id))
      .filter((c): c is CharacterBible => c !== null);
    
    // Collect all unique style tokens
    const tokenSet = new Set<string>();
    for (const c of characters) {
      for (const token of c.styleTokens) {
        tokenSet.add(token);
      }
    }
    
    return Array.from(tokenSet);
  }
  
  /**
   * Create character from analysis result
   */
  createFromAnalysis(
    screenplayId: string,
    analysisResult: any,
    referenceImageUrl?: string
  ): CharacterBible {
    const referenceImages: ReferenceImage[] = [];
    
    if (referenceImageUrl) {
      referenceImages.push({
        id: `ref_${Date.now()}`,
        url: referenceImageUrl,
        analysisResult,
        isPrimary: true,
      });
    }
    
    return this.addCharacter({
      screenplayId,
      name: analysisResult.name || 'Unknown',
      type: analysisResult.type || 'other',
      visualTraits: analysisResult.visualTraits || '',
      styleTokens: analysisResult.styleTokens || [],
      colorPalette: analysisResult.colorPalette || [],
      personality: analysisResult.personality || '',
      referenceImages,
    });
  }
  
  /**
   * Export all characters for persistence
   */
  exportAll(): CharacterBible[] {
    return Array.from(this.characters.values());
  }
  
  /**
   * Import characters from persistence
   */
  importAll(characters: CharacterBible[]): void {
    this.characters.clear();
    for (const c of characters) {
      this.characters.set(c.id, c);
    }
  }
  
  /**
   * Clear all characters
   */
  clear(): void {
    this.characters.clear();
  }
}

// Singleton instance
let managerInstance: CharacterBibleManager | null = null;

/**
 * Get the singleton character bible manager
 */
export function getCharacterBibleManager(): CharacterBibleManager {
  if (!managerInstance) {
    managerInstance = new CharacterBibleManager();
  }
  return managerInstance;
}

// Convenience alias for import
export const characterBibleManager = getCharacterBibleManager();

/**
 * Generate a consistency prompt for a character
 * This is used to maintain visual consistency across scenes
 */
export function generateConsistencyPrompt(character: CharacterBible): string {
  const parts: string[] = [];
  
  // Add visual traits
  if (character.visualTraits) {
    parts.push(character.visualTraits);
  }
  
  // Add style tokens
  if (character.styleTokens.length > 0) {
    parts.push(character.styleTokens.join(', '));
  }
  
  // Add character name as identifier
  parts.push(`character: ${character.name}`);
  
  return parts.join(', ');
}

/**
 * Merge multiple character analyses to find common traits
 * Useful when analyzing multiple reference images of same character
 */
export function mergeCharacterAnalyses(analyses: any[]): Partial<CharacterBible> {
  if (analyses.length === 0) return {};
  
  if (analyses.length === 1) {
    return {
      visualTraits: analyses[0].visualTraits,
      styleTokens: analyses[0].styleTokens || [],
      colorPalette: analyses[0].colorPalette || [],
      personality: analyses[0].personality,
    };
  }
  
  // Merge visual traits by taking the longest/most detailed
  const visualTraits = analyses
    .map(a => a.visualTraits)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || '';
  
  // Merge style tokens (unique)
  const styleTokenSet = new Set<string>();
  for (const a of analyses) {
    if (a.styleTokens) {
      for (const t of a.styleTokens) {
        styleTokenSet.add(t);
      }
    }
  }
  
  // Merge color palettes (unique)
  const colorSet = new Set<string>();
  for (const a of analyses) {
    if (a.colorPalette) {
      for (const c of a.colorPalette) {
        colorSet.add(c);
      }
    }
  }
  
  return {
    visualTraits,
    styleTokens: Array.from(styleTokenSet),
    colorPalette: Array.from(colorSet),
    personality: analyses.find(a => a.personality)?.personality || '',
  };
}
