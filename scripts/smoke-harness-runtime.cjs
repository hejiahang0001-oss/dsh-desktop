const fs = require('node:fs/promises');
const path = require('node:path');
const { HarnessSupervisor, probeHarness } = require('../electron/harness-supervisor.cjs');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const main = async () => {
  const runtimeRoot = readArgument('runtime-root');
  const outputFile = readArgument('output');
  const dataRoot = readArgument('data-root');

  if (!runtimeRoot || !outputFile || !dataRoot) {
    throw new Error('用法：node scripts/smoke-harness-runtime.cjs --runtime-root=<目录> --output=<json> --data-root=<目录>');
  }

  const nodeName = process.platform === 'win32' ? 'node.exe' : 'bin/node';
  const nodePath = path.resolve(__dirname, '..', 'vendor', 'runtime', `${process.platform}-${process.arch}`, nodeName);
  const dshBinPath = path.join(path.resolve(runtimeRoot), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const supervisor = new HarnessSupervisor({
    rootDir: path.resolve(__dirname, '..'),
    resourcesPath: path.resolve(runtimeRoot),
    isPackaged: false,
    homeDir: path.join(path.resolve(dataRoot), 'harness'),
    launchDir: path.join(path.resolve(dataRoot), 'workspace'),
    logFile: path.join(path.resolve(dataRoot), 'logs', 'harness.log'),
    env: { DSH_DESKTOP_NODE: nodePath, DSH_DESKTOP_DSH_BIN: dshBinPath }
  });

  let result;
  try {
    const url = await supervisor.start();
    const probe = await probeHarness(url);
    result = { ok: true, url, nodePath, dshBinPath, ...probe };
  } catch (error) {
    result = { ok: false, error: error.stack || error.message, nodePath, dshBinPath };
    process.exitCode = 1;
  } finally {
    await supervisor.stop();
  }

  await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await fs.writeFile(path.resolve(outputFile), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

void main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
