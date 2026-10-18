/** Explicit, creation-only hardening for the pinned private PowerShell route. */
import { win32 as path } from 'node:path'
import { createHash } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { requireKoffi } from './koffi.ts'
import { Win32Error } from './errors.ts'
import type { NativePtr, Win32ProcessBindings } from './ffi.ts'

export const POWERSHELL_EXTENSION_POINT_POLICY = 'lulu-private-powershell-7.6.6' as const
export const POWERSHELL_PTY_EXTENSION_POINT_POLICY = 'lulu-private-powershell-7.6.6-pty' as const
export const EXTENDED_STARTUPINFO_PRESENT = 0x80000
const PRIVATE_PWSH_SHA256 = 'bfb46af89433268872ddb43d1ca7a3f433452ee91ed356a9786940f90118e285'
const MAX_EXECUTABLE_BYTES = 16 * 1024 * 1024

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.nlink === right.nlink
}

/** Bounded descriptor read; detects observed replacement/change, not future immutability. */
function assertPinnedExecutable(file: string): void {
  const before = lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > MAX_EXECUTABLE_BYTES) {
    throw new Error('Private PowerShell executable identity/size is invalid')
  }
  const fd = openSync(file, 'r')
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || !sameFile(before, opened)) throw new Error('Private PowerShell changed while opening')
    const bytes = Buffer.alloc(opened.size + 1)
    let count = 0
    while (count < bytes.length) {
      const got = readSync(fd, bytes, count, bytes.length - count, count)
      if (got === 0) break
      count += got
    }
    if (count !== opened.size || !sameFile(opened, fstatSync(fd)) || !sameFile(before, lstatSync(file))
      || createHash('sha256').update(bytes.subarray(0, count)).digest('hex') !== PRIVATE_PWSH_SHA256) {
      throw new Error('Private PowerShell executable identity changed or differs from the pinned official release')
    }
  } finally {
    closeSync(fd)
  }
}

/** Fail closed rather than quietly applying a mitigation to another program. */
function assertPrivatePowerShellExecutable(command: string, expectedPath: string | undefined): void {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Extension point mitigation requires Windows x64')
  // expectedPath is explicit trusted-host input, not a child environment switch.
  // The desktop verifies the whole payload; re-check the fixed executable here.
  if (!expectedPath || !/^[A-Za-z]:[\\/]/u.test(expectedPath) || expectedPath.includes('\0')
    || expectedPath.slice(2).includes(':') || !path.isAbsolute(command)
    || path.normalize(command).toLowerCase() !== path.normalize(expectedPath).toLowerCase()
    || !path.normalize(expectedPath).toLowerCase().endsWith('\\powershell\\7.6.6\\win32-x64\\pwsh.exe')) {
    throw new Error('Creation policy requires the exact host-verified private PowerShell path')
  }
  for (let current = path.normalize(expectedPath); ; current = path.dirname(current)) {
    const item = lstatSync(current)
    if (item.isSymbolicLink()) throw new Error('Private PowerShell path must not traverse links')
    if (path.dirname(current) === current) break
  }
  if (path.normalize(realpathSync.native(expectedPath)).toLowerCase() !== path.normalize(expectedPath).toLowerCase()) {
    throw new Error('Private PowerShell executable identity does not match the pinned official release')
  }
  assertPinnedExecutable(expectedPath)
}

/** Strict interactive argv for the separately verified inherited ConPTY route. */
export function assertPrivatePowerShellPtyPolicy(command: string, args: readonly string[], expectedPath: string | undefined): void {
  assertPrivatePowerShellExecutable(command, expectedPath)
  if (args.length !== 2 || args[0]?.toLowerCase() !== '-nologo' || args[1]?.toLowerCase() !== '-noprofile') {
    throw new Error('Private PowerShell PTY policy requires exactly -NoLogo -NoProfile')
  }
}

/** Fail closed rather than quietly applying a mitigation to another program. */
export function assertRestrictedPowerShellPolicy(command: string, args: readonly string[], expectedPath: string | undefined): void {
  assertPrivatePowerShellExecutable(command, expectedPath)
  const seen = new Set<string>()
  let commandFound = false
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]?.toLowerCase()
    if (flag === '-command' || flag === '-encodedcommand') {
      commandFound = index === args.length - 2 && (args[index + 1]?.length ?? 0) > 0
      break
    }
    if (flag !== '-nologo' && flag !== '-noprofile' && flag !== '-noninteractive') {
      throw new Error('Extension point mitigation rejects interactive or unverified PowerShell arguments')
    }
    if (seen.has(flag)) throw new Error('Duplicate PowerShell startup flag')
    seen.add(flag)
  }
  if (!commandFound || !seen.has('-noprofile') || !seen.has('-noninteractive')) {
    throw new Error('Extension point mitigation requires -NoProfile -NonInteractive and one command payload')
  }
}

export interface MitigatedCreationResult {
  value: number
  /** Report only after the original Job owner has acquired the created child. */
  cleanupErrors: unknown[]
}

/**
 * Add one STARTUPINFOEX attribute without changing token, stdio or Job policy.
 * Own native storage keeps lpValue alive until DeleteProcThreadAttributeList.
 * After successful creation this helper MUST NOT throw before Job assignment.
 */
export function createWithExtensionPointsDisabled(
  api: Win32ProcessBindings,
  startupInfo: NativePtr,
  create: (extended: NativePtr) => number,
): MitigatedCreationResult {
  const binding = api.extensionPoints
  if (!binding) throw new Error('Creation mitigation bindings are unavailable; no unmitigated fallback')
  const koffi = requireKoffi()
  const pointers: NativePtr[] = []
  const cleanupErrors: unknown[] = []
  let attributes: NativePtr | undefined
  let initialized = false
  let value = 0
  let errorCode = 0
  let primaryError: unknown
  const allocate = (type: string, count: number): NativePtr => {
    const pointer = koffi.alloc(type, count) as NativePtr
    pointers.push(pointer)
    return pointer
  }
  const failed = (name: string): never => {
    errorCode = api.getLastError()
    throw new Win32Error(name, errorCode)
  }
  try {
    const size = allocate('size_t', 1)
    const first = binding.initialize(null, 1, 0, size)
    errorCode = api.getLastError()
    if (first !== 0 || errorCode !== 122) throw new Win32Error('InitializeProcThreadAttributeList(size)', errorCode)
    const count = Number(koffi.decode(size, 'size_t'))
    if (!Number.isSafeInteger(count) || count < 1 || count >= 65536) throw new Error('Invalid attribute-list allocation size')
    attributes = allocate('uint8', count)
    if (binding.initialize(attributes, 1, 0, size) === 0) failed('InitializeProcThreadAttributeList')
    initialized = true
    const policy = allocate('uint64', 1)
    koffi.encode(policy, 'uint64', 1n << 32n)
    if (binding.update(attributes, 0, 0x20007, policy, 8, null, null) === 0) failed('UpdateProcThreadAttribute')
    const extended = allocate('uint8', 112)
    const bytes = Buffer.alloc(112)
    Buffer.from(koffi.decode(startupInfo, 'uint8', 104) as number[]).copy(bytes)
    if (bytes.readUInt32LE() !== 104) throw new Error('Expected x64 STARTUPINFOW before extending')
    bytes.writeUInt32LE(112)
    koffi.encode(extended, 'uint8', bytes, 112)
    koffi.encode(extended, 104, 'void *', attributes)
    value = create(extended)
    errorCode = api.getLastError()
  } catch (error) {
    if (value !== 0) cleanupErrors.push(error)
    else primaryError = error
  } finally {
    if (initialized && attributes !== undefined) {
      try { binding.delete(attributes) } catch (error) { cleanupErrors.push(error) }
    }
    for (const pointer of pointers.reverse()) {
      try { koffi.free(pointer) } catch (error) { cleanupErrors.push(error) }
    }
    try { binding.setLastError(errorCode) } catch (error) { cleanupErrors.push(error) }
  }
  if (primaryError !== undefined) {
    if (cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors], 'Creation mitigation failed with cleanup errors', { cause: primaryError })
    throw primaryError
  }
  return { value, cleanupErrors }
}
