/**
 * 自动化测试脚本 - 验证 NSIS 安装包
 * 使用方法: node test-installer.js
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_JSON_PATH = path.join(__dirname, 'package.json');
const RELEASE_DIR = path.join(__dirname, 'release');
const WAIT_AFTER_LAUNCH_MS = 8000;

const { version } = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));

function findInstallerPath() {
  const installer = fs
    .readdirSync(RELEASE_DIR)
    .filter((entry) => entry.endsWith('.exe') && entry.includes('-setup-') && !entry.endsWith('.blockmap'))
    .sort()
    .at(-1);

  if (!installer) {
    throw new Error(`在 ${RELEASE_DIR} 中找不到安装包`);
  }

  return path.join(RELEASE_DIR, installer);
}

function inferProductName(installerPath) {
  const baseName = path.basename(installerPath, '.exe');
  const suffix = `-${version}-setup-x64`;

  if (baseName.endsWith(suffix)) {
    return baseName.slice(0, -suffix.length);
  }

  const setupIndex = baseName.indexOf(`-${version}-setup-`);
  return setupIndex >= 0 ? baseName.slice(0, setupIndex) : 'SecureVault';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKill(pid) {
  if (!pid || !isProcessAlive(pid)) {
    return;
  }

  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: 'ignore',
      ...options,
    });

    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function buildElectronEnv(overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
  };

  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function launchInstalledApp(executablePath, userDataDir, startupLogPath) {
  const child = spawn(executablePath, [], {
    stdio: 'ignore',
    env: buildElectronEnv({
      SECURE_VAULT_USER_DATA_DIR: userDataDir,
      SECURE_VAULT_STARTUP_LOG: '1',
      APPDATA: path.dirname(startupLogPath),
      LOCALAPPDATA: path.join(path.dirname(path.dirname(startupLogPath)), 'Local'),
    }),
  });

  let exitCode = null;
  let exitSignal = null;
  child.once('exit', (code, signal) => {
    exitCode = code;
    exitSignal = signal;
  });

  await delay(WAIT_AFTER_LAUNCH_MS);

  const dbPath = path.join(userDataDir, 'secure-vault.db');
  const result = {
    pid: child.pid,
    exitCode,
    exitSignal,
    processAlive: isProcessAlive(child.pid),
    userDataExists: fs.existsSync(userDataDir),
    dbExists: fs.existsSync(dbPath),
    startupLogExists: fs.existsSync(startupLogPath),
    startupLog: fs.existsSync(startupLogPath) ? fs.readFileSync(startupLogPath, 'utf8') : '',
  };

  if (result.processAlive) {
    forceKill(child.pid);
  }

  return result;
}

async function main() {
  console.log('========================================');
  console.log('SecureVault 安装包测试脚本');
  console.log('========================================\n');

  const installerPath = findInstallerPath();
  const productName = inferProductName(installerPath);

  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-vault-installer-'));
  const installDir = path.join(sandboxRoot, 'InstallDir');
  const roamingDir = path.join(sandboxRoot, 'Roaming');
  const localDir = path.join(sandboxRoot, 'Local');
  const userDataDir = path.join(roamingDir, 'secure-vault');
  const startupLogPath = path.join(roamingDir, 'secure-vault-startup.log');

  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(roamingDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });

  console.log(`安装包: ${installerPath}`);
  console.log(`安装目录: ${installDir}`);

  const installResult = await runProcess(installerPath, ['/S', `/D=${installDir}`], {
    env: buildElectronEnv(),
  });

  if (installResult.code !== 0) {
    throw new Error(`安装失败，exitCode=${installResult.code ?? 'unknown'} signal=${installResult.signal ?? 'none'}`);
  }

  const installedExe = path.join(installDir, `${productName}.exe`);
  if (!fs.existsSync(installedExe)) {
    throw new Error(`安装完成后找不到 EXE: ${installedExe}`);
  }

  console.log('✓ 安装完成，开始启动已安装版本');
  const runtime = await launchInstalledApp(installedExe, userDataDir, startupLogPath);

  console.log(`  PID: ${runtime.pid}`);
  console.log(`  存活状态: ${runtime.processAlive ? '运行中' : '已退出'}`);
  console.log(`  userData 已创建: ${runtime.userDataExists ? '是' : '否'}`);
  console.log(`  数据库已创建: ${runtime.dbExists ? '是' : '否'}`);
  console.log(`  启动日志: ${runtime.startupLogExists ? startupLogPath : '未生成'}`);

  if (runtime.startupLog) {
    console.log('  启动诊断:');
    runtime.startupLog
      .trim()
      .split('\n')
      .forEach((line) => console.log(`    ${line}`));
  }

  if (!runtime.processAlive) {
    throw new Error(`已安装应用启动失败，exitCode=${runtime.exitCode ?? 'unknown'} signal=${runtime.exitSignal ?? 'none'}`);
  }

  if (!runtime.userDataExists || !runtime.dbExists) {
    throw new Error('已安装应用未完成初始化');
  }

  const uninstallCandidates = [
    path.join(installDir, `Uninstall ${productName}.exe`),
    path.join(installDir, 'Uninstall.exe'),
  ];
  const uninstallExe = uninstallCandidates.find((candidate) => fs.existsSync(candidate));

  if (!uninstallExe) {
    throw new Error(`找不到卸载程序: ${uninstallCandidates.join(' / ')}`);
  }

  console.log('✓ 已安装版本启动通过，开始静默卸载');
  const uninstallResult = await runProcess(uninstallExe, ['/S'], {
    env: buildElectronEnv(),
  });

  if (uninstallResult.code !== 0) {
    throw new Error(`卸载失败，exitCode=${uninstallResult.code ?? 'unknown'} signal=${uninstallResult.signal ?? 'none'}`);
  }

  await delay(1500);

  if (fs.existsSync(installedExe)) {
    throw new Error(`卸载完成后 EXE 仍存在: ${installedExe}`);
  }

  console.log('\n✓ 安装、启动、卸载流程验证通过。');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
