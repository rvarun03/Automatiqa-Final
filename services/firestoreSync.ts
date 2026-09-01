import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc 
} from "firebase/firestore";
import { mainDb, backupDb, db, useBackup, handleFirestoreError, OperationType } from "../firebase";

/**
 * Recursively strips out any keys with `undefined` values,
 * preventing Firestore "Function setDoc() called with invalid data. Unsupported field value: undefined" errors.
 * Preserves Date, FieldValue (arrayUnion, arrayRemove, serverTimestamp, etc.), and custom Firestore objects.
 */
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return obj;
  }
  // Preserve Firestore FieldValue and custom class instances
  const constructorName = obj?.constructor?.name;
  if (
    constructorName &&
    constructorName !== 'Object' &&
    constructorName !== 'Array'
  ) {
    return obj;
  }
  if (
    typeof (obj as any)?._methodName === 'string' ||
    typeof (obj as any)?.isEqual === 'function' ||
    (obj as any)?._delegate !== undefined
  ) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore) as unknown as T;
  }
  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      cleaned[key] = sanitizeForFirestore(val);
    }
  }
  return cleaned as T;
}

/**
 * Dual Database Synchronization Policy:
 * 1. AutomatiQA (Original DB, Paid Plan):
 *    - Primary data store for all Read, Write (Create/Set/Update), and Delete operations.
 *    - All application queries, real-time listeners (onSnapshot), and reads occur on the Original DB.
 * 2. AutomatiQA Backup (Backup DB, Spark Plan):
 *    - Write-only replication target (Add, Set, Update operations replicate sequentially).
 *    - Reads do not occur here unless an automatic failover is triggered by network/quota unavailability.
 * 3. Deletions:
 *    - Executed ONLY on the Original DB.
 *    - Deletions are NEVER propagated to the Backup DB so that all data is permanently preserved in the backup database.
 */

const logSuccessMain = () => console.log("✓ Saved to Original Database");
const logSuccessBackup = () => console.log("✓ Saved to Backup Database");
const logBackupFailure = (err: any) => console.warn("⚠ Backup synchronization note:", err);

/**
 * Adds a new document to the collection, preserving the auto-generated ID across both databases.
 */
export async function syncAddDoc(collectionRef: any, data: any) {
  const cleanData = sanitizeForFirestore(data);
  const path = collectionRef.path;
  
  if (useBackup) {
    const backupDocRef = doc(collection(db, path));
    await setDoc(backupDocRef, cleanData);
    logSuccessBackup();
    return backupDocRef;
  }
  
  // Create a document reference on the main database with an auto-generated ID
  const mainDocRef = doc(collection(mainDb, path));
  const docId = mainDocRef.id;

  let mainSuccess = false;
  // 1. Try Write to Original Database
  try {
    await setDoc(mainDocRef, cleanData);
    logSuccessMain();
    mainSuccess = true;
  } catch (mainErr) {
    handleFirestoreError(mainErr, OperationType.WRITE, path);
    // Write directly to Backup Database as fallback
    const backupDocRef = doc(backupDb, path, docId);
    await setDoc(backupDocRef, cleanData);
    logSuccessBackup();
    return backupDocRef;
  }

  // 2. Write sequentially to Backup Database (write-only replication)
  if (mainSuccess) {
    try {
      const backupDocRef = doc(backupDb, path, docId);
      await setDoc(backupDocRef, cleanData);
      logSuccessBackup();
    } catch (err) {
      logBackupFailure(err);
    }
  }

  return mainDocRef;
}

/**
 * Sets document data, supporting options (such as merge).
 */
export async function syncSetDoc(docRef: any, data: any, options?: any) {
  const cleanData = sanitizeForFirestore(data);
  const path = docRef.path;

  if (useBackup) {
    if (options) {
      await setDoc(doc(db, path), cleanData, options);
    } else {
      await setDoc(doc(db, path), cleanData);
    }
    logSuccessBackup();
    return;
  }

  let mainSuccess = false;
  // 1. Try Write to Original Database
  try {
    if (options) {
      await setDoc(doc(mainDb, path), cleanData, options);
    } else {
      await setDoc(doc(mainDb, path), cleanData);
    }
    logSuccessMain();
    mainSuccess = true;
  } catch (mainErr) {
    handleFirestoreError(mainErr, OperationType.WRITE, path);
    // Write directly to Backup Database as fallback
    if (options) {
      await setDoc(doc(backupDb, path), cleanData, options);
    } else {
      await setDoc(doc(backupDb, path), cleanData);
    }
    logSuccessBackup();
    return;
  }

  // 2. Write sequentially to Backup Database (write-only replication)
  if (mainSuccess) {
    try {
      if (options) {
        await setDoc(doc(backupDb, path), cleanData, options);
      } else {
        await setDoc(doc(backupDb, path), cleanData);
      }
      logSuccessBackup();
    } catch (err) {
      logBackupFailure(err);
    }
  }
}

/**
 * Updates an existing document in both databases (upsert with merge: true).
 */
export async function syncUpdateDoc(docRef: any, data: any) {
  const cleanData = sanitizeForFirestore(data);
  const path = docRef.path;

  if (useBackup) {
    try {
      await setDoc(doc(db, path), cleanData, { merge: true });
      logSuccessBackup();
    } catch (e) {
      logBackupFailure(e);
    }
    return;
  }

  let mainSuccess = false;
  // 1. Try Write to Original Database (using setDoc with merge: true to avoid 'No document to update' on unseeded/missing documents)
  try {
    await setDoc(doc(mainDb, path), cleanData, { merge: true });
    logSuccessMain();
    mainSuccess = true;
  } catch (mainErr) {
    handleFirestoreError(mainErr, OperationType.WRITE, path);
    // Write directly to Backup Database as fallback
    try {
      await setDoc(doc(backupDb, path), cleanData, { merge: true });
      logSuccessBackup();
    } catch (e) {
      logBackupFailure(e);
    }
    return;
  }

  // 2. Write sequentially to Backup Database (write-only replication)
  if (mainSuccess) {
    try {
      await setDoc(doc(backupDb, path), cleanData, { merge: true });
      logSuccessBackup();
    } catch (err) {
      logBackupFailure(err);
    }
  }
}

/**
 * Deletes a document from the Original Database ONLY.
 * Backup Database preserves all created and modified documents permanently,
 * ensuring all data remains stored and available in the backup DB.
 */
export async function syncDeleteDoc(docRef: any) {
  const path = docRef.path;

  if (useBackup) {
    // If currently operating under backup fallback mode, perform delete
    try {
      await deleteDoc(doc(db, path));
      console.log("✓ Deleted from active database");
    } catch (err) {
      console.warn("Delete error on active fallback:", err);
    }
    return;
  }

  // Delete from Original Database ONLY
  try {
    await deleteDoc(doc(mainDb, path));
    console.log("✓ Deleted from Original Database (Preserved in Backup Database)");
  } catch (mainErr) {
    handleFirestoreError(mainErr, OperationType.DELETE, path);
  }
  // Note: We deliberately do NOT delete from backupDb so that all data is retained in the Backup DB.
}
