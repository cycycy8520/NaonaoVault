/**
 * Electron 功能冒烟脚本
 * 使用方法: node test-functional-smoke.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const APP_PATH = path.join(__dirname, 'release', 'win-unpacked', 'SecureVault.exe');
const OUTPUT_DIR = path.join(__dirname, 'output', 'playwright');
const TEST_PASSWORD = 'SecureVault!2026';
const TEST_RECORD_NAME = 'Smoke Test Entry';

function buildLaunchEnvironment(profileRoot) {
  const roamingDir = path.join(profileRoot, 'Roaming');
  const localDir = path.join(profileRoot, 'Local');
  const userDataDir = path.join(roamingDir, 'secure-vault');

  fs.mkdirSync(roamingDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });

  const env = {
    ...process.env,
    APPDATA: roamingDir,
    LOCALAPPDATA: localDir,
    SECURE_VAULT_STARTUP_LOG: '1',
    SECURE_VAULT_USER_DATA_DIR: userDataDir,
  };

  delete env.ELECTRON_RUN_AS_NODE;

  return {
    env,
    roamingDir,
    userDataDir,
    startupLogPath: path.join(roamingDir, 'secure-vault-startup.log'),
  };
}

async function waitForRecord(page, name) {
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 10000 });
}

async function main() {
  if (!fs.existsSync(APP_PATH)) {
    throw new Error(`找不到打包版 EXE: ${APP_PATH}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-vault-functional-'));
  const launchContext = buildLaunchEnvironment(profileRoot);

  const electronApp = await electron.launch({
    executablePath: APP_PATH,
    env: launchContext.env,
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await page.getByPlaceholder('设置密码').fill(TEST_PASSWORD);
    await page.getByPlaceholder('确认密码').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '创建保险库' }).click();

    await page.getByText('输入密码解锁保险库').waitFor({ timeout: 15000 });
    await page.getByPlaceholder('输入密码').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '解锁' }).click();

    await page.getByRole('heading', { name: '全部记录' }).waitFor({ timeout: 15000 });

    await page.getByRole('button', { name: '新建记录' }).first().click();
    await page.getByRole('heading', { name: '新建记录' }).waitFor({ timeout: 10000 });

    await page.getByPlaceholder('输入记录名称').fill(TEST_RECORD_NAME);
    await page.getByPlaceholder('网址或地址').fill('https://example.com');
    await page.getByPlaceholder('用户名或邮箱').fill('smoke@example.com');
    await page.getByPlaceholder('密码').fill('P@ssw0rd-Functional');
    await page.getByPlaceholder('API Key 或其他密钥').fill('sk-functional-smoke');
    await page.getByRole('button', { name: '创建' }).click();

    await waitForRecord(page, TEST_RECORD_NAME);

    await page.getByPlaceholder('搜索记录...').fill(TEST_RECORD_NAME);
    await page.waitForTimeout(500);
    await waitForRecord(page, TEST_RECORD_NAME);

    await page.getByRole('button', { name: '锁定保险库' }).click();
    await page.getByText('输入密码解锁保险库').waitFor({ timeout: 10000 });

    await page.getByPlaceholder('输入密码').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '解锁' }).click();

    await waitForRecord(page, TEST_RECORD_NAME);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, 'functional-smoke.png'),
      fullPage: true,
    });

    console.log('✓ Electron 初始化、录入、搜索、锁定、解锁冒烟通过');
    console.log(`  userData: ${launchContext.userDataDir}`);
    console.log(`  screenshot: ${path.join(OUTPUT_DIR, 'functional-smoke.png')}`);
  } catch (error) {
    if (fs.existsSync(launchContext.startupLogPath)) {
      console.error('启动诊断:');
      const startupLog = fs.readFileSync(launchContext.startupLogPath, 'utf8').trim();
      if (startupLog) {
        for (const line of startupLog.split('\n')) {
          console.error(`  ${line}`);
        }
      }
    }

    throw error;
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
