import { RepositoryInterface } from '../repository-interface.js';
import { normalizePortfolio, defaultPortfolioData } from '../../../utils/normalize.js';
import { AppError, ErrorTypes } from '../../../services/error-service.js';
import { getFirebaseSdkModules } from '../../firebase/firebase-client.js';

export const FIRESTORE_COLLECTION = 'portfolio';
export const FIRESTORE_DOCUMENT = 'main';
const FIRESTORE_MAX_DOC_BYTES = 1048576; // 1 MiB Firestore document limit

/**
 * Firebase Cloud Firestore Repository Implementation
 *
 * Implements the RepositoryInterface using official Firebase Modular Firestore SDK.
 * Manages atomic portfolio persistence, schema validation, record CRUD, and safe read-only defaults.
 *
 * Firestore Document Model:
 *   Collection: `portfolio`
 *   Document: `main`
 *   Fields:
 *     schemaVersion: number (1)
 *     updatedAt: number (epoch ms)
 *     data: {
 *       readings: object,
 *       project: object,
 *       archive: array,
 *       process: object
 *     }
 */
export class FirebaseRepository extends RepositoryInterface {
  /**
   * @param {{
   *   db: object,
   *   firestoreModule?: object,
   *   isOwnerCheck?: () => boolean
   * }} options
   */
  constructor({ db, firestoreModule, isOwnerCheck } = {}) {
    super();
    this.db = db || null;
    this.firestoreModule = firestoreModule || getFirebaseSdkModules()?.firestore || null;
    this.isOwnerCheck = isOwnerCheck || (() => true);
    this.collectionName = FIRESTORE_COLLECTION;
    this.documentId = FIRESTORE_DOCUMENT;
  }

  /**
   * Obtains a DocumentReference to portfolio/main
   * @private
   */
  _getDocRef() {
    const fsMod = this.firestoreModule || getFirebaseSdkModules()?.firestore;
    if (!this.db || !fsMod?.doc) {
      throw new AppError(
        'Cloud Firestore database is not configured or initialized.',
        ErrorTypes.CONFIG
      );
    }
    return fsMod.doc(this.db, this.collectionName, this.documentId);
  }

  /**
   * Fetches the portfolio document from Cloud Firestore.
   * If the document does not exist, returns normalized default data for read-only display.
   * NEVER creates a document during a public visitor's read.
   * @returns {Promise<object>} Normalized portfolio object
   */
  async getPortfolio() {
    const fsMod = this.firestoreModule || getFirebaseSdkModules()?.firestore;
    try {
      const docRef = this._getDocRef();
      const snapshot = await fsMod.getDoc(docRef);

      if (!snapshot.exists()) {
        // Document has not yet been initialized by owner.
        // Return default normalized data safely without performing any write operation.
        return normalizePortfolio(defaultPortfolioData);
      }

      const docData = snapshot.data();
      if (!docData) {
        return normalizePortfolio(defaultPortfolioData);
      }

      // Handle envelope structure: { schemaVersion, updatedAt, data: { ... } }
      const innerData = docData.data && typeof docData.data === 'object' ? docData.data : docData;

      return normalizePortfolio({
        schemaVersion: docData.schemaVersion || innerData.schemaVersion || 1,
        updatedAt: docData.updatedAt || innerData.updatedAt || 0,
        readings: innerData.readings || {},
        project: innerData.project || {},
        archive: innerData.archive || [],
        process: innerData.process || {}
      });
    } catch (err) {
      if (err instanceof AppError) throw err;

      const code = err.code || '';
      if (code === 'permission-denied') {
        throw new AppError(
          'Permission denied: Cloud Firestore security rules restricted read access.',
          ErrorTypes.PERMISSION,
          err
        );
      }
      if (code === 'unavailable' || code === 'deadline-exceeded') {
        throw new AppError(
          'Cloud Firestore service is temporarily unavailable. Check your internet connection.',
          ErrorTypes.NETWORK,
          err
        );
      }

      throw new AppError(
        `Failed to fetch portfolio from Cloud Firestore: ${err.message}`,
        ErrorTypes.DATABASE,
        err
      );
    }
  }

  /**
   * Saves or updates the entire portfolio in Cloud Firestore.
   * Enforces client-side owner check and validates document size.
   * @param {object} nextData
   * @returns {Promise<object>} Updated normalized portfolio
   */
  async updatePortfolio(nextData) {
    if (this.isOwnerCheck && !this.isOwnerCheck()) {
      throw new AppError(
        'Permission denied: You must be signed in as the owner to save changes.',
        ErrorTypes.PERMISSION
      );
    }

    const normalized = normalizePortfolio(nextData);
    normalized.updatedAt = Date.now();

    const documentPayload = {
      schemaVersion: normalized.schemaVersion,
      updatedAt: normalized.updatedAt,
      data: {
        readings: normalized.readings,
        project: normalized.project,
        archive: normalized.archive,
        process: normalized.process
      }
    };

    // Protect against exceeding Firestore 1 MiB document size limit
    const jsonStr = JSON.stringify(documentPayload);
    const approxBytes = new Blob ? new Blob([jsonStr]).size : jsonStr.length;
    if (approxBytes > FIRESTORE_MAX_DOC_BYTES) {
      throw new AppError(
        `Portfolio document size (${Math.round(approxBytes / 1024)} KB) exceeds Firestore 1 MiB limit. Remove large base64 images and use external URLs.`,
        ErrorTypes.VALIDATION
      );
    }

    const fsMod = this.firestoreModule || getFirebaseSdkModules()?.firestore;
    try {
      const docRef = this._getDocRef();
      await fsMod.setDoc(docRef, documentPayload);
      return normalized;
    } catch (err) {
      if (err instanceof AppError) throw err;

      const code = err.code || '';
      if (code === 'permission-denied') {
        throw new AppError(
          'Permission denied: Only the designated portfolio owner is allowed to save changes.',
          ErrorTypes.PERMISSION,
          err
        );
      }
      if (code === 'unavailable' || code === 'deadline-exceeded') {
        throw new AppError(
          'Cloud Firestore service is temporarily unavailable. Unable to save portfolio.',
          ErrorTypes.NETWORK,
          err
        );
      }

      throw new AppError(
        `Failed to save portfolio to Cloud Firestore: ${err.message}`,
        ErrorTypes.DATABASE,
        err
      );
    }
  }

  async getRecord(recordId) {
    const portfolio = await this.getPortfolio();
    return portfolio.archive.find(a => a.id === recordId) || null;
  }

  async createRecord(recordData) {
    const portfolio = await this.getPortfolio();
    const newRecord = {
      ...recordData,
      id: recordData.id || `record-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    };
    portfolio.archive.push(newRecord);
    await this.updatePortfolio(portfolio);
    return newRecord;
  }

  async updateRecord(recordId, recordData) {
    const portfolio = await this.getPortfolio();
    const index = portfolio.archive.findIndex(a => a.id === recordId);
    if (index === -1) {
      throw new AppError(`Record with id '${recordId}' not found.`, ErrorTypes.NOT_FOUND);
    }
    portfolio.archive[index] = { ...portfolio.archive[index], ...recordData, id: recordId };
    await this.updatePortfolio(portfolio);
    return portfolio.archive[index];
  }

  async deleteRecord(recordId) {
    const portfolio = await this.getPortfolio();
    const initialLen = portfolio.archive.length;
    portfolio.archive = portfolio.archive.filter(a => a.id !== recordId);
    if (portfolio.archive.length === initialLen) {
      throw new AppError(`Record with id '${recordId}' not found.`, ErrorTypes.NOT_FOUND);
    }
    await this.updatePortfolio(portfolio);
    return true;
  }
}
