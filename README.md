# NaonaoVault

本项目是一个基于 Electron + React + TypeScript 的本地密码管理工具。
## 这是一个什么项目

NaonaoVault 是一个本地密码管理工具，技术栈是：

- Electron 29
- React 18
- TypeScript
- SQLite `better-sqlite3`
- Zustand

核心特点：

- 敏感字段只在主进程加解密
- 使用 Node `crypto` 的 `AES-256-GCM`
- 主密码使用 `PBKDF2-SHA256` 派生密钥
- 支持 AI 设置、智能录入、AI 助手
- 支持 `.svlt` 加密备份导入导出
- 支持 Git 同步
- AI模型只接收脱敏后的名称、分类、地址域名和字段标签等元数据，账号、密码、Key 明文不会离开本地保险库。

当前可直接看的完整说明书在：

- [项目说明书.md](./项目说明书.md)

常用命令：

```powershell
npm install
npm run build
npm test
npm run dist
npm run pack
npm run portable:clean
```

当前主要产物目录：

- 安装包：`release/NaonaoVault-1.0.0-setup-x64.exe`
- 免安装目录：`release/win-unpacked`
- 干净便携包目录：`release/NaonaoVault-1.0.0-clean-portable`
- 干净便携包压缩包：`release/NaonaoVault-1.0.0-clean-portable.zip`

主代码目录：

- 主进程：`src/main`
- 渲染层：`src/renderer`
- 打包脚本：`scripts`
