// 道劫项目根解析(timeline 一次性脚本共享):
// MYSTUDIO_PROJECT_DIR > project-locations.json 注册表 > 旧内部 _p 路径回退。
// 项目已外迁(/Users/zhengbingjin/Project/IP/MA),旧路径仅作未注册时的兜底。
import fs from "node:fs";

const DAOJIE_PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec0";

export function resolveProjectDir() {
  const legacy = `${process.env.HOME}/Library/Application Support/漫影工作室/projects/_p/${DAOJIE_PROJECT_ID}`;
  if (process.env.MYSTUDIO_PROJECT_DIR) return process.env.MYSTUDIO_PROJECT_DIR;
  try {
    const registry = JSON.parse(fs.readFileSync(`${process.env.HOME}/Library/Application Support/漫影工作室/project-locations.json`, "utf8"));
    const registered = registry?.locations?.[DAOJIE_PROJECT_ID];
    if (registered) return registered;
  } catch { /* 注册表缺失时回退旧路径 */ }
  return legacy;
}
