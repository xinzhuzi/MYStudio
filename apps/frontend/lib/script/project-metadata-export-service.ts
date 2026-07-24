import { useScriptStore } from '@/stores/script-store';

/**
 * 导出项目元数据为 Markdown 格式
 * 类似 Cursor 的 .cursorrules，作为项目的知识库
 */
export function exportProjectMetadata(projectId: string): string {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  if (!project) return '# 错误\n\n项目不存在';

  const background = project.projectBackground;
  const episodes = project.episodeRawScripts;
  const scriptData = project.scriptData;
  const meta = project.seriesMeta;
  const sections: string[] = [];
  const title = meta?.title || background?.title || scriptData?.title || '未命名剧本';
  sections.push(`# 《${title}》`, '', '## 基本信息');
  const genre = meta?.genre || background?.genre;
  const era = meta?.era || background?.era;
  if (genre) sections.push(`- **类型**：${genre}`);
  if (era) sections.push(`- **时代**：${era}`);
  sections.push(`- **总集数**：${episodes.length}集`);
  if (meta?.language || scriptData?.language) sections.push(`- **语言**：${meta?.language || scriptData?.language}`);
  if (meta?.logline) sections.push(`- **Logline**：${meta.logline}`);
  if (meta?.centralConflict) sections.push(`- **核心冲突**：${meta.centralConflict}`);
  if (meta?.themes?.length) sections.push(`- **主题**：${meta.themes.join('、')}`);
  sections.push('');
  const outline = meta?.outline || background?.outline;
  if (outline) sections.push('## 故事大纲', outline, '');
  const worldNotes = meta?.worldNotes || background?.worldSetting;
  if (worldNotes || meta?.powerSystem || meta?.socialSystem) {
    sections.push('## 世界观设定');
    if (worldNotes) sections.push(worldNotes);
    if (meta?.socialSystem) sections.push(`- **社会体系**：${meta.socialSystem}`);
    if (meta?.powerSystem) sections.push(`- **力量体系**：${meta.powerSystem}`);
    sections.push('');
  }
  if (meta?.geography?.length) {
    sections.push('## 地理设定');
    for (const g of meta.geography) sections.push(`- **${g.name}**：${g.desc}`);
    sections.push('');
  }
  if (meta?.keyItems?.length) {
    sections.push('## 关键物品');
    for (const item of meta.keyItems) sections.push(`- **${item.name}**：${item.desc}`);
    sections.push('');
  }
  if (background?.characterBios) sections.push('## 主要人物', background.characterBios, '');
  const characters = meta?.characters || scriptData?.characters;
  if (characters?.length) {
    sections.push('## 角色列表');
    for (const char of characters) {
      sections.push(`### ${char.name}`);
      if (char.gender) sections.push(`- 性别：${char.gender}`);
      if (char.age) sections.push(`- 年龄：${char.age}`);
      if (char.role) sections.push(`- 身份：${char.role}`);
      if (char.personality) sections.push(`- 性格：${char.personality}`);
      if (char.traits) sections.push(`- 特质：${char.traits}`);
      if (char.relationships) sections.push(`- 关系：${char.relationships}`);
      if (char.skills) sections.push(`- 技能：${char.skills}`);
      sections.push('');
    }
  }
  if (meta?.factions?.length) {
    sections.push('## 阵营/势力');
    for (const f of meta.factions) sections.push(`- **${f.name}**：${f.members.join('、')}`);
    sections.push('');
  }
  sections.push('## 剧集大纲');
  for (const ep of episodes) {
    sections.push(`### 第${ep.episodeIndex}集：${ep.title.replace(/^第\d+集[：:]？/, '')}`);
    if (ep.synopsis) sections.push(ep.synopsis);
    if (ep.keyEvents?.length) {
      sections.push('**关键事件：**');
      for (const event of ep.keyEvents) sections.push(`- ${event}`);
    }
    sections.push(`> 本集包含 ${ep.scenes.length} 个场景`, '');
  }
  sections.push('---', `*导出时间：${new Date().toLocaleString('zh-CN')}*`);
  return sections.join('\n');
}
