import path from 'node:path';

export const name = 'dsh-desktop-shell-env';
export const inject = ['shellEnv'];

const VARIABLES = Object.freeze({
  DSH_CWD: 'Absolute active DSH Desktop workspace path.',
  DSH_DESKTOP_NODE: 'Absolute path to the DSH Desktop bundled Node.js runtime.',
  DSH_DESKTOP_DOCX_TOOL: 'Absolute path to the fixed DSH Desktop Word tool.',
  DSH_DESKTOP_XLSX_TOOL: 'Absolute path to the fixed DSH Desktop Excel tool.',
  DSH_DESKTOP_PPTX_TOOL: 'Absolute path to the fixed DSH Desktop PowerPoint tool.',
  DSH_DESKTOP_WIKI_TOOL: 'Absolute path to the fixed DSH Desktop Wiki tool.',
  DSH_DESKTOP_WIKI_CONFIG: 'Absolute path to the desktop-owned Wiki settings file.'
});

export function apply(ctx) {
  const values = {};
  for (const key of Object.keys(VARIABLES)) {
    const value = process.env[key];
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
      throw new Error(`dsh-desktop-shell-env: ${key} is not an absolute desktop-owned path`);
    }
    values[key] = path.resolve(value);
  }
  const frozen = Object.freeze(values);
  ctx.shellEnv.register({
    name: 'dsh-desktop-runtime',
    variables: Object.freeze(Object.fromEntries(Object.entries(VARIABLES).map(([key, description]) => [key, Object.freeze({ description })]))),
    resolve() {
      return frozen;
    }
  });
}
