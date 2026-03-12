const { spawn } = require('child_process');

const args = process.argv.slice(2);
const cliPath = require.resolve('electron-builder/out/cli/cli.js');

const env = {
  ...process.env,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

const child = spawn(process.execPath, [cliPath, ...args], {
  cwd: process.cwd(),
  env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

const shouldSuppressLine = (line) => (
  line.includes('unresolved deps')
);

function relayOutput(stream, target) {
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!shouldSuppressLine(line)) {
        target.write(`${line}\n`);
      }
    }
  });

  stream.on('end', () => {
    if (buffer && !shouldSuppressLine(buffer)) {
      target.write(buffer);
    }
  });
}

relayOutput(child.stdout, process.stdout);
relayOutput(child.stderr, process.stderr);

child.once('error', (error) => {
  throw error;
});

child.once('close', (code) => {
  process.exit(code ?? 1);
});
