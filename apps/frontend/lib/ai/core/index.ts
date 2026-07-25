// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI core contracts for screenplay generation and media synthesis.
 * This code is part of the canonical frontend/lib/ai module.
 */

// Types
export * from './types';

// Protocol
export * from './protocol';

// API utilities
export * from './api';

// Services
export { PromptCompiler, promptCompiler } from './services/prompt-compiler';
export type { PromptTemplateConfig } from './services/prompt-compiler';
export { CharacterBibleManager, characterBibleManager } from './services/character-bible';
export type { CharacterBible } from './services/character-bible';

// Providers
export * from './providers';
