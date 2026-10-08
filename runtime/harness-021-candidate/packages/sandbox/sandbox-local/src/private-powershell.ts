/** Narrow host-owned opt-in for the two reviewed private PowerShell routes. */
import { win32 as path } from 'node:path'

/**
 * This is dispatch only, not an integrity authority. The desktop verifies the
 * complete payload before providing DSH_DESKTOP_PWSH; the native runner checks
 * the fixed executable hash and path again before it creates any process.
 * Only the exact existing command or PowerShell-PTY argv forms opt in.
 * The PTY flag is distinct: it MUST NOT detach or create a private console.
 * Other runners and spec.env/dshEnv are out of scope.
 */
export function privatePowerShellRunnerArgs(
  argv: readonly string[],
  managedPath = process.env.DSH_DESKTOP_PWSH,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const executable = argv[0]
  if (platform !== 'win32' || managedPath === undefined || executable === undefined
    || !/^[a-z]:[\\/]/iu.test(managedPath) || !/^[a-z]:[\\/]/iu.test(executable)
    || /[\u0000-\u001f\u007f]/u.test(managedPath + executable)
    || managedPath.slice(2).includes(':') || executable.slice(2).includes(':')
    || [managedPath, executable].some(file => file.split(/[\\/]/u).some(part => part === '.' || part === '..'))
    || path.normalize(executable).toLowerCase() !== path.normalize(managedPath).toLowerCase()
    || !path.normalize(managedPath).toLowerCase().endsWith('\\powershell\\7.6.6\\win32-x64\\pwsh.exe')
    || argv[1] !== '-NoLogo' || argv[2] !== '-NoProfile') return []
  if (argv.length === 6 && argv[3] === '-NonInteractive' && argv[4] === '-Command' && argv[5]?.length)
    return ['--lulu-private-powershell', managedPath]
  if (argv.length === 3) return ['--lulu-private-powershell-pty', managedPath]
  return []
}
