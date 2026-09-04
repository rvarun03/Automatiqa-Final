import { Dispatch, MouseEvent, MutableRefObject, SetStateAction, useCallback } from 'react';
import { toast } from 'sonner';
import { RecordedStep } from '../types';
import { performMobileDeviceAction } from '../services/mobileRecordingService';
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
          targetBox: step.targetBox
        } as RecordedStep];
      });
    } else {
      options.addStep(step);
    }

    const time = new Date().toLocaleTimeString();
    options.log(`[${time}] [ADB] input event "${action}" on target [${step.elementName}]`);
    options.log(`[${time}] [Appium] findElement(${step.locator.primary.type}, "${step.locator.primary.value}") -> ${action}`);

    const bounds = elem.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!metrics?.recordOnly && options.liveFrame && bounds) {
      const x = Math.round((Number(bounds[1]) + Number(bounds[3])) / 2);
      const y = Math.round((Number(bounds[2]) + Number(bounds[4])) / 2);
      void performMobileDeviceAction(options.email, 'tap', {
        x, y, resourceId: elem.resourceId, xpath: elem.xpath, bounds: elem.bounds, recordStep: false
      }).catch(error => console.error('Failed to post device action:', error));
    }
    toast.success(`[+] Recorded Step: ${action.toUpperCase()} "${step.elementName}"`);
  }, [options]);
}
