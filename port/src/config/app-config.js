/**
 * Application Configuration Layer
 *
 * Supports configuration via window.__ENV__ or environment defaults.
 * Keeps public client credentials organized and validates required parameters.
 *
 * Security Principle:
 * Firebase Web configuration fields (apiKey, authDomain, projectId, appId)
 * are public client parameters for identifying your Firebase project.
 * Security is enforced on Google's servers by Firebase Authentication and Firestore Security Rules.
 */
export function getAppConfig() {
  const env = (typeof window !== 'undefined' && window.__ENV__) || {};

  return {
    appName: env.APP_NAME || 'Deepak Digital Humanities Portfolio',
    environment: env.NODE_ENV || 'production',
    backendProvider: env.BACKEND_PROVIDER || 'firebase', // 'firebase' | 'local'
    authProvider: env.AUTH_PROVIDER || 'firebase',       // 'firebase' | 'local'
    databaseProvider: env.DATABASE_PROVIDER || 'firebase',// 'firebase' | 'local'
    firebase: {
      apiKey: env.FIREBASE_API_KEY || '',
      authDomain: env.FIREBASE_AUTH_DOMAIN || '',
      projectId: env.FIREBASE_PROJECT_ID || '',
      appId: env.FIREBASE_APP_ID || '',
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
      ownerUid: env.FIREBASE_OWNER_UID || ''
    }
  };
}

/**
 * Validates configuration and returns diagnostic status
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  const usesFirebase =
    config.backendProvider === 'firebase' ||
    config.authProvider === 'firebase' ||
    config.databaseProvider === 'firebase';

  if (usesFirebase) {
    if (!config.firebase?.apiKey) {
      errors.push('Missing FIREBASE_API_KEY in configuration.');
    }
    if (!config.firebase?.authDomain) {
      errors.push('Missing FIREBASE_AUTH_DOMAIN in configuration.');
    }
    if (!config.firebase?.projectId) {
      errors.push('Missing FIREBASE_PROJECT_ID in configuration.');
    }
    if (!config.firebase?.appId) {
      errors.push('Missing FIREBASE_APP_ID in configuration.');
    }
    if (!config.firebase?.ownerUid) {
      warnings.push('Missing FIREBASE_OWNER_UID in configuration. Owner editing controls will remain disabled.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
