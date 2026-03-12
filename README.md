# NaonaoVault

本项目是一个基于 Electron + React + TypeScript 的本地密码管理工具。

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
