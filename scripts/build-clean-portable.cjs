const { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const version = packageJson.version;

const releaseDir = path.join(projectRoot, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');

if (!existsSync(unpackedDir)) {
  throw new Error('Missing release/win-unpacked. Run "npm run pack" first.');
}

const executableName = readdirSync(unpackedDir).find((name) => name.toLowerCase().endsWith('.exe'));

if (!executableName) {
  throw new Error('Cannot find the packaged application executable in release/win-unpacked.');
}

const productBaseName = path.parse(executableName).name;
const outputDirName = `${productBaseName}-${version}-clean-portable`;
const outputDir = path.join(releaseDir, outputDirName);
const userDataDir = path.join(outputDir, 'user-data');
const launcherName = `${productBaseName}-Clean.cmd`;

rmSync(outputDir, { recursive: true, force: true });
cpSync(unpackedDir, outputDir, { recursive: true });

mkdirSync(userDataDir, { recursive: true });
writeFileSync(path.join(userDataDir, '.keep'), '', 'ascii');

writeFileSync(
  path.join(outputDir, launcherName),
  [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'set "ELECTRON_RUN_AS_NODE="',
    'set "SECURE_VAULT_USER_DATA_DIR=%~dp0user-data"',
    `"%~dp0${executableName}" %*`,
    '',
  ].join('\r\n'),
  'ascii',
);

writeFileSync(
  path.join(outputDir, 'README-clean-portable.txt'),
  [
    `${productBaseName} clean portable package`,
    '',
    `Run "${launcherName}".`,
    `This launcher forces ${productBaseName} to use the local "user-data" folder`,
    'inside this package, so it does not reuse stale data from %APPDATA%.',
    '',
    'To reset this portable package later, close the app and delete the',
    '"user-data" folder in the same directory.',
    '',
  ].join('\r\n'),
  'ascii',
);

console.log(`Created clean portable folder: ${outputDir}`);
