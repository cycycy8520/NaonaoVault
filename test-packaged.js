/**
 * 自动化测试脚本 - 验证打包后的 SecureVault.exe
 * 使用方法: node test-packaged.js
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_PATH = path.join(__dirname, 'release', 'win-unpacked', 'SecureVault.exe');
const ROOT_PACKAGE_PATH = path.join(__dirname, 'package.json');
const RESOURCES_DIR = path.join(__dirname, 'release', 'win-unpacked', 'resources');
const PACKAGED_APP_DIR = path.join(RESOURCES_DIR, 'app');
const PACKAGED_APP_ASAR_PATH = path.join(RESOURCES_DIR, 'app.asar');
const MAIN_ENTRY_PATH = path.join(PACKAGED_APP_DIR, 'dist', 'main', 'index.js');
const PRELOAD_PATH = path.join(PACKAGED_APP_DIR, 'dist', 'main', 'preload.js');
const SQLITE_BINDING_PATHS = [
  path.join(
    RESOURCES_DIR,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  ),
  path.join(
    PACKAGED_APP_DIR,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  ),
];

const WAIT_AFTER_LAUNCH_MS = 8000;

console.log('========================================');
console.log('SecureVault 打包测试脚本');
console.log('========================================\n');

const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function logFileSize(filePath, unit = 'MB') {
  const stats = fs.statSync(filePath);
  const divisor = unit === 'KB' ? 1024 : 1024 * 1024;
  console.log(`  大小: ${(stats.size / divisor).toFixed(2)} ${unit}`);
}

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`✓ ${name}`);
  } catch (error) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: error.message });
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findExistingPath(paths) {
  return paths.find((candidate) => fs.existsSync(candidate));
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

async function runFreshProfileSmokeTest() {
  const packagedApp = JSON.parse(fs.readFileSync(ROOT_PACKAGE_PATH, 'utf8'));
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-vault-packaged-'));
  const roamingDir = path.join(profileRoot, 'Roaming');
  const localDir = path.join(profileRoot, 'Local');

  fs.mkdirSync(roamingDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });

  const userDataDir = path.join(roamingDir, packagedApp.name);
  const dbPath = path.join(userDataDir, 'secure-vault.db');
  const logPath = path.join(userDataDir, 'secure-vault.log');
  const startupLogPath = path.join(roamingDir, 'secure-vault-startup.log');

  console.log('\n--- Fresh Profile 启动测试 ---');
  console.log(`  APPDATA: ${roamingDir}`);
  console.log(`  LOCALAPPDATA: ${localDir}`);
  console.log(`  预期 userData: ${userDataDir}`);

  const childEnv = {
    ...process.env,
    APPDATA: roamingDir,
    LOCALAPPDATA: localDir,
    SECURE_VAULT_STARTUP_LOG: '1',
    SECURE_VAULT_USER_DATA_DIR: userDataDir,
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const child = spawn(APP_PATH, [], {
    stdio: 'ignore',
    env: childEnv,
  });

  let exitCode = null;
  let exitSignal = null;
  child.once('exit', (code, signal) => {
    exitCode = code;
    exitSignal = signal;
  });

  await delay(WAIT_AFTER_LAUNCH_MS);

  const runtime = {
    pid: child.pid,
    exitCode,
    exitSignal,
    profileRoot,
    userDataDir,
    processAlive: isProcessAlive(child.pid),
    userDataExists: fs.existsSync(userDataDir),
    dbExists: fs.existsSync(dbPath),
    logExists: fs.existsSync(logPath),
    startupLogExists: fs.existsSync(startupLogPath),
    startupLogPath,
    startupLog: fs.existsSync(startupLogPath) ? fs.readFileSync(startupLogPath, 'utf8') : '',
    userDataEntries: fs.existsSync(userDataDir) ? fs.readdirSync(userDataDir).sort() : [],
  };

  if (runtime.processAlive) {
    forceKill(child.pid);
  }

  return runtime;
}

async function main() {
  await test('SecureVault.exe 存在', async () => {
    if (!fs.existsSync(APP_PATH)) {
      throw new Error(`找不到文件: ${APP_PATH}`);
    }

    logFileSize(APP_PATH);
  });

  await test('应用源码包存在', async () => {
    if (fs.existsSync(PACKAGED_APP_ASAR_PATH)) {
      logFileSize(PACKAGED_APP_ASAR_PATH);
      return;
    }

    if (!fs.existsSync(MAIN_ENTRY_PATH)) {
      throw new Error(`找不到源码包或主入口: ${PACKAGED_APP_ASAR_PATH} / ${MAIN_ENTRY_PATH}`);
    }
  });

  await test('preload.js 存在', async () => {
    if (fs.existsSync(PACKAGED_APP_ASAR_PATH)) {
      console.log('  使用 app.asar 打包，跳过单文件 preload 检查');
      return;
    }

    if (!fs.existsSync(PRELOAD_PATH)) {
      throw new Error(`找不到: ${PRELOAD_PATH}`);
    }
  });

  await test('better_sqlite3.node 存在', async () => {
    const sqliteBindingPath = findExistingPath(SQLITE_BINDING_PATHS);

    if (!sqliteBindingPath) {
      throw new Error(`找不到: ${SQLITE_BINDING_PATHS.join(' 或 ')}`);
    }

    logFileSize(sqliteBindingPath, 'KB');
  });

  await test('打包版可在 fresh profile 启动', async () => {
    const runtime = await runFreshProfileSmokeTest();

    console.log(`  PID: ${runtime.pid}`);
    console.log(`  存活状态: ${runtime.processAlive ? '运行中' : '已退出'}`);
    console.log(`  userData 已创建: ${runtime.userDataExists ? '是' : '否'}`);
    console.log(`  数据库已创建: ${runtime.dbExists ? '是' : '否'}`);
    console.log(`  日志已创建: ${runtime.logExists ? '是' : '否'}`);
    console.log(`  启动诊断日志: ${runtime.startupLogExists ? runtime.startupLogPath : '未生成'}`);

    if (runtime.userDataEntries.length > 0) {
      console.log(`  userData 内容: ${runtime.userDataEntries.join(', ')}`);
    }

    if (runtime.startupLog) {
      console.log('  启动诊断:');
      runtime.startupLog
        .trim()
        .split('\n')
        .forEach((line) => console.log(`    ${line}`));
    }

    if (!runtime.processAlive) {
      throw new Error(`应用在初始化期间退出，exitCode=${runtime.exitCode ?? 'unknown'} signal=${runtime.exitSignal ?? 'none'}`);
    }

    if (!runtime.userDataExists) {
      throw new Error(`应用未创建 userData 目录: ${runtime.userDataDir}`);
    }

    if (!runtime.dbExists) {
      throw new Error('应用未创建数据库文件 secure-vault.db');
    }
  });

  console.log('\n========================================');
  console.log('测试总结');
  console.log('========================================');
  console.log(`通过: ${results.passed}`);
  console.log(`失败: ${results.failed}`);
  console.log(`总计: ${results.passed + results.failed}`);

  if (results.failed === 0) {
    console.log('\n✓ 文件检查和 fresh profile 启动测试均通过。');
  } else {
    console.log('\n✗ 存在失败项，请根据上述错误继续排查。');
    process.exitCode = 1;
  }
}

void main();
