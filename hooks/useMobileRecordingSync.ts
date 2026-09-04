import { Dispatch, MutableRefObject, SetStateAction, useEffect } from 'react';
import { RecordedStep } from '../types';
import { getMobileLiveFrame, getMobileSessionSteps } from '../services/mobileRecordingService';
import { mergeMobileRecordedSteps } from '../utils/mobileRecordingSteps';

interface MobileRecordingSyncOptions {
  enabled: boolean;
  email: string;
  recordingRef: MutableRefObject<boolean>;
  socketRef: MutableRefObject<{ connected?: boolean } | null>;
  setSteps: Dispatch<SetStateAction<RecordedStep[]>>;
  setFrame: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

/** Owns mobile frame/step polling so RecordAndPlay remains only an orchestrator. */
export function useMobileRecordingSync({
  enabled,
  email,
  recordingRef,
  socketRef,
  setSteps,
  setFrame,
  setError
}: MobileRecordingSyncOptions) {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const poll = async () => {
      try {
        if (!socketRef.current?.connected) {
          const data = await getMobileLiveFrame(email);
          if (!cancelled && data.frame) {
            setFrame(current => current === data.frame ? current : data.frame!);
            setError(null);
          } else if (!cancelled && data.error?.includes('Appium')) {
            setError('Unable to start Appium. Verify Appium installation and Device Agent status.');
          }
        }

        if (recordingRef.current) {
          const incoming = await getMobileSessionSteps(email);
          if (!cancelled && incoming.length) setSteps(current => mergeMobileRecordedSteps(current, incoming, email));
        }
      } catch {
        // A temporary agent/network gap must not stop the next polling cycle.
      }
    };

    void poll();
    const interval = window.setInterval(poll, 600);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [email, enabled, recordingRef, setError, setFrame, setSteps, socketRef]);
}
