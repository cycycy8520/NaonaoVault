@echo off
chcp 65001 >nul
echo ========================================
echo   SecureVault 一键构建打包脚本
echo ========================================
echo.

echo [1/3] 检查依赖...
if not exist "node_modules" (
    echo node_modules 不存在，正在安装依赖...
    npm install
    if errorlevel 1 (
        echo.
        echo ❌ 依赖安装失败！
        pause
        exit /b 1
    )
) else (
    echo ✓ 依赖已存在
)

echo.
echo [2/3] 编译项目...
call npm run build
if errorlevel 1 (
    echo.
    echo ❌ 编译失败！
    pause
    exit /b 1
)

echo.
echo [3/3] 打包应用...
call npm run dist
if errorlevel 1 (
    echo.
    echo ❌ 打包失败！
    pause
    exit /b 1
)

echo.
echo ========================================
echo   ✓ 构建完成！
echo ========================================
echo.
echo 输出目录: release\
echo   - win-unpacked/  (免安装版本文件夹)
echo   - SecureVault-1.0.0-win.zip (压缩包)
echo.
echo 按任意键打开输出目录...
pause >nul
start "" "release"
