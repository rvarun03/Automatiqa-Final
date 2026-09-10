import { Dispatch, MouseEvent, MutableRefObject, SetStateAction, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { RecordedStep } from '../types';
import { getMobileLiveFrame, performMobileDeviceAction, waitForMobileDeviceAction } from '../services/mobileRecordingService';
import { buildMobileRecordedStep, MobileStepMetrics } from '../utils/mobileRecordingSteps';

interface MobileStepCaptureOptions {
  email: string;
  recordingRef: MutableRefObject<boolean>;
  pausedRef: MutableRefObject<boolean>;
  sessionRef: MutableRefObject<string | null>;
  setRecording: Dispatch<SetStateAction<boolean>>;
  setPaused: Dispatch<SetStateAction<boolean>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSteps: Dispatch<SetStateAction<RecordedStep[]>>;
  addStep: (step: any) => void;
  setSelectedElement: Dispatch<SetStateAction<any>>;
  triggerRipple: (x: number, y: number) => void;
  log: (message: string) => void;
  inspectorMode: string;
  inspectorValue: string;
  activeScreen: string;
  liveFrame: string | null;
  captureScreenshots: boolean;
}

export function useMobileStepCapture(options: MobileStepCaptureOptions) {
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  return useCallback((
    elem: any,
    overrideAction?: string,
    overrideValue?: string,
    event?: MouseEvent,
    metrics?: MobileStepMetrics
  ) => {
    if (!elem) return;
    if (!options.recordingRef.current) {
      options.setRecording(true);
      options.recordingRef.current = true;
      options.setPaused(false);
      options.pausedRef.current = false;
      if (!options.sessionRef.current) {
        const session = `mob-${Date.now().toString(36)}-${Math.random().toString(36).substring(7)}`;
        options.setSessionId(session);
        options.sessionRef.current = session;
      }
    }

    if (event) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      options.triggerRipple(event.clientX - rect.left, event.clientY - rect.top);
    }
    options.setSelectedElement(elem);

    let action = overrideAction || (options.inspectorMode === 'type' ? 'fill' : options.inspectorMode === 'assert' ? 'assertion' : options.inspectorMode === 'long_press' ? 'long_press' : 'click');
    if (action === 'type') action = 'fill';
    const value = overrideValue !== undefined
      ? overrideValue
      : action === 'fill'
        ? options.inspectorValue || elem.text || 'Test Input Value'
        : action === 'assertion'
          ? elem.text || elem.name
          : elem.text || elem.name || '';
    const step = buildMobileRecordedStep(elem, action, value, options.activeScreen, metrics, options.captureScreenshots ? options.liveFrame : undefined);

    if (metrics?.recordOnly) {
      options.setSteps(previous => {
        const index = previous.length - 1;
        const original = previous[index];
        const matches = original?.platform === 'mobile' && original?.elementName === 'Screen position' &&
          original?.coordinates?.x === step.coordinates?.x && original?.coordinates?.y === step.coordinates?.y;
        if (!matches) return previous;
        return [...previous.slice(0, index), {
          ...original,
          elementName: step.elementName,
          value: step.value,
          locator: step.locator,
          screen: step.screen,
          bounds: step.bounds,
          node: step.node,
          target: step.target,
          targetBox: step.targetBox
        } as RecordedStep];
      });
      return;
    } else {
      options.addStep(step);
    }

    const time = new Date().toLocaleTimeString();
    options.log(`[${time}] [ADB] input event "${action}" on target [${step.elementName}]`);
    options.log(`[${time}] [Appium] findElement(${step.locator.primary.type}, "${step.locator.primary.value}") -> ${action}`);

    const bounds = elem.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!metrics?.recordOnly && action !== 'assertion' && options.liveFrame && (metrics?.coordinates || bounds || action === 'swipe')) {
      // Preserve the physical touch point. Bounds are only a fallback for
      // inspector controls that did not originate from a real touch.
      const x = metrics?.coordinates?.x ?? (bounds ? Math.round((Number(bounds[1]) + Number(bounds[3])) / 2) : metrics?.x1);
      const y = metrics?.coordinates?.y ?? (bounds ? Math.round((Number(bounds[2]) + Number(bounds[4])) / 2) : metrics?.y1);
      const beforeFrame = options.liveFrame;
      const deviceAction = action === 'swipe' ? 'swipe' : action === 'long_press' ? 'long_press' : action === 'fill' ? 'fill' : 'tap';
      const actionParams = action === 'swipe'
        ? { ...metrics, recordStep: false }
        : { x, y, text: action === 'fill' ? value : undefined, resourceId: elem.resourceId, xpath: elem.xpath, bounds: elem.bounds, target: step.target, recordStep: false };
      commandQueueRef.current = commandQueueRef.current.then(async () => {
        const queued = await performMobileDeviceAction(options.email, deviceAction, actionParams);
        if (!queued?.actionId) throw new Error(`Device did not accept ${deviceAction}`);
        await waitForMobileDeviceAction(queued.actionId);
        if (!options.captureScreenshots) return;
        // Store post-action evidence. The previous implementation attached the
        // frame from before the tap, which made playback comparisons misleading.
        const started = Date.now();
        let capturedFrame: string | undefined;
        while (Date.now() - started < 5000) {
          const response: { frame?: string } = await getMobileLiveFrame(options.email).catch(() => ({}));
          if (response.frame) {
            capturedFrame = response.frame;
            if (response.frame !== beforeFrame) break;
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (capturedFrame) {
          options.setSteps(previous => previous.map(item => item.id === step.id
            ? { ...item, screenshot: capturedFrame }
            : item));
        }
      }).catch(error => console.error('Failed to execute recorded device action:', error));
    }
    toast.success(`[+] Recorded Step: ${action.toUpperCase()} "${step.elementName}"`);
  }, [options]);
}
