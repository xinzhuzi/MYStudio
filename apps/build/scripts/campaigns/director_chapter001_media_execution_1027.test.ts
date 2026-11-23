// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { bootVerification } from './director_chapter001_media_execution_1027.renderer';
import { useProjectStore } from '@/stores/project/project-store';
import { useStudioStore } from '@/stores/studio/studio-store';
describe('real seeded singleton boot contract', () => {
  it('accepts the actual default project and empty chapter/media state', async () => {
    expect(useProjectStore.getState().activeProjectId).toBe('default-project');
    await expect(bootVerification()).resolves.toMatchObject({actualSingletonsHydrated:true});
  });
  it('rejects another active project, extra project, chapter identity and media', async () => {
    const project=useProjectStore.getState(), studio=useStudioStore.getState();
    try {
      useProjectStore.setState({activeProjectId:null});
      await expect(bootVerification()).rejects.toThrow('Native session');
      useProjectStore.setState({...project,projects:[...project.projects,{...project.projects[0],id:'foreign'}]});
      await expect(bootVerification()).rejects.toThrow('Native session');
      useProjectStore.setState(project);
      useStudioStore.setState({activeChapterId:'chapter-001'});
      await expect(bootVerification()).rejects.toThrow('Native session');
      useStudioStore.setState({...studio,imageWorkflows:[{id:'foreign'} as typeof studio.imageWorkflows[number]]});
      await expect(bootVerification()).rejects.toThrow('Native session');
    } finally { useProjectStore.setState(project); useStudioStore.setState(studio); }
  });
});
