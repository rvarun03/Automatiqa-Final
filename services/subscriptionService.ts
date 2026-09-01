import { collection, doc, getDocs, getDoc, setDoc, query, orderBy, onSnapshot } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { SubscriptionRequest, NotificationType, UserRole } from "../types";
import { syncSetDoc, syncUpdateDoc } from "./firestoreSync";
import { createNotification, notifyAdmins } from "./notificationService";
import { formatToIST, TOTAL_CREDIT_POOL } from "./tokenConsumptionService";
import { logActivity } from "./activityService";

const LOCAL_STORAGE_KEY = 'automatiqa_subscription_requests';

// In-memory / local fallback store
export const getLocalSubscriptionRequests = (): SubscriptionRequest[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

export const saveLocalSubscriptionRequests = (requests: SubscriptionRequest[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(requests));
    window.dispatchEvent(new CustomEvent('subscription-request-updated', { detail: requests }));
  } catch (e) {
    console.warn("Failed to save local subscription requests:", e);
  }
};

/**
 * Fetch all subscription requests from Firestore (with local storage fallback)
 */
export const getSubscriptionRequests = async (): Promise<SubscriptionRequest[]> => {
  const path = "subscription_requests";
  try {
    const snap = await getDocs(query(collection(db, path)));
    if (!snap.empty) {
      const requests: SubscriptionRequest[] = [];
      snap.forEach(d => {
        requests.push({ id: d.id, ...(d.data() as any) });
      });
      // Sort newest first
      requests.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
      saveLocalSubscriptionRequests(requests);
      return requests;
    }
  } catch (error) {
    console.warn("Failed to fetch subscription requests from Firestore:", error);
  }
  return getLocalSubscriptionRequests();
};

/**
 * Create a new subscription renewal request when user exceeds 1,000 credits
 */
export const createSubscriptionRequest = async (
  userEmail: string,
  userName: string,
  currentUsedCredits: number = 1000,
  notes?: string
): Promise<SubscriptionRequest> => {
  const cleanEmail = userEmail.toLowerCase().trim();
  const now = Date.now();
  const dateFormatted = formatToIST(now);

  const requestObj: SubscriptionRequest = {
    id: `sub_req_${now}_${Math.random().toString(36).substring(2, 7)}`,
    userEmail: cleanEmail,
    userName: userName || cleanEmail.split('@')[0],
    requestedAt: now,
    requestedDateFormatted: dateFormatted,
    requestedAtFormatted: dateFormatted,
    status: 'PENDING',
    creditsRequested: 1000,
    requestedCredits: 1000,
    currentUsedCredits,
    planName: 'AutomatiQA 1,000 Credit Pack (32-Day Validity)',
    notes: notes || 'Exceeded 1,000 credit limit. Requested subscription re-enablement.'
  };

  // 1. Save locally
  const currentRequests = getLocalSubscriptionRequests();
  const existingIdx = currentRequests.findIndex(r => r.userEmail === cleanEmail && r.status === 'PENDING');
  if (existingIdx >= 0) {
    currentRequests[existingIdx] = requestObj;
  } else {
    currentRequests.unshift(requestObj);
  }
  saveLocalSubscriptionRequests(currentRequests);

  // 2. Save to Firestore
  try {
    const ref = doc(db, "subscription_requests", requestObj.id);
    await syncSetDoc(ref, requestObj);
  } catch (err) {
    console.warn("Failed to sync subscription request to Firestore:", err);
  }

  // 3. Notify Super Admins
  try {
    await notifyAdmins(
      '🚨 Subscription Re-Enablement Request',
      `User ${userName} (${cleanEmail}) has exceeded their 1,000 credit limit and clicked Subscribe. Please re-enable their subscription in the Credit Consumption page.`,
      userName || cleanEmail,
      NotificationType.SUBSCRIPTION_REQUEST
    );
  } catch (err) {
    console.warn("Failed to notify admins of subscription request:", err);
  }

  // 4. Also trigger backend notification / email route
  try {
    await fetch('/api/subscription/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userEmail: cleanEmail,
        userName,
        currentUsedCredits,
        notes: requestObj.notes
      })
    });
  } catch (err) {
    console.warn("Server subscription notify endpoint warning:", err);
  }

  // 5. Global events
  window.dispatchEvent(new CustomEvent('subscription-request-created', { detail: requestObj }));

  return requestObj;
};

/**
 * Super Admin Re-enables subscription for the user:
 * - Resets user's consumed credit tally to 0 (granting fresh 1,000 credits & 32-day validity)
 * - Updates request status to 'APPROVED'
 * - Sends in-app and email notification to the user
 */
export const reEnableUserSubscription = async (
  requestId: string,
  userEmail: string,
  userName?: string,
  adminEmail: string = 'automatiqa@qaoncloud.com',
  additionalCredits: number = 1000,
  validityDays: number = 32
): Promise<boolean> => {
  const cleanEmail = userEmail.toLowerCase().trim();
  const displayName = userName || cleanEmail.split('@')[0];
  const now = Date.now();
  const dateFormatted = formatToIST(now);

  // 1. Update request status in Firestore
  try {
    if (requestId) {
      const ref = doc(db, "subscription_requests", requestId);
      await syncUpdateDoc(ref, {
        status: 'APPROVED',
        approvedAt: now,
        approvedAtFormatted: dateFormatted,
        approvedBy: adminEmail
      });
    }
  } catch (err) {
    console.warn("Failed to update subscription request in Firestore:", err);
  }

  // 2. Update local requests
  const localReqs = getLocalSubscriptionRequests().map(r => {
    if (r.id === requestId || (r.userEmail === cleanEmail && r.status === 'PENDING')) {
      return {
        ...r,
        status: 'APPROVED' as const,
        approvedAt: now,
        approvedAtFormatted: dateFormatted,
        approvedBy: adminEmail
      };
    }
    return r;
  });
  saveLocalSubscriptionRequests(localReqs);

  // 3. Reset User's credit consumption in Token Logs
  try {
    // Reset in local storage
    const tokenLogsRaw = localStorage.getItem('automatiqa_token_consumption_logs');
    if (tokenLogsRaw) {
      const logs = JSON.parse(tokenLogsRaw);
      // Remove or reset old logs for this user to grant fresh 1,000 credits pool
      const updatedLogs = logs.filter((l: any) => (l.userEmail || '').toLowerCase().trim() !== cleanEmail);
      localStorage.setItem('automatiqa_token_consumption_logs', JSON.stringify(updatedLogs));
    }

    // Set renewal metadata for user in localStorage
    localStorage.setItem(`automatiqa_subscription_renewed_${cleanEmail}`, JSON.stringify({
      renewedAt: now,
      renewedBy: adminEmail,
      creditsGranted: additionalCredits,
      validityDays
    }));

    // Dispatch global event so all components immediately update
    window.dispatchEvent(new CustomEvent('token-consumption-updated'));
    window.dispatchEvent(new CustomEvent('subscription-request-updated'));
  } catch (e) {
    console.warn("Failed to reset local token logs for user:", e);
  }

  // 4. Send In-App Notification to User
  try {
    await createNotification({
      recipientEmail: cleanEmail,
      senderName: 'Super Admin',
      type: NotificationType.SUBSCRIPTION_APPROVED,
      title: '🎉 Subscription Re-Enabled by Super Admin',
      message: `Your AutomatiQA subscription has been successfully renewed and re-enabled by Super Admin! You now have a fresh pool of ${additionalCredits} AI generation credits and ${validityDays} days of validity.`
    });
  } catch (err) {
    console.warn("Failed to create user approval notification:", err);
  }

  // 5. Trigger Backend Email/Notification Route
  try {
    await fetch('/api/subscription/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        userEmail: cleanEmail,
        userName: displayName,
        adminEmail,
        adminName: 'Super Admin',
        creditsGranted: additionalCredits
      })
    });
  } catch (err) {
    console.warn("Server subscription approve endpoint warning:", err);
  }

  // 6. Log Activity
  try {
    await logActivity(
      adminEmail,
      'Super Admin',
      `Re-enabled subscription for ${cleanEmail} (+${additionalCredits} Credits & ${validityDays} Days Validity)`,
      'global',
      'Global Subscription'
    );
  } catch (e) {}

  return true;
};

/**
 * Super Admin directly grants credits or renews subscription for any user without a pending request
 */
export const grantDirectSubscription = async (
  userEmail: string,
  userName?: string,
  adminEmail: string = 'automatiqa@qaoncloud.com',
  credits: number = 1000,
  validityDays: number = 32
): Promise<boolean> => {
  const dummyRequestId = `direct-sub-${Date.now()}`;
  return reEnableUserSubscription(dummyRequestId, userEmail, userName, adminEmail, credits, validityDays);
};
