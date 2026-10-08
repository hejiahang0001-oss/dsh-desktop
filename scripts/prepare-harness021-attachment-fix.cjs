'use strict';

// Reviewed source increment only. This never changes a source checkout, vendor or installed app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const inputRoot = path.resolve(__dirname, '../runtime/harness-021-attachment-fix');
const profile = require('../runtime/harness-021-attachment-fix/profile.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function readRegular(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(!stat.isSymbolicLink(), 'Linked source input refused');
    if (current === path.resolve(file)) assert.ok(stat.isFile() && stat.nlink === 1, 'Non-regular source input refused');
    if (current === path.dirname(current)) break;
  }
  return fs.readFileSync(file);
}
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'Reviewed source anchor mismatch');
  return source.replace(before, after);
}
function transform(relative, source) {
  let text = source.toString('utf8').replace(/\r\n/g, '\n');
  if (relative.endsWith('/service-orchestration.client.spec.ts')) {
    text = replaceOnce(text, "it('releases draft previews when their session scope is disposed'", "it('retains draft previews across navigation and releases them on structural disposal'");
    text = replaceOnce(text, `      b.root.input.for(b.runtime.sessions.scope('s1')!).addAttachments([attachment.id])
      b.reference.release()
      await b.runtime.flush()
      expect(b.root.resolveDraftAttachments([attachment.id])).toEqual([])`, `      b.root.input.for(b.runtime.sessions.scope('s1')!).addAttachments([attachment.id])
      b.reference.release()
      await b.runtime.flush()
      expect(b.root.resolveDraftAttachments([attachment.id])).toEqual([attachment])
      expect(revoked).not.toHaveBeenCalled()
      await b.runtime.sessions.disposeScopes()
      expect(b.root.resolveDraftAttachments([attachment.id])).toEqual([])`);
  } else if (relative.endsWith('/facade.ts')) {
    text = replaceOnce(text, "          if (outcome.kind === 'success') return\n", "          if (outcome.kind === 'success') { this.publish(); return }\n");
    text = replaceOnce(text, '  // ---- wiring-layer extras (not on the frozen SessionInput face) ----\n', `  // ---- wiring-layer extras (not on the frozen SessionInput face) ----

  /** Browser attachments require their exact Session generation until admission settles. */
  get retainsDraftAttachments(): boolean {
    return !this.disposed && (this.attachmentIds.length > 0
      || this.attachmentFlights.size > 0
      || [...this.detachedDrafts.values()].some(draft => draft.attachmentIds.length > 0))
  }
`);
  } else {
    text = replaceOnce(text, '  ISessions, SessionBinding, SessionFace,\n', '  ISessions, SessionBinding, SessionFace, SessionReference,\n');
    text = replaceOnce(text, '/** Structural command face for per-session popup resolution. */', `declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Unsent browser attachments and their unsettled submissions. */
    conversationDraft: unknown
  }
}

/** Structural command face for per-session popup resolution. */`);
    text = replaceOnce(text, "    actx.effect(() => {\n      const offs = [", `    actx.effect(() => {
      let draftReference: SessionReference | undefined
      const releaseReference = (): void => {
        const reference = draftReference
        draftReference = undefined
        reference?.release()
      }
      const releaseShell = (): void => {
        const drafts = shell.dispose()
        const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
        for (const attachmentId of drafts) conversation?.releaseDraftAttachment(attachmentId)
      }
      const syncDraftRetention = (): void => {
        // Deletion is structural teardown; changing the selected view is not.
        if (session.getSnapshot().removed) releaseShell()
        if (!shell.retainsDraftAttachments) { releaseReference(); return }
        if (draftReference === undefined) {
          draftReference = this.sessions().retain(binding.sessionId, { source: 'conversationDraft' })
        }
      }
      const offs = [
        shell.state.subscribe(syncDraftRetention),
        session.subscribe(syncDraftRetention),`);
    text = replaceOnce(text, `        const drafts = shell.dispose()
        this.shells.delete(binding)
        const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
        for (const attachmentId of drafts) conversation?.releaseDraftAttachment(attachmentId)`, `        releaseShell()
        this.shells.delete(binding)
        releaseReference()`);
  }
  return Buffer.from(source.includes(Buffer.from('\r\n')) ? text.replace(/\n/g, '\r\n') : text);
}
function postimages(sourceRoot) {
  assert.ok(path.isAbsolute(sourceRoot || ''), 'Absolute source root required');
  const identity = JSON.parse(readRegular(path.join(sourceRoot, 'package.json')));
  assert.equal(identity.version, profile.version, 'Source version mismatch');
  const commit = spawnSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  assert.equal(commit.status, 0, 'Source Git identity unavailable');
  assert.equal(commit.stdout.trim(), profile.commit, 'Source commit mismatch');
  assert.equal(digest(readRegular(path.resolve(inputRoot, '../harness-021-candidate/profile.json'))), profile.parentProfileSha256, 'Parent source profile changed');
  const result = new Map();
  for (const entry of profile.files) {
    const before = readRegular(path.join(sourceRoot, entry.path));
    assert.equal(digest(before), entry.beforeSha256, `Reviewed source changed: ${entry.path}`);
    const after = transform(entry.path, before);
    if (entry.afterSha256) assert.equal(digest(after), entry.afterSha256, `Reviewed postimage changed: ${entry.path}`);
    result.set(entry.path, { before, after });
  }
  if (profile.regression) {
    const after = readRegular(path.join(inputRoot, profile.regression.input));
    assert.equal(digest(after), profile.regression.sha256, 'Regression input changed');
    assert.ok(!fs.existsSync(path.join(sourceRoot, profile.regression.path)), 'Existing regression source preserved');
    result.set(profile.regression.path, { before: null, after });
  }
  return result;
}
function validateOutputRoot(sourceRoot, outputRoot) {
  assert.ok(path.isAbsolute(sourceRoot || ''), 'Absolute source root required');
  assert.ok(path.isAbsolute(outputRoot || ''), 'Absolute output root required');
  const source = path.resolve(sourceRoot), output = path.resolve(outputRoot);
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  assert.ok(!contains(source, output) && !contains(output, source), 'Source/output overlap refused');
  assert.ok(!fs.existsSync(output), 'Output already exists; existing evidence preserved');
  for (let current = path.dirname(output); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Linked or non-directory output ancestor refused');
    if (current === path.dirname(current)) break;
  }
  return output;
}
function prepare(sourceRoot, outputRoot) {
  outputRoot = validateOutputRoot(sourceRoot, outputRoot);
  const images = postimages(sourceRoot);
  const patch = readRegular(path.join(inputRoot, 'source.patch'));
  assert.equal(digest(patch), profile.patchSha256, 'Reviewed patch changed');
  fs.mkdirSync(outputRoot, { recursive: false });
  for (const [relative, { before, after }] of images) {
    for (const [tree, bytes] of [['before', before], ['after', after]]) {
      if (bytes === null) continue;
      const file = path.join(outputRoot, tree, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes, { flag: 'wx' });
    }
  }
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: path.join(outputRoot, 'before'), windowsHide: true, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr || 'Isolated patch checkout initialization failed');
  const checked = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '--check', '-'], {
    cwd: path.join(outputRoot, 'before'), input: patch, windowsHide: true, encoding: 'utf8',
  });
  assert.equal(checked.status, 0, checked.stderr || 'Patch check failed');
  const applied = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '-'], {
    cwd: path.join(outputRoot, 'before'), input: patch, windowsHide: true, encoding: 'utf8',
  });
  assert.equal(applied.status, 0, applied.stderr || 'Patch application failed');
  for (const [relative, { after }] of images) assert.equal(digest(readRegular(path.join(outputRoot, 'before', relative))), digest(after), `Applied postimage differs: ${relative}`);
  const report = { ok: true, scope: 'reviewed-source-postimages-only', deployed: false,
    files: [...images].map(([name, value]) => ({ path: name, beforeSha256: value.before === null ? null : digest(value.before), afterSha256: digest(value.after) })) };
  fs.writeFileSync(path.join(outputRoot, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}
if (require.main === module) {
  const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  console.log(JSON.stringify(prepare(option('source-root'), option('output-root')), null, 2));
}
module.exports = { digest, postimages, prepare, profile, transform, validateOutputRoot };
