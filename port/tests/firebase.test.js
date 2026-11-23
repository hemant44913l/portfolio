import assert from 'node:assert/strict';
import {
  initFirebase,
  getFirebaseApp,
  getFirebaseAuth,
  getFirestoreDb,
  validateFirebaseConfig,
  resetFirebaseForTesting
} from '../src/backend/firebase/firebase-client.js';
import { FirebaseAuth } from '../src/backend/auth/firebase/firebase-auth.js';
import { FirebaseRepository } from '../src/backend/database/firebase/firebase-repository.js';
import { createBackend } from '../src/backend/backend-factory.js';
import { AuthInterface } from '../src/backend/auth/auth-interface.js';
import { RepositoryInterface } from '../src/backend/database/repository-interface.js';
import { AppError, ErrorTypes } from '../src/services/error-service.js';
import { defaultPortfolioData } from '../src/utils/normalize.js';

console.log('Testing Firebase Backend, Auth, and Firestore Repository...');

// =========================================================================
// 1. Firebase Configuration Validation Tests
// =========================================================================
const invalidConfigs = [
  null,
  {},
  { apiKey: '' },
  { apiKey: 'key', authDomain: '' },
  { apiKey: 'key', authDomain: 'domain', projectId: '' },
  { apiKey: 'key', authDomain: 'domain', projectId: 'project', appId: '' }
];

for (const cfg of invalidConfigs) {
  const result = validateFirebaseConfig(cfg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
}

const validConfig = {
  apiKey: 'test-api-key',
  authDomain: 'test-project.firebaseapp.com',
  projectId: 'test-project',
  appId: '1:123456789:web:abcdef',
  ownerUid: 'owner-uid-123'
};

const validResult = validateFirebaseConfig(validConfig);
assert.equal(validResult.valid, true);
assert.equal(validResult.errors.length, 0);

// =========================================================================
// 2. Firebase Client Initialization & Mock Modules
// =========================================================================
resetFirebaseForTesting();

let mockApps = [];
const mockAppInstance = { name: '[DEFAULT]', options: validConfig };
const mockAuthInstance = { currentUser: null };
const mockDbInstance = { type: 'firestore' };

const mockSdkModules = {
  app: {
    initializeApp: (cfg) => {
      mockApps.push(mockAppInstance);
      return mockAppInstance;
    },
    getApps: () => mockApps,
    getApp: () => mockApps[0]
  },
  auth: {
    getAuth: (app) => mockAuthInstance,
    signInWithEmailAndPassword: async (auth, email, pass) => {
      if (email === 'bad@example.com' || pass === 'wrong') {
        const err = new Error('Invalid credentials');
        err.code = 'auth/invalid-credential';
        throw err;
      }
      if (email === 'visitor@example.com') {
        return {
          user: {
            uid: 'visitor-uid-999',
            email,
            getIdToken: async () => 'visitor-token'
          }
        };
      }
      if (email === 'owner@example.com') {
        return {
          user: {
            uid: 'owner-uid-123',
            email,
            getIdToken: async () => 'owner-token'
          }
        };
      }
      throw new Error('Unknown user');
    },
    signOut: async (auth) => {
      auth.currentUser = null;
    },
    onAuthStateChanged: (auth, callback) => {
      return () => {};
    }
  },
  firestore: {
    getFirestore: (app) => mockDbInstance
  }
};

// Initialize client with mock SDK
const initialized = await initFirebase(validConfig, mockSdkModules);
assert.equal(initialized.app, mockAppInstance);
assert.equal(initialized.auth, mockAuthInstance);
assert.equal(initialized.db, mockDbInstance);
assert.equal(getFirebaseApp(), mockAppInstance);
assert.equal(getFirebaseAuth(), mockAuthInstance);
assert.equal(getFirestoreDb(), mockDbInstance);

// Prevent duplicate initialization
const secondInit = await initFirebase(validConfig, mockSdkModules);
assert.equal(secondInit.app, mockAppInstance);

// =========================================================================
// 3. Firebase Authentication Adapter & Role Checks
// =========================================================================
const firebaseAuth = new FirebaseAuth({
  auth: mockAuthInstance,
  authModule: mockSdkModules.auth,
  ownerUid: 'owner-uid-123'
});
assert.ok(firebaseAuth instanceof AuthInterface);

// Public visitor is unauthenticated
assert.equal(firebaseAuth.isAuthenticated(), false);
assert.equal(firebaseAuth.isOwner(), false);
assert.equal(firebaseAuth.getCurrentUser(), null);

// State observer works
let authStateTriggered = false;
let observedState = null;
const unsub = firebaseAuth.onAuthStateChange(st => {
  authStateTriggered = true;
  observedState = st;
});
assert.equal(authStateTriggered, true);
assert.equal(observedState.isAuthenticated, false);

// Invalid credentials rejection
await assert.rejects(async () => {
  await firebaseAuth.signIn('bad@example.com', 'wrong');
}, /Invalid email or password/);

// Second authenticated account (non-owner) MUST NOT receive owner permissions
await assert.rejects(async () => {
  await firebaseAuth.signIn('visitor@example.com', 'password123');
}, /Unauthorized: This account is not designated as the portfolio owner/);
assert.equal(firebaseAuth.isOwner(), false);
assert.equal(firebaseAuth.isAuthenticated(), false); // Cleanly logged out

// Designated owner sign-in succeeds
const ownerSession = await firebaseAuth.signIn('owner@example.com', 'ownerpass');
assert.equal(ownerSession.user.uid, 'owner-uid-123');
assert.equal(firebaseAuth.isAuthenticated(), true);
assert.equal(firebaseAuth.isOwner(), true);
assert.equal(observedState.isOwner, true);

// Owner sign-out revokes permissions
await firebaseAuth.signOut();
assert.equal(firebaseAuth.isAuthenticated(), false);
assert.equal(firebaseAuth.isOwner(), false);
assert.equal(firebaseAuth.getCurrentUser(), null);

// Fail-closed test: If ownerUid is not configured, no user receives owner permissions
const unconfiguredOwnerAuth = new FirebaseAuth({
  auth: mockAuthInstance,
  authModule: mockSdkModules.auth,
  ownerUid: '' // Missing UID
});
await assert.rejects(async () => {
  await unconfiguredOwnerAuth.signIn('owner@example.com', 'ownerpass');
}, /Unauthorized/);
assert.equal(unconfiguredOwnerAuth.isOwner(), false);

unsub();

// =========================================================================
// 4. Cloud Firestore Repository Adapter Tests
// =========================================================================
let firestoreStore = {}; // In-memory document storage

const mockFirestoreModule = {
  doc: (db, coll, docId) => ({ path: `${coll}/${docId}` }),
  getDoc: async (docRef) => {
    const data = firestoreStore[docRef.path];
    return {
      exists: () => Boolean(data),
      data: () => data || null
    };
  },
  setDoc: async (docRef, payload) => {
    firestoreStore[docRef.path] = JSON.parse(JSON.stringify(payload));
  }
};

let simulatedIsOwner = true;
const repo = new FirebaseRepository({
  db: mockDbInstance,
  firestoreModule: mockFirestoreModule,
  isOwnerCheck: () => simulatedIsOwner
});
assert.ok(repo instanceof RepositoryInterface);

// 4a. Read missing document returns normalized default data (read-only, no write)
firestoreStore = {};
const defaultDoc = await repo.getPortfolio();
assert.equal(defaultDoc.schemaVersion, 1);
assert.deepEqual(defaultDoc.archive, []);
// Verify that getDoc NEVER automatically wrote a document during public visitor read
assert.equal(firestoreStore['portfolio/main'], undefined);

// 4b. Write portfolio saves envelope structure with updatedAt
const savedPortfolio = await repo.updatePortfolio({
  schemaVersion: 1,
  readings: {
    kirschenbaum: { annotation: 'https://example.com/scan.pdf', analysis: 'Text', notes: '', summary: '' }
  },
  project: { title: 'Living Archives' },
  archive: [],
  process: { log: 'First entry' }
});
assert.equal(savedPortfolio.project.title, 'Living Archives');
assert.ok(savedPortfolio.updatedAt > 0);

// Check stored envelope in Firestore
const rawStored = firestoreStore['portfolio/main'];
assert.ok(rawStored);
assert.equal(rawStored.schemaVersion, 1);
assert.ok(rawStored.updatedAt > 0);
assert.equal(rawStored.data.project.title, 'Living Archives');
assert.equal(rawStored.data.readings.kirschenbaum.analysis, 'Text');

// 4c. Non-owner write protection
simulatedIsOwner = false;
await assert.rejects(async () => {
  await repo.updatePortfolio({ schemaVersion: 1, readings: {}, project: {}, archive: [], process: {} });
}, /Permission denied/);
simulatedIsOwner = true;

// 4d. Archive Record CRUD Operations
const newRecord = await repo.createRecord({
  title: 'Street Sign',
  type: 'Photograph',
  location: 'Malleswaram',
  source: 'https://example.com/sign.jpg'
});
assert.ok(newRecord.id);
assert.equal(newRecord.title, 'Street Sign');

const fetchedRecord = await repo.getRecord(newRecord.id);
assert.equal(fetchedRecord.title, 'Street Sign');

const updatedRecord = await repo.updateRecord(newRecord.id, {
  description: 'Historic street sign'
});
assert.equal(updatedRecord.description, 'Historic street sign');
assert.equal(updatedRecord.title, 'Street Sign');

const deleted = await repo.deleteRecord(newRecord.id);
assert.equal(deleted, true);
const deletedCheck = await repo.getRecord(newRecord.id);
assert.equal(deletedCheck, null);

// 4e. Permission-denied error mapping
const permissionDeniedModule = {
  doc: () => ({ path: 'portfolio/main' }),
  getDoc: async () => {
    const err = new Error('Permission denied');
    err.code = 'permission-denied';
    throw err;
  },
  setDoc: async () => {
    const err = new Error('Permission denied');
    err.code = 'permission-denied';
    throw err;
  }
};
const errorRepo = new FirebaseRepository({
  db: mockDbInstance,
  firestoreModule: permissionDeniedModule
});
await assert.rejects(async () => {
  await errorRepo.getPortfolio();
}, /Permission denied/);
await assert.rejects(async () => {
  await errorRepo.updatePortfolio(defaultPortfolioData);
}, /Permission denied/);

// =========================================================================
// 5. Backend Factory Integration & Safe Unconfigured State
// =========================================================================

// 5a. When credentials are not configured in production Firebase mode:
// Must produce a safe read-only state and NEVER pretend changes were saved to cloud
const unconfiguredBackend = await createBackend({
  backendProvider: 'firebase',
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: ''
  }
});
assert.equal(unconfiguredBackend.isUnconfigured, true);
assert.equal(unconfiguredBackend.isLocalFallback, false);

// Visitors can view default portfolio
const publicPortfolio = await unconfiguredBackend.repositoryAdapter.getPortfolio();
assert.equal(publicPortfolio.schemaVersion, 1);

// Write attempts in unconfigured state must fail with clear setup error
await assert.rejects(async () => {
  await unconfiguredBackend.repositoryAdapter.updatePortfolio(defaultPortfolioData);
}, /Firebase is not configured/);

// Sign-in attempts in unconfigured state must fail with clear setup error
await assert.rejects(async () => {
  await unconfiguredBackend.authAdapter.signIn('owner@example.com', 'password');
}, /Firebase is not configured/);

// 5b. Explicit Local Provider mode
const localBackend = await createBackend({
  backendProvider: 'local',
  firebase: { ownerUid: 'local-owner' }
});
assert.equal(localBackend.isLocalFallback, true);
assert.equal(localBackend.isUnconfigured, false);

console.log('✓ Firebase Backend, Auth, and Firestore Repository tests passed.');
