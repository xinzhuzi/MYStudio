# 捆绑 SQLite CLI(仅 Windows)

资产库(`<storageBasePath>/assets/assets.db`)通过 SQLite 命令行工具读写。
macOS 与 GitHub Actions 的 Linux runner 预装 `sqlite3`,但 **Windows 默认没有**,
因此 Windows 安装包必须捆绑 `sqlite3.exe`,否则装机后资产库初始化直接失败
(旧版本 Windows 安装包存在此缺口,仅 CI 无法发现)。

- 来源:SQLite 官方 `sqlite-tools-win-x64-*.zip`
  (https://www.sqlite.org/download.html)
- 版本:3.53.4
- 校验(SHA-256):`F46EE2475DE4CBE287E6E5F7D43C838796B14E7379CD216BDBB28D391429F9FC`
- 获取:`node build/packaging/fetch-sqlite3.mjs`(构建脚本 `build:win` 自动调用)

**约定**:`bin/` 下的二进制不入库(见根 `.gitignore`),由构建期脚本填充;
`electron-builder.yml` 的 `extraResources` 将该目录以 `Resources/sqlite3` 打包。
运行时解析见 `frontend/electron/storage/assets-sqlite.ts` 的 `resolveSqliteCli()`。
