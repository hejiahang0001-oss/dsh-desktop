/** A runner-owned console, never setters on a caller's existing console. */
import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'
import { extendWin32ProcessBindings, Win32Error } from '@deepseek-ai/dsh-win32-process'
import type { NativePtr, Win32ProcessBindings } from '@deepseek-ai/dsh-win32-process'

type Koffi = typeof import('koffi')['default']
const requireKoffi = createLazyRequire<Koffi>('koffi', import.meta.url)

export interface PrivateConsoleBindings extends Win32ProcessBindings {
  freeConsole(): number
  allocConsole(): number
  getConsoleProcessList(buffer: Buffer, length: number): number
  getConsoleWindow(): NativePtr | null
  getConsoleCP(): number
  getConsoleOutputCP(): number
  setConsoleCP(codePage: number): number
  setConsoleOutputCP(codePage: number): number
  setStdHandle(id: number, handle: NativePtr): number
  showWindow(window: NativePtr, command: number): number
  isWindowVisible(window: NativePtr): number
}

/** Load these additional APIs only for the explicitly opted-in private shell. */
export function privateConsoleBindings(): PrivateConsoleBindings {
  const koffi = requireKoffi()
  const pointer = koffi.pointer('void')
  const user32 = koffi.load('user32.dll')
  return extendWin32ProcessBindings(({ kernel32, bind }) => ({
    freeConsole: bind(kernel32, 'FreeConsole', 'int', []),
    allocConsole: bind(kernel32, 'AllocConsole', 'int', []),
    getConsoleProcessList: bind(kernel32, 'GetConsoleProcessList', 'uint32', [pointer, 'uint32']),
    getConsoleWindow: bind(kernel32, 'GetConsoleWindow', pointer, []),
    getConsoleCP: bind(kernel32, 'GetConsoleCP', 'uint32', []),
    getConsoleOutputCP: bind(kernel32, 'GetConsoleOutputCP', 'uint32', []),
    setConsoleCP: bind(kernel32, 'SetConsoleCP', 'int', ['uint32']),
    setConsoleOutputCP: bind(kernel32, 'SetConsoleOutputCP', 'int', ['uint32']),
    setStdHandle: bind(kernel32, 'SetStdHandle', 'int', ['uint32', pointer]),
    showWindow: bind(user32, 'ShowWindow', 'int', [pointer, 'int']),
    isWindowVisible: bind(user32, 'IsWindowVisible', 'int', [pointer]),
  })) as PrivateConsoleBindings
}

/**
 * The caller MUST be the one-shot ACL runner, not the desktop/Harness process.
 * No PowerShell preamble, shared-console setter, child NEW_CONSOLE, or ACL change.
 * Pipes and optional control FD 7 stay identical across AllocConsole.
 */
export function acquirePrivateUtf8Console(
  api: PrivateConsoleBindings,
  ownPid: number,
  controlFileDescriptor?: 7,
): { dispose(): void } {
  if (!Number.isInteger(ownPid) || ownPid !== process.pid) throw new Error('Console owner must be the current runner')
  const address = (handle: NativePtr | null | undefined): bigint => handle == null ? 0n
    : typeof handle === 'bigint' ? handle : requireKoffi().address(handle)
  const valid = (handle: NativePtr | null | undefined): handle is NativePtr => handle != null
    && address(handle) !== 0n && address(handle) !== -1n && address(handle) !== 0xffffffffffffffffn
  const handles = [-10, -11, -12].map(id => ({ id, handle: api.getStdHandle(id) }))
  if (handles.some(({ handle }) => !valid(handle))) throw new Error('Private console requires valid inherited standard handles')
  // A ConPTY/interactive terminal is not this noninteractive pipe route.
  if (api.getFileType(handles[1]!.handle) !== 3 || api.getFileType(handles[2]!.handle) !== 3) {
    throw new Error('Private console requires piped stdout/stderr; interactive console is not supported')
  }
  const controlHandle = controlFileDescriptor === undefined ? undefined : api.uvGetOsfhandle(controlFileDescriptor)
  if (controlFileDescriptor !== undefined && (!valid(controlHandle) || api.getFileType(controlHandle) !== 3)) {
    throw new Error('Private console requires a valid unchanged control pipe')
  }
  const checked = (result: number, name: string): void => {
    if (result === 0) throw new Win32Error(name, api.getLastError())
  }
  const exclusive = (): void => {
    const pids = Buffer.alloc(256)
    const count = api.getConsoleProcessList(pids, 64)
    if (count !== 1 || pids.readUInt32LE() !== ownPid) throw new Error('Refusing to configure a console not owned exclusively by this runner')
  }
  const restore = (checkControl = true): void => {
    for (const { id, handle } of handles) checked(api.setStdHandle(id, handle), 'SetStdHandle')
    if (handles.some(({ id, handle }) => address(api.getStdHandle(id)) !== address(handle)))
      throw new Error('Private console changed inherited standard handles')
    if (checkControl && controlFileDescriptor !== undefined && address(api.uvGetOsfhandle(controlFileDescriptor)) !== address(controlHandle))
      throw new Error('Private console changed inherited control FD')
  }
  let owned = false
  let detached = false
  try {
    // This detaches only the dedicated helper, without altering the old console.
    const freed = api.freeConsole()
    if (freed === 0 && api.getLastError() !== 6) throw new Win32Error('FreeConsole', api.getLastError())
    detached = true
    if (api.getConsoleWindow() !== null && address(api.getConsoleWindow()) !== 0n) throw new Error('Runner did not detach from its prior console')
    checked(api.allocConsole(), 'AllocConsole')
    owned = true
    exclusive()
    const window = api.getConsoleWindow()
    if (!valid(window)) throw new Error('Private console has no owned window')
    api.showWindow(window, 0)
    if (api.isWindowVisible(window) !== 0) throw new Error('Private console could not be hidden')
    restore()
    exclusive()
    checked(api.setConsoleCP(65001), 'SetConsoleCP')
    exclusive()
    checked(api.setConsoleOutputCP(65001), 'SetConsoleOutputCP')
    if (api.getConsoleCP() !== 65001 || api.getConsoleOutputCP() !== 65001) throw new Error('Private console UTF-8 readback failed')
  } catch (error) {
    const cleanup: unknown[] = []
    if (owned) {
      try { checked(api.freeConsole(), 'FreeConsole(cleanup)') } catch (failure) { cleanup.push(failure) }
      owned = false
    }
    if (detached) {
      try { restore() } catch (failure) { cleanup.push(failure) }
    }
    if (cleanup.length) throw new AggregateError([error, ...cleanup], 'Private console failed with cleanup errors', { cause: error })
    throw error
  }
  return {
    dispose(): void {
      if (!owned) return
      checked(api.freeConsole(), 'FreeConsole(dispose)')
      owned = false
      // Runner already closed its copy of FD 7 after handing it to the child.
      restore(false)
    },
  }
}
