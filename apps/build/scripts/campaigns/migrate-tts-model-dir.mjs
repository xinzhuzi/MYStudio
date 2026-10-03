#!/usr/bin/env node
/**
 * One-shot migration: move the TTS model cache from the pre-2026-08 default
 * <storageBase>/TTS/model to the unified model layout <storageBase>/model/TTS
 * (user ruling 2026-08-19: all model families live under <userData>/model/<family>/).
 *
 * Mirrors what the in-app TTS migrateStorage() flow does (tts-runtime.ts):
 *  - moves each models--org--name repo directory with a same-volume rename
 *  - rewrites the persisted TTS runtime config modelCacheDir
 *  - refuses to overwrite an existing target repo (abort before touching it)
 *
 * Run only while the app is closed. Idempotent: re-running after a successful
 * migration is a no-op.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'

const USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', '漫影工作室')

function resolveStorageBase() {
  const configPath = path.join(USER_DATA_DIR, 'storage-config.json')
  try {
    const configured = JSON.parse(fs.readFileSync(configPath, 'utf8')).basePath
    if (typeof configured === 'string' && configured.trim()) return configured.trim()
  } catch { /* fall through to the default */ }
  return USER_DATA_DIR
}

const base = resolveStorageBase()
const oldDir = path.join(base, 'TTS', 'model')
const newDir = path.join(base, 'model', 'TTS')
const runtimeConfigPath = path.join(base, 'TTS', 'runtime', 'config.json')

if (!fs.existsSync(oldDir)) {
  console.log(`[migrate-tts-model-dir] nothing to do: ${oldDir} does not exist` +
    (fs.existsSync(newDir) ? ` (already migrated to ${newDir})` : ''))
  process.exit(0)
}

// Conflict check first: never overwrite an existing target repo.
const entries = fs.readdirSync(oldDir, { withFileTypes: true })
const repoEntries = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('models--'))
const conflicts = repoEntries
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(newDir, name)))
if (conflicts.length > 0) {
  console.error(`[migrate-tts-model-dir] ABORT: target already has repos with different content risk: ${conflicts.join(', ')}`)
  process.exit(1)
}

fs.mkdirSync(newDir, { recursive: true })
let moved = 0
for (const entry of repoEntries) {
  fs.renameSync(path.join(oldDir, entry.name), path.join(newDir, entry.name))
  moved += 1
  console.log(`[migrate-tts-model-dir] moved ${entry.name}`)
}

// Rewrite the persisted modelCacheDir so both old and new app builds resolve the new location.
if (fs.existsSync(runtimeConfigPath)) {
  const config = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'))
  if (typeof config.modelCacheDir === 'string' && path.resolve(config.modelCacheDir) === path.resolve(oldDir)) {
    config.modelCacheDir = newDir
    fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(config, null, 2)}\n`)
    console.log('[migrate-tts-model-dir] rewrote runtime config modelCacheDir')
  }
} else {
  console.log('[migrate-tts-model-dir] no runtime config.json found (fresh install) — skipped config rewrite')
}

// Best-effort cleanup of the emptied legacy dir (.DS_Store and empty leftovers only).
const leftovers = fs.readdirSync(oldDir)
if (leftovers.every((name) => name === '.DS_Store')) {
  for (const name of leftovers) fs.rmSync(path.join(oldDir, name), { force: true })
  fs.rmdirSync(oldDir)
  console.log('[migrate-tts-model-dir] removed emptied legacy dir TTS/model')
} else {
  console.log(`[migrate-tts-model-dir] kept legacy dir (non-model leftovers: ${leftovers.join(', ')})`)
}

console.log(`[migrate-tts-model-dir] done: ${moved} repo(s) -> ${newDir}`)
