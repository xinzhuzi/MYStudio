import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectEnvironmentType, type EnvironmentKeywords } from './scene-environment';

function keywords(overrides: Partial<EnvironmentKeywords>): EnvironmentKeywords {
  return {
    ancient_vehicle: [],
    ancient_indoor: [],
    ancient_outdoor: [],
    vehicle: [],
    outdoor: [],
    indoor_public: [],
    indoor_work: [],
    indoor_home: [],
    unknown: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectEnvironmentType', () => {
  it('cleans trailing character and time metadata before matching location keywords', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = detectEnvironmentType(
      '地下车库 人物：马 时间：夜',
      keywords({
        ancient_vehicle: ['马'],
        indoor_work: ['地下车库'],
      }),
    );

    expect(result).toBe('indoor_work');
  });

  it('uses the documented priority order when multiple environment keywords match', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(detectEnvironmentType(
      '车内 宫殿 庭院',
      keywords({
        ancient_vehicle: ['车内'],
        ancient_indoor: ['宫殿'],
        ancient_outdoor: ['庭院'],
        vehicle: ['车内'],
      }),
    )).toBe('ancient_vehicle');

    expect(detectEnvironmentType(
      '街道里的咖啡厅',
      keywords({
        outdoor: ['街道'],
        indoor_public: ['咖啡厅'],
      }),
    )).toBe('outdoor');
  });

  it('normalizes location casing and returns unknown when no keyword matches', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(detectEnvironmentType(
      'UBER pick-up zone',
      keywords({ vehicle: ['uber'] }),
    )).toBe('vehicle');

    expect(detectEnvironmentType(
      '未登记的抽象空间',
      keywords({ indoor_home: ['卧室'] }),
    )).toBe('unknown');
  });
});
