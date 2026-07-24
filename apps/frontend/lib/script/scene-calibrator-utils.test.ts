import { describe, expect, it } from 'vitest';
import {
  cleanLocationString,
  extractLocationFromHeader,
  extractTimeFromHeader,
  normalizeLocation,
} from './scene-calibrator-utils';

describe('scene calibrator pure helpers', () => {
  it('parses location and time markers without changing ordering', () => {
    expect(extractLocationFromHeader('1-1 夜 内 沪上 张家')).toBe('沪上 张家');
    expect(extractTimeFromHeader('1-1 夜 内 沪上 张家')).toBe('夜');
    expect(extractTimeFromHeader('未知地点')).toBe('日');
  });

  it('removes trailing metadata and normalizes matching keys', () => {
    expect(cleanLocationString('张家（内） 人物：张明 时间：夜')).toBe('张家（内）');
    expect(normalizeLocation(' 张家（内） ')).toBe('张家内');
  });
});
