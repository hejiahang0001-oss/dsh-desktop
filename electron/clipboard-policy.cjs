const CLIPBOARD_WRITE_PERMISSION = 'clipboard-sanitized-write';

const originOf = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

const isTrustedClipboardWrite = ({
  webContents,
  mainWebContents,
  permission,
  requestingUrl,
  harnessOrigin,
  isMainFrame
} = {}) => {
  if (permission !== CLIPBOARD_WRITE_PERMISSION) return false;
  if (!webContents || webContents !== mainWebContents) return false;
  if (isMainFrame === false || !harnessOrigin) return false;
  const requestOrigin = originOf(requestingUrl || webContents.getURL?.());
  return Boolean(requestOrigin && requestOrigin === harnessOrigin);
};

module.exports = { CLIPBOARD_WRITE_PERMISSION, isTrustedClipboardWrite };
