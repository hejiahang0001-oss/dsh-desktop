/** Identity-checked UTF-8 configuration of a dedicated inherited ConPTY only. */
import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'
import { extendWin32ProcessBindings, Win32Error } from '@deepseek-ai/dsh-win32-process'
import type { Win32ProcessBindings, NativePtr } from '@deepseek-ai/dsh-win32-process'

type Koffi = typeof import('koffi')['default']
const requireKoffi = createLazyRequire<Koffi>('koffi', import.meta.url)
export interface PtyConsoleBindings extends Win32ProcessBindings {
  getConsoleMode(handle: NativePtr, mode: Buffer): number
  getConsoleProcessList(buffer: Buffer, length: number): number
  getConsoleWindow(): NativePtr | null
  getConsoleCP(): number
  getConsoleOutputCP(): number
  setConsoleCP(codePage: number): number
  setConsoleOutputCP(codePage: number): number
}
/** No detach/allocation, stdio replacement, or hidden-window operations. */
export function ptyConsoleBindings(): PtyConsoleBindings {
  const pointer = requireKoffi().pointer('void')
  return extendWin32ProcessBindings(({ kernel32, bind }) => ({
    getConsoleMode: bind(kernel32, 'GetConsoleMode', 'int', [pointer, pointer]),
    getConsoleProcessList: bind(kernel32, 'GetConsoleProcessList', 'uint32', [pointer, 'uint32']),
    getConsoleWindow: bind(kernel32, 'GetConsoleWindow', pointer, []),
    getConsoleCP: bind(kernel32, 'GetConsoleCP', 'uint32', []),
    getConsoleOutputCP: bind(kernel32, 'GetConsoleOutputCP', 'uint32', []),
    setConsoleCP: bind(kernel32, 'SetConsoleCP', 'int', ['uint32']),
    setConsoleOutputCP: bind(kernel32, 'SetConsoleOutputCP', 'int', ['uint32']),
  })) as PtyConsoleBindings
}

/** Only the explicitly selected one-shot ConPTY runner may call this function. */
export function acquireInheritedPtyUtf8Console(api: PtyConsoleBindings, ownPid: number): { dispose(): void } {
  assertInheritedPtyConsole(api, ownPid)
  const address = (pointer: NativePtr | null): bigint => pointer === null ? 0n
    : typeof pointer === 'bigint' ? pointer : requireKoffi().address(pointer)
  const window = address(api.getConsoleWindow())
  if (window === 0n) throw new Error('Dedicated PTY console identity is unavailable')
  const input = api.getConsoleCP(), output = api.getConsoleOutputCP()
  if (!Number.isInteger(input) || input < 1 || !Number.isInteger(output) || output < 1) throw new Error('Dedicated PTY code pages are unavailable')
  const owned = (): void => {
    assertInheritedPtyConsole(api, ownPid)
    if (address(api.getConsoleWindow()) !== window) throw new Error('Dedicated PTY console identity changed')
  }
  const checked = (value: number, name: string): void => {
    if (value === 0) throw new Win32Error(name, api.getLastError())
  }
  let changed = false
  const restore = (): void => {
    if (!changed) return
    owned()
    checked(api.setConsoleCP(input), 'SetConsoleCP(restore PTY)')
    owned()
    checked(api.setConsoleOutputCP(output), 'SetConsoleOutputCP(restore PTY)')
    if (api.getConsoleCP() !== input || api.getConsoleOutputCP() !== output) throw new Error('Dedicated PTY code-page restore readback failed')
    changed = false
  }
  try {
    owned()
    changed = true
    checked(api.setConsoleCP(65001), 'SetConsoleCP(PTY)')
    owned()
    checked(api.setConsoleOutputCP(65001), 'SetConsoleOutputCP(PTY)')
    if (api.getConsoleCP() !== 65001 || api.getConsoleOutputCP() !== 65001) throw new Error('Dedicated PTY UTF-8 readback failed')
  } catch (error) {
    try { restore() } catch (cleanup) { throw new AggregateError([error, cleanup], 'Dedicated PTY configuration failed with cleanup error', { cause: error }) }
    throw error
  }
  // Call after the native Job is settled/closed; refuse setters if another
  // process is still attached or this runner changed console association.
  return { dispose: restore }
}
/** Shape is necessary, not proof of ConPTY origin; trusted host selects this route. */
export function assertInheritedPtyConsole(api: PtyConsoleBindings, ownPid: number): void {
  if (ownPid !== process.pid) throw new Error('PTY console owner must be the current runner')
  for (const id of [-10, -11, -12]) {
    const handle = api.getStdHandle(id)
    if (handle == null || handle === 0n || api.getFileType(handle) !== 2 || api.getConsoleMode(handle, Buffer.alloc(4)) === 0) {
      throw new Error('PTY creation policy requires inherited console stdio')
    }
  }
  const list = Buffer.alloc(256)
  if (api.getConsoleProcessList(list, 64) !== 1 || list.readUInt32LE() !== ownPid) {
    throw new Error('PTY creation policy requires a dedicated runner console')
  }
}
