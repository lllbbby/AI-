# AI- 网文翻译审校工具

针对中国网络文学出海过程中的文本翻译、本地化适配与内容包装需求开发的 AI 辅助内容工具。原网页项目与本地运行的 Windows 桌面版都在本仓库。

## 桌面版

[桌面版使用说明](使用说明.md) · [验收记录](docs/validation.md)

桌面版使用 Electron、React、Vite 和 SQLite，提供书籍章节管理、原译编辑、模型检查、逐项人工复核、版本历史和 JSON 备份。Windows x64 安装包包含 Electron 与 SQLite，不需要单独安装 Node.js。

### 安装和使用

1. 在源码项目目录运行 `npm ci`、`npx install-electron` 和 `npm run make`。安装包生成于 `out/make/squirrel.windows/x64/Duidu-1.0.1-Setup.exe`。安装后从开始菜单打开“对读”；日常使用不需要 Node.js。
2. 创建书籍和章节，粘贴中文原文、英文译文，或点击对应栏的“导入”。TXT、MD、Markdown 必须使用 UTF-8；Markdown 标记作为原始文字保留。导入预览确认后才替换，旧稿仍可在“文本版本”中恢复。
3. 在“书籍背景与名称”填写人物关系及统一译法，在编辑区填写本章补充背景。
4. 在“模型设置”填写 API 根地址、模型名称和自己的密钥。根地址例如 `https://api.deepseek.com` 或其他 OpenAI Chat Completions 兼容服务的 `/v1` 根地址，不附加 `/chat/completions`。“保存并测试连接”只发送固定短文本，会产生一次 API 调用。
5. 点击“检查译文”，逐项核对原译引文和前后文，记录“准备修改／保留译文／查前文再定”及备注。“复制参考改译”后由你手动粘贴修改。
6. “检查历史”切换不同轮次。“导出译文”输出 TXT，“导出记录”输出复核 Markdown，“备份这本书”输出包含所有章节、草稿版本、检查快照和备注的 JSON。

停止编辑 800 毫秒后自动保存；显示“已保存”代表数据库写入成功。Ctrl+S 可立即保存。切章、打开设置和正常退出都等待草稿及备注保存。保存失败时保留当前编辑，使用“重试保存”或“导出当前译文草稿”；版本冲突需要先导出草稿，避免覆盖另一份修改。

修改原译、背景或切换章节会取消运行中的检查。旧轮次和备注继续保留；新请求失败不会清空它们。输入改变后的旧记录显示提示，展示的是当时的输入快照。重启不会自动重发请求。

### 数据、备份和升级

数据默认在 Windows 当前用户的 `%APPDATA%\对读\duidu.sqlite`，设置页可查看实际目录。SQLite 可能同时包含 `-wal` 和 `-shm` 文件。日常备份使用书籍 JSON；复制整个数据目录前先正常退出软件。可用启动参数 `--user-data-dir=绝对路径` 指定独立数据目录。

JSON 导入创建新书副本，生成新 ID，保留原书。跨电脑恢复请重新填写 API 密钥；书籍备份不含模型密钥。密钥使用 Windows `safeStorage` 加密，仅当前 Windows 用户可解密。检查时文本、背景会发送至你配置的模型服务；本地管理和导出无需联网。

同一 Windows 用户同时只打开一个实例。第一版手动升级：先正常退出并导出书籍备份，再运行新版本安装包，保持同一产品名和数据目录。安装目录与用户数据目录分开，升级不覆盖用户数据库。较新数据库不能用旧版打开。不要自行删除数据目录。

原文最多 12,000、译文最多 48,000、合并背景最多 3,000 字符，超限无法检查且不截断。较长草稿仍可保存和导出。文本文件导入限制 4 MB，JSON 备份导入限制 50 MB。第一版不支持批量检查、离线模型、整书自动拆章、DOCX/PDF 或云同步。

模型可能误判或遗漏。记录“准备修改”只保存你的决定，不会自动改译文。数据没有云端副本，请定期备份。

### 源码开发

要求 Node.js 24+、npm 和 Windows x64。

```powershell
cd D:\对读\duidu-desktop
npm ci
npx install-electron
npm run dev
```

Electron 44 将运行时下载独立为 `install-electron`。若官方下载不可达，可设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 及 `electron_config_cache` 指向项目 `.cache/electron` 后运行 `node node_modules/electron/install.js`。运行时保持 SHA-256 校验，不能禁用校验。

```powershell
npm test              # 原网页的 20 项测试 + 桌面存储与任务测试
npm run build
npm run test:desktop  # 真实 Electron 窗口 + 受控模型，不产生付费调用
npm run make          # Forge 生成 Windows 安装包和 ZIP
npm run test:packaged # 检查实际打包程序（先执行 make）
```

`node scripts/live-test.mjs` 是显式运行的付费验收脚本：读取现有模型环境配置，最多发起一次连接测试和一次短句检查，失败不重试。测试数据位于忽略打包的 `.test-data`；截图位于 `output/playwright`。自动测试使用独立数据目录。

结构：`electron/main.mjs` 负责受限 IPC、窗口、文件对话框及密钥；`electron/store.mjs` 负责 SQLite 事务、版本冲突与迁移；`electron/jobs.mjs` 负责单任务、取消和迟到结果隔离；`src/save-queue.mjs` 负责串行保存；`lib/` 复用原项目分析、引文定位及报告逻辑。

数据库当前 schema 1。检查快照保存实际输入、当时书籍和章节背景、模型参数、提示词 SHA-256 及逐项稳定 ID。复核记录按检查轮次和问题 ID 绑定。`better-sqlite3` 13 的 Node-API 二进制已在 Node 和 Electron 中验证，无需本地 Visual Studio 重编译。

参见 [验收记录](docs/validation.md)。

## 开源许可

本仓库按 [MIT License](LICENSE) 开源。
