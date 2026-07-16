// 更新 DOCS_MAINTENANCE.md 中纯文本文件名引用为带子目录的路径
// 用法: node scripts/docs-fix-plaintext-refs.mjs --dry-run | --write
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const mode = process.argv[2] || '--dry-run';

// 复用 docs-relocate.mjs 的归类映射
const mapping = {
  'WORKFLOW_GUIDE.md': 'workflow', 'WORKFLOW_STAGE_OPERATIONS.md': 'workflow',
  'WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md': 'workflow', 'WORKFLOW_ASSET_GENERATION_OPERATIONS.md': 'workflow',
  'WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md': 'workflow', 'OVERVIEW_PANEL_GUIDE.md': 'workflow',
  'OVERVIEW_PANEL_OPERATIONS.md': 'workflow', 'SCRIPT_FORMAT_EXAMPLE.md': 'workflow',
  'art-styles.md': 'assets', 'art-styles.en.md': 'assets', 'VISUAL_STYLE_MANAGEMENT.md': 'assets',
  'VISUAL_MANUAL_EDITOR_OPERATIONS.md': 'assets', 'ASSET_LIBRARY_GUIDE.md': 'assets',
  'ASSET_IMPORT_AND_MANAGEMENT.md': 'assets', 'ASSET_DETAIL_OPERATIONS.md': 'assets',
  'ASSET_AUDIO_ASSIGNMENT.md': 'assets', 'ROLE_AUDIO_ASSIGNMENT_REFERENCE.md': 'assets',
  'PROPS_LIBRARY_OPERATIONS.md': 'assets', 'CHARACTER_GENERATION_GUIDE.md': 'assets',
  'SCENE_MULTIVIEW_GUIDE.md': 'assets',
  'ADVANCED_DIRECTOR_TOOLS.md': 'director', 'DIRECTOR_SHOT_CARD_REFERENCE.md': 'director',
  'DIRECTOR_VOICEOVER_REFERENCE.md': 'director', 'ANGLE_AND_QUAD_GRID_OPERATIONS.md': 'director',
  'SCLASS_GROUP_VIDEO_OPERATIONS.md': 'director', 'TRAILER_STORYBOARD_REUSE_REFERENCE.md': 'director',
  'LEGACY_SCRIPT_WORKSPACE_GUIDE.md': 'director',
  'APP_SHELL_OPERATIONS.md': 'panels', 'NAVIGATION_GUIDE.md': 'panels',
  'PROJECT_DASHBOARD_GUIDE.md': 'panels', 'PROJECT_DASHBOARD_OPERATIONS.md': 'panels',
  'SKILLS_EDITOR_GUIDE.md': 'panels', 'SKILLS_EDITOR_OPERATIONS.md': 'panels',
  'ASSIST_WORKBENCH_GUIDE.md': 'panels', 'ASSIST_WORKBENCH_OPERATIONS.md': 'panels',
  'ASSIST_WORKBENCH_PARAMETER_REFERENCE.md': 'panels', 'MEDIA_OUTPUTS_GUIDE.md': 'panels',
  'MEDIA_OUTPUTS_OPERATIONS.md': 'panels', 'EXPORT_GUIDE.md': 'panels', 'EXPORT_OPERATIONS.md': 'panels',
  'TTS_PANEL_OPERATIONS.md': 'panels', 'voicebox-voice-cloning-flow.md': 'panels',
  'APPEARANCE_THEMES.md': 'panels',
  'SETTINGS_PANEL_OPERATIONS.md': 'settings', 'API_SETTINGS_GUIDE.md': 'settings',
  'API_MANAGER_OPERATIONS.md': 'settings', 'API_PROVIDER_MODEL_TEST_REFERENCE.md': 'settings',
  'PYTHON_TTS_SETUP.md': 'settings', 'TTS_CONFIG_GUIDE.md': 'settings',
  'ADVANCED_OPTIONS_GUIDE.md': 'settings', 'IMAGE_HOST_CONFIG.md': 'settings',
  'APP_UPDATE_GUIDE.md': 'settings', 'DEVELOPMENT_MODE.md': 'settings',
  'SUPPORT_GUIDE.md': 'settings', 'LICENSE_GUIDE.md': 'settings',
  'DEVELOPER_ARCHITECTURE.md': 'engineering', 'PACKAGING_AND_SMOKE_TESTING.md': 'engineering',
  'TROUBLESHOOTING.md': 'engineering', 'THIRD_PARTY_NOTICES.md': 'engineering',
  'STORAGE_AND_DATA.md': 'engineering', 'DOCS_COVERAGE_AUDIT.md': 'engineering',
  'DOCS_MAINTENANCE.md': 'engineering',
};

// 处理目标文件（engineering 目录下的维护文档，它们引用其他文档）
const targets = [
  join(root, 'docs/engineering/DOCS_MAINTENANCE.md'),
  join(root, 'docs/engineering/DOCS_COVERAGE_AUDIT.md'),
];

let totalChanges = 0;

for (const file of targets) {
  let text = readFileSync(file, 'utf8');
  const changes = [];

  for (const [basename, dir] of Object.entries(mapping)) {
    // 匹配反引号里的纯文件名 `XXX.md`（不匹配已经是路径的）
    // 避免匹配已经是 dir/XXX.md 的
    const re = new RegExp('`' + basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`', 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
      // 检查这个匹配是否已经是路径的一部分（前面有 /）
      const before = text.slice(Math.max(0, match.index - 1), match.index);
      if (before === '/') continue; // 已经在路径中，跳过
      // 不替换 DOCS_MAINTENANCE.md 自引用（表格里列自己）
      changes.push({ file: basename, dir, index: match.index, old: match[0] });
    }
  }

  // 应用替换：`XXX.md` -> `dir/XXX.md`
  // 从后往前替换避免 index 偏移
  changes.sort((a, b) => b.index - a.index);
  for (const c of changes) {
    const replacement = '`' + c.dir + '/' + c.file + '`';
    text = text.slice(0, c.index) + replacement + text.slice(c.index + c.old.length);
  }

  console.log(`${file.replace(root + '/', '')}: ${changes.length} 处纯文本引用更新`);
  totalChanges += changes.length;

  if (mode === '--write') {
    writeFileSync(file, text, 'utf8');
  }
}

console.log(`\n总计: ${totalChanges} 处`);
if (mode !== '--write') console.log('(dry-run，加 --write 执行)');
