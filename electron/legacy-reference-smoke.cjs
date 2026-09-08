// Test-only setup for persisted references from pre-alpha.2 desktop versions.
// This is deliberately not a user-facing file import path.
const seedLegacyReference = async (evaluate) => evaluate(`(async () => {
  const state = await desktopAPI.documents.getState();
  const result = await desktopAPI.documents.choose(state.context);
  if (!result.ok) throw new Error(result.message || 'Legacy fixture import failed');
  await window.__DSH_COMPOSER_TEXT__.append(window.__DSH_COMPOSER_TEXT__.current(), result.references.join('\\n'));
  document.dispatchEvent(new Event('dsh-draft-restored'));
})()`);
module.exports = { seedLegacyReference };
