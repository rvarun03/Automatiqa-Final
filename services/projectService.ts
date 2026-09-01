import {
  collection,
  getDocs,
  query,
  where,
  doc,
  arrayUnion,
  serverTimestamp,
  getDoc,
  Timestamp,
  FieldValue
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { syncAddDoc, syncUpdateDoc, syncDeleteDoc, syncSetDoc } from "./firestoreSync";

/**
 * Recursively cleans an object for Firestore.
 */
export const cleanFirestoreData = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj === undefined ? null : obj;
  }

  const constructorName = obj.constructor?.name;
  if (
    obj instanceof Timestamp || 
    obj instanceof FieldValue ||
    constructorName === 'Timestamp' || 
    constructorName === 'FieldValue' ||
    constructorName === 'FieldValueImpl' || 
    obj._methodName !== undefined
  ) {
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (Array.isArray(obj)) {
    return obj
      .map(item => cleanFirestoreData(item))
      .filter(item => item !== undefined);
  }

  const cleaned: Record<string, any> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key];
      const cleanedVal = cleanFirestoreData(val);
      if (cleanedVal !== undefined) {
        cleaned[key] = cleanedVal;
      }
    }
  }
  return cleaned;
};

/**
 * Estimates the size of an object in bytes for Firestore 1MB limit.
 */
export const estimateSize = (obj: any): number => {
  try {
    const str = JSON.stringify(obj);
    return str ? new Blob([str]).size : 0;
  } catch (e) {
    return 0;
  }
};

/**
 * Aggressively prunes and sanitizes project data to stay well within Firestore's 1MB limit.
 * Focuses on compressing/stripping large base64 attachments, redundant screenshots, and bulky binary data.
 */
export const pruneProjectData = (project: any): any => {
  const deepClone = (val: any): any => {
    if (val === null || typeof val !== 'object') return val;
    const constructorName = val.constructor?.name;
    if (
      val instanceof Timestamp || 
      val instanceof FieldValue ||
      constructorName === 'Timestamp' || 
      constructorName === 'FieldValue' ||
      constructorName === 'FieldValueImpl' || 
      val._methodName !== undefined ||
      val instanceof Date
    ) {
      return val;
    }
    if (Array.isArray(val)) return val.map(deepClone);
    const res: Record<string, any> = {};
    for (const k in val) {
      if (Object.prototype.hasOwnProperty.call(val, k)) {
        res[k] = deepClone(val[k]);
      }
    }
    return res;
  };

  const cloned = deepClone(project);
  
  // Helper to sanitize oversized base64 strings in an object tree
  const sanitizeHeavyDataUrls = (obj: any, maxLen = 40000): any => {
    if (!obj) return obj;
    if (typeof obj === 'string') {
      if (obj.startsWith('/artifacts/') || obj.startsWith('/api/artifacts/') || obj.startsWith('http://') || obj.startsWith('https://')) {
        return obj;
      }
      if ((obj.startsWith('data:') || obj.startsWith('blob:')) && obj.length > maxLen) {
        return '';
      }
      if (obj.length > 80000) {
        return obj.substring(0, 80000);
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      const sanitized = obj.map(item => sanitizeHeavyDataUrls(item, maxLen));
      // If array of strings, filter out empty strings left by sanitization
      if (sanitized.some(s => typeof s === 'string')) {
        const filtered = sanitized.filter(s => typeof s !== 'string' || s.trim().length > 0);
        return filtered;
      }
      return sanitized;
    }
    if (typeof obj === 'object') {
      const constructorName = obj.constructor?.name;
      if (
        obj instanceof Timestamp || 
        obj instanceof FieldValue ||
        constructorName === 'Timestamp' || 
        constructorName === 'FieldValue' ||
        constructorName === 'FieldValueImpl' || 
        obj._methodName !== undefined ||
        obj instanceof Date
      ) {
        return obj;
      }
      for (const key of Object.keys(obj)) {
        obj[key] = sanitizeHeavyDataUrls(obj[key], maxLen);
      }
    }
    return obj;
  };

  let currentSize = estimateSize(cloned);
  const LIMIT = 800000; // 800KB safe Firestore threshold (Firestore hard max is 1MB)

  if (currentSize < LIMIT) return cloned;

  console.warn(`Pruning project data: Current size ${Math.round(currentSize / 1024)}KB exceeds threshold.`);

  // 1. COLLECT ALL TEST CASES WITH ATTACHMENTS
  const allCases: any[] = [];
  if (cloned.manualTestCases) allCases.push(...cloned.manualTestCases);
  if (cloned.scenarios) {
    cloned.scenarios.forEach((s: any) => {
      if (s.testCases) allCases.push(...s.testCases);
    });
  }

  // 2. PRUNE INLINE BASE64 VIDEO FRAMES IF OVER LIMIT (Server disk & IndexedDB retain them)
  if (estimateSize(cloned) > LIMIT) {
    if (cloned.uiTestingInputs) {
      cloned.uiTestingInputs.forEach((inp: any) => {
        if (inp.videos) {
          inp.videos.forEach((v: any) => {
            if (v.frames && Array.isArray(v.frames) && v.frames.some((f: any) => typeof f === 'string' && f.length > 5000)) {
              v.frames = v.frames.map((f: any) => (typeof f === 'string' && f.startsWith('data:') && f.length > 20000 ? '' : f)).filter(Boolean);
            }
          });
        }
      });
    }

    if (cloned.uiTestingReports) {
      cloned.uiTestingReports.forEach((rep: any) => {
        if (rep.videos) {
          rep.videos.forEach((v: any) => {
            if (v.frames && Array.isArray(v.frames) && v.frames.some((f: any) => typeof f === 'string' && f.length > 5000)) {
              v.frames = v.frames.map((f: any) => (typeof f === 'string' && f.startsWith('data:') && f.length > 20000 ? '' : f)).filter(Boolean);
            }
          });
        }
      });
    }
  }

  // 3. PRUNE ATTACHMENTS FROM "PASS" CASES FIRST
  for (const tc of allCases) {
    if (estimateSize(cloned) < LIMIT) break;
    if (tc.status === 'PASS' && (tc.attachments?.length > 0 || tc.evidence || tc.videoEvidence)) {
      tc.attachments = [];
      tc.evidence = "";
      tc.videoEvidence = "";
      tc.notes = (tc.notes || "") + " [Evidence purged]";
    }
  }

  // 4. SANITIZE RAW OVERSIZED UNCOMPRESSED DATA URLS (> 200KB) ONLY IF STILL OVER LIMIT
  if (estimateSize(cloned) > LIMIT) {
    sanitizeHeavyDataUrls(cloned, 200000);
  }

  // 5. PRUNE OLD PERFORMANCE REPORTS (Keep 5)
  if (estimateSize(cloned) > LIMIT && cloned.performanceScripts && cloned.performanceScripts.length > 5) {
    cloned.performanceScripts = cloned.performanceScripts
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }

  // 6. PRUNE API HISTORY (Keep 5)
  if (estimateSize(cloned) > LIMIT && cloned.apiHistory && cloned.apiHistory.length > 5) {
    cloned.apiHistory = cloned.apiHistory.slice(0, 5);
  }

  // 7. PRUNE AUTOMATION SCRIPT EVIDENCE
  if (estimateSize(cloned) > LIMIT && cloned.automationScripts) {
    cloned.automationScripts.forEach((s: any) => {
      if (estimateSize(cloned) < LIMIT) return;
      s.evidence = "";
      s.contextImages = [];
    });
  }

  // 8. PRUNE API WORKSPACE SAVED RESPONSES
  if (estimateSize(cloned) > LIMIT && cloned.apiWorkspaces) {
    cloned.apiWorkspaces.forEach((w: any) => {
      w.requests?.forEach((r: any) => {
        if (estimateSize(cloned) < LIMIT) return;
        r.savedResponse = null;
      });
      w.collections?.forEach((c: any) => {
        c.requests?.forEach((r: any) => {
          if (estimateSize(cloned) < LIMIT) return;
          r.savedResponse = null;
        });
      });
    });
  }

  // 9. EMERGENCY PURGE: All base64 attachments on test cases & scenarios if still large
  if (estimateSize(cloned) > LIMIT) {
    for (const tc of allCases) {
      if (estimateSize(cloned) < LIMIT) break;
      tc.attachments = [];
      tc.evidence = "";
      tc.videoEvidence = "";
    }
    if (cloned.scenarios) {
      cloned.scenarios.forEach((s: any) => {
        if (s.attachments) s.attachments = [];
        if (s.inputImages) s.inputImages = [];
        if (s.contextImages) s.contextImages = [];
        if (s.evidence) s.evidence = "";
      });
    }
  }

  // 10. ULTRA-AGGRESSIVE PASS: Sanitize all base64 data URLs > 5KB
  if (estimateSize(cloned) > LIMIT) {
    sanitizeHeavyDataUrls(cloned, 5000);
  }

  return cloned;
};

export const saveProject = async (projectData: any): Promise<string> => {
  const initialData = {
    ...projectData,
    scenarios: [],
    manualTestCases: [],
    automationScripts: [],
    apiTestSuites: [],
    performanceScripts: [],
    userStories: [],
    automationFolders: [],
    uiTestingFolders: [],
    uiTestingInputs: [],
    uiTestingReports: [],
    figmaDesignReviews: [],
    uiComparisonReports: [],
    recordedFlows: [],
    allocatedUserEmails: projectData.allocatedUserEmails || [],
    createdAt: serverTimestamp()
  };

  const path = "projects";
  const docRef = await syncAddDoc(collection(db, path), cleanFirestoreData(initialData));
  return docRef.id;
};

export const getProjects = async (userEmail: string) => {
  const path = "projects";
  const ownedQuery = query(
    collection(db, path),
    where("ownerEmail", "==", userEmail)
  );

  const allocatedQuery = query(
    collection(db, path),
    where("allocatedUserEmails", "array-contains", userEmail)
  );

  try {
    const [ownedSnap, allocSnap] = await Promise.all([
      getDocs(ownedQuery),
      getDocs(allocatedQuery)
    ]);

    const map = new Map<string, any>();
    ownedSnap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
    allocSnap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));

    return Array.from(map.values());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return [];
  }
};

export const updateProjectFirestore = async (projectId: string, data: any) => {
  if (!projectId) return;
  const path = `projects/${projectId}`;
  const ref = doc(db, "projects", projectId);
  const { id, ...cleanData } = data;
  
  // Clean and Estimate
  let finalizedData = cleanFirestoreData(cleanData);
  
  // Apply aggressive pruning if necessary
  finalizedData = pruneProjectData(finalizedData);
  finalizedData.updatedAt = serverTimestamp();

  let size = estimateSize(finalizedData);

  // If still above 750KB, apply emergency strip of any remaining large strings/images
  if (size > 750 * 1024) {
    const emergencySanitize = (obj: any): any => {
      if (!obj) return obj;
      if (typeof obj === 'string') {
        if (obj.startsWith('data:') || obj.startsWith('blob:')) {
          return ''; // Strip base64 data URLs in emergency
        }
        if (obj.length > 20000) {
          return obj.substring(0, 20000);
        }
        return obj;
      }
      if (Array.isArray(obj)) return obj.map(emergencySanitize);
      if (typeof obj === 'object') {
        const res: any = {};
        for (const k of Object.keys(obj)) {
          res[k] = emergencySanitize(obj[k]);
        }
        return res;
      }
      return obj;
    };
    finalizedData = emergencySanitize(finalizedData);
  }

  try {
    await syncUpdateDoc(ref, finalizedData);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

export const deleteProject = async (projectId: string) => {
  if (!projectId) return;
  const path = `projects/${projectId}`;
  const ref = doc(db, "projects", projectId);
  try {
    await syncDeleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};

export const allocateProject = async (projectId: string, email: string, role: 'Admin' | 'Team Member' = 'Team Member') => {
  if (!projectId || !email) return;
  const projectPath = `projects/${projectId}`;
  const projectRef = doc(db, "projects", projectId);
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const projectSnap = await getDoc(projectRef);
    if (projectSnap.exists()) {
      const pData = projectSnap.data();
      const currentRoles = pData.projectRoles || {};
      const updatedRoles = { ...currentRoles, [normalizedEmail]: role };
      await syncUpdateDoc(projectRef, {
        allocatedUserEmails: arrayUnion(normalizedEmail),
        projectRoles: updatedRoles
      });
    } else {
      await syncUpdateDoc(projectRef, {
        allocatedUserEmails: arrayUnion(normalizedEmail)
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, projectPath);
  }

  const userPath = `users/${normalizedEmail}`;
  const userRef = doc(db, "users", normalizedEmail);
  
  try {
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      await syncUpdateDoc(userRef, {
        assignedProjectIds: arrayUnion(projectId)
      });
    } else {
      await syncSetDoc(userRef, {
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0],
        role: role === 'Admin' ? 'Admin' : 'Team Member',
        status: 'active',
        assignedProjectIds: [projectId],
        createdAt: new Date().toISOString()
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
};