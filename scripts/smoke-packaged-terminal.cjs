const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { TerminalRunner, resolveTerminalRuntime, sanitizePtyOutput } = require('../electron/terminal-runner.cjs');

const readArgument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const stripAnsi = (value) => sanitizePtyOutput(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');

const waitFor = (runner, predicate, timeoutMs = 12_000) => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs;
  const check = () => {
    const snapshot = runner.getSnapshot();
    if (predicate(snapshot)) {
      cleanup();
      resolve(snapshot);
    } else if (Date.now() >= deadline) {
      cleanup();
      reject(new Error(`Packaged terminal smoke timed out in ${snapshot.state.status}.`));
    }
  };
  const timer = setInterval(check, 40);
  const cleanup = () => {
    clearInterval(timer);
    runner.off('state', check);
    runner.off('output', check);
  };
  runner.on('state', check);
  runner.on('output', check);
  check();
});

const main = async () => {
  const resourcesArgument = readArgument('resources-root');
  const dataArgument = readArgument('data-root');
  const outputArgument = readArgument('output');
  if (!resourcesArgument || !dataArgument || !outputArgument) {
    throw new Error('Usage: node scripts/smoke-packaged-terminal.cjs --resources-root=<dir> --data-root=<dir> --output=<json>');
  }
  const resourcesPath = path.resolve(resourcesArgument);
  const dataRoot = path.resolve(dataArgument);
  const outputPath = path.resolve(outputArgument);
  const workspacePath = path.join(dataRoot, 'workspace');
  await fsp.mkdir(workspacePath, { recursive: true });
  const runtime = resolveTerminalRuntime({ rootDir: path.join(resourcesPath, 'app.asar'), resourcesPath, isPackaged: true });
  const runner = new TerminalRunner({
    workspacePath,
    ...runtime,
    baseEnv: { ...process.env, DEEPSEEK_API_KEY: 'packaged-smoke-secret-marker' }
  });
  let result;
  try {
    for (const target of [runtime.nodePath, runtime.helperScriptPath, runtime.ptyModulePath]) {
      const info = await fsp.lstat(target);
      if (info.isSymbolicLink()) throw new Error('Packaged terminal runtime contains a link.');
    }
    runner.start({ cols: 100, rows: 30 });
    await waitFor(runner, ({ state }) => state.status === 'running');
    runner.write("Write-Output ('cwd-ok=' + [bool](Test-Path -LiteralPath '.')); Write-Output ('secret=' + [bool]$env:DEEPSEEK_API_KEY)\r");
    await waitFor(runner, ({ output }) => stripAnsi(output).includes('secret=False'));
    runner.write("Write-Output 'second-command'\r");
    await waitFor(runner, ({ output }) => stripAnsi(output).includes('second-command'));
    runner.write('exit\r');
    const final = await waitFor(runner, ({ state }) => ['completed', 'failed'].includes(state.status));
    const output = stripAnsi(final.output);
    result = {
      ok: final.state.status === 'completed'
        && output.includes('cwd-ok=True')
        && output.includes('secret=False')
        && output.includes('second-command')
        && !output.includes('packaged-smoke-secret-marker'),
      status: final.state.status,
      cwdVerified: output.includes('cwd-ok=True'),
      credentialIsolated: output.includes('secret=False') && !output.includes('packaged-smoke-secret-marker'),
      secondCommand: output.includes('second-command'),
      runtimeFiles: 3
    };
  } catch (error) {
    result = { ok: false, status: runner.getState().status, error: error.message };
  } finally {
    if (runner.isActive()) await runner.stop();
  }
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
};

void main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
