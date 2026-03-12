/**
 * Assistant 搜索冒烟脚本
 * 使用方法: node test-assistant-search.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const APP_PATH = path.join(__dirname, 'release', 'win-unpacked', 'NaonaoVault.exe');
const TEST_PASSWORD = 'SecureVault!2026';
const TEST_RECORD = {
  name: 'Gitee',
  address: 'https://gitee.com',
  account: 'someone@example.com',
  password: 'Passw0rd!2026',
};

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
    SECURE_VAULT_USER_DATA_DIR: userDataDir,
  };

  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function main() {
  if (!fs.existsSync(APP_PATH)) {
    throw new Error(`找不到打包版 EXE: ${APP_PATH}`);
  }

  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-vault-assistant-'));
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

    await page.getByRole('button', { name: '新建记录' }).first().click();
    await page.getByRole('heading', { name: '新建记录' }).waitFor({ timeout: 10000 });
    await page.getByPlaceholder('输入记录名称').fill(TEST_RECORD.name);
    await page.getByPlaceholder('网址或地址').fill(TEST_RECORD.address);
    await page.getByPlaceholder('用户名或邮箱').fill(TEST_RECORD.account);
    await page.getByPlaceholder('密码').fill(TEST_RECORD.password);
    await page.getByRole('button', { name: '创建' }).click();

    await page.getByText(TEST_RECORD.name, { exact: true }).first().waitFor({ timeout: 10000 });

    await page.getByTitle('AI 助手').click();
    await page.getByRole('heading', { name: 'AI 助手' }).waitFor({ timeout: 10000 });

    await page.getByPlaceholder('例如：Gitee 的账号是什么').fill('gitee的账号是什么');
    await page.getByRole('button', { name: '查询' }).click();

    await page.getByText(`Gitee 的账号是 ${TEST_RECORD.account}。`).waitFor({ timeout: 10000 });
    await page.getByText('打开记录').first().click();

    await page.getByRole('heading', { name: '编辑记录' }).waitFor({ timeout: 10000 });
    await page.locator(`input[value="${TEST_RECORD.name}"]`).waitFor({ timeout: 10000 });

    console.log('✓ Assistant 搜索、展示、打开记录冒烟通过');
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
