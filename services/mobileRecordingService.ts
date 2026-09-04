import { RecordedStep } from '../types';

export const DEFAULT_MOBILE_USER_EMAIL = 'sowbarnya@qaoncloud.com';

const jsonHeaders = { 'Content-Type': 'application/json' };

async function readJson(response: Response) {
  if (!response.ok) throw new Error(`Mobile agent request failed (${response.status})`);
  return response.json();
}

export async function performMobileDeviceAction(email: string, action: string, params: Record<string, unknown>) {
  return readJson(await fetch('/api/device-agent/perform-action', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, action, params })
  }));
}

export async function clearPendingMobileDeviceActions(email: string) {
  return readJson(await fetch('/api/device-agent/clear-pending-actions', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email })
  }));
}

export async function getMobileLiveFrame(email: string): Promise<{ frame?: string; error?: string }> {
  return readJson(await fetch(`/api/device-agent/live-frame?email=${encodeURIComponent(email)}`));
}

export async function getMobileSessionSteps(email: string): Promise<RecordedStep[]> {
  const data = await readJson(await fetch(`/api/mobile/session/steps?email=${encodeURIComponent(email)}`));
  return Array.isArray(data.steps) ? data.steps : [];
}

export async function clearMobileSessionSteps(email: string) {
  return readJson(await fetch('/api/mobile/session/clear-steps', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email })
  }));
}
