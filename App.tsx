import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, 
  FolderKanban, 
  FileSearch, 
  PlayCircle, 
  Code2, 
  ChevronRight, 
  ChevronDown, 
  Database, 
  CheckCircle2, 
  BookOpen, 
  BarChart3, 
  Zap, 
  Network, 
  Activity, 
  Terminal, 
  Folder, 
  Plus, 
  X, 
  MoreVertical, 
  MoreHorizontal,
  LogOut, 
  Layout, 
  Users, 
  ShieldCheck, 
  Briefcase, 
  Bell, 
  Inbox, 
  Clock, 
  Eye, 
  Paperclip, 
  Trash2, 
  Link2, 
  MessageSquare, 
  FileVideo, 
  ImageIcon, 
  Upload, 
  ExternalLink,
  Loader2,
  AlertTriangle,
  Download,
  CheckCircle,
  Maximize2,
  Minimize2,
  Globe,
  Coins,
  ShieldAlert,
  Smartphone
} from 'lucide-react';
import MobileTesting from './components/MobileTesting';
import { onSnapshot, query, collection, where, doc, orderBy, limit, serverTimestamp, getDocFromServer, or } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth, handleFirestoreError, OperationType } from "./firebase";
import { syncUpdateDoc, syncSetDoc } from "./services/firestoreSync";
import seededUsers from './users.json';
import { Toaster } from 'sonner';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './components/Dashboard';
import ProjectList from './components/ProjectList';
import ScenarioGenerator from './components/ScenarioGenerator';
import TestCaseManager from './components/TestCaseManager';
import ManualTestCaseManager from './components/ManualTestCaseManager';
import ExecutionPanel from './components/ExecutionPanel';
import ScriptGenerator from './components/ScriptGenerator';
import ApiTesting from './components/ApiTesting';
import PerformanceTesting from './components/PerformanceTesting';
import PerformanceTestingWorkflow from './components/PerformanceTestingWorkflow';
import PerformanceExecution from './components/PerformanceExecution';
import JMeterPerformance from './components/JMeterPerformance';
import { JiraBugModal } from './components/JiraBugModal';
import UITesting from './components/UITesting';
import UserManagement from './components/UserManagement';
import Reports from './components/Reports';
import RecordAndPlay from './components/RecordAndPlay';
import AuthComponent from './components/Auth';
import { Logo } from './components/Logo';
import { JiraSettings } from './components/JiraSettings';
import { GithubSettings } from './components/GithubSettings';
import { SlackSettings } from './components/SlackSettings';
import { AICacheSettings } from './components/AICacheSettings';
import { AICacheNotification } from './components/AICacheNotification';
import { NotificationBell } from './components/NotificationBell';
import AIGeneratorUser from './components/AIGeneratorUser';
import { RAGDashboard } from './components/RAGDashboard';
import { TokenConsumption } from './components/TokenConsumption';
import { CreditConsumption } from './components/CreditConsumption';
import { CreditAlertBanner } from './components/CreditAlertBanner';
import { Sliders, Github, Sparkles, UserPlus, Slack, Gauge } from 'lucide-react';
import { Project, ApiTestSuite, User, UserRole, AppNotification, ApiRequest, ApiTestSuiteEvidence, TestStatus } from './types';
import { logActivity } from './services/activityService';
import { markAsRead } from './services/notificationService';
import { cleanFirestoreData, updateProjectFirestore, estimateSize } from './services/projectService';
import { toast as sonnerToast } from 'sonner';

type ActiveTab = 'dashboard' | 'projects' | 'rag' | 'ai_user_generator' | 'scenarios' | 'cases' | 'manual' | 'execution' | 'execution_manual_cases' | 'execution_scripts' | 'execution_api' | 'execution_performance' | 'scripts' | 'record_play' | 'mobile_testing' | 'api' | 'performance' | 'web_performance' | 'jmeter_performance' | 'ui_testing' | 'reports' | 'token_consumption' | 'user_management' | 'settings_jira' | 'settings_github' | 'settings_slack' | 'settings_cache' | 'settings_credits';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 Minutes

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isExecutionExpanded, setIsExecutionExpanded] = useState(false);
  const [isAutomationExpanded, setIsAutomationExpanded] = useState(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
  const [activeFolderRunId, setActiveFolderRunId] = useState<string | null>(null);
  const [isSwitchProjectOpen, setIsSwitchProjectOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isRecorderFullScreen, setIsRecorderFullScreen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const switchDropdownRef = useRef<HTMLDivElement>(null);
  const notificationDropdownRef = useRef<HTMLDivElement>(null);
  const autoUpgradeAttemptedRef = useRef(false);
  const [toast, setToast] = useState<{ message: string; visible: boolean; type?: 'success' | 'error' | 'warning' } | null>(null);

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [fallbackTrigger, setFallbackTrigger] = useState(0);

  useEffect(() => {
    const handleFallback = () => {
      setFallbackTrigger(prev => prev + 1);
    };
    window.addEventListener('firestore-db-fallback', handleFallback);
    return () => window.removeEventListener('firestore-db-fallback', handleFallback);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (['settings_jira', 'settings_github', 'settings_slack', 'settings_cache', 'settings_credits'].includes(activeTab)) {
      setIsSettingsExpanded(true);
    }
  }, [activeTab]);

  // Firestore Connection & Quota Health Verification
  useEffect(() => {
    const testConnection = async () => {
      try {
        // Attempt to fetch a doc to test connectivity
        await getDocFromServer(doc(db, '_connection_test_', 'ping'));
        console.log("Firestore connection verified.");
        setIsOffline(false);
      } catch (error: any) {
        if (error.message?.includes('Missing or insufficient permissions') || error.code === 'permission-denied') {
          console.warn("Connection test ping restricted by rules.");
        } else {
          handleFirestoreError(error, OperationType.GET, '_connection_test_/ping');
        }
        if (error.message?.includes('the client is offline') || error.code === 'unavailable' || error.message?.includes('Could not reach Cloud Firestore') || error.code === 'resource-exhausted') {
          console.warn("Firebase connection or quota issue detected. Running in backup/cached mode.");
          setIsOffline(true);
        } else {
          console.warn("Connection test warning:", error);
        }
      }
    };
    testConnection();
  }, [fallbackTrigger]);

  // API Execution States
  const [isSuiteModalOpen, setIsSuiteModalOpen] = useState(false);
  const [newSuiteName, setNewSuiteName] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [suiteError, setSuiteError] = useState('');
  const [activeMenuSuiteId, setActiveMenuSuiteId] = useState<string | null>(null);
  const [activeMenuScenarioId, setActiveMenuScenarioId] = useState<string | null>(null);
  const [expandedSuiteIds, setExpandedSuiteIds] = useState<Set<string>>(new Set());
  const [deleteSuiteConfirm, setDeleteSuiteConfirm] = useState<{ id: string, name: string } | null>(null);
  
  const [apiBugModalOpen, setApiBugModalOpen] = useState(false);
  const [apiBugTitle, setApiBugTitle] = useState('');
  const [apiBugDescription, setApiBugDescription] = useState('');
  const [apiBugAttachments, setApiBugAttachments] = useState<string[]>([]);
  const [apiBugLinks, setApiBugLinks] = useState<string[]>([]);
  const [apiBugComments, setApiBugComments] = useState<string>('');

  const handleCreateScenarioBug = (suite: ApiTestSuite, scenario: any) => {
    const scenarioEv = suite.scenarioResults?.[scenario.id]?.evidence || stagedEvidence[scenario.id] || suite.evidence;
    const attachments = scenarioEv?.attachments || [];
    const links = scenarioEv?.links || [];
    const comment = scenarioEv?.comment || '';

    setApiBugTitle(`[FAIL] API Verification - ${suite.name} - ${scenario.name || 'Scenario'}`);
    
    let desc = 
      `AutomatiQA API Execution Failure Report\n` +
      `----------------------------------------\n` +
      `Suite Name: ${suite.name}\n` +
      `Scenario Name: ${scenario.name || 'Untitled Scenario'}\n` +
      `Method: ${scenario.method}\n` +
      `URL: ${scenario.url}\n` +
      `Timestamp: ${new Date().toLocaleString('en-GB')}\n\n`;

    if (comment) {
      desc += `Execution Comments:\n${comment}\n\n`;
    }
    if (links.length > 0) {
      desc += `Reference Links:\n` + links.map((l, i) => `${i + 1}. ${l}`).join('\n') + `\n\n`;
    }
    if (attachments.length > 0) {
      desc += `Attached Evidences: ${attachments.length} file(s) attached to this bug report.\n\n`;
    }

    desc += `Recommended Action: Inspect server gateway availability, routing configuration, SSL cert handshakes, or response payload schemas.`;

    setApiBugDescription(desc);
    setApiBugAttachments(attachments);
    setApiBugLinks(links);
    setApiBugComments(comment);
    setApiBugModalOpen(true);
  };
  
  // Action Modals State
  const [viewDetailsSuite, setViewDetailsSuite] = useState<ApiTestSuite | null>(null);
  const [addEvidenceContext, setAddEvidenceContext] = useState<{ suite: ApiTestSuite, scenarioId?: string } | null>(null);
  
  // STAGED EVIDENCE: Keyed by scenarioId or suiteId to preserve across navigation
  const [stagedEvidence, setStagedEvidence] = useState<Record<string, ApiTestSuiteEvidence>>({});
  const [newLinkInput, setNewLinkInput] = useState('');
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewMedia, setPreviewMedia] = useState<{ url: string, type: 'image' | 'video' } | null>(null);

  // 1. Auth State Management
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      setIsAuthReady(true);
      if (!firebaseUser) {
        // Clear session if firebase auth is lost
        sessionStorage.removeItem('automatiqa_user');
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // 1b. Session Storage Recovery
  useEffect(() => {
    const savedUser = sessionStorage.getItem('automatiqa_user');
    if (savedUser) {
      try { 
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
      } catch (e) { console.error("Session parse error"); }
    }
  }, []);

  // 1c. Real-time User Data Sync
  useEffect(() => {
    if (!isAuthReady || !user?.email || !auth.currentUser) return;

    const emailLower = user.email.toLowerCase().trim();
    const path = `users/${emailLower}`;
    const unsubUser = onSnapshot(doc(db, "users", emailLower), async (docSnap) => {
      if (docSnap.exists()) {
        const freshUserData = docSnap.data() as User;
        const isDefaultSuperAdmin = emailLower === 'shanmugapriya@qaoncloud.com' || emailLower === 'sathya@qaoncloud.com';

        // Auto-upgrade default super admins to Super Admin if they still have the old Admin role
        if (isDefaultSuperAdmin && freshUserData.role !== UserRole.SUPER_ADMIN && !autoUpgradeAttemptedRef.current) {
          autoUpgradeAttemptedRef.current = true;
          try {
            await syncUpdateDoc(doc(db, "users", emailLower), { role: UserRole.SUPER_ADMIN });
            return; // The next snapshot from the database update will process the fresh state
          } catch (e) {
            console.error("Failed to auto-upgrade to Super Admin:", e);
          }
        }

        const freshAssigned = Array.isArray(freshUserData.assignedProjectIds)
          ? freshUserData.assignedProjectIds
          : (freshUserData.assignedProjectIds && typeof freshUserData.assignedProjectIds === 'object')
            ? Object.keys(freshUserData.assignedProjectIds)
            : [];

        const normalizedUser: User = {
          ...freshUserData,
          assignedProjectIds: freshAssigned
        };

        setUser(prev => {
           const prevAssigned = Array.isArray(prev?.assignedProjectIds)
             ? prev?.assignedProjectIds
             : (prev?.assignedProjectIds && typeof prev?.assignedProjectIds === 'object')
               ? Object.keys(prev?.assignedProjectIds)
               : [];

           if (prev && 
               prev.role === normalizedUser.role && 
               prev.name === normalizedUser.name &&
               JSON.stringify(prevAssigned) === JSON.stringify(freshAssigned)) {
             return prev;
           }
           return normalizedUser;
        });
        sessionStorage.setItem('automatiqa_user', JSON.stringify(normalizedUser));
      } else {
        // If user doc doesn't exist yet in this database, check seeded users and auto-provision
        const seeded = (seededUsers as any[]).find(u => u.id?.toLowerCase() === emailLower || u.data?.email?.toLowerCase() === emailLower);
        const seededData = seeded?.data;
        const isDefaultSuperAdmin = emailLower === 'shanmugapriya@qaoncloud.com' || emailLower === 'sathya@qaoncloud.com';
        
        const autoUser: User = {
          email: emailLower,
          name: seededData?.name || user.name || emailLower.split('@')[0],
          role: (seededData?.role as UserRole) || (isDefaultSuperAdmin ? UserRole.SUPER_ADMIN : (user.role || UserRole.TEAM_MEMBER)),
          assignedProjectIds: Array.isArray(seededData?.assignedProjectIds) ? seededData.assignedProjectIds : (user.assignedProjectIds || [])
        };

        try {
          await syncSetDoc(doc(db, "users", emailLower), { ...autoUser, status: 'active', createdAt: new Date().toISOString() });
        } catch (err) {
          console.warn("Auto-provision user document error:", err);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubUser();
  }, [user?.email, isAuthReady, fallbackTrigger]);

  // 2. Real-time Notifications Listener
  useEffect(() => {
    if (!isAuthReady || !user || !auth.currentUser) {
      setNotifications([]);
      return;
    }

    const path = "notifications";
    const qNotifications = query(
      collection(db, path),
      where("recipientEmail", "==", user.email.toLowerCase()),
      limit(50)
    );

    const unsub = onSnapshot(qNotifications, (snap) => {
      const notes = snap.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification));
      notes.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setNotifications(notes);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsub();
  }, [user?.email, isAuthReady, fallbackTrigger]);

  // Idle Logout Protocol
  useEffect(() => {
    if (!user) return;
    let idleTimer: number;
    const resetIdleTimer = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => handleLogout(), IDLE_TIMEOUT_MS);
    };
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(evt => window.addEventListener(evt, resetIdleTimer));
    resetIdleTimer();
    return () => {
      activityEvents.forEach(evt => window.removeEventListener(evt, resetIdleTimer));
      if (idleTimer) window.clearTimeout(idleTimer);
    };
  }, [user]);

  // Real-time Firestore Sync for Projects
  useEffect(() => {
    if (!isAuthReady || !user || !auth.currentUser) {
      setProjects([]);
      return;
    }

    const path = "projects";
    const email = user.email.toLowerCase().trim();
    const projectsQuery = query(collection(db, path));

    const unsub = onSnapshot(projectsQuery, (snap) => {
      const projectsData = snap.docs.map(d => ({ id: d.id, ...d.data() } as Project));
      
      let filtered: Project[] = [];
      const userRoleLower = (user.role as string | undefined)?.toLowerCase().trim();
      const isSuperAdminUser = user.role === UserRole.SUPER_ADMIN || 
                               userRoleLower === 'super admin' || 
                               email === 'shanmugapriya@qaoncloud.com' || 
                               email === 'sathya@qaoncloud.com';

      if (isSuperAdminUser) {
         // Super Admin - Able to access all the projects
         filtered = projectsData;
      } else {
         // Admin and Team members - Access allocated project
         let rawAssigned: string[] = [];
         if (Array.isArray(user.assignedProjectIds)) {
           rawAssigned = user.assignedProjectIds.map(x => String(x));
         } else if (user.assignedProjectIds && typeof user.assignedProjectIds === 'object') {
           rawAssigned = Object.keys(user.assignedProjectIds);
         }

         // Fallback to seeded data if rawAssigned is empty
         if (rawAssigned.length === 0) {
           const seeded = (seededUsers as any[]).find(u => u.id?.toLowerCase() === email || u.data?.email?.toLowerCase() === email);
           if (seeded?.data?.assignedProjectIds && Array.isArray(seeded.data.assignedProjectIds)) {
             rawAssigned = seeded.data.assignedProjectIds.map((x: any) => String(x));
           }
         }

         const assignedIds = new Set(rawAssigned);

         filtered = projectsData.filter(p => {
           const ownerMatch = p.ownerEmail?.toLowerCase().trim() === email;
           
           let allocatedMatch = false;
           if (Array.isArray(p.allocatedUserEmails)) {
             allocatedMatch = p.allocatedUserEmails.some(e => typeof e === 'string' && e.toLowerCase().trim() === email);
           } else if (p.allocatedUserEmails && typeof p.allocatedUserEmails === 'object') {
             allocatedMatch = Object.keys(p.allocatedUserEmails).some(e => e.toLowerCase().trim() === email) ||
                              Object.values(p.allocatedUserEmails).some(e => typeof e === 'string' && e.toLowerCase().trim() === email);
           }

           let roleMatch = false;
           if (p.projectRoles && typeof p.projectRoles === 'object') {
             roleMatch = Object.keys(p.projectRoles).some(k => k.toLowerCase().trim() === email);
           }

           const assignedIdMatch = assignedIds.has(p.id);

           return ownerMatch || allocatedMatch || roleMatch || assignedIdMatch;
         });
      }
      setProjects(filtered);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsub();
  }, [user?.email, user?.role, JSON.stringify(user?.assignedProjectIds), isAuthReady, fallbackTrigger]);

  // Auto-select first project if none selected
  useEffect(() => {
    if (user && projects.length > 0 && !selectedProjectId) {
      const savedId = localStorage.getItem(`automatiqa_last_project_${user.email.toLowerCase()}`);
      if (savedId && projects.some(p => p.id === savedId)) {
        setSelectedProjectId(savedId);
      } else {
        setSelectedProjectId(projects[0].id);
      }
    }
  }, [projects, user, selectedProjectId]);

  // --- PERSISTENCE LOGIC: Last Accessed Project ---
  useEffect(() => {
    if (user && selectedProjectId) {
      localStorage.setItem(`automatiqa_last_project_${user.email.toLowerCase()}`, selectedProjectId);
    }
  }, [selectedProjectId, user]);

  useEffect(() => {
    if (selectedProjectId && projects.length > 0) {
      if (!projects.some(p => p.id === selectedProjectId)) {
        setSelectedProjectId(null);
      }
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (switchDropdownRef.current && !switchDropdownRef.current.contains(event.target as Node)) {
        setIsSwitchProjectOpen(false);
      }
      if (notificationDropdownRef.current && !notificationDropdownRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogin = (userData: User) => {
    setUser(userData);
    sessionStorage.setItem('automatiqa_user', JSON.stringify(userData));
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      sessionStorage.removeItem('automatiqa_user');
      setActiveTab('dashboard');
      setSelectedProjectId(null);
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const activeProject = projects.find(p => p.id === selectedProjectId) || projects[0];

  // Sync active project and user details globally for AI token consumption and feature logging
  useEffect(() => {
    if (activeProject) {
      localStorage.setItem('automatiqa_active_project_name', activeProject.name);
      localStorage.setItem('automatiqa_active_project_id', activeProject.id);
      if (typeof window !== 'undefined') {
        (window as any).__automatiqa_active_project_name = activeProject.name;
        (window as any).__automatiqa_active_project_id = activeProject.id;
      }
    }
  }, [activeProject?.id, activeProject?.name]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('automatiqa_user_name', user.name || 'Shanmugapriya');
      localStorage.setItem('automatiqa_user_email', user.email || 'shanmugapriya@qaoncloud.com');
      if (typeof window !== 'undefined') {
        (window as any).__automatiqa_user_name = user.name || 'Shanmugapriya';
        (window as any).__automatiqa_user_email = user.email || 'shanmugapriya@qaoncloud.com';
      }
    }
  }, [user?.email, user?.name]);

  const switcherProjects = useMemo(() => {
    if (!user) return [];
    // For Admins and other roles, 'projects' state is already filtered correctly in the listener
    // Admins get all projects, while others get only their assigned/owned ones.
    return projects;
  }, [projects, user]);

  const rawContextualUser: User | null = user ? {
    ...user,
    role: (() => {
      const userRoleLower = (user.role as string | undefined)?.toLowerCase().trim();
      if (user.role === UserRole.SUPER_ADMIN || userRoleLower === 'super admin') return UserRole.SUPER_ADMIN;
      if (!activeProject) return user.role;
      const emailLower = user.email.toLowerCase().trim();
      if (activeProject.ownerEmail?.toLowerCase().trim() === emailLower) {
        return UserRole.ADMIN;
      }
      const pRole = activeProject.projectRoles?.[emailLower];
      if (pRole === 'Admin') return UserRole.ADMIN;
      if (pRole === 'Team Member') return UserRole.TEAM_MEMBER;
      return user.role;
    })()
  } : null;

  const isSuperAdmin = Boolean(
    user && (
      user.role === UserRole.SUPER_ADMIN ||
      (user.role as string)?.toLowerCase().trim() === 'super admin' ||
      user.email?.toLowerCase().trim() === 'shanmugapriya@qaoncloud.com' ||
      user.email?.toLowerCase().trim() === 'sathya@qaoncloud.com' ||
      rawContextualUser?.role === UserRole.SUPER_ADMIN ||
      (rawContextualUser?.role as string)?.toLowerCase().trim() === 'super admin'
    )
  );

  const isGlobalAdmin = user ? (
    user.role === UserRole.SUPER_ADMIN || 
    user.role === UserRole.ADMIN ||
    (user.role as string)?.toLowerCase().trim() === 'super admin' ||
    (user.role as string)?.toLowerCase().trim() === 'admin'
  ) : false;
  
  const isAdmin = rawContextualUser ? (
    rawContextualUser.role === UserRole.SUPER_ADMIN || 
    rawContextualUser.role === UserRole.ADMIN ||
    (rawContextualUser.role as string)?.toLowerCase().trim() === 'super admin' ||
    (rawContextualUser.role as string)?.toLowerCase().trim() === 'admin'
  ) : false;

  const canViewReports = rawContextualUser ? (
    rawContextualUser.role === UserRole.SUPER_ADMIN || 
    rawContextualUser.role === UserRole.DELIVERY_MANAGER || 
    rawContextualUser.role === UserRole.SPOC || 
    rawContextualUser.role === UserRole.ADMIN ||
    (rawContextualUser.role as string)?.toLowerCase().trim() === 'super admin' ||
    (rawContextualUser.role as string)?.toLowerCase().trim() === 'admin'
  ) : false;

  const updateProject = async (updatedProject: Project) => {
    if (!updatedProject?.id) return;
    
    setProjects(prevProjects => 
      prevProjects.map(p => p.id === updatedProject.id ? { ...updatedProject } : p)
    );

    try {
      await updateProjectFirestore(updatedProject.id, updatedProject);
    } catch (err: any) {
      console.warn("Firestore update notice:", err);
    }
  };

  const showToast = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToast({ message, visible: true, type });
    setTimeout(() => { setToast(prev => prev ? { ...prev, visible: false } : null); }, 4000);
  };

  const handleRunFolder = (folderId: string) => {
    const folder = activeProject.scenarios.find(s => s.id === folderId);
    if (!folder) return;

    if (!folder.testCases || folder.testCases.length === 0) {
      showToast('Add at least one test case.', 'error');
      return;
    }

    const currentActiveFolders = activeProject.activeExecutionFolderIds || [];
    let updatedActiveFolders = [...currentActiveFolders];
    if (!updatedActiveFolders.includes(folderId)) {
        updatedActiveFolders.push(folderId);
    }

    // Reset test case results for a fresh execution (Project-wide for these case IDs)
    const caseIdsToReset = new Set(folder.testCases.map(tc => tc.id));
    
    const updatedScenarios = activeProject.scenarios.map(s => ({
      ...s,
      testCases: s.testCases.map(tc => {
        if (caseIdsToReset.has(tc.id)) {
          return {
            ...tc,
            status: TestStatus.NOT_EXECUTED,
            executedAt: undefined,
            comments: '',
            attachments: [],
            links: [],
            evidence: ''
          };
        }
        return tc;
      })
    }));

    const updatedManualCases = (activeProject.manualTestCases || []).map(tc => {
      if (caseIdsToReset.has(tc.id)) {
        return {
          ...tc,
          status: TestStatus.NOT_EXECUTED,
          executedAt: undefined,
          comments: '',
          attachments: [],
          links: [],
          evidence: ''
        };
      }
      return tc;
    });

    const caseIdsInFolder = folder.testCases.map(tc => tc.id);
    const updatedExcludedIds = (activeProject.excludedFromExecutionIds || []).filter(
      id => id !== folderId && !caseIdsInFolder.includes(id)
    );

    updateProject({
        ...activeProject,
        scenarios: updatedScenarios,
        manualTestCases: updatedManualCases,
        activeExecutionFolderIds: updatedActiveFolders,
        excludedFromExecutionIds: updatedExcludedIds
    });

    if (user) {
       logActivity(user.email, user.name, `Initiated Functional Execution for folder: ${folder.title}`, activeProject.id, activeProject.name);
    }

    showToast('Testcase added to the execution queue');
    setActiveFolderRunId(folderId);
    setIsExecutionExpanded(true);
    setActiveTab('execution_manual_cases');
  };

  const availableAiFolders = useMemo(() => {
      const options: {id: string, name: string, path: string}[] = [];
      activeProject?.apiWorkspaces?.forEach(ws => {
          ws.collections.forEach(col => {
              col.folders?.forEach(fold => {
                  if (fold.name.startsWith('AI Scenarios') || fold.name.includes('AI')) {
                       options.push({
                          id: fold.id,
                          name: fold.name,
                          path: `${ws.name} / ${col.name} / ${fold.name}`
                       });
                  }
              });
          });
      });
      return options;
  }, [activeProject]);

  const handleSaveSuite = () => {
    if (!newSuiteName.trim()) { setSuiteError('Suite Name is required'); return; }
    if (!selectedFolderId) { setSuiteError('Please select a collection/folder'); return; }
    const exists = (activeProject.apiTestSuites || []).some(s => s.name.toLowerCase() === newSuiteName.trim().toLowerCase());
    if (exists) { setSuiteError('Test Suite Name must be unique'); return; }
    const folder = availableAiFolders.find(f => f.id === selectedFolderId);
    
    const existingSuites = activeProject.apiTestSuites || [];
    const nextNumber = existingSuites.length > 0 
      ? Math.max(...existingSuites.map(s => {
          const match = s.id.match(/API-(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        })) + 1 
      : 1;
    
    const sequentialId = `API-${nextNumber.toString().padStart(3, '0')}`;
    const uniqueId = `${sequentialId}-${Date.now()}`;
    
    const newSuite: ApiTestSuite = {
        id: uniqueId,
        name: newSuiteName.trim(),
        targetFolderId: selectedFolderId,
        targetFolderName: folder ? folder.name : 'Unknown',
        status: 'Not Started',
        scenarioResults: {}
    };
    updateProject({
        ...activeProject,
        apiTestSuites: [newSuite, ...(activeProject.apiTestSuites || [])]
    });

    if (user) {
       logActivity(user.email, user.name, `Created API Execution Suite: ${newSuite.name}`, activeProject.id, activeProject.name);
    }

    setIsSuiteModalOpen(false);
    setNewSuiteName('');
    setSelectedFolderId('');
    setSuiteError('');
  };

  const handleDeleteSuite = (suiteId: string) => {
    const updatedSuites = (activeProject.apiTestSuites || []).filter(s => s.id !== suiteId);
    updateProject({ ...activeProject, apiTestSuites: updatedSuites });
    logActivity(user.email, user.name, `Deleted API Execution Suite`, activeProject.id, activeProject.name);
  };

  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_DIM = 800;
        if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) { height *= MAX_DIM / width; width = MAX_DIM; }
            else { width *= MAX_DIM / height; height = MAX_DIM; }
        }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.3));
      };
      img.onerror = () => resolve(base64Str);
    });
  };

  const handleDownloadMedia = (data: string, index: number) => {
    const link = document.createElement('a');
    link.href = data;
    const isVid = data.startsWith('data:video') || data.toLowerCase().includes('.mp4') || data.toLowerCase().includes('.mov') || data.toLowerCase().includes('.webm');
    link.download = `evidence_${index + 1}.${isVid ? 'mp4' : 'jpg'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openEvidenceModal = (suite: ApiTestSuite, scenarioId?: string) => {
    const targetId = scenarioId || suite.id;
    setAddEvidenceContext({ suite, scenarioId });
    setUploadSuccessMessage(null);
    
    let existing: ApiTestSuiteEvidence | undefined;
    if (scenarioId) {
        existing = suite.scenarioResults?.[scenarioId]?.evidence;
    } else {
        existing = suite.evidence;
    }

    setStagedEvidence(prev => ({
      ...prev,
      [targetId]: {
        comment: existing?.comment || '',
        links: existing?.links || [],
        attachments: existing?.attachments || []
      }
    }));

    setNewLinkInput('');
    setActiveMenuSuiteId(null);
    setActiveMenuScenarioId(null);
  };

  const updateStagedField = (field: keyof ApiTestSuiteEvidence, value: any) => {
    if (!addEvidenceContext) return;
    const targetId = addEvidenceContext.scenarioId || addEvidenceContext.suite.id;
    setStagedEvidence(prev => ({
      ...prev,
      [targetId]: {
        ...(prev[targetId] || { comment: '', links: [], attachments: [] }),
        [field]: value
      }
    }));
  };

  const handleAddEvidenceLink = () => {
    if (!newLinkInput.trim() || !addEvidenceContext) return;
    const targetId = addEvidenceContext.scenarioId || addEvidenceContext.suite.id;
    const currentLinks = stagedEvidence[targetId]?.links || [];
    const l = newLinkInput.trim().startsWith('http') ? newLinkInput.trim() : `https://${newLinkInput.trim()}`;
    updateStagedField('links', [...currentLinks, l]);
    setNewLinkInput('');
  };

  const handleRemoveEvidenceLink = (idx: number) => {
    if (!addEvidenceContext) return;
    const targetId = addEvidenceContext.scenarioId || addEvidenceContext.suite.id;
    const currentLinks = stagedEvidence[targetId]?.links || [];
    updateStagedField('links', currentLinks.filter((_, i) => i !== idx));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !addEvidenceContext) return;
    
    const targetId = addEvidenceContext.scenarioId || addEvidenceContext.suite.id;
    const currentAttachments = stagedEvidence[targetId]?.attachments || [];

    setIsUploadingMedia(true);
    setUploadSuccessMessage(null);
    const readers = Array.from(files).map((file: File) => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const result = reader.result as string;
          if (result.startsWith('data:image')) {
            const compressed = await compressImage(result);
            resolve(compressed);
          } else {
            resolve(result);
          }
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readers).then(results => {
      updateStagedField('attachments', [...currentAttachments, ...results]);
      setIsUploadingMedia(false);
      setUploadSuccessMessage("Successfully uploaded.");
      setTimeout(() => setUploadSuccessMessage(null), 3000);
    }).catch(err => {
      console.error("Multimedia read failed:", err);
      setIsUploadingMedia(false);
    });
  };

  const saveEvidence = async () => {
    if (!addEvidenceContext || isUploadingMedia) return;
    const { suite, scenarioId } = addEvidenceContext;
    const targetId = scenarioId || suite.id;
    
    const evidenceData = stagedEvidence[targetId] || { comment: '', links: [], attachments: [] };

    const currentProjectSize = estimateSize(activeProject);
    const evidenceSize = estimateSize(evidenceData);
    
    if (currentProjectSize + evidenceSize > 980000) {
      alert("This project document is almost full. Please remove old reports or large images before adding more.");
      return;
    }

    const updatedSuites = (activeProject.apiTestSuites || []).map(s => {
      if (s.id !== suite.id) return s;
      
      if (scenarioId) {
          const results = { ...(s.scenarioResults || {}) };
          results[scenarioId] = { 
            ...(results[scenarioId] || { status: 'Not Started' }), 
            evidence: evidenceData 
          };
          return { ...s, scenarioResults: results };
      } else {
          return { ...s, evidence: evidenceData };
      }
    });

    // Close the modal immediately as requested by the user to fix the "does not close" issue
    setAddEvidenceContext(null);

    try {
      await updateProject({ ...activeProject, apiTestSuites: updatedSuites });
      logActivity(user.email, user.name, `Updated Evidence for API Suite: ${suite.name}${scenarioId ? ` (Scenario: ${scenarioId})` : ''}`, activeProject.id, activeProject.name);
      showToast('Evidence committed');
    } catch (err) {
      console.error("Failed to commit evidence context:", err);
      showToast('Failed to save. Check storage limits.', 'error');
    }
  };

  const toggleSuiteExpansion = (suiteId: string) => {
      const next = new Set(expandedSuiteIds);
      if (next.has(suiteId)) next.delete(suiteId);
      else next.add(suiteId);
      setExpandedSuiteIds(next);
  };

  const handleUpdateScenarioStatus = (suiteId: string, requestId: string, status: string) => {
      const updatedSuites = (activeProject.apiTestSuites || []).map(suite => {
          if (suite.id === suiteId) {
              const results = { ...(suite.scenarioResults || {}) };
              results[requestId] = { ...(results[requestId] || {}), status };
              return { ...suite, scenarioResults: results };
          }
          return suite;
      });
      updateProject({ ...activeProject, apiTestSuites: updatedSuites });
  };

  const getSuiteScenarios = (folderId: string): ApiRequest[] => {
    const scenarios: ApiRequest[] = [];
    activeProject.apiWorkspaces?.forEach(ws => {
      ws.collections.forEach(col => {
        col.folders?.forEach(fold => {
          if (fold.id === folderId) {
            scenarios.push(...fold.requests);
          }
        });
      });
    });
    return scenarios;
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-6">
        <Loader2 size={48} className="animate-spin text-indigo-500" />
        <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-500 animate-pulse">Establishing Secure Session...</p>
      </div>
    );
  }

  if (!user) return <AuthComponent onLogin={handleLogin} />;

  const contextualUser: User = rawContextualUser!;

  const mainNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { id: 'projects', label: 'Projects', icon: <FolderKanban size={20} /> },
    ...(isSuperAdmin ? [{ id: 'rag', label: 'RAG Vector Search', icon: <Sparkles size={20} className="text-emerald-400 animate-pulse" /> }] : []),
    { id: 'ai_user_generator', label: 'AI User Story Generator', icon: <UserPlus size={20} /> },
    { id: 'scenarios', label: 'AI Scenarios', icon: <FileSearch size={20} /> },
    { id: 'cases', label: 'AI Test Cases', icon: <Database size={20} /> },
    { id: 'manual', label: 'Functional Test cases', icon: <BookOpen size={20} /> },
  ];

  const executionSubItems = [
    { id: 'execution_manual_cases', label: 'Test Cases Execution', icon: <Activity size={16} /> },
    { id: 'execution_scripts', label: 'Script Execution', icon: <Terminal size={16} /> },
    { id: 'execution_api', label: 'API Execution', icon: <Network size={16} /> },
    { id: 'execution_performance', label: 'Performance API Testing Execution', icon: <Zap size={16} /> },
  ];

  const automationSubItems = [
    { id: 'scripts', label: 'Script Generator', icon: <Terminal size={16} /> },
    { id: 'record_play', label: 'Record and Play', icon: <PlayCircle size={16} /> },
  ];

  const bottomNavItems = [
    { id: 'api', label: 'API Testing', icon: <Network size={20} /> },
    { id: 'performance', label: 'Performance API Testing', icon: <Zap size={20} /> },
    ...(isSuperAdmin ? [
      { id: 'web_performance', label: 'Web Performance Testing', icon: <Globe size={20} /> },
      { id: 'jmeter_performance', label: 'Jmeter Integration', icon: <Gauge size={20} className="text-emerald-400" /> },
    ] : []),
    { id: 'ui_testing', label: 'UI Testing', icon: <Layout size={20} /> },
    ...(canViewReports ? [{ id: 'reports', label: 'Reports', icon: <BarChart3 size={20} /> }] : []),
    ...(isSuperAdmin ? [{ id: 'token_consumption', label: 'Credit Consumption', icon: <Coins size={20} className="text-[#00E1C5]" /> }] : []),
    ...(isGlobalAdmin || isAdmin ? [{ id: 'user_management', label: 'Access Control', icon: <Users size={20} /> }] : []),
  ];

  const renderContent = () => {
    if (!user) return null;

    // Guard for project-specific tabs
    const projectTabs = ['ai_user_generator', 'scenarios', 'cases', 'manual', 'execution', 'execution_manual_cases', 'execution_scripts', 'execution_api', 'execution_performance', 'scripts', 'record_play', 'mobile_testing', 'api', 'performance', 'web_performance', 'jmeter_performance', 'ui_testing', 'settings_jira', 'settings_github', 'settings_slack'];
    if (projectTabs.includes(activeTab) && !activeProject) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] bg-white rounded-[3rem] border border-slate-100 shadow-sm p-12 text-center animate-in fade-in duration-500">
          <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-8 shadow-inner">
            <Briefcase size={48} />
          </div>
          <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-4">No Project Selected</h2>
          <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-sm mb-10">
            Please select an existing project from the dashboard or create a new one to access this feature.
          </p>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95 transition-all"
          >
            Go to Dashboard
          </button>
        </div>
      );
    }

    switch (activeTab) {
      case 'dashboard': return <Dashboard user={contextualUser} projects={projects} activeProject={activeProject} />;
      case 'projects': return <ProjectList user={contextualUser} projects={projects} setProjects={setProjects} onSelectProject={(id) => { setSelectedProjectId(id); setActiveTab('ai_user_generator'); }} />;
      case 'rag': 
        if (!isSuperAdmin) return <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest">Unauthorized Access - Super Admin Only</div>;
        return <RAGDashboard currentProject={activeProject} projects={projects} />;
      case 'ai_user_generator': return <AIGeneratorUser project={activeProject!} user={contextualUser} onUpdateProject={updateProject} />;
      case 'scenarios': return <ScenarioGenerator project={activeProject} user={contextualUser} onUpdateProject={updateProject} />;
      case 'cases': return <TestCaseManager project={activeProject} user={contextualUser} onUpdateProject={updateProject} onRunFolder={handleRunFolder} />;
      case 'manual': return <ManualTestCaseManager project={activeProject} user={contextualUser} onUpdateProject={updateProject} onRunFolder={handleRunFolder} />;
      case 'execution': return <ExecutionPanel project={activeProject} user={contextualUser} onUpdateProject={updateProject} onClearActiveFolder={() => setActiveFolderRunId(null)} />;
      case 'execution_manual_cases': return <ExecutionPanel project={activeProject} user={contextualUser} onUpdateProject={updateProject} defaultFilter="MANUAL" activeFolderId={activeFolderRunId} onClearActiveFolder={() => setActiveFolderRunId(null)} />;
      case 'execution_scripts': return <ScriptGenerator project={activeProject} user={contextualUser} onUpdateProject={updateProject} viewOnly />;
      case 'execution_api':
        return (
          <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm animate-in fade-in duration-500" onClick={() => { setActiveMenuSuiteId(null); setActiveMenuScenarioId(null); }}>
             <div className="flex items-center justify-between mb-8">
               <div className="flex items-center gap-4">
                  <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-600"><Network size={24} /></div>
                  <div><h3 className="text-2xl font-black text-black uppercase tracking-tight">API Execution</h3></div>
               </div>
               <button onClick={() => setIsSuiteModalOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"><Plus size={16} /> Add Test Suite</button>
             </div>
             <div className="overflow-visible rounded-3xl border border-slate-200">
               <table className="w-full text-left border-collapse">
                 <thead>
                   <tr className="bg-slate-50/50 text-[14px] font-black text-black uppercase tracking-widest border-b border-slate-100">
                     <th className="px-8 py-5 w-16"></th>
                     <th className="px-8 py-5">Suite ID</th>
                     <th className="px-8 py-5">Collections / Suite</th>
                     <th className="px-8 py-5 text-right">Actions</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                   {(activeProject.apiTestSuites || []).length === 0 ? (
                     <tr><td colSpan={4} className="px-8 py-24 text-center"><div className="flex flex-col items-center justify-center opacity-50"><BarChart3 size={48} className="mb-4 text-slate-300" /><p className="text-slate-400 font-bold uppercase text-xs tracking-widest">No Test Suites found</p></div></td></tr>
                   ) : (
                     (activeProject.apiTestSuites || []).map((suite, idx) => {
                       const isExpanded = expandedSuiteIds.has(suite.id);
                       const scenarios = getSuiteScenarios(suite.targetFolderId);
                       
                       return (
                         <React.Fragment key={suite.id}>
                           <tr className={`hover:bg-slate-50/50 transition-colors group ${isExpanded ? 'bg-indigo-50/20' : ''}`} onClick={() => toggleSuiteExpansion(suite.id)}>
                             <td className="px-8 py-6">
                                <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                  <ChevronDown size={18} className="text-slate-400" />
                                </div>
                             </td>
                             <td className="px-8 py-6 text-[14px] font-mono text-black">
                                {suite.id.startsWith('API-') ? suite.id.split('-').slice(0, 2).join('-') : (suite.id.split('-').pop()?.toUpperCase() || 'N/A')}
                             </td>
                             <td className="px-8 py-6">
                                <div className="flex items-center gap-4">
                                  <div className="p-3 bg-white border border-slate-100 rounded-xl text-amber-500 shadow-sm">
                                    <Folder size={18} />
                                  </div>
                                  <div>
                                    <h4 className="font-bold text-slate-700 text-sm">{suite.name}</h4>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{suite.targetFolderName}</p>
                                  </div>
                                </div>
                             </td>
                             <td className="px-8 py-6 text-right relative overflow-visible">
                               <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setActiveMenuSuiteId(activeMenuSuiteId === suite.id ? null : suite.id); 
                                  }} 
                                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                               >
                                  <MoreVertical size={18} />
                               </button>
                               {activeMenuSuiteId === suite.id && (
                                 <div className="absolute right-8 top-12 w-48 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[500] p-2 animate-in zoom-in-95 duration-200 text-left" onClick={e => e.stopPropagation()}>
                                    <button onClick={() => { setViewDetailsSuite(suite); setActiveMenuSuiteId(null); }} className="w-full flex items-center gap-3 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all"><Eye size={16} /> View Details</button>
                                    <div className="my-1 border-t border-slate-50" />
                                    <button onClick={() => { setDeleteSuiteConfirm({ id: suite.id, name: suite.name }); setActiveMenuSuiteId(null); }} className="w-full flex items-center gap-3 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-rose-500 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={16} /> Delete Suite</button>
                                 </div>
                               )}
                             </td>
                           </tr>
                           {isExpanded && (
                             <tr>
                               <td colSpan={4} className="px-12 py-6 bg-slate-50/50">
                                 <div className="space-y-3 animate-in slide-in-from-top-2">
                                   <div className="flex items-center gap-2 mb-4">
                                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Scenario Execution Context</p>
                                   </div>
                                   {scenarios.length === 0 ? (
                                     <div className="py-10 text-center text-slate-400 italic text-xs">No scenarios found in this collection folder.</div>
                                   ) : (
                                     scenarios.map((req, ridx) => {
                                       const res = suite.scenarioResults?.[req.id] || { status: 'Not Started' };
                                       const reqEv = suite.scenarioResults?.[req.id]?.evidence || stagedEvidence[req.id];
                                       const hasEvidence = reqEv && ((reqEv.attachments && reqEv.attachments.length > 0) || (reqEv.links && reqEv.links.length > 0) || (reqEv.comment && reqEv.comment.trim().length > 0));

                                       return (
                                         <div key={req.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4 group/scen">
                                            <div className="flex items-center justify-between gap-6">
                                               <div className="flex items-center gap-5 min-w-0 flex-1">
                                                  <span className="text-[10px] font-mono text-slate-300 w-6">{(ridx + 1).toString().padStart(2, '0')}</span>
                                                  <div className="min-w-0">
                                                     <div className="flex items-center gap-3">
                                                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border border-indigo-100 bg-indigo-50 text-indigo-600`}>{req.method}</span>
                                                        <h5 className="text-xs font-bold text-slate-700 truncate uppercase tracking-tight">{req.name || 'Untitled Scenario'}</h5>
                                                     </div>
                                                     <p className="text-[9px] text-slate-400 font-bold truncate mt-1">{req.url}</p>
                                                  </div>
                                               </div>
                                               
                                               <div className="flex items-center gap-3 flex-shrink-0">
                                                  <button
                                                    onClick={() => openEvidenceModal(suite, req.id)}
                                                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border flex items-center gap-1.5 transition-all ${
                                                      hasEvidence
                                                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100'
                                                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100'
                                                    }`}
                                                    title="Manage Evidence"
                                                  >
                                                    <Paperclip size={12} />
                                                    <span>{hasEvidence ? 'Evidence Added' : 'Add Evidence'}</span>
                                                  </button>

                                                  <div className="relative group">
                                                     <select 
                                                       value={res.status || ''} 
                                                       onChange={e => handleUpdateScenarioStatus(suite.id, req.id, e.target.value)}
                                                       className={`appearance-none pl-4 pr-10 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border outline-none cursor-pointer transition-all shadow-sm ${
                                                         res.status === 'PASS' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                                         res.status === 'Fail' ? 'bg-red-50 text-red-600 border-red-100' :
                                                         res.status === 'Blocked' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                                         res.status === 'In Progress' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                                         'bg-slate-50 text-slate-400 border-slate-200'
                                                       }`}
                                                     >
                                                        <option value="Not Started">Not Started</option>
                                                        <option value="In Progress">In Progress</option>
                                                        <option value="PASS">PASS</option>
                                                        <option value="Fail">Fail</option>
                                                        <option value="Blocked">Blocked</option>
                                                     </select>
                                                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-current opacity-40 pointer-events-none" size={14} />
                                                  </div>
                                                  
                                                  <div className="relative">
                                                    <button 
                                                      onClick={(e) => { e.stopPropagation(); setActiveMenuScenarioId(activeMenuScenarioId === req.id ? null : req.id); }}
                                                      className="p-2.5 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all border border-slate-100"
                                                    >
                                                      <MoreHorizontal size={18} />
                                                    </button>
                                                    {activeMenuScenarioId === req.id && (
                                                      <div className="absolute right-0 top-12 w-48 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[500] p-2 animate-in zoom-in-95 duration-200 text-left" onClick={e => e.stopPropagation()}>
                                                         <button onClick={() => openEvidenceModal(suite, req.id)} className="w-full flex items-center gap-3 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all">
                                                           <Paperclip size={16} /> 
                                                           {hasEvidence ? 'Update Evidence' : 'Add Evidence'}
                                                         </button>
                                                         {res.status === 'Fail' && (
                                                           <>
                                                             <div className="my-1 border-t border-slate-100" />
                                                             <button 
                                                               onClick={() => {
                                                                 setActiveMenuScenarioId(null);
                                                                 handleCreateScenarioBug(suite, req);
                                                               }} 
                                                               className="w-full flex items-center gap-3 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                                                             >
                                                               <AlertTriangle size={16} /> 
                                                               Create Bug
                                                             </button>
                                                           </>
                                                         )}
                                                      </div>
                                                    )}
                                                  </div>
                                               </div>
                                            </div>

                                            {/* EVIDENCE DISPLAY BAR */}
                                            {hasEvidence && (
                                              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs">
                                                 {reqEv.attachments && reqEv.attachments.length > 0 && (
                                                    <div className="flex items-center gap-2">
                                                       <span className="text-[9px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 flex items-center gap-1">
                                                          <Paperclip size={10} /> {reqEv.attachments.length} Proof(s)
                                                       </span>
                                                       <div className="flex items-center gap-1.5">
                                                          {reqEv.attachments.map((att: string, aidx: number) => {
                                                             const isVid = att.startsWith('data:video') || att.toLowerCase().includes('.mp4') || att.toLowerCase().includes('.webm');
                                                             return (
                                                                <div 
                                                                  key={aidx} 
                                                                  onClick={() => setPreviewMedia({ url: att, type: isVid ? 'video' : 'image' })}
                                                                  className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer hover:ring-2 ring-indigo-500 transition-all relative group/att shrink-0 bg-slate-900"
                                                                  title="Click to view evidence full screen"
                                                                >
                                                                   {isVid ? (
                                                                      <div className="w-full h-full flex items-center justify-center text-white/80">
                                                                         <FileVideo size={16} />
                                                                      </div>
                                                                   ) : (
                                                                      <img src={att} alt={`Evidence ${aidx + 1}`} className="w-full h-full object-cover" />
                                                                   )}
                                                                   <div className="absolute inset-0 bg-indigo-600/30 opacity-0 group-hover/att:opacity-100 transition-opacity flex items-center justify-center text-white">
                                                                      <Maximize2 size={12} />
                                                                   </div>
                                                                </div>
                                                             );
                                                          })}
                                                       </div>
                                                    </div>
                                                 )}

                                                 {reqEv.links && reqEv.links.length > 0 && (
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                       {reqEv.links.map((link: string, lidx: number) => (
                                                          <a
                                                            key={lidx}
                                                            href={link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg text-[10px] font-bold text-indigo-600 transition-all max-w-[200px] truncate"
                                                            title={link}
                                                          >
                                                             <Link2 size={10} />
                                                             <span className="truncate">{link}</span>
                                                             <ExternalLink size={8} />
                                                          </a>
                                                       ))}
                                                    </div>
                                                 )}

                                                 {reqEv.comment && (
                                                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1 rounded-lg text-[10px] font-medium text-slate-600 max-w-md truncate">
                                                       <MessageSquare size={10} className="text-slate-400 shrink-0" />
                                                       <span className="truncate" title={reqEv.comment}>{reqEv.comment}</span>
                                                    </div>
                                                 )}
                                              </div>
                                            )}
                                         </div>
                                       );
                                     })
                                   )}
                                 </div>
                               </td>
                             </tr>
                           )}
                         </React.Fragment>
                       );
                     })
                   )}
                 </tbody>
               </table>
             </div>
          </div>
        );
      case 'execution_performance': return <PerformanceExecution project={activeProject} user={contextualUser} onUpdateProject={updateProject} />;
      case 'scripts': return <ScriptGenerator project={activeProject} user={contextualUser} onUpdateProject={updateProject} />;
      case 'settings_jira': return <JiraSettings activeProject={activeProject} onUpdateProject={updateProject} />;
      case 'settings_github': return <GithubSettings activeProject={activeProject} onUpdateProject={updateProject} />;
      case 'settings_slack': return <SlackSettings activeProject={activeProject} onUpdateProject={updateProject} />;
      case 'settings_cache': return <AICacheSettings />;
      case 'settings_credits': 
        if (!isSuperAdmin && !isAdmin && !isGlobalAdmin) return <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest">Unauthorized Access - Admin and Super Admin Only</div>;
        return <CreditConsumption currentUser={user || contextualUser} activeProject={activeProject} projects={projects} />;
      case 'api': return <ApiTesting project={activeProject} user={contextualUser} onUpdateProject={updateProject} />;
      case 'performance': return <PerformanceTesting project={activeProject} user={contextualUser} onUpdateProject={updateProject} />;
      case 'web_performance': 
        if (!isSuperAdmin) return <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest">Unauthorized Access - Super Admin Only</div>;
        return <PerformanceTestingWorkflow project={activeProject} user={contextualUser} />;
      case 'jmeter_performance': 
        if (!isSuperAdmin) return <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest">Unauthorized Access - Super Admin Only</div>;
        return <JMeterPerformance project={activeProject} user={contextualUser} onUpdateProject={updateProject} />;
      case 'record_play': return <RecordAndPlay project={activeProject} user={contextualUser} onUpdateProject={updateProject} isFullScreen={isRecorderFullScreen} onToggleFullScreen={() => setIsRecorderFullScreen(!isRecorderFullScreen)} />;
      case 'mobile_testing': return <MobileTesting project={activeProject} user={contextualUser} onUpdateProject={updateProject} />;
      case 'ui_testing': return <UITesting project={activeProject} user={contextualUser} onUpdateProject={updateProject} />;
      case 'user_management': 
        if (!isGlobalAdmin && !isAdmin) return <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest">Unauthorized Access</div>;
        return <UserManagement currentUser={user || contextualUser} projects={projects} activeProject={activeProject} />;
      case 'token_consumption':
        if (!isSuperAdmin) return <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest">Unauthorized Access - Super Admin Only</div>;
        return <CreditConsumption currentUser={user || contextualUser} activeProject={activeProject} projects={projects} />;
      case 'reports': 
        if (!canViewReports) return <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest">Unauthorized Access</div>;
        return <Reports projects={projects} activeProject={activeProject} user={contextualUser} />;
      default: return <Dashboard user={contextualUser} projects={projects} activeProject={activeProject} />;
    }
  };

  const isExecutionActive = activeTab.startsWith('execution');
  const isAutomationActive = ['scripts', 'record_play'].includes(activeTab);
  const isSettingsActive = ['settings_jira', 'settings_github', 'settings_slack', 'settings_cache', 'settings_credits'].includes(activeTab);

  const getPageTitle = () => {
    if (activeTab === 'execution') return 'Execution Hub';
    if (activeTab === 'settings_jira') return 'Jira Integration Settings';
    if (activeTab === 'settings_github') return 'GitHub Integration Settings';
    if (activeTab === 'settings_slack') return 'Slack Integration Settings';
    if (activeTab === 'settings_cache') return 'AI Cache & Performance Settings';
    if (activeTab === 'settings_credits') return 'Credits Consumption Settings';
    if (activeTab.startsWith('execution_')) {
      return executionSubItems.find(i => i.id === activeTab)?.label || 'Execution Hub';
    }
    const automationItem = automationSubItems.find(i => i.id === activeTab);
    if (automationItem) return automationItem.label;
    
    return [...mainNavItems, ...bottomNavItems].find(i => i.id === activeTab)?.label || 'Dashboard';
  };

  const activeStagedId = addEvidenceContext ? (addEvidenceContext.scenarioId || addEvidenceContext.suite?.id) : null;
  const currentStaged = activeStagedId ? stagedEvidence[activeStagedId] : null;

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden bg-[#edf4f2]">
      {toast?.visible && (
        <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[3000] animate-in slide-in-from-bottom-10 fade-in duration-500`}>
           <div className={`${toast.type === 'error' ? 'bg-rose-900' : toast.type === 'warning' ? 'bg-amber-800' : 'bg-slate-900'} text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 border border-white/10 backdrop-blur-md`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${toast.type === 'error' ? 'bg-rose-500' : toast.type === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                {toast.type === 'error' ? <AlertTriangle size={14} strokeWidth={4} /> : <CheckCircle2 size={14} strokeWidth={4} />}
              </div>
              <p className="text-sm font-bold tracking-tight">{toast.message}</p>
           </div>
        </div>
      )}

      {previewMedia && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 md:p-12 animate-in fade-in duration-300" onClick={() => setPreviewMedia(null)}>
            <button className="absolute top-8 right-8 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all border border-white/20 z-[5001]">
                <X size={32} />
            </button>
            <div className="relative w-full h-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
                {previewMedia.type === 'video' ? (
                    <video src={previewMedia.url || undefined} controls autoPlay className="max-w-full max-h-full rounded-xl shadow-2xl" />
                ) : (
                    <img src={previewMedia.url || undefined} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl animate-in zoom-in-95 duration-300" alt="Evidence Preview" />
                )}
            </div>
        </div>
      )}

      <aside className="w-64 bg-[#0c1017] text-slate-300 flex flex-col border-r border-slate-800">
        <div className="p-8 flex items-center gap-3 border-b border-slate-800/50">
          <Logo className="h-10 w-10" color="#00E1C5" />
          <span className="text-xl font-black text-white tracking-tighter">AutomatiQA</span>
        </div>
        <nav className="flex-1 p-5 space-y-2 overflow-y-auto custom-scrollbar">
          {mainNavItems.map(item => (
            <button 
              key={item.id} 
              onClick={() => setActiveTab(item.id as any)} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 relative border ${activeTab === item.id ? 'border-[#00E1C5]/40 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <span className={`flex-shrink-0 ${activeTab === item.id ? 'text-[#00E1C5]' : 'text-slate-400'}`}>{item.icon}</span>
              <span className={`text-[13px] tracking-tight ${activeTab === item.id ? 'text-white font-bold' : 'text-slate-300'}`}>{item.label}</span>
            </button>
          ))}
          
          <div className="my-4 border-t border-slate-800/50" />

          {/* Automation Section */}
          <div>
            <button 
              onClick={() => { setIsAutomationExpanded(!isAutomationExpanded); if (!isAutomationExpanded) setActiveTab('scripts'); }} 
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 border ${isAutomationActive && !isAutomationExpanded ? 'border-[#00E1C5]/40 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <div className="flex items-center gap-3">
                <Code2 size={20} className={isAutomationActive && !isAutomationExpanded ? 'text-[#00E1C5]' : 'text-slate-400'} />
                <span className={`text-[13px] tracking-tight ${isAutomationActive && !isAutomationExpanded ? 'text-white font-bold' : 'text-slate-300'}`}>Automation</span>
              </div>
              {isAutomationExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isAutomationExpanded ? 'max-h-64 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
              <div className="ml-5 pl-4 border-l border-slate-800 space-y-1">
                {automationSubItems.map(subItem => (
                  <button 
                    key={subItem.id} 
                    onClick={() => setActiveTab(subItem.id as any)} 
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs transition-all duration-200 border ${activeTab === subItem.id ? 'border-[#00E1C5]/35 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}
                  >
                    <span className="flex-shrink-0">{subItem.icon}</span>
                    <span className="truncate text-white">{subItem.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Core Testing Tools */}
          {bottomNavItems.filter(i => ['api', 'performance', 'web_performance', 'jmeter_performance', 'ui_testing'].includes(i.id)).map(item => (
            <button 
              key={item.id} 
              onClick={() => setActiveTab(item.id as any)} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 relative border ${activeTab === item.id ? 'border-[#00E1C5]/40 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <span className={`flex-shrink-0 ${activeTab === item.id ? 'text-[#00E1C5]' : 'text-slate-400'}`}>{item.icon}</span>
              <span className={`text-[13px] tracking-tight ${activeTab === item.id ? 'text-white font-bold' : 'text-slate-300'}`}>{item.label}</span>
            </button>
          ))}

          {/* Execution Hub */}
          <div>
            <button 
              onClick={() => { setIsExecutionExpanded(!isExecutionExpanded); if (!isExecutionExpanded) setActiveTab('execution'); }} 
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 border ${isExecutionActive && !isExecutionExpanded ? 'border-[#00E1C5]/40 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <div className="flex items-center gap-3">
                <PlayCircle size={20} className={isExecutionActive && !isExecutionExpanded ? 'text-[#00E1C5]' : 'text-slate-400'} />
                <span className={`text-[13px] tracking-tight ${isExecutionActive && !isExecutionExpanded ? 'text-white font-bold' : 'text-slate-300'}`}>Execution Hub</span>
              </div>
              {isExecutionExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExecutionExpanded ? 'max-h-64 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
              <div className="ml-5 pl-4 border-l border-slate-800 space-y-1">
                {executionSubItems.map(subItem => (
                  <button 
                    key={subItem.id} 
                    onClick={() => setActiveTab(subItem.id as any)} 
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs transition-all duration-200 border ${activeTab === subItem.id ? 'border-[#00E1C5]/35 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}
                  >
                    <span className="flex-shrink-0">{subItem.icon}</span>
                    <span className="truncate text-white">{subItem.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Reports & Management */}
          {bottomNavItems.filter(i => ['reports', 'token_consumption', 'user_management'].includes(i.id)).map(item => (
            <button 
              key={item.id} 
              onClick={() => setActiveTab(item.id as any)} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 relative border ${activeTab === item.id ? 'border-[#00E1C5]/40 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <span className={`flex-shrink-0 ${activeTab === item.id ? 'text-[#00E1C5]' : 'text-slate-400'}`}>{item.icon}</span>
              <span className={`text-[13px] tracking-tight ${activeTab === item.id ? 'text-white font-bold' : 'text-slate-300'}`}>{item.label}</span>
            </button>
          ))}

          <div className="my-4 border-t border-slate-800/50" />

          {/* Settings Section */}
          <div>
            <button 
              onClick={() => { setIsSettingsExpanded(!isSettingsExpanded); }} 
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 border ${isSettingsActive && !isSettingsExpanded ? 'border-[#00E1C5]/40 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <div className="flex items-center gap-3">
                <Sliders size={20} className={isSettingsActive && !isSettingsExpanded ? 'text-[#00E1C5]' : 'text-slate-400'} />
                <span className={`text-[13px] tracking-tight ${isSettingsActive && !isSettingsExpanded ? 'text-white font-bold' : 'text-slate-300'}`}>Settings</span>
              </div>
              {isSettingsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isSettingsExpanded ? 'max-h-96 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
              <div className="ml-5 pl-4 border-l border-slate-800 space-y-1">
                {[
                  { id: 'settings_jira', label: 'Jira Integration', icon: <Sparkles size={16} /> },
                  { id: 'settings_github', label: 'GitHub Integration', icon: <Github size={16} /> },
                  { id: 'settings_slack', label: 'Slack Integration', icon: <Slack size={16} /> },
                  { id: 'settings_cache', label: 'AI Cache & Optimization', icon: <Zap size={16} className="text-yellow-400" /> },
                  ...((isSuperAdmin || isAdmin || isGlobalAdmin) ? [{ id: 'settings_credits', label: 'Credits Consumption', icon: <Coins size={16} className="text-[#00E1C5]" /> }] : [])
                ].map(subItem => (
                  <button 
                    key={subItem.id} 
                    onClick={() => setActiveTab(subItem.id as any)} 
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs transition-all duration-200 border ${activeTab === subItem.id ? 'border-[#00E1C5]/35 bg-[#132d2f]/40 text-[#00E1C5] font-bold' : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}
                  >
                    <span className="flex-shrink-0">{subItem.icon}</span>
                    <span className="truncate text-white">{subItem.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </nav>
        
        <div className="p-4 border-t border-slate-800/60 bg-slate-950/20">
          <div className="bg-[#111622] p-4 rounded-2xl mb-3 relative group border border-slate-800/40">
            <div className="absolute top-0 right-0 p-3 opacity-10 text-[#00E1C5]"><ShieldCheck size={36} /></div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-[#00E1C5] flex items-center justify-center text-slate-950 text-sm font-black shadow-lg shadow-[#00E1C5]/20">{contextualUser.name.charAt(0).toUpperCase()}</div>
              <div className="overflow-hidden">
                <p className="text-[13px] font-bold text-white truncate">{contextualUser.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                   <p className="text-[8px] text-slate-500 font-extrabold uppercase tracking-wider">{contextualUser.role || 'Team Member'}</p>
                </div>
              </div>
            </div>
            
            <div ref={switchDropdownRef} className="relative">
              <button onClick={() => setIsSwitchProjectOpen(!isSwitchProjectOpen)} className={`w-full py-2 px-3 rounded-lg text-[10px] flex items-center justify-between font-bold transition-all ${isSwitchProjectOpen ? 'bg-[#00E1C5] text-slate-950' : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'}`}>
                <span className="truncate mr-2">{activeProject?.name || 'Project'}</span>
                <ChevronDown size={12} className={`transition-transform duration-300 ${isSwitchProjectOpen ? 'rotate-180' : ''}`} />
              </button>
              {isSwitchProjectOpen && (
                <div className="absolute bottom-full left-0 w-full mb-2 bg-[#111622] border border-slate-800 rounded-xl shadow-2xl overflow-hidden z-[100] p-1">
                   <div className="max-h-56 overflow-y-auto custom-scrollbar">
                      {switcherProjects.length === 0 ? (
                        <div className="px-3 py-3 text-[9px] text-slate-500 font-bold uppercase tracking-wider text-center italic">No projects found</div>
                      ) : switcherProjects.map(proj => (
                        <button key={proj.id} onClick={() => { setSelectedProjectId(proj.id); setIsSwitchProjectOpen(false); }} className={`w-full text-left px-3 py-2 text-[10px] font-medium transition-all flex items-center gap-2 rounded-lg mb-0.5 last:mb-0 ${proj.id === activeProject?.id ? 'bg-[#00E1C5] text-slate-950' : 'text-slate-300 hover:bg-white/5'}`}>
                           <Briefcase size={10} />
                           <span className="truncate">{proj.name}</span>
                        </button>
                      ))}
                   </div>
                </div>
              )}
            </div>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900/50 hover:bg-rose-950/20 text-slate-500 hover:text-rose-400 transition-all font-bold text-[10px] uppercase tracking-wider border border-slate-800/40"><LogOut size={12} /> Sign Out Session</button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto flex flex-col bg-[#edf4f2]">
        <header className="h-20 bg-white border-b border-slate-100 flex items-center justify-between px-10 sticky top-0 z-50 shadow-sm">
          <div className="flex items-center gap-2">
             <Logo className="h-9 w-9" color="#00E1C5" />
             <h1 className="text-xl font-black text-slate-800 tracking-widest uppercase">QAonCloud</h1>
          </div>
          <div className="flex items-center gap-4">
             {activeProject && [
               'ai_user_generator', 'scenarios', 'cases', 'manual', 
               'execution', 'execution_manual_cases', 'execution_scripts', 
               'execution_api', 'execution_performance', 'scripts', 
               'record_play', 'api', 'performance', 'web_performance', 'ui_testing', 
               'settings_jira', 'settings_github', 'settings_slack'
             ].includes(activeTab) && (
               <div className="bg-[#00E1C5]/10 border border-[#00E1C5]/25 px-5 py-2.5 rounded-full text-[10px] font-black text-[#009B87] uppercase tracking-widest mr-2 shadow-sm">
                 PROJECT: {activeProject.name.toUpperCase()}
               </div>
             )}



              {/* Permanent Real-Time Credit Alert Label in Clear Format */}
              <CreditAlertBanner 
                currentUserEmail={user?.email || contextualUser?.email} 
                currentUserName={user?.name || contextualUser?.name} 
                onNavigateToCredits={() => setActiveTab('settings_credits')}
              />

              <NotificationBell notifications={notifications} userEmail={user?.email || ''} isAdmin={isAdmin} />

             <div className={`flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] px-5 py-2.5 rounded-full border transition-all duration-300 ${
               isOffline 
                 ? 'bg-amber-50 border border-amber-200 text-amber-700' 
                 : 'bg-[#00E1C5]/10 border border-[#00E1C5]/20 text-[#009B87]'
             }`}>
                <div className={`w-2 h-2 rounded-full ${isOffline ? 'bg-amber-500' : 'bg-[#10b981] animate-pulse'}`} />
                <span className={isOffline ? 'text-amber-700' : 'text-[#009B87]'}>{isOffline ? 'Offline Mode (Local Cache)' : 'Synchronized Session'}</span>
                <span className="opacity-30 text-[#009B87]">|</span>
                <span className={isOffline ? 'text-amber-600' : 'text-slate-600'}>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
             </div>
          </div>
        </header>
        <div className="p-10 w-full">{renderContent()}</div>
      </main>



      {/* Add Execution Suite Modal */}
      {isSuiteModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-md rounded-[3rem] shadow-2xl p-10 border border-white">
            <div className="flex items-center gap-4 mb-8">
               <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-100"><Network size={24} /></div>
               <div>
                  <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Add Execution Suite</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Initialize new API collection run</p>
               </div>
            </div>
            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Suite Label</label>
                <input type="text" value={newSuiteName || ''} onChange={(e) => setNewSuiteName(e.target.value)} placeholder="e.g. Identity Regression" className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-inner" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Source Collection</label>
                <div className="relative">
                  <select value={selectedFolderId || ''} onChange={(e) => setSelectedFolderId(e.target.value)} className="w-full pl-6 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium outline-none appearance-none cursor-pointer focus:ring-4 ring-indigo-50 shadow-inner">
                    <option value="">Select Target Collection</option>
                    {availableAiFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                </div>
              </div>
              {suiteError && <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-red-600 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2"><Zap size={14} /> {suiteError}</div>}
              <div className="flex flex-col gap-3 pt-4">
                <button onClick={handleSaveSuite} className="w-full py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2 disabled:opacity-50">Submit</button>
                <button 
                  onClick={() => {
                    setIsSuiteModalOpen(false);
                    setNewSuiteName('');
                    setSelectedFolderId('');
                    setSuiteError('');
                  }} 
                  className="w-full py-5 bg-slate-100 text-slate-500 rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Suite Confirmation Modal */}
      {deleteSuiteConfirm && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white p-10 rounded-[3.5rem] max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95 duration-300 border border-white">
             <div className="w-24 h-24 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-10 text-rose-500 shadow-inner">
                <AlertTriangle size={48} />
             </div>
             <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-4 leading-none">Delete Suite?</h3>
             <p className="text-sm text-slate-500 font-medium leading-relaxed mb-12 px-4">Permanently remove <span className="font-bold text-slate-800">"{deleteSuiteConfirm.name}"</span>? This action is irreversible.</p>
             <div className="flex flex-col gap-4">
                <button onClick={() => { handleDeleteSuite(deleteSuiteConfirm.id); setDeleteSuiteConfirm(null); }} className="w-full py-5 bg-rose-600 text-white rounded-[1.8rem] font-black text-[11px] uppercase tracking-widest hover:bg-rose-700 shadow-2xl shadow-rose-100 active:scale-95 transition-all">Delete / Continue</button>
                <button onClick={() => setDeleteSuiteConfirm(null)} className="w-full py-5 bg-slate-100 text-slate-500 rounded-[1.8rem] font-black text-[11px] uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
             </div>
          </div>
        </div>
      )}

      {/* View Details Modal */}
      {viewDetailsSuite && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-lg"><Eye size={24} /></div>
                    <div>
                       <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">{viewDetailsSuite.name} Scenarios</h3>
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Included collection requests</p>
                    </div>
                 </div>
                 <button onClick={() => setViewDetailsSuite(null)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                    <X size={24} />
                 </button>
              </div>
              <div className="flex-1 overflow-y-auto p-10 custom-scrollbar space-y-4">
                 {getSuiteScenarios(viewDetailsSuite.targetFolderId).length === 0 ? (
                   <div className="py-20 text-center text-slate-400 italic font-medium">No scenarios found in this folder.</div>
                 ) : (
                   getSuiteScenarios(viewDetailsSuite.targetFolderId).map((req, ridx) => (
                     <div key={req.id} className="p-6 bg-slate-50 border border-slate-100 rounded-[2rem] hover:border-indigo-200 transition-all group">
                        <div className="flex items-center justify-between mb-4">
                           <div className="flex items-center gap-3">
                              <span className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">{req.method}</span>
                              <h4 className="text-sm font-bold text-slate-800">{req.name || 'Untitled Request'}</h4>
                           </div>
                           <span className="text-[10px] font-mono text-slate-400">Step {ridx + 1}</span>
                        </div>
                        <div className="space-y-4">
                           {req.description && (
                             <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Scenario Description</p>
                                <p className="text-xs text-slate-600 leading-relaxed">{req.description}</p>
                             </div>
                           )}
                           {req.expectedResults && (
                             <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Expected Results</p>
                                <p className="text-xs text-indigo-600 font-bold leading-relaxed">{req.expectedResults}</p>
                             </div>
                           )}
                        </div>
                     </div>
                   ))
                 )}
              </div>
              <div className="p-8 border-t border-slate-100 flex justify-end bg-slate-50/50">
                 <button onClick={() => setViewDetailsSuite(null)} className="px-10 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all">Close Details</button>
              </div>
           </div>
        </div>
      )}

      {/* Add Evidence Modal */}
      {addEvidenceContext && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white w-full max-w-4xl h-[90vh] rounded-[3.5rem] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-300 border border-white">
              <div className="p-10 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 backdrop-blur-sm">
                 <div className="flex items-center gap-6">
                    <div className="p-5 bg-indigo-600 rounded-[1.5rem] text-white shadow-2xl shadow-indigo-100">
                       <Paperclip size={32} />
                    </div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Add Execution Evidence</h3>
                       {!addEvidenceContext.scenarioId && (
                          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                             Execution Suite: {addEvidenceContext.suite.name}
                          </p>
                       )}
                    </div>
                 </div>
                 <button onClick={() => setAddEvidenceContext(null)} className="p-3 text-slate-400 hover:text-slate-600 hover:bg-white rounded-full transition-all border border-slate-100 shadow-sm">
                    <X size={32} />
                 </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-12 space-y-12 custom-scrollbar bg-white">
                 {/* Comments Section */}
                 <div>
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-3 ml-2">
                       <MessageSquare size={16} className="text-indigo-50" /> Execution Notes & Observations
                    </label>
                    <textarea 
                       value={currentStaged?.comment || ''} 
                       onChange={e => updateStagedField('comment', e.target.value)} 
                       placeholder="Enter technical findings, bug descriptions, or general observations here..." 
                       className="w-full h-40 px-8 py-6 bg-slate-50 border border-slate-200 rounded-[2.5rem] text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all resize-none shadow-inner text-slate-700" 
                    />
                 </div>
                 
                 {/* Links Section */}
                 <div>
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-3 ml-2">
                       <Link2 size={16} className="text-indigo-50" /> Reference Links (Jam, Jira etc)
                    </label>
                    <div className="flex gap-3 mb-6">
                       <div className="relative flex-1 group">
                          <Link2 className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={20} />
                          <input 
                             value={newLinkInput || ''} 
                             onChange={e => setNewLinkInput(e.target.value)} 
                             onKeyDown={e => e.key === 'Enter' && handleAddEvidenceLink()}
                             placeholder="e.g. Jira Ticket URL, Confluence link, Log viewer..." 
                             className="w-full pl-14 pr-6 py-5 bg-slate-50 border border-slate-200 rounded-3xl text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-sm" 
                          />
                       </div>
                       <button onClick={handleAddEvidenceLink} className="px-8 py-5 bg-indigo-600 text-white rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg active:scale-95 transition-all">Add Link</button>
                    </div>

                    {currentStaged?.links && currentStaged.links.length > 0 && (
                       <div className="space-y-3 px-2">
                          {currentStaged.links.map((link, lidx) => (
                             <div key={lidx} className="flex items-center justify-between p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl group/link">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                   <ExternalLink size={14} className="text-indigo-400 flex-shrink-0" />
                                   <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-indigo-700 hover:underline truncate">{link}</a>
                                </div>
                                <button onClick={() => handleRemoveEvidenceLink(lidx)} className="p-2 text-slate-400 hover:text-rose-500 opacity-0 group-hover/link:opacity-100 transition-all"><Trash2 size={16} /></button>
                             </div>
                          ))}
                       </div>
                    )}
                 </div>

                 {/* Attachments Section */}
                 <div>
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-3 ml-2">
                       <Upload size={16} className="text-indigo-50" /> EVIDENCE (SCREENSHOT/IMAGES)
                    </label>
                    <div 
                      onClick={() => !isUploadingMedia && fileInputRef.current?.click()}
                      className={`border-4 border-dashed border-slate-100 rounded-[3rem] p-16 flex flex-col items-center justify-center gap-6 bg-slate-50/50 hover:bg-indigo-50/20 hover:border-indigo-200 transition-all cursor-pointer group mb-10 ${isUploadingMedia ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                       <input type="file" multiple ref={fileInputRef} className="hidden" accept="image/*,video/*" onChange={handleFileSelect} />
                       {isUploadingMedia ? (
                          <div className="flex flex-col items-center gap-4">
                             <Loader2 size={48} className="animate-spin text-indigo-600" />
                             <p className="text-xs font-black uppercase tracking-widest text-slate-400">Processing Media stream...</p>
                          </div>
                       ) : (
                          <>
                             <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-slate-300 group-hover:text-indigo-50 group-hover:scale-110 shadow-xl border border-slate-100 transition-all">
                                <Upload size={40} />
                             </div>
                             <div className="text-center">
                                <p className="text-lg font-black text-slate-700 uppercase tracking-tight">Drop files or click to initiate upload</p>
                                <p className="text-xs text-slate-400 font-bold uppercase mt-2 tracking-[0.2em]">Supports PNG, JPG, WEBP, MP4, MOV, WEBM (Aggressive Compression)</p>
                             </div>
                          </>
                       )}
                    </div>

                    {uploadSuccessMessage && (
                       <div className="mb-8 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center gap-3 text-emerald-600 text-sm font-black uppercase tracking-widest animate-in slide-in-from-top-2">
                          <CheckCircle size={20} />
                          {uploadSuccessMessage}
                       </div>
                    )}

                    {currentStaged?.attachments && currentStaged.attachments.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 animate-in slide-in-from-top-4">
                        {currentStaged.attachments.map((data, aidx) => {
                          const isVid = data.startsWith('data:video') || data.toLowerCase().includes('.mp4') || data.toLowerCase().includes('.mov') || data.toLowerCase().includes('.webm');
                          return (
                            <div key={aidx} className="relative group/att rounded-[2rem] overflow-hidden border border-slate-200 shadow-xl aspect-video bg-slate-900">
                               {isVid ? (
                                 <div 
                                   className="w-full h-full flex flex-col items-center justify-center gap-3 cursor-pointer"
                                   onClick={() => setPreviewMedia({ url: data, type: 'video' })}
                                 >
                                    <FileVideo size={48} className="text-white/30" />
                                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Video Stream Asset</span>
                                    <div className="absolute inset-0 bg-indigo-600/10 opacity-0 group-hover/att:opacity-100 transition-all flex items-center justify-center">
                                       <PlayCircle size={48} className="text-white shadow-2xl" />
                                    </div>
                                 </div>
                               ) : (
                                 <img 
                                   src={data || undefined} 
                                   className="w-full h-full object-cover transition-transform duration-700 group-hover/att:scale-110 opacity-80 group-hover/att:opacity-100 cursor-zoom-in" 
                                   alt="Evidence" 
                                   onClick={() => setPreviewMedia({ url: data, type: 'image' })}
                                 />
                               )}
                               <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover/att:opacity-100 transition-all z-20">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleDownloadMedia(data, aidx); }}
                                    className="p-2.5 bg-indigo-600 text-white rounded-2xl shadow-2xl hover:bg-indigo-700 transition-all"
                                    title="Download"
                                  >
                                    <Download size={18}/>
                                  </button>
                                  <button 
                                    onClick={() => updateStagedField('attachments', currentStaged.attachments!.filter((_, i) => i !== aidx))} 
                                    className="p-2.5 bg-rose-500 text-white rounded-2xl shadow-2xl hover:bg-rose-600 transition-all"
                                    title="Delete"
                                  >
                                    <Trash2 size={18}/>
                                  </button>
                               </div>
                               <div className="absolute bottom-4 left-4 px-4 py-1.5 bg-black/40 backdrop-blur-md rounded-xl border border-white/10">
                                  <div className="flex items-center gap-2">
                                     {isVid ? <FileVideo size={14} className="text-white"/> : <ImageIcon size={14} className="text-white"/>}
                                     <span className="text-[9px] font-black uppercase text-white tracking-widest">{isVid ? 'Video Evidence' : 'Static Image'}</span>
                                  </div>
                               </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                 </div>
              </div>
              
              <div className="p-10 bg-slate-50 border-t border-slate-100 flex gap-5 shadow-[0_-10px_40px_rgba(0,0,0,0.02)]">
                 <button 
                  onClick={saveEvidence} 
                  disabled={isUploadingMedia}
                  className={`flex-1 py-6 bg-indigo-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest hover:bg-indigo-700 shadow-2xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-3 ${isUploadingMedia ? 'opacity-50 cursor-not-allowed' : ''}`}
                 >
                    {isUploadingMedia ? <Loader2 size={24} /> : <CheckCircle2 size={24} />} Commit Evidence Context
                 </button>
                 <button onClick={() => setAddEvidenceContext(null)} className="flex-1 py-6 bg-white text-slate-500 border border-slate-200 rounded-[2rem] font-black text-sm uppercase tracking-widest hover:bg-slate-50 active:scale-95 transition-all">Discard Operation</button>
              </div>
           </div>
        </div>
      )}
      <Toaster position="top-right" richColors closeButton />
      <AICacheNotification />
      <JiraBugModal 
        isOpen={apiBugModalOpen} 
        onClose={() => setApiBugModalOpen(false)} 
        project={activeProject} 
        customTitle={apiBugTitle}
        customDescription={apiBugDescription}
        customAttachments={apiBugAttachments}
        customLinks={apiBugLinks}
        customComments={apiBugComments}
        user={contextualUser}
      />
    </div>
    </ErrorBoundary>
  );
};

export default App;