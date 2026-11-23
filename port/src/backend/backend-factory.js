import { FirebaseRepository } from './database/firebase/firebase-repository.js';
import { LocalRepository } from './database/local/local-repository.js';
import { FirebaseAuth } from './auth/firebase/firebase-auth.js';
import { LocalAuth } from './auth/local/local-auth.js';
import {
  initFirebase,
  getFirebaseAuth,
  getFirestoreDb,
  validateFirebaseConfig
} from './firebase/firebase-client.js';
import { AuthInterface } from './auth/auth-interface.js';
import { RepositoryInterface } from './database/repository-interface.js';
import { normalizePortfolio, defaultPortfolioData } from '../utils/normalize.js';
import { AppError, ErrorTypes } from '../services/error-service.js';

/**
 * Unconfigured Authentication Adapter
 * Used when Firebase credentials are not provided.
 * Ensures a fail-closed, read-only state with clear diagnostic errors.
 */
class UnconfiguredAuth extends AuthInterface {
  constructor() {
    super();
    this.listeners = new Set();
  }

  getCurrentUser() {
    return null;
  }

  getSession() {
    return null;
  }

  isAuthenticated() {
    return false;
  }

  isOwner() {
    return false;
  }

  async signIn() {
    throw new AppError(
      'Firebase is not configured in window.__ENV__. Please configure your Firebase project credentials in env.js to sign in as owner.',
      ErrorTypes.CONFIG
    );
  }

  async signOut() {
    // No-op
  }

  onAuthStateChange(callback) {
    try {
      callback({
        isAuthenticated: false,
        isOwner: false,
        user: null
      });
    } catch (err) {
      console.error('Unconfigured auth callback error:', err);
    }
    return () => {};
  }
}

/**
 * Unconfigured Repository Adapter
 * Used when Firebase credentials are not provided.
 * Provides safe read-only access to baseline data and blocks write operations.
 */
class UnconfiguredRepository extends RepositoryInterface {
  constructor(baselineData = defaultPortfolioData) {
    super();
    this.data = normalizePortfolio(baselineData);
  }

  async getPortfolio() {
    return this.data;
  }

  async updatePortfolio() {
    throw new AppError(
      'Firebase is not configured. Portfolio is currently operating in safe read-only mode.',
      ErrorTypes.CONFIG
    );
  }

  async getRecord(recordId) {
    return this.data.archive.find(a => a.id === recordId) || null;
  }

  async createRecord() {
    throw new AppError(
      'Firebase is not configured. Portfolio is currently operating in safe read-only mode.',
      ErrorTypes.CONFIG
    );
  }

  async updateRecord() {
    throw new AppError(
      'Firebase is not configured. Portfolio is currently operating in safe read-only mode.',
      ErrorTypes.CONFIG
    );
  }

  async deleteRecord() {
    throw new AppError(
      'Firebase is not configured. Portfolio is currently operating in safe read-only mode.',
      ErrorTypes.CONFIG
    );
  }
}

/**
 * Backend Factory
 *
 * Instantiates the appropriate Database and Auth adapters based on application configuration.
 * Adheres strictly to the requirement that missing Firebase configuration produces a clear
 * setup error and a safe read-only state without pretending local edits were saved to the cloud.
 *
 * @param {object} config Application configuration
 * @returns {Promise<{
 *   authAdapter: AuthInterface,
 *   repositoryAdapter: RepositoryInterface,
 *   isLocalFallback: boolean,
 *   isUnconfigured: boolean
 * }>}
 */
export async function createBackend(config) {
  const isFirebaseMode = config.backendProvider === 'firebase';
  const firebaseValidation = validateFirebaseConfig(config.firebase);
  const isFirebaseConfigured = isFirebaseMode && firebaseValidation.valid;

  // 1. Explicit Local Development Provider
  if (config.backendProvider === 'local') {
    const authAdapter = new LocalAuth(config.firebase?.ownerUid || 'owner@example.com');
    const repositoryAdapter = new LocalRepository(defaultPortfolioData);
    return {
      authAdapter,
      repositoryAdapter,
      isLocalFallback: true,
      isUnconfigured: false
    };
  }

  // 2. Production Firebase Provider (Configured)
  if (isFirebaseConfigured) {
    try {
      await initFirebase(config.firebase);
      const auth = getFirebaseAuth();
      const db = getFirestoreDb();

      const authAdapter = new FirebaseAuth({
        auth,
        ownerUid: config.firebase?.ownerUid
      });

      const repositoryAdapter = new FirebaseRepository({
        db,
        isOwnerCheck: () => authAdapter.isOwner()
      });

      return {
        authAdapter,
        repositoryAdapter,
        isLocalFallback: false,
        isUnconfigured: false
      };
    } catch (err) {
      console.error('Failed to initialize Firebase backend:', err);
      // Fail safely to read-only state on initialization error
      return {
        authAdapter: new UnconfiguredAuth(),
        repositoryAdapter: new UnconfiguredRepository(),
        isLocalFallback: false,
        isUnconfigured: true
      };
    }
  }

  // 3. Firebase Selected but Credentials Missing in env.js
  // Provide safe read-only experience for public visitors without fake persistence.
  return {
    authAdapter: new UnconfiguredAuth(),
    repositoryAdapter: new UnconfiguredRepository(),
    isLocalFallback: false,
    isUnconfigured: true
  };
}
