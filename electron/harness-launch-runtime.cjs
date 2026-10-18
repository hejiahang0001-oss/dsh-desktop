'use strict';

const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { PRODUCT_BINDING, readHarnessDesktopRuntime } = require('./harness-desktop-runtime.cjs');
const { resolvePowerShellRuntime } = require('./powershell-runtime.cjs');

const invalid = () => Object.assign(new Error('lulu 固定 Node 运行时完整性检查失败，请修复安装。'), { code: 'NODE_RUNTIME_INVALID' });

async function verifyHarnessNode(file) {
  let handle;
  try {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw invalid();
    const absolute = path.resolve(file);
    let current = path.parse(absolute).root;
    for (const segment of path.relative(current, path.dirname(absolute)).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const info = await fsp.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
    }
    const before = await fsp.lstat(absolute);
    const same = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
      && stat.size > 0 && stat.size <= 256 * 1024 * 1024 && stat.dev === before.dev && stat.ino === before.ino
      && stat.size === before.size && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs;
    if (!same(before)) throw invalid();
    handle = await fsp.open(absolute, 'r');
    if (!same(await handle.stat())) throw invalid();
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position <= before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size + 1 - position), position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    if (position !== before.size || !same(await handle.stat()) || !same(await fsp.lstat(absolute))
      || hash.digest('hex') !== PRODUCT_BINDING.node.sha256) throw invalid();
    return Object.freeze({ executable: absolute, version: PRODUCT_BINDING.node.version });
  } catch { throw invalid(); }
  finally { await handle?.close(); }
}

// Full Harness inventory verification belongs to deployment and packaging. At
// launch, verify its fixed identity/entry bytes plus the entire private PS7 tree.
// Keep synchronous filesystem work out of the Electron main event loop.
async function checkLaunchRuntime(options, runtime) {
  const runtimeRoot = path.resolve(path.dirname(runtime.dshBinPath), '../../../..');
  const approved = readHarnessDesktopRuntime(runtimeRoot);
  if (path.relative(approved.dshBinPath, path.resolve(runtime.dshBinPath)) !== '') {
    throw Object.assign(new Error('lulu 内核入口与固定运行库不一致。'), { code: 'HARNESS_DESKTOP_RUNTIME_INVALID' });
  }
  await verifyHarnessNode(runtime.nodePath);
  const powerShell = resolvePowerShellRuntime(options);
  if (powerShell.version !== PRODUCT_BINDING.powerShell.version) throw invalid();
  return Object.freeze({ powerShellExecutable: powerShell.executable, powerShellVersion: powerShell.version });
}

function verifyHarnessLaunchRuntime(options, runtime, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => Object.assign(new Error('Harness 启动运行库检查已取消。'), { code: 'HARNESS_START_ABORTED' });
    if (signal?.aborted) return reject(aborted());
    const worker = new Worker(__filename, { workerData: { kind: 'lulu-launch-runtime',
      options: { rootDir: options.rootDir, resourcesPath: options.resourcesPath, isPackaged: options.isPackaged },
      runtime: { dshBinPath: runtime.dshBinPath, nodePath: runtime.nodePath } } });
    let response, settled = false, stopError;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(Object.freeze(value));
    };
    const terminate = error => {
      stopError ||= error;
      void worker.terminate().then(() => finish(stopError), () => finish(stopError));
    };
    const cancel = () => terminate(aborted());
    const timer = setTimeout(() => {
      terminate(Object.assign(new Error('lulu 启动运行库检查超时，请重试或修复安装。'), { code: 'HARNESS_RUNTIME_CHECK_TIMEOUT' }));
    }, 60_000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    worker.once('message', message => { response = message; });
    worker.once('error', () => terminate(invalid()));
    worker.once('exit', code => {
      if (stopError) return finish(stopError);
      if (code !== 0 || !response) return finish(invalid());
      if (response.ok) return finish(null, response.value);
      const error = Object.assign(new Error(response.message), { code: response.code });
      finish(error);
    });
  });
}

if (!isMainThread && workerData?.kind === 'lulu-launch-runtime') {
  checkLaunchRuntime(workerData.options, workerData.runtime).then(value => parentPort.postMessage({ ok: true, value }),
    error => parentPort.postMessage({ ok: false, code: error.code || 'HARNESS_DESKTOP_RUNTIME_INVALID',
      message: error.code ? error.message : 'lulu 固定运行库检查失败，请修复安装。' }));
}

module.exports = { verifyHarnessNode, verifyHarnessLaunchRuntime };
