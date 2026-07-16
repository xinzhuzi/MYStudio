// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingSceneData } from '@/stores/media-panel-store';

const mocks = vi.hoisted(() => ({
  getStyleById: vi.fn(),
  toast: { success: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/constants/visual-styles', () => ({
  DEFAULT_STYLE_ID: 'default',
  getStyleById: mocks.getStyleById,
}));
vi.mock('@/stores/scene-store', () => ({
  TIME_PRESETS: [{ id: 'night', label: '夜晚' }],
  ATMOSPHERE_PRESETS: [{ id: 'tense', label: '紧张' }],
}));

import { usePendingSceneIntake } from './use-pending-scene-intake';

function createOptions(data: PendingSceneData) {
  const setter = () => vi.fn();
  return {
    pendingSceneData: data,
    setPendingSceneData: vi.fn(),
    scriptPromptLanguage: 'en' as const,
    currentFolderId: 'folder-1',
    resourceProjectId: 'project-1',
    addScene: vi.fn(() => 'scene-new'),
    selectScene: vi.fn(),
    onSceneCreated: vi.fn(),
    setPromptLanguage: setter(), setName: setter(), setLocation: setter(),
    setTime: setter(), setAtmosphere: setter(), setVisualPrompt: setter(),
    setTags: setter(), setNotes: setter(), setStyleId: setter(),
    setPendingViewpoints: setter(), setPendingContactSheetPrompts: setter(),
    setCurrentPageIndex: setter(), setContactSheetPrompt: setter(),
    setContactSheetPromptZh: setter(), setContactSheetLayout: setter(),
    setContactSheetAspectRatio: setter(), setExtractedViewpoints: setter(),
  };
}

describe('usePendingSceneIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStyleById.mockReturnValue({ id: 'ink' });
  });

  it('consumes pending data once and initializes the created scene and first contact-sheet page', () => {
    const options = createOptions({
      name: '  古桥  ', location: '  河岸  ', time: '夜晚', atmosphere: '紧张',
      styleId: 'ink', promptLanguage: 'zh', viewpoints: [{
        id: 'view-1', name: '全景', nameEn: 'Overview', shotIds: [], shotIndexes: [],
        keyProps: [], keyPropsEn: [], gridIndex: 0, pageIndex: 0,
      }],
      contactSheetPrompts: [{
        pageIndex: 0, prompt: 'prompt-en', promptZh: '提示词', viewpointIds: ['view-1'],
        gridLayout: { rows: 2, cols: 2 },
      }],
    } as PendingSceneData);

    renderHook(() => usePendingSceneIntake(options));

    expect(options.setPendingSceneData).toHaveBeenCalledWith(null);
    expect(options.addScene).toHaveBeenCalledWith(expect.objectContaining({
      name: '古桥', location: '河岸', time: 'night', atmosphere: 'tense',
      styleId: 'ink', folderId: 'folder-1', projectId: 'project-1',
    }));
    expect(options.selectScene).toHaveBeenCalledWith('scene-new');
    expect(options.setContactSheetPrompt).toHaveBeenCalledWith('prompt-en');
    expect(options.setContactSheetLayout).toHaveBeenCalledWith('2x2');
    expect(options.setContactSheetAspectRatio).toHaveBeenCalledWith('16:9');
  });

  it('fills partial form data without creating a scene', () => {
    const options = createOptions({ name: '孤桥', visualPrompt: '晨雾' } as PendingSceneData);
    renderHook(() => usePendingSceneIntake(options));
    expect(options.addScene).not.toHaveBeenCalled();
    expect(options.setName).toHaveBeenCalledWith('孤桥');
    expect(options.setLocation).toHaveBeenCalledWith('');
    expect(options.setVisualPrompt).toHaveBeenCalledWith('晨雾');
  });

  it('does not create the same pending scene twice under StrictMode', () => {
    const options = createOptions({ name: '古桥', location: '河岸' } as PendingSceneData);
    renderHook(() => usePendingSceneIntake(options), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    expect(options.addScene).toHaveBeenCalledTimes(1);
    expect(options.setPendingSceneData).toHaveBeenCalledTimes(1);
  });
});
