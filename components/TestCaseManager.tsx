import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { 
  Sparkles, 
  FileVideo, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Trash2, 
  Edit3, 
  Copy, 
  Download, 
  Play, 
  Folder, 
  FolderPlus,
  FileSpreadsheet, 
  Layers, 
  Eye, 
  RefreshCw, 
  ChevronRight, 
  ChevronDown, 
  ChevronLeft,
  Check, 
  CheckSquare, 
  Square, 
  Clock, 
  ShieldAlert, 
  FileText, 
  Film, 
  ExternalLink,
  ArrowRight,
  HelpCircle,
  Hash,
  SlidersHorizontal,
  Maximize2,
  ZoomIn,
  X,
  Globe,
  User as UserIcon,
  Lock,
  Paperclip,
  Upload,
  Info,
  Sliders,
  Image as ImageIcon,
  Clipboard,
  FileCode,
  FileCheck,
  LayoutGrid,
  Pencil,
  Zap
} from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { 
  Project, 
  TestScenario, 
  TestCase, 
  TestStatus, 
  TestPriority, 
  TestType, 
  TestIntent, 
  User,
  VectorSearchResult 
} from '../types';
import { VideoInputUploader, VideoWalkthroughData } from './VideoInputUploader';
import { ScreenshotUploader, ScreenshotFile } from './ScreenshotUploader';
import { RAGStatusBadge } from './RAGStatusBadge';
import { generateTestCasesFromScenario } from '../geminiService';
import { logActivity } from '../services/activityService';
import { JiraBugModal } from './JiraBugModal';
import { createVideoFramesThumbnails } from '../utils/videoExtractor';

export const maskPasswordText = (text: string | undefined, password?: string): string => {
  if (!text) return '';
  if (!password || password.trim().length === 0) return text;
  try {
    const escaped = password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'gi'), '••••••••');
  } catch {
    return text;
  }
};

/**
 * Parses test case step text to highlight and link Frame references (e.g. [Frame 1 @ 00:01])
 */
export const renderStepWithFrameTags = (
  stepText: string,
  password?: string,
  onFrameClick?: (frameIndex: number) => void
): React.ReactNode => {
  const masked = maskPasswordText(stepText, password);
  const frameRegex = /\[Frame\s*(\d+)(?:\s*@\s*([\d:]+))?\]/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = frameRegex.exec(masked)) !== null) {
    if (match.index > lastIndex) {
      parts.push(masked.substring(lastIndex, match.index));
    }
    const frameNum = parseInt(match[1], 10);
    const timestamp = match[2] || '';
    parts.push(
      <button
        key={`frame-btn-${match.index}`}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (onFrameClick) onFrameClick(frameNum - 1);
        }}
        className="inline-flex items-center gap-1 mx-1 px-2 py-0.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200/90 rounded-md font-mono text-[10px] font-black transition-all hover:scale-105 shadow-xs cursor-pointer align-baseline"
        title={`Inspect Frame ${frameNum}${timestamp ? ` at ${timestamp}` : ''}`}
      >
        <Film size={10} className="text-teal-600 shrink-0" />
        <span>Frame {frameNum}</span>
        {timestamp && <span className="text-teal-600 font-semibold">@{timestamp}</span>}
      </button>
    );
    lastIndex = frameRegex.lastIndex;
  }

  if (lastIndex < masked.length) {
    parts.push(masked.substring(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : masked;
};

interface TestCaseManagerProps {
  project: Project;
  user: User;
  onUpdateProject: (p: Project) => void;
  onRunFolder?: (folderId: string) => void;
}

export const TestCaseManager: React.FC<TestCaseManagerProps> = ({
  project,
  user,
  onUpdateProject,
  onRunFolder
}) => {
  // Main view tab: 'folders' or 'scenarios'
  const [activeView, setActiveView] = useState<'folders' | 'scenarios'>('folders');

  // Expanded folders and test cases
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [expandedCaseIds, setExpandedCaseIds] = useState<Set<string>>(new Set());

  // Scenarios / cases filters
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [intentFilter, setIntentFilter] = useState<string>('ALL');
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());

  // RAG Toggle
  const [ragEnabled, setRagEnabled] = useState(true);
  const [retrievedRagChunks, setRetrievedRagChunks] = useState<VectorSearchResult[]>([]);

  // Generation Context States
  const [defaultAppUrl, setDefaultAppUrl] = useState('');
  const [defaultUsername, setDefaultUsername] = useState('');
  const [defaultPassword, setDefaultPassword] = useState('');
  const [reqDocFile, setReqDocFile] = useState<{ name: string; content: string; size: number } | null>(null);
  const [screenshots, setScreenshots] = useState<ScreenshotFile[]>([]);
  const [videoData, setVideoData] = useState<VideoWalkthroughData | null>(null);
  const [visualInputMode, setVisualInputMode] = useState<'screenshots' | 'video'>('screenshots');
  const [focusDirectives, setFocusDirectives] = useState('');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisStep, setSynthesisStep] = useState('');

  // File Upload Refs
  const docInputRef = useRef<HTMLInputElement>(null);
  const excelUploadRef = useRef<HTMLInputElement>(null);
  const imagesUploadRef = useRef<HTMLInputElement>(null);

  // Keyframe Inspector Modal State
  const [previewFrameModal, setPreviewFrameModal] = useState<{
    isOpen: boolean;
    frames: Array<{ timestamp?: string; image?: string; frameIndex?: number; isBlank?: boolean }>;
    currentFrameIndex: number;
    title: string;
    videoFileName?: string;
  }>({
    isOpen: false,
    frames: [],
    currentFrameIndex: 0,
    title: '',
    videoFileName: ''
  });

  // Add / Edit Folder Modal State
  const [isAddFolderModalOpen, setIsAddFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderModule, setNewFolderModule] = useState('');

  // Delete Folder State
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<TestScenario | null>(null);

  // Move to Folder / Scenario Modal State
  const [isMoveToFolderModalOpen, setIsMoveToFolderModalOpen] = useState(false);
  const [moveTargetScenarioId, setMoveTargetScenarioId] = useState<string>('');

  // Add / Edit Case Modal State
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<{ scenarioId: string; testCase: TestCase } | null>(null);
  const [caseFormScenarioId, setCaseFormScenarioId] = useState<string>('');
  const [caseForm, setCaseForm] = useState<Partial<TestCase>>({
    title: '',
    steps: [''],
    expectedResult: '',
    status: TestStatus.NOT_EXECUTED,
    isApproved: false,
    testType: TestType.FUNCTIONAL,
    testIntent: TestIntent.POSITIVE,
    priority: TestPriority.MEDIUM,
    testDataSets: ['', '']
  });

  // Delete Case modal
  const [deleteTarget, setDeleteTarget] = useState<{ scenarioId: string; testCaseId: string; title: string } | null>(null);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);

  // Jira bug modal
  const [jiraModalCase, setJiraModalCase] = useState<TestCase | null>(null);

  // Generate AI Test Cases for selected scenario modal states
  const [scenarioForGenerateModal, setScenarioForGenerateModal] = useState<TestScenario | null>(null);
  const [generateDirectives, setGenerateDirectives] = useState<string>('');
  const [isModalGenerating, setIsModalGenerating] = useState<boolean>(false);

  // Helper to parse steps from scenario description
  const helperParseSteps = (desc?: string): string[] => {
    const cleanDesc = (desc || '').trim();
    if (!cleanDesc) return ['Execute scenario verification steps.'];
    const lines = cleanDesc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const numberedMatches = lines.filter(l => /^\d+[\.\)]\s*/.test(l));
    if (numberedMatches.length > 1) {
      return numberedMatches.map(l => l.replace(/^\d+[\.\)]\s*/, '').trim());
    } else if (lines.length > 1) {
      return lines.map(l => l.replace(/^[-*•]\s*/, '').trim());
    }
    return [cleanDesc];
  };

  // Helper to resolve test cases from a single scenario
  const getScenarioCases = useCallback((scen: TestScenario): TestCase[] => {
    if (scen.testCases && scen.testCases.length > 0) {
      return scen.testCases;
    }
    if (['SCENARIO_FOLDER', 'MANUAL_FOLDER', 'TESTCASE_FOLDER', 'INPUT_SOURCE'].includes(scen.scenarioId)) {
      return [];
    }
    const rawId = scen.scenarioId || 'TC-001';
    const tcId = rawId.replace(/^TS-|^SC-/, 'TC-');

    return [{
      id: `TC-${scen.id}`,
      testCaseId: tcId.startsWith('TC-') ? tcId : `TC-${tcId}`,
      userStoryId: scen.userStoryNumber || scen.userStoryId || '',
      title: scen.title,
      description: scen.description,
      steps: helperParseSteps(scen.description),
      expectedResult: scen.expectedResults || 'Execution validates requirements successfully.',
      status: TestStatus.NOT_EXECUTED,
      isApproved: Boolean(scen.isApproved),
      priority: (scen.priority as TestPriority) || TestPriority.MEDIUM,
      testType: scen.type === 'Non-functional' ? TestType.NON_FUNCTIONAL : TestType.FUNCTIONAL,
      testIntent: TestIntent.POSITIVE,
      testDataSets: ['Default test data set'],
      executedAt: scen.createdAt || new Date().toISOString()
    }];
  }, []);

  // Helper to resolve all test cases in a folder (direct + member scenarios)
  const getFolderCases = useCallback((folder: TestScenario, allScenarios: TestScenario[]): TestCase[] => {
    const directCases = (folder.testCases || []).length > 0 ? (folder.testCases || []) : [];
    const memberIds = new Set(folder.memberScenarioIds || []);
    
    const memberScenarios = allScenarios.filter(s => 
      (memberIds.has(s.id) || s.folderId === folder.id) &&
      !['SCENARIO_FOLDER', 'MANUAL_FOLDER', 'TESTCASE_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId)
    );

    const memberCases: TestCase[] = [];
    memberScenarios.forEach(ms => {
      memberCases.push(...getScenarioCases(ms));
    });

    const combined = [...directCases];
    const seen = new Set(directCases.map(c => c.id));
    memberCases.forEach(c => {
      if (!seen.has(c.id)) {
        combined.push(c);
        seen.add(c.id);
      }
    });

    return combined;
  }, [getScenarioCases]);

  // Folders created specifically in AI Test Cases page
  const testCaseFolders = useMemo(() => {
    return (project.scenarios || []).filter(s => s.scenarioId === 'TESTCASE_FOLDER');
  }, [project.scenarios]);

  // Approved scenarios available in AI Test Cases (excludes structural folders)
  const approvedScenarios = useMemo(() => {
    return (project.scenarios || []).filter(s => 
      !['SCENARIO_FOLDER', 'MANUAL_FOLDER', 'TESTCASE_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId) &&
      (s.isApproved || (s.testCases && s.testCases.length > 0))
    );
  }, [project.scenarios]);

  // Active scenarios for test case management (non-folder scenarios)
  const validScenarios = useMemo(() => {
    return (project.scenarios || []).filter(s => 
      !['SCENARIO_FOLDER', 'MANUAL_FOLDER', 'TESTCASE_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId)
    );
  }, [project.scenarios]);

  // Flattened list of test cases with scenario metadata across ALL test case folders and approved scenarios
  const allCasesWithScenario = useMemo(() => {
    const list: Array<{ scenario: TestScenario; testCase: TestCase }> = [];
    const seenCaseIds = new Set<string>();

    // Include cases from test case folders
    testCaseFolders.forEach(scen => {
      const folderCases = getFolderCases(scen, project.scenarios || []);
      folderCases.forEach(tc => {
        if (!seenCaseIds.has(tc.id)) {
          seenCaseIds.add(tc.id);
          list.push({ scenario: scen, testCase: tc });
        }
      });
    });

    // Include cases from individual approved scenarios
    approvedScenarios.forEach(scen => {
      const scenarioCases = getScenarioCases(scen);
      scenarioCases.forEach(tc => {
        if (!seenCaseIds.has(tc.id)) {
          seenCaseIds.add(tc.id);
          list.push({ scenario: scen, testCase: tc });
        }
      });
    });

    return list;
  }, [testCaseFolders, approvedScenarios, project.scenarios, getFolderCases, getScenarioCases]);

  // Filtered test cases
  const filteredCases = useMemo(() => {
    return allCasesWithScenario.filter(({ scenario, testCase }) => {
      // Scenario filter
      if (selectedScenarioId !== 'ALL' && scenario.id !== selectedScenarioId) {
        return false;
      }
      // Status filter
      if (statusFilter !== 'ALL' && testCase.status !== statusFilter) {
        return false;
      }
      // Priority filter
      if (priorityFilter !== 'ALL' && testCase.priority !== priorityFilter) {
        return false;
      }
      // Type filter
      if (typeFilter !== 'ALL' && testCase.testType !== typeFilter) {
        return false;
      }
      // Intent filter
      if (intentFilter !== 'ALL' && testCase.testIntent !== intentFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inId = (testCase.testCaseId || '').toLowerCase().includes(q);
        const inTitle = testCase.title.toLowerCase().includes(q);
        const inExpected = (testCase.expectedResult || '').toLowerCase().includes(q);
        const inSteps = (testCase.steps || []).some(s => s.toLowerCase().includes(q));
        const inScenario = scenario.title.toLowerCase().includes(q);
        if (!inId && !inTitle && !inExpected && !inSteps && !inScenario) {
          return false;
        }
      }
      return true;
    });
  }, [allCasesWithScenario, selectedScenarioId, statusFilter, priorityFilter, typeFilter, intentFilter, searchQuery]);

  // Filtered folders for folders view (ONLY displays AI Test Cases folders)
  const filteredFolders = useMemo(() => {
    const foldersList = testCaseFolders;
    if (!searchQuery.trim()) return foldersList;
    const q = searchQuery.toLowerCase();
    return foldersList.filter(f => {
      const fCases = getFolderCases(f, project.scenarios || []);
      return (
        f.title.toLowerCase().includes(q) ||
        (f.moduleName || '').toLowerCase().includes(q) ||
        fCases.some(tc => 
          tc.title.toLowerCase().includes(q) || 
          (tc.testCaseId || '').toLowerCase().includes(q)
        )
      );
    });
  }, [testCaseFolders, searchQuery, getFolderCases, project.scenarios]);

  // Quick summary metrics
  const totalCount = allCasesWithScenario.length;

  // Toggle Folder expansion
  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // Selection toggle
  const toggleSelectCase = (id: string) => {
    const next = new Set(selectedCaseIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCaseIds(next);
  };

  const toggleSelectAllVisible = () => {
    if (filteredCases.length > 0 && filteredCases.every(c => selectedCaseIds.has(c.testCase.id))) {
      const next = new Set(selectedCaseIds);
      filteredCases.forEach(c => next.delete(c.testCase.id));
      setSelectedCaseIds(next);
    } else {
      const next = new Set(selectedCaseIds);
      filteredCases.forEach(c => next.add(c.testCase.id));
      setSelectedCaseIds(next);
    }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedCaseIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedCaseIds(next);
  };

  // Toggle single approval
  const handleToggleApproval = (scenarioId: string, testCaseId: string) => {
    const updatedScenarios = (project.scenarios || []).map(scen => {
      const currentCases = getScenarioCases(scen);
      const isTarget = scen.id === scenarioId || currentCases.some(tc => tc.id === testCaseId) || (scen.testCases || []).some(tc => tc.id === testCaseId);
      if (isTarget) {
        const updatedCases = currentCases.map(tc => {
          if (tc.id === testCaseId) {
            return { ...tc, isApproved: !tc.isApproved };
          }
          return tc;
        });
        const hasApproved = updatedCases.some(tc => tc.isApproved);
        return {
          ...scen,
          isApproved: hasApproved,
          testCases: updatedCases
        };
      }
      return scen;
    });
    onUpdateProject({ ...project, scenarios: updatedScenarios });
    toast.success('Test case approval status updated');
  };

  // Bulk Approve
  const handleBulkApprove = () => {
    if (selectedCaseIds.size === 0) return;
    const updatedScenarios = (project.scenarios || []).map(scen => {
      const currentCases = getScenarioCases(scen);
      let changed = false;
      const updatedCases = currentCases.map(tc => {
        if (selectedCaseIds.has(tc.id)) {
          changed = true;
          return { ...tc, isApproved: true };
        }
        return tc;
      });
      if (changed) {
        return {
          ...scen,
          isApproved: true,
          testCases: updatedCases
        };
      }
      return scen;
    });
    onUpdateProject({ ...project, scenarios: updatedScenarios });
    toast.success(`Approved ${selectedCaseIds.size} test cases`);
    setSelectedCaseIds(new Set());
  };

  // Bulk Delete Trigger
  const handleBulkDelete = () => {
    if (selectedCaseIds.size === 0) {
      toast.error('Please select at least one test case to delete');
      return;
    }
    setIsBulkDeleteModalOpen(true);
  };

  const handleBulkDeleteConfirm = () => {
    if (selectedCaseIds.size === 0) {
      setIsBulkDeleteModalOpen(false);
      return;
    }
    const idsToDelete = new Set(selectedCaseIds);

    const updatedScenarios = (project.scenarios || [])
      .map(scen => {
        const isFolder = scen.scenarioId === 'SCENARIO_FOLDER' || 
                         scen.scenarioId === 'TESTCASE_FOLDER' || 
                         scen.scenarioId === 'MANUAL_FOLDER';

        if (isFolder) {
          const remainingDirectCases = (scen.testCases || []).filter(tc => !idsToDelete.has(tc.id));
          return {
            ...scen,
            testCases: remainingDirectCases
          };
        } else {
          // Individual scenario
          const hadExplicitCases = scen.testCases && scen.testCases.length > 0;
          if (hadExplicitCases) {
            const remainingCases = (scen.testCases || []).filter(tc => !idsToDelete.has(tc.id));
            if (remainingCases.length === 0) {
              return null;
            }
            return {
              ...scen,
              testCases: remainingCases
            };
          } else {
            // Synthesized test case: id is `TC-${scen.id}` or `scen.id`
            if (idsToDelete.has(`TC-${scen.id}`) || idsToDelete.has(scen.id)) {
              return null;
            }
            return scen;
          }
        }
      })
      .filter(Boolean) as TestScenario[];

    // Clean up memberScenarioIds in folders if referenced scenarios were removed
    const existingScenarioIds = new Set(updatedScenarios.map(s => s.id));
    const finalScenarios = updatedScenarios.map(scen => {
      if (scen.memberScenarioIds && scen.memberScenarioIds.length > 0) {
        return {
          ...scen,
          memberScenarioIds: scen.memberScenarioIds.filter(id => existingScenarioIds.has(id))
        };
      }
      return scen;
    });

    onUpdateProject({ ...project, scenarios: finalScenarios });
    toast.success(`Deleted ${selectedCaseIds.size} test case(s)`);
    setSelectedCaseIds(new Set());
    setIsBulkDeleteModalOpen(false);
  };

  // Export to Excel / CSV
  const handleExportExcel = () => {
    const target = selectedCaseIds.size > 0 
      ? filteredCases.filter(c => selectedCaseIds.has(c.testCase.id))
      : filteredCases;

    if (target.length === 0) {
      toast.error('No test cases available to export');
      return;
    }

    const rows = target.map(({ scenario, testCase }, idx) => ({
      '#': idx + 1,
      'Test Case ID': testCase.testCaseId || `TC-${idx + 1}`,
      'Scenario Title': scenario.title,
      'Module': scenario.moduleName || 'General',
      'Test Case Title': testCase.title,
      'Test Steps': (testCase.steps || []).join('\n'),
      'Expected Result': testCase.expectedResult,
      'Priority': testCase.priority || 'Medium',
      'Type': testCase.testType || 'Functional',
      'Intent': testCase.testIntent || 'Positive',
      'Status': testCase.status || 'NOT_EXECUTED',
      'Approved': testCase.isApproved ? 'YES' : 'NO',
      'Test Data Sets': (testCase.testDataSets || []).join(' | '),
      'Source': (testCase as any).source || (scenario.videoFileName ? 'Video Walkthrough' : 'AI Scenario')
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AI Test Cases');
    XLSX.writeFile(wb, `${project.name.replace(/\s+/g, '_')}_AI_Test_Cases.xlsx`);
    toast.success(`Exported ${target.length} test cases to Excel`);
  };

  // Single Folder Export
  const handleExportSingleFolder = (folder: TestScenario) => {
    const cases = getFolderCases(folder, project.scenarios || []);
    if (cases.length === 0) {
      toast.error(`Folder "${folder.title}" has no test cases to export`);
      return;
    }
    const rows = cases.map((tc, idx) => ({
      '#': idx + 1,
      'Test Case ID': tc.testCaseId || `TC-${idx + 1}`,
      'Folder / Scenario': folder.title,
      'Module': folder.moduleName || 'General',
      'Test Case Title': tc.title,
      'Test Steps': (tc.steps || []).join('\n'),
      'Expected Result': tc.expectedResult,
      'Priority': tc.priority || 'Medium',
      'Type': tc.testType || 'Functional',
      'Intent': tc.testIntent || 'Positive',
      'Status': tc.status || 'NOT_EXECUTED',
      'Approved': tc.isApproved ? 'YES' : 'NO',
      'Test Data Sets': (tc.testDataSets || []).join(' | ')
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, folder.title.slice(0, 30));
    XLSX.writeFile(wb, `${folder.title.replace(/\s+/g, '_')}_Test_Cases.xlsx`);
    toast.success(`Exported ${cases.length} test cases from "${folder.title}"`);
  };

  // Delete Folder
  const handleDeleteFolder = (folderId: string) => {
    const target = validScenarios.find(s => s.id === folderId);
    const updatedScenarios = (project.scenarios || []).filter(s => s.id !== folderId);
    onUpdateProject({ ...project, scenarios: updatedScenarios });
    toast.success(`Folder "${target?.title || 'Folder'}" deleted`);
    setDeleteFolderTarget(null);
    if (selectedScenarioId === folderId) {
      setSelectedScenarioId('ALL');
    }
  };

  // Download Excel Template
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Test Case ID': 'TC-001',
        'Module': 'Authentication',
        'Scenario Title': 'User Login Workflow',
        'Test Case Title': 'Verify successful login with valid credentials',
        'Test Steps': '1. Navigate to login page\n2. Enter valid email\n3. Enter valid password\n4. Click Login button',
        'Expected Result': 'User is redirected to Dashboard with success toast',
        'Priority': 'High',
        'Type': 'Functional',
        'Intent': 'Positive',
        'Test Data': 'admin@example.com / Pass123!'
      },
      {
        'Test Case ID': 'TC-002',
        'Module': 'Authentication',
        'Scenario Title': 'User Login Workflow',
        'Test Case Title': 'Verify error message with invalid password',
        'Test Steps': '1. Navigate to login page\n2. Enter valid email\n3. Enter incorrect password\n4. Click Login button',
        'Expected Result': 'System displays "Invalid credentials" error banner',
        'Priority': 'High',
        'Type': 'Functional',
        'Intent': 'Negative',
        'Test Data': 'admin@example.com / WrongPass'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Test_Cases_Import_Template.xlsx');
    toast.success('Template downloaded successfully');
  };

  // Handle Excel/CSV Upload Import
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data: any[] = XLSX.utils.sheet_to_json(ws);

        if (!data || data.length === 0) {
          toast.error('The uploaded sheet is empty');
          return;
        }

        const importedCases: TestCase[] = [];
        let targetModuleName = 'Imported';
        let targetScenarioTitle = `Imported: ${file.name.replace(/\.[^/.]+$/, '')}`;

        data.forEach((row, idx) => {
          const title = row['Test Case Title'] || row['Title'] || row['test case title'] || row['title'];
          if (!title) return;

          if (row['Module']) targetModuleName = row['Module'];
          if (row['Scenario Title']) targetScenarioTitle = row['Scenario Title'];

          const rawSteps = row['Test Steps'] || row['Steps'] || row['steps'] || '';
          const steps = typeof rawSteps === 'string' 
            ? rawSteps.split(/\r?\n|\d+\.\s+/).map(s => s.trim()).filter(Boolean)
            : ['Execute test steps'];

          const expectedResult = row['Expected Result'] || row['expected result'] || 'Step passes successfully';
          const priorityRaw = (row['Priority'] || 'Medium').toString().toUpperCase();
          const priority = priorityRaw === 'HIGH' ? TestPriority.HIGH : priorityRaw === 'LOW' ? TestPriority.LOW : TestPriority.MEDIUM;
          const typeRaw = (row['Type'] || 'Functional').toString();
          const testType = typeRaw.toLowerCase().includes('ui') ? TestType.UI : typeRaw.toLowerCase().includes('non') ? TestType.NON_FUNCTIONAL : TestType.FUNCTIONAL;

          importedCases.push({
            id: Math.random().toString(36).substr(2, 9),
            testCaseId: row['Test Case ID'] || `TC-IMP-${idx + 1}`,
            title: title.toString().trim(),
            steps: steps.length > 0 ? steps : ['Execute test steps'],
            expectedResult: expectedResult.toString().trim(),
            status: TestStatus.NOT_EXECUTED,
            isApproved: false,
            priority,
            testType,
            testIntent: TestIntent.POSITIVE,
            testDataSets: row['Test Data'] ? [row['Test Data'].toString()] : [],
            executedAt: new Date().toISOString()
          });
        });

        if (importedCases.length === 0) {
          toast.error('No valid test cases found in file');
          return;
        }

        const newScenario: TestScenario = {
          id: Math.random().toString(36).substr(2, 9),
          scenarioId: `TS-IMP-${Date.now().toString().slice(-4)}`,
          title: targetScenarioTitle,
          moduleName: targetModuleName,
          description: `Imported from ${file.name}`,
          expectedResults: 'Execution validates imported flows',
          type: 'Functional',
          isApproved: false,
          testCases: importedCases,
          createdAt: new Date().toISOString()
        };

        onUpdateProject({ ...project, scenarios: [newScenario, ...(project.scenarios || [])] });
        setSelectedScenarioId(newScenario.id);
        setActiveView('folders');
        setExpandedFolderIds(prev => new Set([...Array.from(prev), newScenario.id]));
        toast.success(`Successfully imported ${importedCases.length} test cases!`);
      } catch (err: any) {
        console.error('Import error:', err);
        toast.error('Failed to parse Excel file. Please use the provided template format.');
      }
    };
    reader.readAsBinaryString(file);
    if (excelUploadRef.current) excelUploadRef.current.value = '';
  };

  // Requirements Document Upload Handler
  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string || '';
      setReqDocFile({
        name: file.name,
        content: content.slice(0, 50000),
        size: file.size
      });
      toast.success(`Attached requirements document: ${file.name}`);
    };
    reader.readAsText(file);
    if (docInputRef.current) docInputRef.current.value = '';
  };

  // Paste Screenshot Handler
  const handlePasteScreenshot = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        toast.info('Please use the "Upload Images" button or drag & drop files.');
        return;
      }
      const clipboardItems = await navigator.clipboard.read();
      let found = false;
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          found = true;
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64Data = dataUrl.split(',')[1];
            const newScreenshot: ScreenshotFile = {
              id: Math.random().toString(36).substr(2, 9),
              name: `pasted-image-${Date.now()}.${imageType.split('/')[1] || 'png'}`,
              data: base64Data,
              mimeType: imageType,
              previewUrl: dataUrl,
              size: blob.size
            };
            setScreenshots(prev => [...prev, newScreenshot]);
            toast.success('Screenshot pasted from clipboard!');
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
      if (!found) {
        toast.error('No image found in clipboard');
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
      toast.info('To paste an image, please copy an image to your clipboard and try again.');
    }
  };

  // Multiple Image Upload Handler
  const handleImagesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64Data = dataUrl.split(',')[1];
        const newScreenshot: ScreenshotFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          data: base64Data,
          mimeType: file.type,
          previewUrl: dataUrl,
          size: file.size
        };
        setScreenshots(prev => [...prev, newScreenshot]);
      };
      reader.readAsDataURL(file);
    });

    toast.success(`Uploaded ${files.length} screenshot(s)`);
    if (imagesUploadRef.current) imagesUploadRef.current.value = '';
  };

  // Create New Folder Modal Handler
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      toast.error('Please enter a folder name');
      return;
    }

    const newScenario: TestScenario = {
      id: Math.random().toString(36).substr(2, 9),
      scenarioId: 'TESTCASE_FOLDER',
      title: newFolderName.trim(),
      moduleName: newFolderModule.trim() || 'General',
      description: 'Folder for test cases',
      expectedResults: 'Execution succeeds',
      type: 'Functional',
      isApproved: true,
      testCases: [],
      createdAt: new Date().toISOString()
    };

    onUpdateProject({ ...project, scenarios: [newScenario, ...(project.scenarios || [])] });
    setSelectedScenarioId(newScenario.id);
    setActiveView('folders');
    setExpandedFolderIds(prev => new Set([...Array.from(prev), newScenario.id]));
    setIsAddFolderModalOpen(false);
    setNewFolderName('');
    setNewFolderModule('');
    toast.success(`Folder "${newFolderName}" created`);
  };

  // Handler to generate AI test cases for a specific approved scenario
  const handleExecuteGenerateForScenario = async (targetScenario: TestScenario) => {
    if (!targetScenario) return;
    setIsModalGenerating(true);
    try {
      toast.info(`Generating AI Test Cases for "${targetScenario.title}"...`);
      const contextPayload: any = {
        url: targetScenario.appUrl || defaultAppUrl,
        username: targetScenario.username || defaultUsername,
        password: targetScenario.password || defaultPassword,
        refineInstructions: generateDirectives || focusDirectives,
        docContent: reqDocFile?.content || targetScenario.docContent,
        docFileName: reqDocFile?.name || targetScenario.docFileName
      };

      if (screenshots.length > 0) {
        contextPayload.screenshots = screenshots.map(s => `data:${s.mimeType};base64,${s.data}`);
      }
      if (videoData && videoData.frames.length > 0) {
        contextPayload.videoFrames = videoData.frames;
        contextPayload.videoFileName = videoData.fileName;
        contextPayload.videoDuration = videoData.duration;
      }

      const generatedCases = await generateTestCasesFromScenario(targetScenario, contextPayload);

      if (!Array.isArray(generatedCases) || generatedCases.length === 0) {
        throw new Error('No test cases generated by the AI service.');
      }

      const formattedCases: TestCase[] = generatedCases.map((tc: any, idx: number) => ({
        id: Math.random().toString(36).substr(2, 9),
        testCaseId: `TC-${targetScenario.scenarioId || 'GEN'}-${String(idx + 1).padStart(2, '0')}`,
        title: tc.title || `Test Case ${idx + 1}`,
        steps: Array.isArray(tc.steps) && tc.steps.length > 0 ? tc.steps : ['Execute scenario steps'],
        expectedResult: tc.expectedResult || targetScenario.expectedResults || 'Execution succeeds.',
        status: TestStatus.NOT_EXECUTED,
        isApproved: false,
        testType: tc.testType === 'Non-Functional' ? TestType.NON_FUNCTIONAL : tc.testType === 'UI' ? TestType.UI : TestType.FUNCTIONAL,
        testIntent: tc.testIntent === 'Negative' ? TestIntent.NEGATIVE : TestIntent.POSITIVE,
        priority: tc.priority === 'High' ? TestPriority.HIGH : tc.priority === 'Low' ? TestPriority.LOW : TestPriority.MEDIUM,
        testDataSets: Array.isArray(tc.testDataSets) ? tc.testDataSets : ['Set 1: Valid inputs', 'Set 2: Boundary data'],
        source: 'ai_synthesis',
        executedAt: new Date().toISOString()
      }));

      const updatedScenarios = (project.scenarios || []).map(s => {
        if (s.id === targetScenario.id) {
          return {
            ...s,
            isApproved: true,
            testCases: formattedCases
          };
        }
        return s;
      });

      onUpdateProject({ ...project, scenarios: updatedScenarios });
      setScenarioForGenerateModal(null);
      setGenerateDirectives('');
      toast.success(`Successfully generated ${formattedCases.length} AI test cases for "${targetScenario.title}"!`);
      await logActivity(user.email, user.name, `Generated ${formattedCases.length} AI Test Cases for scenario: ${targetScenario.title}`, project.id, project.name);
    } catch (err: any) {
      console.error('Generation error:', err);
      toast.error(`Generation error: ${err.message || 'Failed to generate test cases'}`);
    } finally {
      setIsModalGenerating(false);
    }
  };

  // Save Add/Edit Test Case Handler
  const handleSaveTestCase = () => {
    if (!caseForm.title?.trim()) {
      toast.error('Please enter a test case title');
      return;
    }
    if (!caseFormScenarioId) {
      toast.error('Please select a target folder');
      return;
    }

    const cleanSteps = (caseForm.steps || []).filter(s => s.trim().length > 0);
    const formattedSteps = cleanSteps.length > 0 ? cleanSteps : ['Perform initial validation step'];

    if (editingCase) {
      // Update existing case
      const updatedScenarios = (project.scenarios || []).map(scen => {
        if (scen.id !== editingCase.scenarioId) return scen;
        const updatedCases = (scen.testCases || []).map(tc => {
          if (tc.id !== editingCase.testCase.id) return tc;
          return {
            ...tc,
            title: caseForm.title!.trim(),
            steps: formattedSteps,
            expectedResult: caseForm.expectedResult?.trim() || 'Verify expected behavior',
            priority: caseForm.priority || TestPriority.MEDIUM,
            testType: caseForm.testType || TestType.FUNCTIONAL,
            testIntent: caseForm.testIntent || TestIntent.POSITIVE,
            testDataSets: (caseForm.testDataSets || []).filter(d => d.trim().length > 0)
          };
        });
        return { ...scen, testCases: updatedCases };
      });
      onUpdateProject({ ...project, scenarios: updatedScenarios });
      toast.success('Test case updated successfully');
    } else {
      // Add new case
      const newCase: TestCase = {
        id: Math.random().toString(36).substr(2, 9),
        testCaseId: `TC-${Date.now().toString().slice(-4)}`,
        title: caseForm.title!.trim(),
        steps: formattedSteps,
        expectedResult: caseForm.expectedResult?.trim() || 'Verify expected outcome',
        status: TestStatus.NOT_EXECUTED,
        isApproved: false,
        priority: caseForm.priority || TestPriority.MEDIUM,
        testType: caseForm.testType || TestType.FUNCTIONAL,
        testIntent: caseForm.testIntent || TestIntent.POSITIVE,
        testDataSets: (caseForm.testDataSets || []).filter(d => d.trim().length > 0),
        executedAt: new Date().toISOString()
      };

      const updatedScenarios = (project.scenarios || []).map(scen => {
        if (scen.id !== caseFormScenarioId) return scen;
        return {
          ...scen,
          testCases: [...(scen.testCases || []), newCase]
        };
      });
      onUpdateProject({ ...project, scenarios: updatedScenarios });
      setExpandedFolderIds(prev => new Set([...Array.from(prev), caseFormScenarioId]));
      toast.success('Test case created successfully');
    }

    setIsCaseModalOpen(false);
    setEditingCase(null);
  };

  // AI Synthesis of Test Cases from Global Generation Context
  const handleSynthesizeTestCases = async () => {
    setIsSynthesizing(true);
    setSynthesisStep('Synthesizing requirements, visual inputs, and test workflows...');

    try {
      // Determine folder or scenario target
      let targetScenario = validScenarios.find(s => s.id === selectedScenarioId);
      if (!targetScenario || selectedScenarioId === 'ALL') {
        const inferredTitle = videoData?.fileName 
          ? `Workflow: ${videoData.fileName.replace(/\.[^/.]+$/, '')}`
          : reqDocFile?.name
          ? `Spec: ${reqDocFile.name.replace(/\.[^/.]+$/, '')}`
          : defaultAppUrl
          ? `App: ${defaultAppUrl.replace(/^https?:\/\//, '').split('/')[0]}`
          : `AI Synthesized Suite #${(project.scenarios?.length || 0) + 1}`;

        targetScenario = {
          id: Math.random().toString(36).substr(2, 9),
          scenarioId: `TS-AI-${Date.now().toString().slice(-4)}`,
          title: inferredTitle,
          moduleName: 'Synthesis',
          description: 'AI Synthesized Test Cases with visual and architectural context',
          expectedResults: 'All test assertions and workflow steps succeed',
          type: 'Functional',
          isApproved: false,
          testCases: [],
          appUrl: defaultAppUrl,
          username: defaultUsername,
          password: defaultPassword,
          createdAt: new Date().toISOString()
        };
      }

      // Context Payload
      const contextPayload: any = {
        url: defaultAppUrl,
        username: defaultUsername,
        password: defaultPassword,
        refineInstructions: focusDirectives,
        docContent: reqDocFile?.content,
        docFileName: reqDocFile?.name
      };

      // Add Screenshots
      if (screenshots.length > 0) {
        contextPayload.screenshots = screenshots.map(s => `data:${s.mimeType};base64,${s.data}`);
      }

      // Add Video Frames
      if (videoData && videoData.frames.length > 0) {
        contextPayload.videoFrames = videoData.frames;
        contextPayload.videoFileName = videoData.fileName;
        contextPayload.videoDuration = videoData.duration;
      }

      const generatedCases = await generateTestCasesFromScenario(targetScenario, contextPayload);

      if (!Array.isArray(generatedCases) || generatedCases.length === 0) {
        throw new Error('No test cases generated by the AI service.');
      }

      const formattedCases: TestCase[] = generatedCases.map((tc: any, idx: number) => ({
        id: Math.random().toString(36).substr(2, 9),
        testCaseId: `TC-${targetScenario!.scenarioId || 'GEN'}-0${idx + 1}`,
        title: tc.title || `Test Case ${idx + 1}`,
        steps: Array.isArray(tc.steps) && tc.steps.length > 0 ? tc.steps : ['Execute scenario steps'],
        expectedResult: tc.expectedResult || targetScenario!.expectedResults || 'Execution succeeds.',
        status: TestStatus.NOT_EXECUTED,
        isApproved: false,
        testType: tc.testType === 'Non-Functional' ? TestType.NON_FUNCTIONAL : tc.testType === 'UI' ? TestType.UI : TestType.FUNCTIONAL,
        testIntent: tc.testIntent === 'Negative' ? TestIntent.NEGATIVE : TestIntent.POSITIVE,
        priority: tc.priority === 'High' ? TestPriority.HIGH : tc.priority === 'Low' ? TestPriority.LOW : TestPriority.MEDIUM,
        testDataSets: Array.isArray(tc.testDataSets) ? tc.testDataSets : ['Set 1: Valid inputs', 'Set 2: Boundary data'],
        source: videoData ? 'video_walkthrough' : screenshots.length > 0 ? 'screenshot_analysis' : 'ai_synthesis',
        executedAt: new Date().toISOString()
      }));

      // Compress video frames if present for storage
      const compressedFrames = videoData?.frames?.length 
        ? await createVideoFramesThumbnails(videoData.frames)
        : targetScenario.videoFrames;

      let updatedScenarios = [...(project.scenarios || [])];
      const existingIdx = updatedScenarios.findIndex(s => s.id === targetScenario!.id);

      if (existingIdx >= 0) {
        updatedScenarios[existingIdx] = {
          ...updatedScenarios[existingIdx],
          appUrl: defaultAppUrl || updatedScenarios[existingIdx].appUrl,
          videoFileName: videoData ? videoData.fileName : updatedScenarios[existingIdx].videoFileName,
          videoFrames: compressedFrames as any,
          testCases: [...(updatedScenarios[existingIdx].testCases || []), ...formattedCases]
        };
      } else {
        const enrichedTarget: TestScenario = {
          ...targetScenario,
          videoFileName: videoData?.fileName,
          videoFrames: compressedFrames as any,
          testCases: formattedCases
        };
        updatedScenarios = [enrichedTarget, ...updatedScenarios];
        setSelectedScenarioId(enrichedTarget.id);
      }

      onUpdateProject({ ...project, scenarios: updatedScenarios });
      toast.success(`Successfully synthesized ${formattedCases.length} AI test cases!`);
      setActiveView('folders');
      setExpandedFolderIds(prev => new Set([...Array.from(prev), targetScenario!.id]));
      await logActivity(user.email, user.name, `Synthesized ${formattedCases.length} AI Test Cases`, project.id, project.name);
    } catch (err: any) {
      console.error('Synthesis error:', err);
      toast.error(`Synthesis notice: ${err.message || 'Failed to synthesize test cases'}`);
    } finally {
      setIsSynthesizing(false);
      setSynthesisStep('');
    }
  };

  // Open Frame Inspector
  const openFramePreview = (
    frames: Array<{ timestamp?: string; image?: string; frameIndex?: number; isBlank?: boolean }>,
    initialIndex: number = 0,
    title: string = 'Video Walkthrough Keyframe',
    videoFileName: string = ''
  ) => {
    if (!frames || frames.length === 0) return;
    const safeIdx = Math.max(0, Math.min(frames.length - 1, initialIndex));
    setPreviewFrameModal({
      isOpen: true,
      frames,
      currentFrameIndex: safeIdx,
      title,
      videoFileName
    });
  };

  return (
    <div className="space-y-6 pb-20 max-w-7xl mx-auto">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & METRIC / ACTION ROW                                       */}
      {/* ========================================================================= */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
            AI TEST CASES
          </h1>
          <RAGStatusBadge
            enabled={ragEnabled}
            onToggle={setRagEnabled}
            retrievedChunks={retrievedRagChunks}
          />
        </div>
      </div>

      {/* Second Row: TOTAL TESTCASES metric card on left, Search & Action Buttons on right */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* TOTAL TESTCASES METRIC CARD */}
        <div className="w-fit min-w-[200px] bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex items-center gap-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">TOTAL TESTCASES</span>
            <div className="text-2xl font-black text-teal-600 flex items-center gap-1.5 mt-0.5">
              {totalCount}
              <span className="text-sm text-teal-500 font-bold">↗</span>
            </div>
          </div>
        </div>

        {/* Right action buttons: Search, Template, Upload, Export, Add Folder */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cases or IDs..."
              className="pl-9 pr-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 shadow-xs w-48 sm:w-60"
            />
          </div>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-xs cursor-pointer"
            title="Download Excel Template"
          >
            <Download size={13} className="text-slate-500" />
            TEMPLATE
          </button>

          <button
            type="button"
            onClick={() => excelUploadRef.current?.click()}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-xs cursor-pointer"
            title="Upload Excel or CSV"
          >
            <Upload size={13} className="text-slate-500" />
            UPLOAD
          </button>
          <input
            ref={excelUploadRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleExcelUpload}
          />

          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-xs cursor-pointer"
            title="Export Test Cases to Excel"
          >
            <FileSpreadsheet size={13} className="text-emerald-600" />
            EXPORT
          </button>

          <button
            type="button"
            onClick={() => setIsAddFolderModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-500/10 border border-teal-500/30 hover:bg-teal-500/20 text-teal-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-xs cursor-pointer"
          >
            <Plus size={14} className="text-teal-600" />
            ADD FOLDER
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. GENERATION CONTEXT CARD (Exact Screenshot Match with Video Input)     */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xs space-y-6">
        {/* Top Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#00E1C5] text-slate-950 flex items-center justify-center font-bold shadow-xs">
            <SlidersHorizontal size={20} />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">
              GENERATION CONTEXT
            </h2>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">
              CONFIGURE GLOBAL CONTEXT FOR TEST CASE SYNTHESIS
            </p>
          </div>
        </div>

        {/* 3 Input Fields Grid: URL, Username, Password */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1.5">
              DEFAULT APP URL
            </label>
            <div className="relative">
              <Globe size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={defaultAppUrl}
                onChange={(e) => setDefaultAppUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1.5">
              DEFAULT USERNAME
            </label>
            <div className="relative">
              <UserIcon size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={defaultUsername}
                onChange={(e) => setDefaultUsername(e.target.value)}
                placeholder="admin@example.com"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1.5">
              DEFAULT PASSWORD
            </label>
            <div className="relative">
              <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={defaultPassword}
                onChange={(e) => setDefaultPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all font-mono"
              />
            </div>
          </div>
        </div>

        {/* Amber System Notice */}
        <div className="bg-[#FFF9EE] border border-[#FFE8C8] rounded-xl px-4 py-3 flex items-center gap-2.5 text-[#C26100]">
          <Info size={16} className="shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wide">
            SYSTEM WILL INTELLIGENTLY DETECT IF LOGIN IS REQUIRED. PROVIDED CREDENTIALS WILL BE USED ONLY WHEN NECESSARY.
          </span>
        </div>

        {/* Requirements Document Box */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600">
            REQUIREMENTS DOCUMENT (OPTIONAL)
          </label>
          <div
            onClick={() => docInputRef.current?.click()}
            className="border-2 border-dashed border-teal-200 hover:border-teal-400 bg-teal-50/20 hover:bg-teal-50/40 rounded-2xl p-4 text-center cursor-pointer transition-all flex items-center justify-center gap-2 group"
          >
            <Paperclip size={16} className="text-teal-600 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-black text-teal-700 uppercase tracking-wide">
              {reqDocFile ? reqDocFile.name : 'UPLOAD REQUIREMENTS DOCUMENT (PDF, TXT, DOCX)'}
            </span>
            {reqDocFile && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setReqDocFile(null);
                }}
                className="ml-2 p-1 text-slate-400 hover:text-rose-600 rounded-md"
                title="Remove Document"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.txt,.docx,.md"
            className="hidden"
            onChange={handleDocUpload}
          />
        </div>

        {/* Screenshots & Video Input Section with Switcher */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                GENERATION SCREENSHOTS & VIDEO INPUT (OPTIONAL)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Attach screenshots or video walkthroughs to guide test case synthesis with visual UI layouts, buttons, forms, and workflows.
              </p>
            </div>

            {/* Switcher tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setVisualInputMode('screenshots')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  visualInputMode === 'screenshots'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ImageIcon size={14} />
                <span>Screenshots ({screenshots.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setVisualInputMode('video')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  visualInputMode === 'video'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Film size={14} />
                <span>Video Input {videoData ? `(${videoData.frames?.length || 0} frames)` : ''}</span>
              </button>
            </div>
          </div>

          {/* If Screenshots view is active */}
          {visualInputMode === 'screenshots' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                  ATTACH UI SCREENSHOTS
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePasteScreenshot}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Clipboard size={13} className="text-slate-500" />
                    Paste
                  </button>
                  <button
                    type="button"
                    onClick={() => imagesUploadRef.current?.click()}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                  >
                    <Upload size={13} />
                    Upload Images
                  </button>
                  <input
                    ref={imagesUploadRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImagesUpload}
                  />
                </div>
              </div>

              <div
                onClick={() => imagesUploadRef.current?.click()}
                className="border-2 border-dashed border-teal-200/80 hover:border-teal-400 bg-teal-50/20 hover:bg-teal-50/40 rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
              >
                <div className="w-10 h-10 rounded-2xl bg-teal-100/70 group-hover:bg-teal-200/80 flex items-center justify-center text-teal-600 transition-colors">
                  <Upload size={18} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700">
                    Drop screenshots here, or browse files
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Supports PNG, JPG, WEBP, GIF, SVG (Multiple files supported)
                  </p>
                </div>
              </div>

              {screenshots.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider block">
                    Attached Screenshots ({screenshots.length})
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    {screenshots.map((s, idx) => (
                      <div key={s.id || idx} className="relative group rounded-xl overflow-hidden border border-slate-200 aspect-video bg-slate-100">
                        <img
                          src={s.previewUrl || `data:${s.mimeType};base64,${s.data}`}
                          alt={s.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setScreenshots(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-sm"
                            title="Remove Screenshot"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <span className="absolute bottom-1 left-1 right-1 text-[9px] font-mono text-white bg-black/60 px-1 rounded truncate">
                          {s.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* If Video Input view is active */}
          {visualInputMode === 'video' && (
            <div className="animate-in fade-in duration-200">
              <VideoInputUploader
                videoData={videoData}
                onVideoChange={setVideoData}
                accentColor="teal"
                title="Video Walkthrough Input"
                description="Upload a screen recording or walkthrough video (MP4, WebM, MOV) to extract key UI states and synthesis context."
              />
            </div>
          )}
        </div>

        {/* Refine Instructions / Focus Directives */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
              <Hash size={13} className="text-teal-600" />
              FOCUS DIRECTIVES / CUSTOM PROMPT (OPTIONAL)
            </label>
            <span className="text-[11px] font-mono font-bold text-slate-400">
              {focusDirectives.length}/1000
            </span>
          </div>

          <textarea
            value={focusDirectives}
            maxLength={1000}
            onChange={(e) => setFocusDirectives(e.target.value)}
            placeholder="e.g. 'Focus on edge boundary validations, error banners, responsive drawer interactions, and confirmation modal states.'"
            rows={3}
            className="w-full p-3.5 bg-slate-50/70 border border-slate-200 rounded-2xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all resize-none leading-relaxed"
          />
        </div>

        {/* Synthesize Button */}
        <div className="pt-2">
          {isSynthesizing ? (
            <div className="w-full py-3.5 bg-teal-50 border border-teal-200 rounded-2xl flex items-center justify-center gap-2 text-teal-800 animate-pulse text-xs font-black">
              <RefreshCw size={15} className="animate-spin text-teal-600" />
              <span>{synthesisStep || 'Synthesizing Test Cases...'}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSynthesizeTestCases}
              className="w-full py-3.5 bg-[#00B4A0] hover:bg-[#009E8C] text-white font-black rounded-2xl text-xs uppercase tracking-wider transition-all shadow-sm hover:shadow-teal-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
            >
              <Sparkles size={15} />
              SYNTHESIZE TEST CASES {screenshots.length > 0 ? `(${screenshots.length} IMAGES)` : videoData ? `(1 VIDEO)` : ''}
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. AMBER ALERT BANNER: BULK SELECTION DYNAMICS (Exact Old UI Match)      */}
      {/* ========================================================================= */}
      <div className="bg-[#FFFDF5] border border-amber-200/80 rounded-2xl p-4 flex items-start gap-3 shadow-2xs">
        <div className="p-1 text-amber-500 shrink-0 mt-0.5">
          <Info size={18} />
        </div>
        <div>
          <h4 className="text-[11px] font-black text-amber-900 uppercase tracking-wider">
            BULK SELECTION DYNAMICS
          </h4>
          <p className="text-[10px] font-bold text-amber-800/90 uppercase tracking-wide mt-0.5">
            BULK SELECTION IS UNLIMITED FOR DELETION. AI GENERATION IS CAPPED AT 30 SCENARIOS PER BATCH TO ENSURE ARTIFACT QUALITY.
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. SUB-TABS: INDIVIDUAL SCENARIOS & FOLDERS (Exact Old UI Match)          */}
      {/* ========================================================================= */}
      <div className="flex gap-8 border-b border-slate-200 px-2">
        <button
          type="button"
          onClick={() => setActiveView('scenarios')}
          className={`pb-4 flex items-center gap-2 text-[13px] font-black uppercase tracking-wider relative transition-all cursor-pointer ${
            activeView === 'scenarios'
              ? 'text-teal-600'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <LayoutGrid size={15} />
          <span>INDIVIDUAL SCENARIOS</span>
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
            activeView === 'scenarios' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {allCasesWithScenario.length}
          </span>
          {activeView === 'scenarios' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-t-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveView('folders')}
          className={`pb-4 flex items-center gap-2 text-[13px] font-black uppercase tracking-wider relative transition-all cursor-pointer ${
            activeView === 'folders'
              ? 'text-teal-600'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Folder size={15} />
          <span>FOLDERS</span>
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
            activeView === 'folders' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {testCaseFolders.length}
          </span>
          {activeView === 'folders' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-t-full" />
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 5. FOLDERS VIEW (Exact Match to Image Screenshot)                         */}
      {/* ========================================================================= */}
      {activeView === 'folders' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          {filteredFolders.length === 0 ? (
            <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-3">
              <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
                <Folder size={24} />
              </div>
              <h3 className="text-base font-bold text-slate-800">No Folders Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Click "Add Folder" above to create your first folder or synthesize new AI test cases.
              </p>
              <button
                type="button"
                onClick={() => setIsAddFolderModalOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-xl text-xs font-bold"
              >
                <Plus size={14} /> Add Folder
              </button>
            </div>
          ) : (
            filteredFolders.map(folder => {
              const isExpanded = expandedFolderIds.has(folder.id);
              const folderCases = getFolderCases(folder, project.scenarios || []);
              const casesCount = folderCases.length;

              return (
                <div 
                  key={folder.id} 
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs hover:border-slate-300 transition-all"
                >
                  {/* Folder Header Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Left: Chevron & Folder Title */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => toggleFolderExpand(folder.id)}
                        className="p-1 text-slate-400 hover:text-slate-700 transition-transform cursor-pointer"
                        title={isExpanded ? 'Collapse folder' : 'Expand folder'}
                      >
                        {isExpanded ? (
                          <ChevronDown size={20} className="text-slate-700" />
                        ) : (
                          <ChevronRight size={20} className="text-slate-400" />
                        )}
                      </button>

                      <h3
                        onClick={() => toggleFolderExpand(folder.id)}
                        className="font-black text-sm sm:text-base text-slate-900 uppercase tracking-tight truncate cursor-pointer hover:text-teal-600 transition-colors"
                        title={folder.title}
                      >
                        {folder.title}
                      </h3>
                    </div>

                    {/* Right: Count Badge, FOLDER Tag, RUN FOLDER button, Action Icons */}
                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto flex-wrap">
                      {/* Count Badge */}
                      <span className="text-xs font-black text-teal-600 bg-teal-50 px-2.5 py-1 rounded-lg border border-teal-100">
                        {casesCount}
                      </span>

                      {/* FOLDER Tag Badge */}
                      <span className="bg-[#E6FFFA] text-[#00B4A0] px-3 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase border border-[#B2F5EA]">
                        FOLDER
                      </span>

                      {/* RUN FOLDER Button (Exact Match) */}
                      <button
                        type="button"
                        onClick={() => {
                          if (onRunFolder) {
                            onRunFolder(folder.id);
                          } else {
                            toast.success(`Starting execution for folder: "${folder.title}"`);
                          }
                        }}
                        className="flex items-center gap-2 bg-[#00E1C5] hover:bg-[#00C4AC] text-slate-950 font-black px-5 py-2 rounded-full text-[11px] uppercase tracking-wider shadow-xs hover:shadow-sm active:scale-95 transition-all cursor-pointer"
                      >
                        <Play size={13} className="fill-slate-950 text-slate-950" />
                        RUN FOLDER
                      </button>

                      {/* Download Folder test cases */}
                      <button
                        type="button"
                        onClick={() => handleExportSingleFolder(folder)}
                        className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
                        title="Download Folder Test Cases"
                      >
                        <Download size={16} />
                      </button>

                      {/* Add Test Case to Folder */}
                      <button
                        type="button"
                        onClick={() => {
                          setCaseFormScenarioId(folder.id);
                          setEditingCase(null);
                          setCaseForm({
                            title: '',
                            steps: [''],
                            expectedResult: '',
                            status: TestStatus.NOT_EXECUTED,
                            isApproved: false,
                            testType: TestType.FUNCTIONAL,
                            testIntent: TestIntent.POSITIVE,
                            priority: TestPriority.MEDIUM,
                            testDataSets: ['', '']
                          });
                          setIsCaseModalOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-all cursor-pointer"
                        title="Add Test Case to this Folder"
                      >
                        <Plus size={18} />
                      </button>

                      {/* Delete Folder */}
                      <button
                        type="button"
                        onClick={() => setDeleteFolderTarget(folder)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all cursor-pointer"
                        title="Delete Folder"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Test Cases Inside Folder */}
                  {isExpanded && (
                    <div className="mt-5 pt-5 border-t border-slate-100 space-y-3 animate-in slide-in-from-top-1 duration-200">
                      {folderCases.length === 0 ? (
                        <div className="py-8 text-center text-slate-400 italic text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                          This folder is currently empty. Click '+' to add a test case or synthesize new test cases.
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {folderCases.map((tc, tcIdx) => {
                            const isTcSelected = selectedCaseIds.has(tc.id);
                            const isTcExpanded = expandedCaseIds.has(tc.id);

                            return (
                              <div
                                key={tc.id}
                                className={`bg-slate-50/60 rounded-xl border transition-all ${
                                  isTcSelected 
                                    ? 'border-teal-500 bg-teal-50/20' 
                                    : 'border-slate-200/80 hover:border-slate-300'
                                }`}
                              >
                                <div 
                                  onClick={() => toggleExpand(tc.id)}
                                  className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                                >
                                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleSelectCase(tc.id);
                                      }}
                                      className="mt-0.5 sm:mt-0 text-slate-400 hover:text-teal-600 cursor-pointer"
                                    >
                                      {isTcSelected ? <CheckSquare size={16} className="text-teal-600" /> : <Square size={16} />}
                                    </button>

                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-mono text-[10px] font-black text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                          {tc.testCaseId || `TC-${tcIdx + 1}`}
                                        </span>

                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${
                                          tc.priority === TestPriority.HIGH 
                                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                            : tc.priority === TestPriority.LOW
                                            ? 'bg-slate-100 text-slate-600'
                                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                                        }`}>
                                          {tc.priority || 'Medium'}
                                        </span>

                                        <span className="text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 rounded uppercase">
                                          {tc.testType || 'Functional'}
                                        </span>
                                      </div>

                                      <h4 className="text-xs font-bold text-slate-800 mt-1 truncate">
                                        {tc.title}
                                      </h4>
                                    </div>
                                  </div>

                                  {/* Test Case Action Buttons */}
                                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleApproval(folder.id, tc.id);
                                      }}
                                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                        tc.isApproved 
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                          : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
                                      }`}
                                    >
                                      <CheckCircle2 size={12} className={tc.isApproved ? 'text-emerald-600' : 'text-slate-400'} />
                                      {tc.isApproved ? 'Approved' : 'Approve'}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingCase({ scenarioId: folder.id, testCase: tc });
                                        setCaseFormScenarioId(folder.id);
                                        setCaseForm({
                                          title: tc.title,
                                          steps: tc.steps || [''],
                                          expectedResult: tc.expectedResult,
                                          status: tc.status,
                                          isApproved: tc.isApproved,
                                          testType: tc.testType,
                                          testIntent: tc.testIntent,
                                          priority: tc.priority,
                                          testDataSets: tc.testDataSets || ['', '']
                                        });
                                        setIsCaseModalOpen(true);
                                      }}
                                      className="p-1.5 hover:bg-white text-slate-400 hover:text-slate-700 rounded-lg border border-transparent hover:border-slate-200"
                                      title="Edit Test Case"
                                    >
                                      <Pencil size={13} />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setJiraModalCase(tc);
                                      }}
                                      className="p-1.5 hover:bg-white text-slate-400 hover:text-amber-600 rounded-lg border border-transparent hover:border-slate-200"
                                      title="Log Jira Bug"
                                    >
                                      <ShieldAlert size={14} />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteTarget({ scenarioId: folder.id, testCaseId: tc.id, title: tc.title });
                                      }}
                                      className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg"
                                      title="Delete Test Case"
                                    >
                                      <Trash2 size={13} />
                                    </button>

                                    <div className="p-1 text-slate-400">
                                      {isTcExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                    </div>
                                  </div>
                                </div>

                                {/* Expanded Steps and Details */}
                                {isTcExpanded && (
                                  <div className="px-4 pb-4 pt-1 border-t border-slate-200/60 space-y-3 bg-white rounded-b-xl">
                                    <div>
                                      <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                                        Steps ({tc.steps?.length || 0})
                                      </h5>
                                      <ol className="space-y-1 bg-slate-50 rounded-lg p-2.5 text-xs text-slate-700 font-medium">
                                        {(tc.steps || []).map((step, sIdx) => (
                                          <li key={sIdx} className="flex items-start gap-2">
                                            <span className="font-mono text-slate-400 font-bold shrink-0">{sIdx + 1}.</span>
                                            <div>{renderStepWithFrameTags(step, folder.password)}</div>
                                          </li>
                                        ))}
                                      </ol>
                                    </div>

                                    <div>
                                      <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                        Expected Result
                                      </h5>
                                      <div className="p-2.5 bg-emerald-50/50 border border-emerald-100 rounded-lg text-xs text-emerald-950 font-medium leading-relaxed">
                                        {tc.expectedResult}
                                      </div>
                                    </div>

                                    {tc.testDataSets && tc.testDataSets.length > 0 && (
                                      <div>
                                        <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                          Test Data
                                        </h5>
                                        <div className="flex flex-wrap gap-1.5">
                                          {tc.testDataSets.map((ds, dIdx) => (
                                            <span key={dIdx} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-mono">
                                              {ds}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. INDIVIDUAL SCENARIOS VIEW                                              */}
      {/* ========================================================================= */}
      {activeView === 'scenarios' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          {/* Secondary Filter Row: Status, Priority, Type */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:border-teal-500"
              >
                <option value="ALL">All Statuses</option>
                <option value={TestStatus.NOT_EXECUTED}>Not Executed</option>
                <option value={TestStatus.PASS}>Passed</option>
                <option value={TestStatus.FAIL}>Failed</option>
                <option value={TestStatus.BLOCKED}>Blocked</option>
                <option value={TestStatus.DEFERRED}>Deferred</option>
              </select>
            </div>

            <div>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:border-teal-500"
              >
                <option value="ALL">All Priorities</option>
                <option value={TestPriority.HIGH}>High Priority</option>
                <option value={TestPriority.MEDIUM}>Medium Priority</option>
                <option value={TestPriority.LOW}>Low Priority</option>
              </select>
            </div>

            <div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:border-teal-500"
              >
                <option value="ALL">All Types</option>
                <option value={TestType.FUNCTIONAL}>Functional</option>
                <option value={TestType.UI}>UI</option>
                <option value={TestType.NON_FUNCTIONAL}>Non-Functional</option>
              </select>
            </div>
          </div>

          {/* Bulk Selection Action Bar */}
          {selectedCaseIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-900 text-white rounded-2xl shadow-md">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-0.5 bg-teal-400 text-slate-950 text-[11px] font-black rounded-full">
                  {selectedCaseIds.size} Selected
                </span>
                <span className="text-xs text-slate-300">Bulk Operations</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const selectedCases = filteredCases.filter(c => selectedCaseIds.has(c.testCase.id));
                    const targetScen = selectedCases[0]?.scenario || approvedScenarios[0] || validScenarios[0];
                    if (targetScen) {
                      setScenarioForGenerateModal(targetScen);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95"
                >
                  <Sparkles size={13} /> Generate AI Test Cases
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoveTargetScenarioId(validScenarios[0]?.id || '');
                    setIsMoveToFolderModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <Folder size={13} /> Move to Folder
                </button>
                <button
                  type="button"
                  onClick={handleBulkApprove}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <CheckCircle2 size={13} /> Approve Selected
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <Trash2 size={13} /> Delete Selected
                </button>
              </div>
            </div>
          )}

          {/* Listing Header */}
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={toggleSelectAllVisible}
              className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {filteredCases.length > 0 && filteredCases.every(c => selectedCaseIds.has(c.testCase.id)) ? (
                <CheckSquare size={16} className="text-teal-600" />
              ) : (
                <Square size={16} className="text-slate-400" />
              )}
              Select All Visible ({filteredCases.length})
            </button>

            <div className="text-xs text-slate-500">
              Showing <strong className="text-slate-800">{filteredCases.length}</strong> of {totalCount} Test Cases
            </div>
          </div>

          {/* Individual Test Cases List */}
          {filteredCases.length === 0 ? (
            <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-3">
              <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
                <FileText size={24} />
              </div>
              <h3 className="text-base font-bold text-slate-800">No Test Cases Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Synthesize new test cases or adjust your search filters above.
              </p>
            </div>
          ) : (
            filteredCases.map(({ scenario, testCase }) => {
              const isSelected = selectedCaseIds.has(testCase.id);
              const isExpanded = expandedCaseIds.has(testCase.id);

              return (
                <div
                  key={testCase.id}
                  className={`bg-white rounded-2xl border transition-all ${
                    isSelected ? 'border-teal-500 ring-2 ring-teal-500/20 shadow-sm' : 'border-slate-200/90 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  <div 
                    onClick={() => toggleExpand(testCase.id)}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectCase(testCase.id);
                        }}
                        className="mt-0.5 sm:mt-0 text-slate-400 hover:text-teal-600 cursor-pointer"
                      >
                        {isSelected ? <CheckSquare size={18} className="text-teal-600" /> : <Square size={18} />}
                      </button>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                            {testCase.testCaseId || 'TC'}
                          </span>

                          <span className="text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200/80 px-2 py-0.5 rounded-md uppercase">
                            {scenario.title}
                          </span>

                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${
                            testCase.priority === TestPriority.HIGH 
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : testCase.priority === TestPriority.LOW
                              ? 'bg-slate-50 text-slate-600 border border-slate-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {testCase.priority || 'Medium'}
                          </span>

                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 rounded-md uppercase">
                            {testCase.testType || 'Functional'}
                          </span>
                        </div>

                        <h3 className="text-sm font-bold text-slate-900 mt-1.5 truncate">
                          {testCase.title}
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setScenarioForGenerateModal(scenario);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 transition-all flex items-center gap-1 cursor-pointer"
                        title="Generate AI Test Cases for this Scenario"
                      >
                        <Sparkles size={13} className="text-teal-600" />
                        Generate Cases
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleApproval(scenario.id, testCase.id);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                          testCase.isApproved 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        <CheckCircle2 size={13} className={testCase.isApproved ? 'text-emerald-600' : 'text-slate-400'} />
                        {testCase.isApproved ? 'Approved' : 'Approve'}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setJiraModalCase(testCase);
                        }}
                        className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg"
                        title="Log Jira Bug"
                      >
                        <ShieldAlert size={15} />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ scenarioId: scenario.id, testCaseId: testCase.id, title: testCase.title });
                        }}
                        className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg"
                        title="Delete Test Case"
                      >
                        <Trash2 size={15} />
                      </button>

                      <div className="p-1 text-slate-400">
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-slate-100 space-y-4">
                      <div>
                        <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                          Execution Steps ({testCase.steps?.length || 0})
                        </h4>
                        <ol className="space-y-1.5 bg-slate-50 rounded-xl p-3 border border-slate-100 text-xs text-slate-700 font-medium">
                          {(testCase.steps || []).map((step, sIdx) => (
                            <li key={sIdx} className="flex items-start gap-2">
                              <span className="font-mono text-slate-400 font-bold shrink-0">{sIdx + 1}.</span>
                              <div className="leading-relaxed">
                                {renderStepWithFrameTags(
                                  step,
                                  scenario.password,
                                  (frameIndex) => {
                                    if (scenario.videoFrames && scenario.videoFrames.length > 0) {
                                      openFramePreview(
                                        scenario.videoFrames,
                                        frameIndex,
                                        `Keyframe ${frameIndex + 1} for ${testCase.title}`,
                                        scenario.videoFileName
                                      );
                                    } else {
                                      toast.info(`Frame ${frameIndex + 1} reference`);
                                    }
                                  }
                                )}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                          Expected Result
                        </h4>
                        <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl text-xs text-emerald-950 font-medium leading-relaxed">
                          {testCase.expectedResult}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. ADD FOLDER MODAL                                                       */}
      {/* ========================================================================= */}
      {isAddFolderModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <FolderPlus size={18} className="text-teal-600" />
                Add New Folder
              </h3>
              <button 
                type="button"
                onClick={() => setIsAddFolderModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Folder Name *</label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g. REPORTS PAGE N"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-teal-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Module / Tag (Optional)</label>
                <input
                  type="text"
                  value={newFolderModule}
                  onChange={(e) => setNewFolderModule(e.target.value)}
                  placeholder="e.g. Reports"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAddFolderModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                Create Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 8. DELETE FOLDER CONFIRMATION MODAL                                       */}
      {/* ========================================================================= */}
      {deleteFolderTarget && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-xl border border-slate-100 text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="text-base font-black text-slate-900">Delete Folder?</h3>
            <p className="text-xs text-slate-500">
              Are you sure you want to delete folder <strong className="text-slate-800">"{deleteFolderTarget.title}"</strong> and all its {deleteFolderTarget.testCases?.length || 0} test cases? This action cannot be undone.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteFolderTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteFolder(deleteFolderTarget.id)}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                Delete Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 9. ADD / EDIT TEST CASE MODAL                                             */}
      {/* ========================================================================= */}
      {isCaseModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <FileText size={18} className="text-teal-600" />
                {editingCase ? 'Edit Test Case' : 'Add Test Case'}
              </h3>
              <button 
                type="button"
                onClick={() => {
                  setIsCaseModalOpen(false);
                  setEditingCase(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Folder *</label>
                <select
                  value={caseFormScenarioId}
                  onChange={(e) => setCaseFormScenarioId(e.target.value)}
                  disabled={Boolean(editingCase)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-teal-500"
                >
                  <option value="">Select Folder</option>
                  {validScenarios.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={caseForm.title || ''}
                  onChange={(e) => setCaseForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. Verify user can export summary report"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Priority</label>
                  <select
                    value={caseForm.priority || TestPriority.MEDIUM}
                    onChange={(e) => setCaseForm(prev => ({ ...prev, priority: e.target.value as TestPriority }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
                  >
                    <option value={TestPriority.HIGH}>High</option>
                    <option value={TestPriority.MEDIUM}>Medium</option>
                    <option value={TestPriority.LOW}>Low</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Type</label>
                  <select
                    value={caseForm.testType || TestType.FUNCTIONAL}
                    onChange={(e) => setCaseForm(prev => ({ ...prev, testType: e.target.value as TestType }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
                  >
                    <option value={TestType.FUNCTIONAL}>Functional</option>
                    <option value={TestType.UI}>UI</option>
                    <option value={TestType.NON_FUNCTIONAL}>Non-Functional</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">Execution Steps</label>
                  <button
                    type="button"
                    onClick={() => setCaseForm(prev => ({ ...prev, steps: [...(prev.steps || []), ''] }))}
                    className="text-[11px] font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                  >
                    <Plus size={12} /> Add Step
                  </button>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(caseForm.steps || ['']).map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-400 w-5">{idx + 1}.</span>
                      <input
                        type="text"
                        value={step}
                        onChange={(e) => {
                          const updated = [...(caseForm.steps || [])];
                          updated[idx] = e.target.value;
                          setCaseForm(prev => ({ ...prev, steps: updated }));
                        }}
                        placeholder={`Step ${idx + 1}`}
                        className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800"
                      />
                      {(caseForm.steps || []).length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (caseForm.steps || []).filter((_, i) => i !== idx);
                            setCaseForm(prev => ({ ...prev, steps: updated }));
                          }}
                          className="p-1 text-slate-400 hover:text-rose-500"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Expected Result</label>
                <textarea
                  value={caseForm.expectedResult || ''}
                  onChange={(e) => setCaseForm(prev => ({ ...prev, expectedResult: e.target.value }))}
                  placeholder="e.g. Exported report file is downloaded with accurate data"
                  rows={2}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-teal-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsCaseModalOpen(false);
                  setEditingCase(null);
                }}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTestCase}
                className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                {editingCase ? 'Save Changes' : 'Add Test Case'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 10. MOVE TO FOLDER MODAL                                                  */}
      {/* ========================================================================= */}
      {isMoveToFolderModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Folder size={18} className="text-teal-600" />
                Move {selectedCaseIds.size} Cases to Folder
              </h3>
              <button 
                type="button"
                onClick={() => setIsMoveToFolderModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Destination Folder</label>
                <select
                  value={moveTargetScenarioId}
                  onChange={(e) => setMoveTargetScenarioId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-teal-500"
                >
                  {validScenarios.map(s => (
                    <option key={s.id} value={s.id}>{s.title} ({s.testCases?.length || 0} cases)</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsMoveToFolderModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!moveTargetScenarioId) return;
                  const casesToMove: TestCase[] = [];
                  const updatedScenarios = validScenarios.map(scen => {
                    const remaining: TestCase[] = [];
                    (scen.testCases || []).forEach(tc => {
                      if (selectedCaseIds.has(tc.id)) {
                        casesToMove.push(tc);
                      } else {
                        remaining.push(tc);
                      }
                    });
                    return { ...scen, testCases: remaining };
                  }).map(scen => {
                    if (scen.id === moveTargetScenarioId) {
                      return { ...scen, testCases: [...(scen.testCases || []), ...casesToMove] };
                    }
                    return scen;
                  });
                  onUpdateProject({ ...project, scenarios: updatedScenarios });
                  setSelectedCaseIds(new Set());
                  setIsMoveToFolderModalOpen(false);
                  setActiveView('folders');
                  setExpandedFolderIds(prev => new Set([...Array.from(prev), moveTargetScenarioId]));
                  toast.success(`Moved ${casesToMove.length} test cases successfully`);
                }}
                className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs"
              >
                Move Cases
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 11. KEYFRAME INSPECTOR MODAL                                              */}
      {/* ========================================================================= */}
      {previewFrameModal.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 text-white rounded-3xl max-w-4xl w-full p-6 space-y-4 shadow-2xl border border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Film size={16} className="text-teal-400" />
                  {previewFrameModal.title}
                </h3>
                {previewFrameModal.videoFileName && (
                  <span className="text-[11px] text-slate-400">Video Source: {previewFrameModal.videoFileName}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewFrameModal(prev => ({ ...prev, isOpen: false }))}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={20} />
              </button>
            </div>

            {previewFrameModal.frames[previewFrameModal.currentFrameIndex] && (
              <div className="space-y-3">
                <div className="relative aspect-video bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800">
                  <img
                    src={previewFrameModal.frames[previewFrameModal.currentFrameIndex].image}
                    alt={`Keyframe ${previewFrameModal.currentFrameIndex + 1}`}
                    className="max-h-full max-w-full object-contain"
                  />
                  <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1 rounded-full text-xs font-mono text-teal-300 font-bold border border-teal-500/30">
                    Frame {previewFrameModal.currentFrameIndex + 1} of {previewFrameModal.frames.length}
                    {previewFrameModal.frames[previewFrameModal.currentFrameIndex].timestamp && (
                      <span className="ml-2 text-white">@{previewFrameModal.frames[previewFrameModal.currentFrameIndex].timestamp}</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto py-2 scrollbar-thin">
                  {previewFrameModal.frames.map((frame, fIdx) => (
                    <button
                      key={fIdx}
                      type="button"
                      onClick={() => setPreviewFrameModal(prev => ({ ...prev, currentFrameIndex: fIdx }))}
                      className={`relative shrink-0 w-24 h-14 rounded-lg overflow-hidden border transition-all ${
                        fIdx === previewFrameModal.currentFrameIndex
                          ? 'border-teal-400 ring-2 ring-teal-400/40'
                          : 'border-slate-800 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={frame.image} alt="" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0.5 right-1 text-[9px] font-mono text-white bg-black/70 px-1 rounded">
                        #{fIdx + 1}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 12. DELETE CONFIRMATION MODALS                                            */}
      {/* ========================================================================= */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-xl border border-slate-100 text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="text-base font-black text-slate-900">Delete Test Case?</h3>
            <p className="text-xs text-slate-500">
              Are you sure you want to delete <strong className="text-slate-800">"{deleteTarget.title}"</strong>? This action cannot be undone.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetCaseId = deleteTarget.testCaseId;
                  const targetScenarioId = deleteTarget.scenarioId;

                  const updatedScenarios = (project.scenarios || [])
                    .map(scen => {
                      if (scen.id === targetScenarioId) {
                        const isFolder = scen.scenarioId === 'SCENARIO_FOLDER' || 
                                         scen.scenarioId === 'TESTCASE_FOLDER' || 
                                         scen.scenarioId === 'MANUAL_FOLDER';
                        const hadExplicitCases = scen.testCases && scen.testCases.length > 0;
                        if (hadExplicitCases) {
                          const remaining = (scen.testCases || []).filter(tc => tc.id !== targetCaseId);
                          if (remaining.length === 0 && !isFolder) {
                            return null;
                          }
                          return { ...scen, testCases: remaining };
                        } else {
                          if (targetCaseId === `TC-${scen.id}` || targetCaseId === scen.id) {
                            return null;
                          }
                          return { ...scen, testCases: [] };
                        }
                      }

                      if (scen.testCases && scen.testCases.some(tc => tc.id === targetCaseId)) {
                        const isFolder = scen.scenarioId === 'SCENARIO_FOLDER' || 
                                         scen.scenarioId === 'TESTCASE_FOLDER' || 
                                         scen.scenarioId === 'MANUAL_FOLDER';
                        const remaining = scen.testCases.filter(tc => tc.id !== targetCaseId);
                        if (remaining.length === 0 && !isFolder) {
                          return null;
                        }
                        return { ...scen, testCases: remaining };
                      }

                      return scen;
                    })
                    .filter(Boolean) as TestScenario[];

                  const existingIds = new Set(updatedScenarios.map(s => s.id));
                  const finalScenarios = updatedScenarios.map(scen => {
                    if (scen.memberScenarioIds && scen.memberScenarioIds.length > 0) {
                      return {
                        ...scen,
                        memberScenarioIds: scen.memberScenarioIds.filter(id => existingIds.has(id))
                      };
                    }
                    return scen;
                  });

                  onUpdateProject({ ...project, scenarios: finalScenarios });
                  toast.success('Test case deleted');
                  setDeleteTarget(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {isBulkDeleteModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-xl border border-slate-100 text-center animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="text-base font-black text-slate-900">Delete Selected Test Cases?</h3>
            <p className="text-xs text-slate-500">
              Are you sure you want to delete <strong className="text-slate-800">{selectedCaseIds.size}</strong> selected test case(s)? This action cannot be undone.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsBulkDeleteModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkDeleteConfirm}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                Delete Selected ({selectedCaseIds.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 13. JIRA BUG MODAL                                                        */}
      {/* ========================================================================= */}
      {jiraModalCase && (
        <JiraBugModal
          isOpen={Boolean(jiraModalCase)}
          onClose={() => setJiraModalCase(null)}
          testCase={jiraModalCase}
          project={project}
        />
      )}

      {/* ========================================================================= */}
      {/* 14. GENERATE AI TEST CASES FOR SCENARIO MODAL                             */}
      {/* ========================================================================= */}
      {scenarioForGenerateModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-7 space-y-5 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-teal-50 border border-teal-200/80 text-teal-600 flex items-center justify-center font-bold shadow-xs">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Generate AI Test Cases
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Synthesize comprehensive, step-by-step test cases for this approved scenario
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScenarioForGenerateModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Selected Scenario Details Box */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-black text-teal-800 bg-teal-100/70 border border-teal-200 px-2 py-0.5 rounded-md">
                  {scenarioForGenerateModal.scenarioId || 'SC-001'}
                </span>
                <span className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-md uppercase">
                  {scenarioForGenerateModal.moduleName || 'General'}
                </span>
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md uppercase">
                  {scenarioForGenerateModal.type || 'Functional'}
                </span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md uppercase">
                  Approved
                </span>
              </div>
              <h4 className="text-sm font-bold text-slate-900 leading-snug">
                {scenarioForGenerateModal.title}
              </h4>
              {scenarioForGenerateModal.description && (
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                  {scenarioForGenerateModal.description}
                </p>
              )}
            </div>

            {/* Optional Focus Directives */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-slate-600 uppercase tracking-wider flex items-center justify-between">
                <span>Focus Directives / Custom Instructions (Optional)</span>
                <span className="text-[10px] font-mono text-slate-400">
                  {generateDirectives.length}/500
                </span>
              </label>
              <textarea
                value={generateDirectives}
                maxLength={500}
                onChange={(e) => setGenerateDirectives(e.target.value)}
                placeholder="e.g. Include negative input validations, boundary tests, and responsive layout checks."
                rows={3}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all resize-none leading-relaxed"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setScenarioForGenerateModal(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-bold transition-all cursor-pointer"
                disabled={isModalGenerating}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleExecuteGenerateForScenario(scenarioForGenerateModal)}
                disabled={isModalGenerating}
                className="flex-2 py-3 bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-teal-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
              >
                {isModalGenerating ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" />
                    <span>Synthesizing Test Cases...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    <span>Generate AI Test Cases</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TestCaseManager;
