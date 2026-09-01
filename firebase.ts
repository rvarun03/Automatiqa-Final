// src/firebase.ts
import { initializeApp } from "firebase/app";
import { initializeFirestore, setLogLevel } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import firebaseConfig from "./firebase-applet-config.json";

try {
  setLogLevel('error');
} catch (e) {}

const app = initializeApp(firebaseConfig);
const mainDb = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, (firebaseConfig as any).firestoreDatabaseId);

const backupFirebaseConfig = {
  apiKey: "AIzaSyDbykadbZnG1pcnykQpbgPsR-uOl1tL934",
  authDomain: "automatiqa-backup.firebaseapp.com",
  projectId: "automatiqa-backup",
  storageBucket: "automatiqa-backup.firebasestorage.app",
  messagingSenderId: "476017422921",
  appId: "1:476017422921:web:bd2c64a9554ec90edc0598"
};

const backupApp = initializeApp(backupFirebaseConfig, "backup");
const backupDb = initializeFirestore(backupApp, {
  experimentalForceLongPolling: true,
});

export let db = mainDb;
export let useBackup = false;

export function switchToBackupDb() {
  if (!useBackup) {
    db = backupDb;
    useBackup = true;
    console.warn("⚠️ Firestore Quota or Connection limit hit. Dynamic live-binding switched to backupDb.");
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('firestore-db-fallback'));
    }
  }
}

export const auth = getAuth(app);
export const backupAuth = getAuth(backupApp);

export {
  mainDb,
  backupDb
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const errorCode = String((error as any)?.code || (error as any)?.name || '');
  
  const isQuotaError = 
    errorCode.includes('resource-exhausted') ||
    errorCode.includes('resource_exhausted') ||
    errorMsg.toLowerCase().includes('quota') || 
    errorMsg.toLowerCase().includes('billing') || 
    errorMsg.toLowerCase().includes('exceeded') || 
    errorMsg.toLowerCase().includes('limit') ||
    errorMsg.toLowerCase().includes('resource-exhausted') ||
    errorMsg.toLowerCase().includes('resource_exhausted') ||
    errorMsg.toLowerCase().includes('429');

  const isConnectionError = 
    errorCode.includes('unavailable') ||
    errorMsg.toLowerCase().includes('unavailable') || 
    errorMsg.toLowerCase().includes('reach cloud firestore') || 
    errorMsg.toLowerCase().includes('could not reach') || 
    errorMsg.toLowerCase().includes('offline');

  if (isQuotaError || isConnectionError) {
    switchToBackupDb();
    console.warn("⚠️ Firestore connection or quota issue detected. Switched to backupDb. Error detail:", errorMsg);
    return; // Recovered gracefully! No console.error or throw.
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}
