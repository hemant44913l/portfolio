import { AuthInterface } from '../auth-interface.js';
import { AppError, ErrorTypes } from '../../../services/error-service.js';
import { getFirebaseSdkModules } from '../../firebase/firebase-client.js';

/**
 * Firebase Authentication Adapter
 *
 * Implements the AuthInterface using Firebase Authentication Modular SDK.
 * Manages email/password authentication, session observation, and owner verification.
 *
 * Security Principle:
 * Client-side isOwner check is for UI control display/hiding only.
 * The true security boundary is enforced by Firestore Security Rules using request.auth.uid.
 */
export class FirebaseAuth extends AuthInterface {
  /**
   * @param {{
   *   auth: object,
   *   authModule?: object,
   *   ownerUid?: string
   * }} options
   */
  constructor({ auth, authModule, ownerUid } = {}) {
    super();
    this.auth = auth || null;
    this.authModule = authModule || getFirebaseSdkModules()?.auth || null;
    this.ownerUid = (ownerUid || '').trim();
    this.currentUser = null;
    this.listeners = new Set();
    this._unsubscribeFirebase = null;

    this._initAuthObserver();
  }

  /**
   * Sets up the Firebase onAuthStateChanged observer
   * @private
   */
  _initAuthObserver() {
    if (this.auth && this.authModule?.onAuthStateChanged) {
      try {
        this._unsubscribeFirebase = this.authModule.onAuthStateChanged(this.auth, (user) => {
          this.currentUser = user ? this._formatUser(user) : null;
          this._notifyListeners();
        });
      } catch (err) {
        console.warn('Could not bind Firebase onAuthStateChanged observer:', err);
      }
    }
  }

  /**
   * Helper to format Firebase user object
   * @private
   */
  _formatUser(user) {
    if (!user) return null;
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      getIdToken: typeof user.getIdToken === 'function' ? () => user.getIdToken() : undefined
    };
  }

  _notifyListeners() {
    const state = {
      isAuthenticated: this.isAuthenticated(),
      isOwner: this.isOwner(),
      user: this.getCurrentUser()
    };
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('Auth state listener error:', err);
      }
    }
  }

  getCurrentUser() {
    if (this.currentUser) return this.currentUser;
    // Fall back to active user on Firebase auth instance if available
    if (this.auth?.currentUser) {
      this.currentUser = this._formatUser(this.auth.currentUser);
      return this.currentUser;
    }
    return null;
  }

  getSession() {
    const user = this.getCurrentUser();
    if (!user) return null;
    return {
      uid: user.uid,
      user
    };
  }

  isAuthenticated() {
    return Boolean(this.getCurrentUser()?.uid);
  }

  /**
   * Checks whether the authenticated user is the designated owner.
   * Fails closed: If owner UID is not configured or user is anonymous/different, returns false.
   * @returns {boolean}
   */
  isOwner() {
    if (!this.isAuthenticated()) return false;
    // Fail closed: No user receives owner permissions if ownerUid is missing
    if (!this.ownerUid) return false;
    const user = this.getCurrentUser();
    return Boolean(user && user.uid === this.ownerUid);
  }

  /**
   * Signs in a user using Firebase Email and Password.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ user: object, token: string }>}
   */
  async signIn(email, password) {
    const cleanEmail = (email || '').trim();
    if (!cleanEmail || !password) {
      throw new AppError('Please provide both email and password.', ErrorTypes.VALIDATION);
    }

    const authMod = this.authModule || getFirebaseSdkModules()?.auth;
    if (!this.auth || !authMod?.signInWithEmailAndPassword) {
      throw new AppError(
        'Firebase Authentication is not configured or initialized.',
        ErrorTypes.CONFIG
      );
    }

    try {
      const userCredential = await authMod.signInWithEmailAndPassword(
        this.auth,
        cleanEmail,
        password
      );

      const user = this._formatUser(userCredential.user);
      this.currentUser = user;

      // Verify owner authorization
      if (!this.isOwner()) {
        // Immediately sign out unauthorized accounts to prevent lingering sessions
        await this.signOut();
        throw new AppError(
          'Unauthorized: This account is not designated as the portfolio owner.',
          ErrorTypes.PERMISSION
        );
      }

      this._notifyListeners();

      let token = 'firebase-session-token';
      if (typeof userCredential.user?.getIdToken === 'function') {
        token = await userCredential.user.getIdToken();
      }

      return {
        user,
        token
      };
    } catch (err) {
      if (err instanceof AppError) throw err;

      let message = err.message || 'Authentication failed.';
      const code = err.code || '';

      if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
        message = 'Invalid email or password.';
      } else if (code === 'auth/too-many-requests') {
        message = 'Too many failed sign-in attempts. Please wait a moment and try again.';
      } else if (code === 'auth/user-disabled') {
        message = 'This account has been disabled.';
      } else if (code === 'auth/network-request-failed') {
        message = 'Network error: Could not reach Firebase Authentication service.';
      }

      throw new AppError(message, ErrorTypes.AUTH, err);
    }
  }

  /**
   * Signs out the current user.
   * @returns {Promise<void>}
   */
  async signOut() {
    const authMod = this.authModule || getFirebaseSdkModules()?.auth;
    if (this.auth && authMod?.signOut) {
      try {
        await authMod.signOut(this.auth);
      } catch (err) {
        console.warn('Firebase signOut notice:', err);
      }
    }
    this.currentUser = null;
    this._notifyListeners();
  }

  /**
   * Registers a callback for authentication state changes.
   * @param {(state: { isAuthenticated: boolean, isOwner: boolean, user: object|null }) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onAuthStateChange(callback) {
    this.listeners.add(callback);
    // Immediately invoke with current state
    try {
      callback({
        isAuthenticated: this.isAuthenticated(),
        isOwner: this.isOwner(),
        user: this.getCurrentUser()
      });
    } catch (err) {
      console.error('Initial auth state listener error:', err);
    }
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Cleanup observer if adapter is discarded
   */
  destroy() {
    if (typeof this._unsubscribeFirebase === 'function') {
      this._unsubscribeFirebase();
      this._unsubscribeFirebase = null;
    }
    this.listeners.clear();
  }
}
