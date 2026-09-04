import { useState } from 'react';

const DEFAULT_APPS = [
  { name: 'F-Droid FOSS Store', package: 'org.fdroid.fdroid', icon: 'package' },
  { name: 'Malarm Alarm Clock', package: 'org.schabi.malarm', icon: 'clock' },
  { name: 'QALculate Mobile App', package: 'com.qalculate.android', icon: 'calculator' },
  { name: 'Sauce Labs My Demo App', package: 'com.saucelabs.mydemoapp.android', icon: 'shopping-bag' },
  { name: 'WhatsApp Business', package: 'com.whatsapp', icon: 'message' },
  { name: 'Google Chrome', package: 'com.android.chrome', icon: 'globe' },
  { name: 'Android Settings', package: 'com.android.settings', icon: 'settings' },
  { name: 'Machaxi Sports', package: 'com.machaxi.app', icon: 'activity' },
  { name: 'Swiggy Food Delivery', package: 'in.swiggy.android', icon: 'utensils' },
  { name: 'Amazon Shopping', package: 'com.amazon.mShop.android.shopping', icon: 'shopping-bag' },
  { name: 'Google Pay / Finance', package: 'com.google.android.apps.nbu.paisa.user', icon: 'credit-card' }
];

/** All mutable mobile-recorder UI/device state lives here, outside RecordAndPlay. */
export function useMobileRecorderState() {
  const [mobilePlatform, setMobilePlatform] = useState<'Android'>('Android');
  const [connectionType, setConnectionType] = useState<'real' | 'emulator'>('real');
  const [mobileDevice, setMobileDevice] = useState('');
  const [mobileAppType, setMobileAppType] = useState<'installed' | 'apk' | 'package' | 'web'>('installed');
  const [mobileInstalledApp, setMobileInstalledApp] = useState('');
  const [mobilePackageName, setMobilePackageName] = useState('');
  const [mobileAppActivity, setMobileAppActivity] = useState('');
  const [mobileWebUrl, setMobileWebUrl] = useState('https://example.com');
  const [mobileApkFile, setMobileApkFile] = useState<File | null>(null);
  const [mobileApkName, setMobileApkName] = useState('');
  const [captureScreenshots, setCaptureScreenshots] = useState(true);
  const [captureVideo, setCaptureVideo] = useState(true);
  const [captureLogcat, setCaptureLogcat] = useState(true);
  const [captureNetwork, setCaptureNetwork] = useState(true);
  const [agentConnected, setAgentConnected] = useState(false);
  const [localAgentState, setLocalAgentState] = useState<'connected' | 'offline' | 'not_installed'>('not_installed');
  const [deviceCheckError, setDeviceCheckError] = useState<string | null>(null);
  const [isStartingAgent, setIsStartingAgent] = useState(false);
  const [isInstallingAgent, setIsInstallingAgent] = useState(false);
  const [useDemoFallback, setUseDemoFallback] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<any[]>([]);
  const [availableApps, setAvailableApps] = useState<any[]>(DEFAULT_APPS);
  const [isInstallingApk, setIsInstallingApk] = useState(false);
  const [mobileAppScreen, setMobileAppScreen] = useState('login');
  const [mobileAppInputVal, setMobileAppInputVal] = useState('');
  const [mobileLoginEmail, setMobileLoginEmail] = useState('sowbarnya@qaoncloud.com');
  const [mobileLoginPassword, setMobileLoginPassword] = useState('AutomatiQA2026!');
  const [rememberMe, setRememberMe] = useState(true);
  const [isMobileLoggedIn, setIsMobileLoggedIn] = useState(false);
  const [mobileSwipeStart, setMobileSwipeStart] = useState<{ x: number; y: number } | null>(null);
  const [isOrientationLandscape, setIsOrientationLandscape] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState<'qwerty' | 'numbers'>('qwerty');
  const [focusedInput, setFocusedInput] = useState<'email' | 'password' | 'generic' | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [touchRipples, setTouchRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const [isPhoneLocked, setIsPhoneLocked] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(80);
  const [showVolumeHud, setShowVolumeHud] = useState(false);
  const [useGestureNav, setUseGestureNav] = useState(false);
  const [liveMobileFrame, setLiveMobileFrame] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [isMobileInspectorActive, setIsMobileInspectorActive] = useState(true);
  const [selectedMobileInspectorElement, setSelectedMobileInspectorElement] = useState<any>(null);
  const [hoveredMobileInspectorElement, setHoveredMobileInspectorElement] = useState<any>(null);
  const [mobileInspectorMode, setMobileInspectorMode] = useState<'tap' | 'type' | 'assert' | 'long_press' | 'swipe'>('tap');
  const [mobileInspectorInputValue, setMobileInspectorInputValue] = useState('');
  const [mobileActiveAppTab, setMobileActiveAppTab] = useState<'home' | 'login' | 'form' | 'catalog' | 'settings'>('home');
  const [mobileHierarchySearch, setMobileHierarchySearch] = useState('');
  const [mobileApkUser, setMobileApkUser] = useState('tester@qaoncloud.com');
  const [mobileApkPass, setMobileApkPass] = useState('Password123');
  const [mobileApkNameInput, setMobileApkNameInput] = useState('Alex Johnson');
  const [mobileApkEmailInput, setMobileApkEmailInput] = useState('alex.j@example.com');
  const [mobileApkNotesInput, setMobileApkNotesInput] = useState('Testing booking slot');
  const [mobileApkSearchInput, setMobileApkSearchInput] = useState('Badminton Court');
  const [mobileFocusedField, setMobileFocusedField] = useState<string | null>(null);

  const triggerTouchRipple = (x: number, y: number) => {
    const ripple = { id: Date.now() + Math.random(), x, y };
    setTouchRipples(previous => [...previous.slice(-3), ripple]);
    window.setTimeout(() => setTouchRipples(previous => previous.filter(item => item.id !== ripple.id)), 550);
  };

  const handleVolumeChange = (delta: number) => {
    setVolumeLevel(previous => Math.min(100, Math.max(0, previous + delta)));
    setShowVolumeHud(true);
    window.setTimeout(() => setShowVolumeHud(false), 2000);
  };

  return {
    mobilePlatform, setMobilePlatform, connectionType, setConnectionType, mobileDevice, setMobileDevice,
    mobileAppType, setMobileAppType, mobileInstalledApp, setMobileInstalledApp, mobilePackageName, setMobilePackageName,
    mobileAppActivity, setMobileAppActivity, mobileWebUrl, setMobileWebUrl, mobileApkFile, setMobileApkFile,
    mobileApkName, setMobileApkName, captureScreenshots, setCaptureScreenshots, captureVideo, setCaptureVideo,
    captureLogcat, setCaptureLogcat, captureNetwork, setCaptureNetwork, agentConnected, setAgentConnected,
    localAgentState, setLocalAgentState, deviceCheckError, setDeviceCheckError, isStartingAgent, setIsStartingAgent,
    isInstallingAgent, setIsInstallingAgent, useDemoFallback, setUseDemoFallback, availableDevices, setAvailableDevices,
    availableApps, setAvailableApps, isInstallingApk, setIsInstallingApk, mobileAppScreen, setMobileAppScreen,
    mobileAppInputVal, setMobileAppInputVal, mobileLoginEmail, setMobileLoginEmail, mobileLoginPassword, setMobileLoginPassword,
    rememberMe, setRememberMe, isMobileLoggedIn, setIsMobileLoggedIn, mobileSwipeStart, setMobileSwipeStart,
    isOrientationLandscape, setIsOrientationLandscape, isKeyboardVisible, setIsKeyboardVisible, keyboardMode, setKeyboardMode,
    focusedInput, setFocusedInput, showNotifications, setShowNotifications, touchRipples, triggerTouchRipple,
    isPhoneLocked, setIsPhoneLocked, volumeLevel, handleVolumeChange, showVolumeHud, useGestureNav, setUseGestureNav,
    liveMobileFrame, setLiveMobileFrame, mobileError, setMobileError, isMobileInspectorActive, setIsMobileInspectorActive,
    selectedMobileInspectorElement, setSelectedMobileInspectorElement, hoveredMobileInspectorElement, setHoveredMobileInspectorElement,
    mobileInspectorMode, setMobileInspectorMode, mobileInspectorInputValue, setMobileInspectorInputValue,
    mobileActiveAppTab, setMobileActiveAppTab, mobileHierarchySearch, setMobileHierarchySearch, mobileApkUser, setMobileApkUser,
    mobileApkPass, setMobileApkPass, mobileApkNameInput, setMobileApkNameInput, mobileApkEmailInput, setMobileApkEmailInput,
    mobileApkNotesInput, setMobileApkNotesInput, mobileApkSearchInput, setMobileApkSearchInput, mobileFocusedField, setMobileFocusedField
  };
}
