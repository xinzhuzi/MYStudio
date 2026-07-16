// docs 重组脚本：移动文件 + 验证总数
// 用法: node scripts/docs-relocate.mjs --dry-run | --move
import { readdirSync, renameSync, mkdirSync, existsSync, statSync, rmSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const docs = join(root, 'docs');
const mode = process.argv[2] || '--dry-run';

// 精确归属映射：文件名 -> 目标子目录
const mapping = {
  // workflow/ (8)
  'WORKFLOW_GUIDE.md': 'workflow',
  'WORKFLOW_STAGE_OPERATIONS.md': 'workflow',
  'WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md': 'workflow',
  'WORKFLOW_ASSET_GENERATION_OPERATIONS.md': 'workflow',
  'WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md': 'workflow',
  'OVERVIEW_PANEL_GUIDE.md': 'workflow',
  'OVERVIEW_PANEL_OPERATIONS.md': 'workflow',
  'SCRIPT_FORMAT_EXAMPLE.md': 'workflow',
  // assets/ (12)
  'art-styles.md': 'assets',
  'art-styles.en.md': 'assets',
  'VISUAL_STYLE_MANAGEMENT.md': 'assets',
  'VISUAL_MANUAL_EDITOR_OPERATIONS.md': 'assets',
  'ASSET_LIBRARY_GUIDE.md': 'assets',
  'ASSET_IMPORT_AND_MANAGEMENT.md': 'assets',
  'ASSET_DETAIL_OPERATIONS.md': 'assets',
  'ASSET_AUDIO_ASSIGNMENT.md': 'assets',
  'ROLE_AUDIO_ASSIGNMENT_REFERENCE.md': 'assets',
  'PROPS_LIBRARY_OPERATIONS.md': 'assets',
  'CHARACTER_GENERATION_GUIDE.md': 'assets',
  'SCENE_MULTIVIEW_GUIDE.md': 'assets',
  // director/ (7)
  'ADVANCED_DIRECTOR_TOOLS.md': 'director',
  'DIRECTOR_SHOT_CARD_REFERENCE.md': 'director',
  'DIRECTOR_VOICEOVER_REFERENCE.md': 'director',
  'ANGLE_AND_QUAD_GRID_OPERATIONS.md': 'director',
  'SCLASS_GROUP_VIDEO_OPERATIONS.md': 'director',
  'TRAILER_STORYBOARD_REUSE_REFERENCE.md': 'director',
  'LEGACY_SCRIPT_WORKSPACE_GUIDE.md': 'director',
  // panels/ (16)
  'APP_SHELL_OPERATIONS.md': 'panels',
  'NAVIGATION_GUIDE.md': 'panels',
  'PROJECT_DASHBOARD_GUIDE.md': 'panels',
  'PROJECT_DASHBOARD_OPERATIONS.md': 'panels',
  'SKILLS_EDITOR_GUIDE.md': 'panels',
  'SKILLS_EDITOR_OPERATIONS.md': 'panels',
  'ASSIST_WORKBENCH_GUIDE.md': 'panels',
  'ASSIST_WORKBENCH_OPERATIONS.md': 'panels',
  'ASSIST_WORKBENCH_PARAMETER_REFERENCE.md': 'panels',
  'MEDIA_OUTPUTS_GUIDE.md': 'panels',
  'MEDIA_OUTPUTS_OPERATIONS.md': 'panels',
  'EXPORT_GUIDE.md': 'panels',
  'EXPORT_OPERATIONS.md': 'panels',
  'TTS_PANEL_OPERATIONS.md': 'panels',
  'voicebox-voice-cloning-flow.md': 'panels',
  'APPEARANCE_THEMES.md': 'panels',
  // settings/ (12)
  'SETTINGS_PANEL_OPERATIONS.md': 'settings',
  'API_SETTINGS_GUIDE.md': 'settings',
  'API_MANAGER_OPERATIONS.md': 'settings',
  'API_PROVIDER_MODEL_TEST_REFERENCE.md': 'settings',
  'PYTHON_TTS_SETUP.md': 'settings',
  'TTS_CONFIG_GUIDE.md': 'settings',
  'ADVANCED_OPTIONS_GUIDE.md': 'settings',
  'IMAGE_HOST_CONFIG.md': 'settings',
  'APP_UPDATE_GUIDE.md': 'settings',
  'DEVELOPMENT_MODE.md': 'settings',
  'SUPPORT_GUIDE.md': 'settings',
  'LICENSE_GUIDE.md': 'settings',
  // engineering/ (7)
  'DEVELOPER_ARCHITECTURE.md': 'engineering',
  'PACKAGING_AND_SMOKE_TESTING.md': 'engineering',
  'TROUBLESHOOTING.md': 'engineering',
  'THIRD_PARTY_NOTICES.md': 'engineering',
  'STORAGE_AND_DATA.md': 'engineering',
  'DOCS_COVERAGE_AUDIT.md': 'engineering',
  'DOCS_MAINTENANCE.md': 'engineering',
};

// 特殊处理（Step 1 已处理，本脚本不再管这些）
const stayRoot = ['README.md', 'README.en.md'];

// === 校验阶段 ===
const allMd = readdirSync(docs).filter(f => f.endsWith('.md'));
console.log(`docs/ 根目录 md 文件总数: ${allMd.length}`);

const categorized = Object.keys(mapping);
const accounted = new Set([...categorized, ...stayRoot]);

const unaccounted = allMd.filter(f => !accounted.has(f));
const missing = [...accounted].filter(f => !allMd.includes(f));

if (unaccounted.length) {
  console.error('❌ 未归类文件（在磁盘上但不在映射表里）:');
  unaccounted.forEach(f => console.error(`   ${f}`));
}
if (missing.length) {
  console.error('❌ 映射表里有但磁盘上不存在:');
  missing.forEach(f => console.error(`   ${f}`));
}
if (unaccounted.length || missing.length) {
  console.error('\n校验失败，终止。');
  process.exit(1);
}

// 统计每个目录
const byDir = {};
for (const [file, dir] of Object.entries(mapping)) {
  byDir[dir] = (byDir[dir] || 0) + 1;
}
console.log('\n归类统计:');
for (const [dir, count] of Object.entries(byDir).sort()) {
  console.log(`  ${dir}/: ${count} 文件`);
}
console.log(`  根目录保留: ${stayRoot.length}`);
const totalAcct = categorized.length + stayRoot.length;
console.log(`\n合计: ${totalAcct} (应等于 ${allMd.length})`);
if (totalAcct !== allMd.length) {
  console.error('❌ 总数不匹配！');
  process.exit(1);
}
console.log('✅ 总数校验通过\n');

// === 执行阶段 ===
if (mode === '--move') {
  // 创建目录
  const dirs = [...new Set(Object.values(mapping))];
  for (const d of dirs) {
    const p = join(docs, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
  // 移动 categorize 的文件
  let moved = 0;
  for (const [file, dir] of Object.entries(mapping)) {
    const src = join(docs, file);
    const dst = join(docs, dir, file);
    if (existsSync(src)) {
      renameSync(src, dst);
      moved++;
    }
  }
  console.log(`已移动 ${moved} 个文件到子目录`);
  console.log('\n✅ 移动完成');
} else {
  console.log('(dry-run 模式，未实际移动。加 --move 执行)');
}
