import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const modulePath = process.env.DSH_DESKTOP_CREDENTIAL_MODULE;
if (!modulePath || !path.isAbsolute(modulePath) || !process.send) throw new Error('DSH Desktop encrypted credential host is unavailable.');
const { CredentialProvider, credentialRef, parseCredentialKey } = await import(pathToFileURL(modulePath).href);
const pending = new Map();
process.on('message', (response) => {
  if (response?.channel !== 'dsh-credential-v1') return;
  const task = pending.get(response.requestId); if (!task) return;
  pending.delete(response.requestId); clearTimeout(task.timer);
  if (response.ok) task.resolve(response.value); else task.reject(new Error(response.error || 'Credential host request failed.'));
});
const request = (operation, args = {}) => new Promise((resolve, reject) => {
  const requestId = randomUUID();
  const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Credential host timed out.')); }, 15000);
  pending.set(requestId, { resolve, reject, timer });
  process.send({ channel: 'dsh-credential-v1', requestId, operation, ...args }, (error) => {
    if (error) { clearTimeout(timer); pending.delete(requestId); reject(new Error('Credential host disconnected.')); }
  });
});

export default class DesktopCredentialProvider extends CredentialProvider {
  operations = Promise.resolve();
  enqueue(work) { const task = this.operations.then(work); this.operations = task.catch(() => {}); return task; }
  async resolve(ref) { const state = await request('snapshot'); const value = state.refs[credentialRef(ref)]; return typeof value === 'string' && value ? { value, source: 'file' } : undefined; }
  async describe(ref) { const found = await this.resolve(ref); return { configured: Boolean(found), ...(found ? { source: 'file' } : {}), writable: true }; }
  async set(ref, value) { await this.enqueue(async () => { const state = await request('snapshot'); await request('put-ref', { key: credentialRef(ref), value, revision: state.revision }); this.notifyUpdated(ref); }); }
  async unset(ref) { await this.enqueue(async () => { const state = await request('snapshot'); await request('delete-ref', { key: credentialRef(ref), revision: state.revision }); this.notifyUpdated(ref); }); }
  async readRecord(key) { return (await request('snapshot')).records[parseCredentialKey(key)]; }
  async describeRecord(key) { const record = await this.readRecord(key); return { configured: Boolean(record), ...(record ? { kind: record.kind } : {}), writable: true }; }
  async listRecords() { return Object.entries((await request('snapshot')).records).map(([key, record]) => ({ key: parseCredentialKey(key), kind: record.kind })); }
  async modifyRecord(key, mutate) { return this.enqueue(async () => { const state = await request('snapshot'); const current = state.records[parseCredentialKey(key)]; const next = await mutate(current); if (next === undefined) return current; await request('put-record', { key, value: next, revision: state.revision }); this.notifyRecordUpdated(key); return next; }); }
  async deleteRecord(key) { await this.enqueue(async () => { const state = await request('snapshot'); await request('delete-record', { key: parseCredentialKey(key), revision: state.revision }); this.notifyRecordUpdated(key); }); }
}
