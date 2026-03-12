/**
 * Smart Capture 批量录入冒烟脚本
 * 使用方法: node test-smart-capture.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const APP_PATH = path.join(__dirname, 'release', 'win-unpacked', 'SecureVault.exe');
const TEST_PASSWORD = 'SecureVault!2026';
const SAMPLE_TEXT = [
  'GitHub',
  '• 账号：cy8520cy@163.com',
  '• 密码：cy8520ads',
  '• 510516968@qq.com',
  '• 密码：cy8520ads',
].join('\n');

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
  return env;
}

async function main() {
  if (!fs.existsSync(APP_PATH)) {
    throw new Error(`找不到打包版 EXE: ${APP_PATH}`);
  }

  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-vault-smart-capture-'));
  const electronApp = await electron.launch({
    executablePath: APP_PATH,
    env: buildLaunchEnvironment(profileRoot),
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

    await page.getByTitle('智能录入').click();
    await page.getByRole('heading', { name: '智能录入' }).waitFor({ timeout: 10000 });

    await page.locator('textarea').fill(SAMPLE_TEXT);
    await page.getByText('解析并生成草稿').click();

    await page.getByText('已识别 2 条草稿').waitFor({ timeout: 10000 });
    await page.locator('input[value="cy8520cy@163.com"]').waitFor({ timeout: 10000 });

    await page.getByRole('button', { name: '2. GitHub' }).click();
    await page.locator('input[value="510516968@qq.com"]').waitFor({ timeout: 10000 });

    await page.getByText('批量保存全部 2 条').click();

    await page.getByText('cy8520cy@163.com').waitFor({ timeout: 10000 });
    await page.getByText('510516968@qq.com').waitFor({ timeout: 10000 });

    console.log('✓ Smart Capture 批量解析与创建冒烟通过');
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
