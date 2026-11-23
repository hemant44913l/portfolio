import { AppError, ErrorTypes } from '../../services/error-service.js';

export const FIREBASE_SDK_VERSION = '10.14.1';

let appInstance = null;
let authInstance = null;
let dbInstance = null;
let sdkModules = null;

/**
 * Validates the public Firebase configuration.
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateFirebaseConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Firebase configuration object is missing.'] };
  }

  const requiredFields = [
    { key: 'apiKey', label: 'FIREBASE_API_KEY' },
    { key: 'authDomain', label: 'FIREBASE_AUTH_DOMAIN' },
    { key: 'projectId', label: 'FIREBASE_PROJECT_ID' },
    { key: 'appId', label: 'FIREBASE_APP_ID' }
  ];

  for (const { key, label } of requiredFields) {
    if (!config[key] || typeof config[key] !== 'string' || !config[key].trim()) {
      errors.push(`Missing or invalid ${label} in configuration.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Allows external injection of Firebase SDK modules.
 * Essential for Node.js test suites, mocks, or alternative module loaders.
 * @param {{ app: object, auth: object, firestore: object }|null} modules
 */
export function setFirebaseModules(modules) {
  sdkModules = modules;
}

/**
 * Loads the modular Firebase JavaScript SDK.
 * In a browser environment, this dynamically imports the official pinned version from gstatic.
 * @returns {Promise<{ app: object, auth: object, firestore: object }>}
 */
export async function loadFirebaseSdk() {
  if (sdkModules) return sdkModules;

  try {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
    ]);

    sdkModules = {
      app: appModule,
      auth: authModule,
      firestore: firestoreModule
    };
    return sdkModules;
  } catch (err) {
    // If gstatic import fails (e.g. offline or mapped via importmap), attempt standard import
    try {
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore')
      ]);
      sdkModules = {
        app: appModule,
        auth: authModule,
        firestore: firestoreModule
      };
      return sdkModules;
    } catch {
      throw new AppError(
        `Failed to load Firebase modular SDK (v${FIREBASE_SDK_VERSION}): ${err.message}`,
        ErrorTypes.NETWORK,
        err
      );
    }
  }
}

/**
 * Initializes the Firebase client instances.
 * Prevents duplicate initialization and validates public configuration.
 * @param {object} config
 * @param {object|null} customModules Optional injected modules (for testing)
 * @returns {Promise<{ app: object, auth: object, db: object }>}
 */
export async function initFirebase(config, customModules = null) {
  // Prevent duplicate initialization
  if (appInstance && authInstance && dbInstance) {
    return { app: appInstance, auth: authInstance, db: dbInstance };
  }

  const validation = validateFirebaseConfig(config);
  if (!validation.valid) {
    throw new AppError(
      `Firebase configuration error: ${validation.errors.join(' ')}`,
      ErrorTypes.CONFIG
    );
  }

  const modules = customModules || (await loadFirebaseSdk());
  sdkModules = modules;

  // Initialize or retrieve Firebase App
  if (modules.app.getApps && modules.app.getApps().length > 0) {
    appInstance = modules.app.getApp();
  } else if (modules.app.initializeApp) {
    appInstance = modules.app.initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      appId: config.appId,
      messagingSenderId: config.messagingSenderId || undefined
    });
  } else {
    throw new AppError('Firebase SDK does not provide initializeApp method.', ErrorTypes.CONFIG);
  }

  // Initialize Auth
  if (modules.auth?.getAuth) {
    authInstance = modules.auth.getAuth(appInstance);
  } else {
    throw new AppError('Firebase Auth SDK does not provide getAuth method.', ErrorTypes.CONFIG);
  }

  // Initialize Firestore
  if (modules.firestore?.getFirestore) {
    dbInstance = modules.firestore.getFirestore(appInstance);
  } else {
    throw new AppError('Firebase Firestore SDK does not provide getFirestore method.', ErrorTypes.CONFIG);
  }

  return { app: appInstance, auth: authInstance, db: dbInstance };
}

export function getFirebaseApp() {
  return appInstance;
}

export function getFirebaseAuth() {
  return authInstance;
}

export function getFirestoreDb() {
  return dbInstance;
}

export function getFirebaseSdkModules() {
  return sdkModules;
}

export function isFirebaseInitialized() {
  return Boolean(appInstance && authInstance && dbInstance);
}

/**
 * Resets initialized instances. Used strictly for automated test isolation.
 */
export function resetFirebaseForTesting() {
  appInstance = null;
  authInstance = null;
  dbInstance = null;
  sdkModules = null;
}
