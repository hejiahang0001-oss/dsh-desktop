'use strict';

// Source overlay verification: existing source/deployed files stay unchanged; one owned test fixture is temporary.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { postimages, digest, profile } = require('./prepare-harness021-attachment-fix.cjs');
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(__dirname, '..');
const profilePath = path.join(root, 'runtime/harness-021-attachment-fix/profile.json');
const inputProfileSha256 = digest(fs.readFileSync(profilePath));
require('node:assert/strict').deepEqual(JSON.parse(fs.readFileSync(profilePath)), profile, 'Input profile changed during startup');
const source = path.resolve(option('source-root') || path.join(root, 'artifacts/harness-021-final-replay'));
const output = fs.mkdtempSync(path.join(root, 'artifacts/stable-readiness-20261007/attachment/', `${option('mode') || 'green'}-`));
const mode = option('mode') || 'green';
const images = postimages(source);
const map = {};
for (const [relative, { before, after }] of images) {
  if (before === null) continue;
  const file = path.join(output, path.basename(relative));
  fs.writeFileSync(file, mode === 'red' ? before : after, { flag: 'wx' });
  map[path.join(source, relative).replaceAll('\\', '/')] = file.replaceAll('\\', '/');
}
const configFile = path.join(output, 'vitest.config.mjs');
const sourceUrl = value => require('node:url').pathToFileURL(path.join(source, value)).href;
const spec = path.join(source, 'packages/client/ui-conversation/tests', `dsh-attachment-${require('node:crypto').randomUUID()}.client.spec.ts`).replaceAll('\\', '/');
const specBytes = images.get(profile.regression.path).after;
fs.writeFileSync(spec, specBytes, { flag: 'wx' });
const specIdentity = fs.lstatSync(spec);
function cleanupSpec() {
  try {
    const stat = fs.lstatSync(spec);
    if (stat.isSymbolicLink() || stat.ino !== specIdentity.ino || stat.dev !== specIdentity.dev
      || digest(fs.readFileSync(spec)) !== digest(specBytes)) return false;
    fs.unlinkSync(spec);
    return true;
  } catch (error) { return error.code === 'ENOENT'; }
}
process.once('exit', cleanupSpec);
const suites = [spec];
if (option('suite') === 'adjacent') for (const name of ['service-orchestration.client.spec.ts', 'draft-hub.client.spec.ts', 'draft-document.client.spec.ts', 'input-reference-submit.client.spec.ts', 'async-insertion.client.spec.ts', 'submit-machine.client.spec.ts']) {
  suites.push(path.join(source, 'packages/client/ui-conversation/tests', name).replaceAll('\\', '/'));
}
fs.writeFileSync(configFile, `import fs from 'node:fs';
import tsconfigPaths from ${JSON.stringify(sourceUrl('node_modules/vite-tsconfig-paths/dist/index.js'))};
import { standardDecoratorPlugin, vitestExecArgv } from ${JSON.stringify(sourceUrl('vitest.shared.ts'))};
const root = ${JSON.stringify(source.replaceAll('\\', '/'))};
const overlays = ${JSON.stringify(map)};
export default {
  root,
  plugins: [{ name: 'reviewed-source-overlay', enforce: 'pre', load(id) { const file = overlays[id.split('?')[0]]; if (file) return fs.readFileSync(file, 'utf8'); } }, tsconfigPaths({ projects: [root + '/tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: { pool: 'forks', maxWorkers: 1, execArgv: vitestExecArgv,
    setupFiles: [root + '/scripts/test-proxy-environment.ts', root + '/scripts/test-dom-environment.ts'],
    include: ${JSON.stringify(suites)},
    reporters: ['default', 'json'], outputFile: { json: ${JSON.stringify(path.join(output, 'vitest.json'))} },
  },
};
`, { flag: 'wx' });
const log = fs.openSync(path.join(output, 'stdout.log'), 'wx');
const error = fs.openSync(path.join(output, 'stderr.log'), 'wx');
const child = spawn(path.join(root, 'vendor/runtime/win32-x64/node.exe'), [path.join(source, 'node_modules/vitest/vitest.mjs'), 'run', '--config', configFile], {
  cwd: source, windowsHide: true, stdio: ['ignore', log, error],
});
let finished = false;
function finish(code, signal, spawnError) {
  if (finished) return;
  finished = true;
  fs.closeSync(log); fs.closeSync(error);
  const report = { mode, code, signal, unchanged: [...images].every(([name, image]) => image.before === null
    ? !fs.existsSync(path.join(source, name)) : digest(fs.readFileSync(path.join(source, name))) === digest(image.before)), sourceOverlayOnly: true,
    regressionSha256: digest(specBytes), inputProfileSha256, profileUnchanged: digest(fs.readFileSync(profilePath)) === inputProfileSha256 };
  report.temporaryFixtureRemoved = cleanupSpec();
  if (spawnError) report.spawnError = spawnError.message;
  fs.writeFileSync(path.join(output, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, ...report })); process.exitCode = code === 0 && report.temporaryFixtureRemoved && report.unchanged && report.profileUnchanged ? 0 : 1;
}
child.once('error', error => finish(null, null, error));
child.once('close', (code, signal) => finish(code, signal));
