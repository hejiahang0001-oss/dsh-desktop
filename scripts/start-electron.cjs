const { spawn } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const electronExe = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const child = spawn(electronExe, [rootDir, ...process.argv.slice(2)], {
  cwd: rootDir,
  stdio: 'inherit',
  windowsHide: false
});

child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
