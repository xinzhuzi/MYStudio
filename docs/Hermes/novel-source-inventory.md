# `/Users/zhengbingjin/Project/IP/MA/novel/` 资料盘面

核验时间：2026-08-17（Asia/Shanghai）。只读取文件名、尺寸、哈希与小范围结构；未把正文原文传入任务资料。

## Existing layout

```text
novel/
├── chapters/
│   └── chapter-001.md
└── source-bible.md
```

- `source-memory/` 当前不存在。
- `chapters/chapter-001.md`：8844 字符、347 行、25696 bytes；SHA-256 `c78e359dca4b22180e293a4c64dc3c87de207025d9e450c2c2583663993d7b76`。
- `source-bible.md`：3453 字符、113 行、9577 bytes；SHA-256 `5a0137f1b97c92aac7b8984d61916fd101c25db7e8c4a67a20fcabb7652da9d7`。
- `source-bible.md` 当前包含主线、基调、大量人物分层、反派谱系、世界观铁律与改编红线，已经超过旧任务宣称的 2000 字符，但未超过当前源码的 4000 字符上限。

## Source boundary evidence

- 当前目录只有导入章节镜像与原著圣经，没有设定集、细纲或其他权威资料镜像。
- 因此第一阶段若只扫描该目录，系统只能依据当前导入的章节和手工/AI 生成的圣经建库；不能声称已覆盖完整原著设定。
- 后续新增章节文件可由 manifest + SHA-256 增量发现；目录之外的资料必须通过明确的导入/镜像契约纳入，不能隐式扫描其他位置。

## Recommended initial ownership

- `novel/chapters/`：权威正文镜像。
- `novel/source-bible.md`：用户可编辑的常驻摘要兼容入口。
- `novel/source-memory/`：派生 manifest、结构化记录、检索索引、构建状态与可审计来源；不得反向覆盖正文。
