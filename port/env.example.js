/**
 * Example Environment Configuration (Firebase Spark Free Tier Template)
 *
 * Copy this file to `env.js` and configure your Firebase project credentials.
 * Include `env.js` before `app.js` in `index.html`.
 *
 * IMPORTANT SECURITY RULES:
 * 1. Only expose public client configuration fields below.
 * 2. NEVER put a Firebase service account private key or admin credentials in this file.
 * 3. Portfolio security is enforced by Cloud Firestore Security Rules and Firebase Authentication.
 * 4. Obtain these values from Firebase Console -> Project Settings -> General -> Your apps -> Web app.
 * 5. Obtain FIREBASE_OWNER_UID from Firebase Console -> Authentication -> Users tab after creating your owner account.
 */
window.__ENV__ = {
  APP_NAME: 'Deepak · Digital Humanities Portfolio',
  NODE_ENV: 'production',
  BACKEND_PROVIDER: 'firebase', // 'firebase' or 'local'
  AUTH_PROVIDER: 'firebase',    // 'firebase' or 'local'
  DATABASE_PROVIDER: 'firebase',// 'firebase' or 'local'

  // Firebase Public Web Client Configuration (Safe for client browsers)
  FIREBASE_API_KEY: 'your-api-key-here',
  FIREBASE_AUTH_DOMAIN: 'your-project-id.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'your-project-id',
  FIREBASE_APP_ID: '1:1234567890:web:abcdef123456',
  FIREBASE_MESSAGING_SENDER_ID: '1234567890',

  // Designated owner Firebase Authentication UID
  // Used by the client UI for showing owner editing controls.
  // The true security boundary is enforced by Firestore Security Rules.
  FIREBASE_OWNER_UID: 'your-owner-firebase-uid-here'
};
