const RESTRICTED_COMPONENT_PATTERNS = Object.freeze([
  /^\.env(?:\.|$)/i,
  /^\.credentials(?:\.|$)/i,
  /^(?:credentials|secrets?)(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i,
  /^(?:\.npmrc|\.pypirc|\.netrc)$/i,
  /\.(?:pem|key|pfx|p12)$/i
]);

const componentPathspecs = (component, { dotSuffix = true } = {}) => [
  `:(exclude,top,icase)${component}`,
  `:(exclude,glob,icase)**/${component}`,
  `:(exclude,top,icase)${component}/**`,
  `:(exclude,glob,icase)**/${component}/**`,
  ...(dotSuffix ? [
    `:(exclude,top,icase)${component}.*`,
    `:(exclude,glob,icase)**/${component}.*`,
    `:(exclude,top,icase)${component}.*/**`,
    `:(exclude,glob,icase)**/${component}.*/**`
  ] : [])
];

const SENSITIVE_PATHSPECS = Object.freeze([
  ...componentPathspecs('.env'),
  ...componentPathspecs('.credentials'),
  ...componentPathspecs('credentials'),
  ...componentPathspecs('secret'),
  ...componentPathspecs('secrets'),
  ...componentPathspecs('id_rsa'),
  ...componentPathspecs('id_dsa'),
  ...componentPathspecs('id_ecdsa'),
  ...componentPathspecs('id_ed25519'),
  ...componentPathspecs('.npmrc', { dotSuffix: false }),
  ...componentPathspecs('.pypirc', { dotSuffix: false }),
  ...componentPathspecs('.netrc', { dotSuffix: false }),
  ':(exclude,glob,icase)**/*.pem', ':(exclude,glob,icase)**/*.pem/**',
  ':(exclude,glob,icase)**/*.key', ':(exclude,glob,icase)**/*.key/**',
  ':(exclude,glob,icase)**/*.pfx', ':(exclude,glob,icase)**/*.pfx/**',
  ':(exclude,glob,icase)**/*.p12', ':(exclude,glob,icase)**/*.p12/**'
]);

const pathComponents = (value) => String(value || '')
  .replaceAll('\\', '/')
  .split('/')
  .filter(Boolean);

const isRestrictedPath = (value) => pathComponents(value)
  .some((component) => RESTRICTED_COMPONENT_PATTERNS.some((pattern) => pattern.test(component)));

module.exports = {
  RESTRICTED_COMPONENT_PATTERNS,
  SENSITIVE_PATHSPECS,
  isRestrictedPath
};
