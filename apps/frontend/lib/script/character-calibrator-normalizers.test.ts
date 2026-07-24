import { describe, expect, it } from 'vitest';
import {
  convertToScriptCharacters,
  resolveSafeScriptCharacters,
  sortByImportance,
  type CalibratedCharacter,
} from './character-calibrator-normalizers';

const calibrated = (overrides: Partial<CalibratedCharacter> = {}): CalibratedCharacter => ({
  id: 'char-1',
  name: '张明',
  importance: 'supporting',
  appearanceCount: 3,
  nameVariants: ['张明'],
  ...overrides,
});

describe('character calibrator normalizers', () => {
  it('sorts by importance without mutating the input list', () => {
    const input = [
      calibrated({ name: '配角', importance: 'supporting', appearanceCount: 1 }),
      calibrated({ name: '主角', importance: 'protagonist', appearanceCount: 1 }),
      calibrated({ name: '高频配角', importance: 'supporting', appearanceCount: 5 }),
    ];

    expect(sortByImportance(input).map((character) => character.name)).toEqual([
      '主角', '高频配角', '配角',
    ]);
    expect(input.map((character) => character.name)).toEqual(['配角', '主角', '高频配角']);
  });

  it('merges calibrated fields into the script contract and preserves existing fields', () => {
    const result = convertToScriptCharacters(
      [calibrated({ visualPromptEn: 'new prompt', facialFeatures: 'sharp eyes' })],
      [{ id: 'script-1', name: '张明', notes: 'keep me', tags: ['existing'] }],
      'zh+en',
    );

    expect(result[0]).toMatchObject({
      id: 'char-1',
      name: '张明',
      notes: 'keep me',
      visualPromptEn: 'new prompt',
      appearance: 'sharp eyes',
      tags: ['supporting', '出场3次', 'existing'],
    });
  });

  it('recovers the first non-empty source and normalizes raw tags', () => {
    expect(resolveSafeScriptCharacters([], {
      existingCharacters: [],
      rawCharacters: [{ id: '', name: '  李四  ', tags: [] }],
    })).toEqual({
      source: 'raw',
      characters: [{ id: 'char_recovered_1', name: '李四', tags: ['minor', 'recovered'] }],
    });
  });
});
