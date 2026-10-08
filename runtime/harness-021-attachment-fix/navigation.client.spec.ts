// @vitest-environment jsdom
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { ClientSessions } from '../../../api/session-controller/src/client/sessions/service.ts'
import { FOLLOW, followScript } from '../../../api/session-controller/tests/remote/session.client.ts'
import { SlotTestRuntime, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { InputHub } from '../src/client/input/hub.ts'
import { ConversationController } from '../src/client/service.ts'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'
import { zh } from '../src/client/locales.ts'

async function bench() {
  const runtime = await SlotTestRuntime.create()
  await runtime.sessions.add({ id: 'a', summary: { cwd: 'C:/fixture/work-a' } })
  await runtime.sessions.add({ id: 'same', summary: { cwd: 'C:/fixture/work-a' } })
  await runtime.sessions.add({ id: 'other', summary: { cwd: 'C:/fixture/work-b' } })
  const view = runtime.sessions.retain('a')
  await view.ready
  const hub = new InputHub(runtime.ctx, makeTranslate(zh, {}))
  const fiber = runtime.ctx.plugin(ConversationController, { input: hub, blocks: new ComposerBlockRegistry(), maxConcurrentFileUploads: 2 })
  await fiber.await()
  const controller = runtime.ctx.get('conversation') as ConversationController
  const shell = hub.shellFor(view.binding)
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:attachment-test')
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
  const cleanup = async () => { await runtime.dispose(); created.mockRestore(); revoked.mockRestore() }
  runtime.fileUpload.upload = async (_id, _file, name) => ({ ok: true, value: {
    receiptId: `receipt-${name}`, file: { attachmentId: `file-${name}`, name, bytes: 1 },
  } })
  const attach = (names = ['picture.png', 'notes.txt']) => {
    const attachments = controller.createDrafts('a', names.map(name => new File([Uint8Array.of(7)], name, { type: name.endsWith('.png') ? 'image/png' : 'text/plain' })))
    shell.addAttachments(attachments.map(item => item.id))
    return attachments
  }
  return { runtime, view, hub, controller, shell, revoked, cleanup, attach }
}

describe('reviewed official attachment navigation lifetime', () => {
  it('restores exact mixed attachments and draft through same/cross workspace navigation', async () => {
    const b = await bench()
    try {
      const attachments = b.attach()
      const ids = attachments.map(item => item.id)
      b.shell.setDraft('draft remains local to a')
      await b.runtime.flush()
      b.view.release()
      await b.runtime.flush()
      for (const target of ['same', 'other']) {
        const other = b.runtime.sessions.retain(target)
        await other.ready
        expect(b.hub.shellFor(other.binding).snapshot.attachmentIds).toEqual([])
        other.release()
        const back = b.runtime.sessions.retain('a')
        await back.ready
        expect(b.hub.shellFor(back.binding) === b.shell).toBe(true)
        expect(b.shell.snapshot.attachmentIds).toEqual(ids)
        expect(b.shell.snapshot.draft).toBe('draft remains local to a')
        expect(b.controller.resolveDraftAttachments(ids)).toEqual(attachments)
        back.release()
      }
      expect(b.revoked).not.toHaveBeenCalled()
    } finally { await b.cleanup() }
  })

  it('keeps an upload alive after view release and removes the final reference with its final attachment', async () => {
    const b = await bench()
    let complete: ((value: unknown) => void) | undefined
    try {
      let signal: AbortSignal | undefined
      b.runtime.fileUpload.upload = (_id, _file, _name, uploadSignal) => {
        signal = uploadSignal
        return new Promise(resolve => { complete = resolve })
      }
      const [attachment] = b.attach(['notes.txt'])
      await b.runtime.flush()
      b.view.release()
      await b.runtime.flush()
      expect(signal?.aborted).toBe(false)
      expect(b.runtime.sessions.binding('a')).toBeDefined()
      complete?.({ ok: true, value: { receiptId: 'ready', file: { attachmentId: 'ready-file', name: 'notes.txt', bytes: 1 } } })
      await vi.waitFor(() => { expect(b.controller.fileUploads.getSnapshot()[attachment.id]?.status).toBe('ready') })
      b.shell.removeAttachment(attachment.id)
      b.controller.releaseDraftAttachment(attachment.id)
      await b.runtime.flush()
      expect(b.runtime.sessions.binding('a')).toBeUndefined()
      expect(b.controller.resolveDraftAttachments([attachment.id])).toEqual([])
    } finally { complete?.({ ok: false, error: { message: 'fixture cleanup' } }); await b.cleanup() }
  })

  it('releases pending attachments on session deletion and root teardown', async () => {
    const b = await bench()
    try {
      const attachments = b.attach(['picture.png'])
      await b.runtime.flush()
      b.view.release()
      await b.runtime.sessions.remove('a')
      await b.runtime.flush()
      expect(b.runtime.sessions.binding('a')).toBeUndefined()
      expect(b.controller.resolveDraftAttachments(attachments.map(item => item.id))).toEqual([])
      expect(b.revoked).toHaveBeenCalledTimes(1)
    } finally { await b.cleanup() }
  })

  it.each([
    ['success', ''], ['error', ''], ['success', 'text with attachment'], ['error', 'text with attachment'],
  ])('retains a send until its %s settlement with draft %s', async (outcome, text) => {
    const b = await bench()
    try {
      const [attachment] = b.attach(['picture.png'])
      let settle!: (value: { kind: string }) => void
      const send = vi.spyOn(b.controller, 'sendSession').mockImplementation(() => new Promise(resolve => { settle = resolve }))
      await b.runtime.flush()
      b.shell.setDraft(text)
      b.shell.submit()
      await vi.waitFor(() => { expect(send).toHaveBeenCalledOnce() })
      b.view.release()
      await b.runtime.flush()
      expect(b.runtime.sessions.binding('a')).toBeDefined()
      if (outcome === 'success') b.controller.releaseDraftAttachment(attachment.id)
      settle({ kind: outcome })
      await b.runtime.flush()
      if (outcome === 'success') {
        expect(b.runtime.sessions.binding('a')).toBeUndefined()
      } else {
        expect(b.runtime.sessions.binding('a')).toBeDefined()
        expect(b.shell.snapshot.attachmentIds).toEqual([attachment.id])
        expect(b.shell.snapshot.draft).toBe(text)
        expect(b.controller.resolveDraftAttachments([attachment.id])).toHaveLength(1)
      }
    } finally { await b.cleanup() }
  })

  it('root disposal releases the retained generation and each preview once', async () => {
    const b = await bench()
    try {
      const attachments = b.attach(['picture.png'])
      await b.runtime.flush()
      b.view.release()
      await b.runtime.dispose()
      expect(b.runtime.sessions.binding('a')).toBeUndefined()
      expect(b.runtime.sessions.retainInfo('a').getSnapshot().referenceCount).toBe(0)
      expect(b.controller.resolveDraftAttachments(attachments.map(item => item.id))).toEqual([])
      expect(b.revoked).toHaveBeenCalledTimes(1)
      expect(b.shell.dispose()).toEqual([])
    } finally { await b.cleanup() }
  })

  it('transfers explicit carry ownership to the target before releasing the source', async () => {
    const b = await bench()
    try {
      const attachments = b.attach()
      const ids = attachments.map(item => item.id)
      await b.runtime.flush()
      b.view.release()
      const target = b.runtime.sessions.retain('other')
      await target.ready
      const next = b.hub.shellFor(target.binding)
      await b.runtime.flush()
      next.addAttachments(ids)
      b.controller.rebindDraftFiles('other', ids)
      for (const id of ids) b.shell.removeAttachment(id)
      await b.runtime.flush()
      expect(b.runtime.sessions.binding('a')).toBeUndefined()
      target.release()
      await b.runtime.flush()
      expect(b.runtime.sessions.binding('other')).toBeDefined()
      expect(next.snapshot.attachmentIds).toEqual(ids)
      expect(b.controller.resolveDraftAttachments(ids)).toEqual(attachments)
    } finally { await b.cleanup() }
  })
})

const realIt = createClientTest({ roster: webApp.closure(['@deepseek-ai/dsh-api-gateway']) })
realIt('real ClientSessions retains one exact generation through navigation and releases deleted drafts', async ({ mock, start }) => {
  const client = await start()
  const ctx = new Context()
  const sessions = new ClientSessions(ctx, client.ctx.remote)
  const a = SessionId('attachment-real-a'), otherId = SessionId('attachment-real-b')
  mock.stream(FOLLOW, followScript(ok({ records: [], hasMore: false })))
  mock.remote.session.list.mockResolvedValue(ok({ items: [a, otherId].map(sessionId => ({ sessionId, updatedAt: 1, running: false, blank: true, agentAvailable: true })) }))
  await sessions.refresh()
  ctx.provide('fileUpload', { upload: async (_id, _file, name) => ({ ok: true, value: { receiptId: `receipt-${name}`, file: { attachmentId: `file-${name}`, name, bytes: 1 } } }) })
  const hub = new InputHub(ctx, makeTranslate(zh, {}))
  const fiber = ctx.plugin(ConversationController, { input: hub, blocks: new ComposerBlockRegistry(), maxConcurrentFileUploads: 2 })
  await fiber.await()
  const controller = ctx.get('conversation') as ConversationController
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:real-navigation')
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
  onTestFinished(async () => { await ctx.fiber.dispose(); created.mockRestore(); revoked.mockRestore() })
  const view = sessions.retain(a, { source: 'gateway' })
  await view.ready
  const binding = view.binding
  const shell = hub.shellFor(binding)
  const attachments = controller.createDrafts(a, ['one.png', 'two.txt', 'three.txt', 'four.txt'].map(name => new File([Uint8Array.of(1)], name, { type: name.endsWith('.png') ? 'image/png' : 'text/plain' })))
  shell.addAttachments(attachments.map(item => item.id))
  view.release()
  const other = sessions.retain(otherId, { source: 'gateway' })
  await other.ready
  expect(hub.shellFor(other.binding).snapshot.attachmentIds).toEqual([])
  other.release()
  const back = sessions.retain(a, { source: 'gateway' })
  await back.ready
  expect(back.binding === binding).toBe(true)
  expect(hub.shellFor(back.binding).snapshot.attachmentIds).toEqual(attachments.map(item => item.id))
  expect(mock.log.requests(FOLLOW)).toHaveLength(2)
  back.release()
  expect(sessions.retainInfo(a).getSnapshot().retainedBy.conversationDraft).toBe(1)
  sessions.handleSessionRemoved(a)
  await vi.waitFor(() => { expect(sessions.binding(a)).toBeUndefined() })
  expect(controller.resolveDraftAttachments(attachments.map(item => item.id))).toEqual([])
  expect(revoked).toHaveBeenCalledTimes(1)
  sessions.handleSessionRemoved(a)
  expect(shell.dispose()).toEqual([])
  expect(sessions.retainInfo(a).getSnapshot().referenceCount).toBe(0)
  expect(revoked).toHaveBeenCalledTimes(1)
})

realIt('late old-scope cleanup and send failure cannot release a same-id replacement generation', async ({ mock, start }) => {
  const client = await start()
  const ctx = new Context()
  const sessions = new ClientSessions(ctx, client.ctx.remote)
  const id = SessionId('attachment-replacement')
  mock.stream(FOLLOW, followScript(ok({ records: [], hasMore: false })))
  mock.remote.session.list.mockResolvedValue(ok({ items: [{ sessionId: id, updatedAt: 1, running: false, blank: true, agentAvailable: true }] }))
  await sessions.refresh()
  const hub = new InputHub(ctx, makeTranslate(zh, {}))
  const fiber = ctx.plugin(ConversationController, { input: hub, blocks: new ComposerBlockRegistry(), maxConcurrentFileUploads: 2 })
  await fiber.await()
  const controller = ctx.get('conversation') as ConversationController
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:new')
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
  const resumed = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  onTestFinished(async () => { resumed.resolve(); await ctx.fiber.dispose(); created.mockRestore(); revoked.mockRestore() })
  const original = sessions.retain(id, { source: 'gateway' })
  await original.ready
  const oldBinding = original.binding
  const oldShell = hub.shellFor(oldBinding)
  const [oldAttachment] = controller.createDrafts(id, [new File([Uint8Array.of(1)], 'old.png', { type: 'image/png' })])
  oldShell.addAttachments([oldAttachment.id])
  const pending = Promise.withResolvers<{ kind: 'error' }>()
  vi.spyOn(controller, 'sendSession').mockReturnValueOnce(pending.promise)
  oldShell.submit()
  original.release()
  oldBinding.ctx.effect(() => async () => { entered.resolve(); await resumed.promise }, 'test: delayed old attachment scope')
  const disposing = oldBinding.ctx.fiber.dispose()
  await entered.promise
  await vi.waitFor(() => { expect(sessions.binding(id)).toBeUndefined() })
  const replacement = sessions.retain(id, { source: 'gateway' })
  await replacement.ready
  const newBinding = replacement.binding
  const next = hub.shellFor(newBinding)
  const [newAttachment] = controller.createDrafts(id, [new File([Uint8Array.of(2)], 'new.png', { type: 'image/png' })])
  next.addAttachments([newAttachment.id])
  replacement.release()
  pending.resolve({ kind: 'error' })
  resumed.resolve()
  await disposing
  expect(sessions.binding(id) === newBinding).toBe(true)
  expect(next.snapshot.attachmentIds).toEqual([newAttachment.id])
  expect(controller.resolveDraftAttachments([oldAttachment.id])).toEqual([])
  expect(controller.resolveDraftAttachments([newAttachment.id])).toEqual([newAttachment])
  expect(sessions.retainInfo(id).getSnapshot().retainedBy.conversationDraft).toBe(1)
  expect(revoked.mock.calls).toEqual([['blob:old']])
})
