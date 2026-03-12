/**
 * SecureVault 自动化测试脚本
 * 测试初始化流程和基本功能
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// 测试配置
const TEST_TIMEOUT = 30000; // 30秒超时
const APP_PATH = path.join(__dirname, 'release', 'win-unpacked', 'SecureVault.exe');
const USER_DATA_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'secure-vault-test');
const LOG_FILE = path.join(USER_DATA_PATH, 'secure-vault.log');
const DB_FILE = path.join(USER_DATA_PATH, 'secure-vault.db');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFile(filePath, description) {
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    log(`✓ ${description} 存在 (${stats.size} bytes)`, 'green');
    return true;
  } else {
    log(`✗ ${description} 不存在`, 'red');
    return false;
  }
}

function readLogFile() {
  if (fs.existsSync(LOG_FILE)) {
    return fs.readFileSync(LOG_FILE, 'utf8');
  }
  return '';
}

function checkLogForErrors() {
  const logContent = readLogFile();
  const errorLines = logContent.split('\n').filter(line => 
    line.toLowerCase().includes('error') || 
    line.toLowerCase().includes('failed') ||
    line.toLowerCase().includes('exception')
  );
  
  if (errorLines.length > 0) {
    log(`\n⚠ 发现 ${errorLines.length} 个错误/警告:`, 'yellow');
    errorLines.slice(-5).forEach(line => log(`  ${line}`, 'yellow'));
    return false;
  }
  return true;
}

function checkLogForSuccess() {
  const logContent = readLogFile();
  return logContent.includes('App initialization complete') ||
         logContent.includes('crypto:init - vaultInitialized set to true');
}

// 清理测试环境
function cleanup() {
  log('\n清理测试环境...', 'blue');
  try {
    if (fs.existsSync(USER_DATA_PATH)) {
      fs.rmSync(USER_DATA_PATH, { recursive: true, force: true });
      log('✓ 清理完成', 'green');
    }
  } catch (e) {
    log(`⚠ 清理失败: ${e.message}`, 'yellow');
  }
}

// 主测试流程
async function runTests() {
  log('\n========================================', 'blue');
  log('  SecureVault 自动化测试', 'blue');
  log('========================================\n', 'blue');

  // 1. 检查应用文件
  log('1. 检查应用文件...', 'blue');
  if (!checkFile(APP_PATH, 'SecureVault.exe')) {
    log('\n✗ 测试失败: 应用未打包', 'red');
    process.exit(1);
  }

  // 2. 检查 better-sqlite3
  log('\n2. 检查原生模块...', 'blue');
  const nativeModulePath = path.join(__dirname, 'release', 'win-unpacked', 'resources', 'app', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const nativeModuleAltPath = path.join(__dirname, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  
  if (checkFile(nativeModulePath, '打包的 better_sqlite3.node') ||
      checkFile(nativeModuleAltPath, '本地的 better_sqlite3.node')) {
    log('✓ 原生模块存在', 'green');
  } else {
    log('✗ 原生模块不存在', 'red');
  }

  // 3. 清理并启动应用
  log('\n3. 启动应用测试...', 'blue');
  cleanup();
  
  // 确保目录存在
  if (!fs.existsSync(USER_DATA_PATH)) {
    fs.mkdirSync(USER_DATA_PATH, { recursive: true });
  }

  // 启动应用
  const { spawn } = require('child_process');
  
  log('启动 SecureVault...', 'blue');
  const appProcess = spawn(APP_PATH, [
    '--user-data-dir=' + USER_DATA_PATH,
    '--enable-logging'
  ], {
    detached: true,
    windowsHide: false
  });

  log(`应用 PID: ${appProcess.pid}`, 'blue');
  
  // 等待应用启动
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 4. 检查日志和数据库
  log('\n4. 检查应用状态...', 'blue');
  
  let checksPassed = 0;
  let checksTotal = 3;
  
  // 检查日志文件
  if (checkFile(LOG_FILE, '日志文件')) {
    checksPassed++;
    
    // 检查日志内容
    const logContent = readLogFile();
    log('\n日志内容 (前20行):', 'blue');
    logContent.split('\n').slice(0, 20).forEach(line => {
      if (line.trim()) console.log('  ' + line);
    });
    
    if (checkLogForSuccess()) {
      log('\n✓ 检测到初始化成功标记', 'green');
      checksPassed++;
    } else {
      log('\n✗ 未检测到初始化成功标记', 'red');
    }
    
    if (checkLogForErrors()) {
      checksPassed++;
    }
  }
  
  // 检查数据库文件
  if (checkFile(DB_FILE, '数据库文件')) {
    checksPassed++;
  }

  // 5. 关闭应用
  log('\n5. 关闭应用...', 'blue');
  try {
    process.kill(appProcess.pid);
    log('✓ 应用已关闭', 'green');
  } catch (e) {
    log(`⚠ 关闭应用时出错: ${e.message}`, 'yellow');
  }

  // 测试结果
  log('\n========================================', 'blue');
  if (checksPassed >= checksTotal) {
    log(`✓ 测试通过 (${checksPassed}/${checksTotal})`, 'green');
    log('========================================\n', 'blue');
    return 0;
  } else {
    log(`✗ 测试失败 (${checksPassed}/${checksTotal})`, 'red');
    log('========================================\n', 'blue');
    return 1;
  }
}

// 运行测试
runTests()
  .then(code => {
    process.exit(code);
  })
  .catch(err => {
    log(`\n✗ 测试异常: ${err.message}`, 'red');
    console.error(err);
    process.exit(1);
  });
