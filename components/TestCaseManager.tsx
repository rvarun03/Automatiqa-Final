import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Project, TestScenario, TestCase, TestStatus, TestType, TestIntent, TestPriority } from '../types';
import { 
  Database, 
  Plus, 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Trash2, 
  Edit3, 
  Save, 
  X, 
  Download, 
  Upload, 
  Globe, 
  User, 
  Lock, 
  Info, 
  FileSpreadsheet, 
  AlertTriangle, 
  Search, 
  ShieldCheck,
  FolderPlus, 
  CheckSquare, 
  Square, 
  Pencil, 
  Settings, 
  LayoutGrid, 
  Folder, 
  Zap, 
  Play, 
  Layers, 
  MinusCircle, 
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  Table,
  FlaskConical,
  DatabaseZap,
  CheckCircle2,
  TrendingUp,
  Loader2,
  AlertCircle,
  Paperclip,
  FileVideo,
  ImageIcon,
  Hash,
  Settings2,
  FileText,
  PlayCircle,
  Asterisk,
  XCircle
} from 'lucide-react';
import { generateTestCasesFromScenario } from '../geminiService';
import { recordFeatureConsumption } from '../services/tokenConsumptionService';
import { logActivity } from '../services/activityService';
import { ragEnrichPrompt, indexSingleItem } from '../services/ragService';
import { RAGStatusBadge } from './RAGStatusBadge';
import { VectorSearchResult } from '../types';
import { ScreenshotUploader, ScreenshotFile } from './ScreenshotUploader';
import { ScreenshotGallery } from './ScreenshotGallery';
import { parseDocumentFile, sanitizeAndExtractDocContent } from '../utils/docParser';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

// Password masking utility functions
export const maskPasswordText = (text: string, knownPass?: string): string => {
  if (!text) return text;
  let result = text;

  // 1. If we have a known password, replace it safely case-insensitively
  if (knownPass && knownPass.trim().length >= 3) {
    const trimmedPass = knownPass.trim();
    const escapedPass = trimmedPass.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedPass, 'gi');
    result = result.replace(regex, '••••••••');
  }

  // 2. Also replace common patterns like "password: XXX" or "Password: XXX" or "password is XXX" or "password 'XXX'"
  result = result.replace(/(password|pwd|pass|secret)\s*[:=]\s*(['"])(.*?)\2/gi, (match, p1, p2, p3) => {
    return `${p1}: ${p2}••••••••${p2}`;
  });

  result = result.replace(/(password|pwd|pass|secret)\s*[:=]\s*([^\s,;]+)/gi, (match, p1, p2) => {
    if (p2.includes('••')) return match;
    return `${p1}: ••••••••`;
  });

  result = result.replace(/(password|pwd|pass|secret)\s+(?:is\s+)?(['"])(.*?)\2/gi, (match, p1, p2, p3) => {
    return `${p1} ${p2}••••••••${p2}`;
  });

  result = result.replace(/(password|pwd|pass|secret)\s+is\s+([^\s,;.!]+)/gi, (match, p1, p2) => {
    if (p2.includes('••')) return match;
    return `${p1} is ••••••••`;
  });

  result = result.replace(/(['"])password\1\s*:\s*(['"])(.*?)\2/gi, (match, q1, q2, p3) => {
    return `${q1}password${q1}: ${q2}••••••••${q2}`;
  });

  return result;
};

export const maskPasswordArray = (arr: string[] | undefined, knownPass?: string): string[] => {
  if (!arr) return [];
  return arr.map(item => maskPasswordText(item, knownPass));
};

interface TestCaseManagerProps {
  project: Project;
  user: { email: string, name: string };
  onUpdateProject: (p: Project) => void;
  onRunFolder?: (folderId: string) => void;
}

interface DeleteTarget {
  type: 'scenario' | 'testcase' | 'folder_removal' | 'bulk_scenario';
  scenarioId?: string;
  scenarioIds?: string[];
  testCaseId?: string;
  // Add optional title property to handle display names in delete confirmation modals
  title?: string;
}

interface BulkProgress {
  active: boolean;
  current: number;
  total: number;
  status: string;
  errors: string[];
}

const TestCaseManager: React.FC<TestCaseManagerProps> = ({ project, user, onUpdateProject, onRunFolder }) => {
  const [activeTab, setActiveTab] = useState<'scenarios' | 'folders'>('scenarios');
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  
  // Test Case Editing State
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TestCase | null>(null);
  
  const [searchQueryRaw, setSearchQuery] = useState('');
  
  const [bulkProgress, setBulkProgress] = useState<BulkProgress>({ active: false, current: 0, total: 0, status: '', errors: [] });
  const bulkCancelledRef = useRef<boolean>(false);
  const [showOverwriteModal, setShowOverwriteModal] = useState(false);
  const [pendingIndividualScenario, setPendingIndividualScenario] = useState<TestScenario | null>(null);
  const [ragEnabled, setRagEnabled] = useState(true);
  const [retrievedRagChunks, setRetrievedRagChunks] = useState<VectorSearchResult[]>([]);
  
  const [currentPage, setCurrentPage] = useState(1);
  const scenariosPerPage = 15;

  const [selectedScenarioIds, setSelectedScenarioIds] = useState<Set<string>>(new Set());

  const scenarioModuleMapping = project.scenarioModuleMapping || {};

  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedCaseRefs, setSelectedCaseRefs] = useState<Set<string>>(new Set());
  const [folderError, setFolderError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const [appUrl, setAppUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [refineInstructions, setRefineInstructions] = useState('');
  const [attachedScreenshots, setAttachedScreenshots] = useState<ScreenshotFile[]>([]);
  const [attachedDocFileName, setAttachedDocFileName] = useState('');
  const [attachedDocContent, setAttachedDocContent] = useState('');
  const [isGeneratingScreenshotCases, setIsGeneratingScreenshotCases] = useState(false);

  // States for AI Test Cases Save Workflow
  const [sessionGeneratedItems, setSessionGeneratedItems] = useState<{ scenario: TestScenario; testCases: TestCase[] }[]>([]);
  const [showSavePromptModal, setShowSavePromptModal] = useState(false);
  const [showSaveFolderSelectModal, setShowSaveFolderSelectModal] = useState(false);
  const [selectedFolderIdForSave, setSelectedFolderIdForSave] = useState('');
  const [showCreateFolderInline, setShowCreateFolderInline] = useState(false);
  const [inlineNewFolderName, setInlineNewFolderName] = useState('');
  const [inlineFolderError, setInlineFolderError] = useState<string | null>(null);
  const [sessionSelectedCaseRefs, setSessionSelectedCaseRefs] = useState<Set<string>>(new Set());

  // States for Move Scenario to Folder
  const [moveTargetScenario, setMoveTargetScenario] = useState<TestScenario | null>(null);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveFolderId, setMoveFolderId] = useState('');
  const [showCreateMoveFolderInline, setShowCreateMoveFolderInline] = useState(false);
  const [moveInlineNewFolderName, setMoveInlineNewFolderName] = useState('');
  const [moveInlineFolderError, setMoveInlineFolderError] = useState<string | null>(null);

  const uploadInputRef = useRef<HTMLInputElement>(null);

  const totalTestCasesCount = useMemo(() => {
    return project.scenarios
      .filter(s => s.isApproved && !['TESTCASE_FOLDER', 'MANUAL_FOLDER', 'SCENARIO_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId) && s.moduleName !== 'API Testing' && !s.isApiScenario && (!s.scenarioId || !s.scenarioId.startsWith('API-')))
      .reduce((sum, s) => sum + (s.testCases?.length || 0), 0);
  }, [project.scenarios]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQueryRaw]);

  // Reset attached screenshots and temporary generation session items when switching project
  useEffect(() => {
    setAttachedScreenshots([]);
    setAttachedDocFileName('');
    setAttachedDocContent('');
    setSessionGeneratedItems([]);
    setSelectedCaseRefs(new Set());
    setSessionSelectedCaseRefs(new Set());
    setAppUrl('');
    setUsername('');
    setPassword('');
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  }, [project.id]);

  const availableModules = useMemo(() => {
    return (project.scenarios || []).filter(s => 
      s.scenarioId === 'TESTCASE_FOLDER' &&
      s.moduleName !== 'API Testing' && !s.isApiScenario && (!s.scenarioId || !s.scenarioId.startsWith('API-'))
    );
  }, [project.scenarios]);

  const individualScenarios = useMemo(() => {
    const testCaseFolderScenarioIds = new Set<string>();
    const testCaseFolderTestCaseIds = new Set<string>();
    
    (project.scenarios || []).forEach(s => {
      if (s.scenarioId === 'TESTCASE_FOLDER') {
        (s.testCases || []).forEach(tc => testCaseFolderTestCaseIds.add(tc.id));
        (s.memberScenarioIds || []).forEach(id => testCaseFolderScenarioIds.add(id));
      }
    });

    return (project.scenarios || []).filter(s => {
      const isFolder = ['TESTCASE_FOLDER', 'MANUAL_FOLDER', 'SCENARIO_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId) || (s.scenarioId && s.scenarioId.includes('FOLDER'));
      if (isFolder) return false;
      if (!s.isApproved) return false;

      // Exclude API Testing scenarios from AI Test Cases page
      if (s.moduleName === 'API Testing' || s.isApiScenario || (s.scenarioId && s.scenarioId.startsWith('API-'))) {
        return false;
      }

      // Check if this scenario or its test cases are saved in an AI Test Case Folder
      if (testCaseFolderScenarioIds.has(s.id)) return false;
      if (s.folderId && (project.scenarios || []).some(f => f.id === s.folderId && f.scenarioId === 'TESTCASE_FOLDER')) return false;
      if (s.testCases && s.testCases.length > 0 && s.testCases.every(tc => testCaseFolderTestCaseIds.has(tc.id))) {
        return false;
      }

      return true;
    });
  }, [project.scenarios]);

  const allAvailableCases = useMemo(() => {
    return individualScenarios
      .flatMap(s => 
        (s.testCases || []).map(tc => ({
          ...tc,
          parentScenarioTitle: s.title,
          parentScenarioId: s.id,
          uniqueRef: `${s.id}|${tc.id}`
        }))
      );
  }, [individualScenarios]);

  const filteredScenarios = useMemo(() => {
    let baseList = activeTab === 'folders' ? availableModules : individualScenarios;

    if (!searchQueryRaw.trim()) return baseList;

    const query = searchQueryRaw.toLowerCase().trim();
    return baseList.filter(scenario => {
      const scenarioTitleMatch = scenario.title.toLowerCase().includes(query);
      const testCaseMatch = (scenario.testCases || []).some(tc => 
        (tc.testCaseId || '').toLowerCase().includes(query) ||
        tc.title.toLowerCase().includes(query)
      );
      return scenarioTitleMatch || testCaseMatch;
    });
  }, [availableModules, individualScenarios, searchQueryRaw, activeTab]);

  const totalPages = Math.ceil(filteredScenarios.length / scenariosPerPage);

  const paginatedScenarios = useMemo(() => {
    const startIndex = (currentPage - 1) * scenariosPerPage;
    return filteredScenarios.slice(startIndex, startIndex + scenariosPerPage);
  }, [filteredScenarios, currentPage]);

  // Handle pagination adjustment when items are deleted on the last page
  useEffect(() => {
    if (currentPage > 1 && paginatedScenarios.length === 0 && filteredScenarios.length > 0) {
      setCurrentPage(totalPages);
    } else if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [filteredScenarios.length, paginatedScenarios.length, currentPage, totalPages]);

  const handleDownloadTemplate = () => {
    const templateData = [
      { 'Sl No': 1, 'Scenario': 'Verify that a user can successfully reset their password via email verification link.' },
      { 'Sl No': 2, 'Scenario': 'Ensure that the login page displays an error message for invalid credential combinations.' }
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Scenario Template');
    XLSX.writeFile(workbook, 'QAonCloud_Scenario_Template.xlsx');
  };

  const handleUploadScenarios = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const bstr = event.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const wsname = workbook.SheetNames[0];
        const ws = workbook.Sheets[wsname];
        const data: any[] = XLSX.utils.sheet_to_json(ws);

        if (data.length === 0) {
          alert('The uploaded file is empty.');
          return;
        }

        const newScenarios: TestScenario[] = data.map((item, idx) => ({
          id: Math.random().toString(36).substr(2, 9),
          scenarioId: `UP-${Date.now().toString().slice(-4)}-${idx}`,
          title: (item.Scenario || 'Uploaded Scenario').trim(),
          type: 'Functional',
          description: item.Scenario || 'No description provided',
          expectedResults: 'Check scenario description for expected behavior',
          moduleName: 'Bulk Uploaded',
          isApproved: true, // Auto-approve so they appear in AI Test Cases page
          testCases: [],
          createdAt: new Date().toISOString(),
          appUrl: appUrl || "",
          username: username || "",
          password: password || ""
        }));

        onUpdateProject({ ...project, scenarios: [...newScenarios, ...project.scenarios] });
        await logActivity(user.email, user.name, `Bulk uploaded ${newScenarios.length} scenarios via Excel template`, project.id, project.name);
        
        if (uploadInputRef.current) uploadInputRef.current.value = '';
        alert(`Successfully imported ${newScenarios.length} scenarios.`);
      } catch (err) {
        alert('Failed to parse file. Please ensure you are using the correct template.');
      }
    };
    reader.readAsBinaryString(file as Blob);
  };

  const executeDeletion = () => {
    if (!deleteTarget) return;

    if (deleteTarget.type === 'scenario' && deleteTarget.scenarioId) {
      const updatedScenarios = project.scenarios.filter(s => s.id !== deleteTarget.scenarioId);
      onUpdateProject({ ...project, scenarios: updatedScenarios });
      
      const nextSelection = new Set(selectedScenarioIds);
      nextSelection.delete(deleteTarget.scenarioId);
      setSelectedScenarioIds(nextSelection);
      logActivity(user.email, user.name, `Deleted scenario: ${deleteTarget.title || 'Unknown'}`, project.id, project.name);
    } else if (deleteTarget.type === 'bulk_scenario' && deleteTarget.scenarioIds) {
      const idsToDelete = new Set(deleteTarget.scenarioIds);
      const updatedScenarios = project.scenarios.filter(s => !idsToDelete.has(s.id));
      onUpdateProject({ ...project, scenarios: updatedScenarios });
      setSelectedScenarioIds(new Set());
      logActivity(user.email, user.name, `Bulk deleted ${idsToDelete.size} AI scenarios`, project.id, project.name);
    } else if (deleteTarget.type === 'testcase' && deleteTarget.scenarioId && deleteTarget.testCaseId) {
      const updatedScenarios = project.scenarios.map(s => {
        if (s.id === deleteTarget.scenarioId) {
          return {
            ...s,
            testCases: s.testCases.filter(tc => tc.id !== deleteTarget.testCaseId)
          };
        }
        // Also remove from any AI testcase folder
        if (s.scenarioId === 'TESTCASE_FOLDER') {
          return {
            ...s,
            testCases: s.testCases.filter(tc => tc.id !== deleteTarget.testCaseId)
          };
        }
        return s;
      });
      onUpdateProject({ ...project, scenarios: updatedScenarios });
      logActivity(user.email, user.name, `Deleted test case: ${deleteTarget.title || 'Untitled'}`, project.id, project.name);
    }

    setDeleteTarget(null);
  };

  const triggerDeleteScenario = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const scenario = project.scenarios.find(s => s.id === id);
    setDeleteTarget({ type: 'scenario', scenarioId: id, title: scenario?.title });
  };

  const openFolderModal = (folder?: TestScenario) => {
    setFolderError(null);
    if (folder) {
      setEditingFolderId(folder.id);
      setNewFolderName(folder.title);
      const preselected = new Set<string>();
      
      // Match folder test cases back to their origin scenarios for pre-selection
      folder.testCases.forEach(folderCase => {
        // Search by ID first as we now preserve IDs when copying to folder
        const match = allAvailableCases.find(ac => ac.id === folderCase.id);
        if (match) {
          preselected.add(match.uniqueRef);
        } else {
          // Fallback matching by content if IDs were somehow lost
          const contentMatch = allAvailableCases.find(ac => 
            ac.title === folderCase.title && 
            JSON.stringify(ac.steps) === JSON.stringify(folderCase.steps)
          );
          if (contentMatch) preselected.add(contentMatch.uniqueRef);
        }
      });
      setSelectedCaseRefs(preselected);
    } else {
      setEditingFolderId(null);
      setNewFolderName('');
      setSelectedCaseRefs(new Set());
    }
    setIsFolderModalOpen(true);
  };

  const handleSelectAllInModal = () => {
    setFolderError(null);
    if (selectedCaseRefs.size === allAvailableCases.length) {
      setSelectedCaseRefs(new Set());
    } else {
      setSelectedCaseRefs(new Set(allAvailableCases.map(tc => tc.uniqueRef)));
    }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedScenarios);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedScenarios(next);
  };

  const handleUpdateModuleLink = (scenarioId: string, folderId: string) => {
    onUpdateProject({
        ...project,
        scenarioModuleMapping: {
            ...scenarioModuleMapping,
            [scenarioId]: folderId
        }
    });
  };

  // Helper to perform the actual AI generation for a single scenario item
  const performGenerationForScenario = async (scenario: TestScenario, currentProj: Project, isBulkContinuation: boolean = false): Promise<TestCase[]> => {
    const linkedFolderId = currentProj.scenarioModuleMapping?.[scenario.id];
    let selectedModuleData = undefined;
    if (linkedFolderId) {
        const folder = currentProj.scenarios.find(s => s.id === linkedFolderId);
        if (folder) {
            selectedModuleData = {
                name: folder.title,
                cases: (folder.testCases || []).map(tc => ({ title: tc.title, steps: tc.steps }))
            };
        }
    }

    const generationContext = { 
        url: scenario.appUrl || appUrl, 
        username: scenario.username || username, 
        password: scenario.password || password, 
        selectedModule: selectedModuleData,
        screenshots: attachedScreenshots,
        refineInstructions: refineInstructions,
        isBulkContinuation
    };

    let targetScenario = scenario;
    if (ragEnabled) {
      const enriched = await ragEnrichPrompt(`${scenario.title}\n${scenario.description}`, currentProj.id, 3);
      setRetrievedRagChunks(enriched.chunks);
      if (enriched.isRAGAugmented) {
        targetScenario = {
          ...scenario,
          description: `${scenario.description}\n\n${enriched.prompt}`
        };
      }
    } else {
      setRetrievedRagChunks([]);
    }

    const cases = await generateTestCasesFromScenario(targetScenario, generationContext) as any[];
    
    // Generated test cases are automatically recorded into Token Consumption via the AI service call


    const scPassword = scenario.password || password;
    return cases.map((c: any, idx: number) => ({
        id: Math.random().toString(36).substr(2, 9),
        testCaseId: `TC-${scenario.scenarioId}-${(idx + 1).toString().padStart(3, '0')}`,
        userStoryId: scenario.userStoryId || scenario.userStoryNumber || '',
        title: c.title,
        steps: maskPasswordArray(c.steps || [], scPassword),
        expectedResult: maskPasswordText(c.expectedResult || "", scPassword),
        status: TestStatus.NOT_EXECUTED,
        testType: c.testType,
        testIntent: c.testIntent,
        priority: c.priority,
        testDataSets: maskPasswordArray(c.testDataSets || [], scPassword)
    }));
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    setAttachedDocFileName(fileName);

    try {
      const cleanContent = await parseDocumentFile(file);
      setAttachedDocContent(cleanContent);
      toast.success(`Attached document: ${fileName}`);
    } catch (err) {
      console.error("Failed to parse document file:", err);
      toast.error('Failed to read document file.');
    }
  };

  const handleGenerateFromScreenshots = async () => {
    if (attachedScreenshots.length === 0 && !attachedDocContent.trim()) {
      toast.error("Please upload at least one screenshot or document file first.");
      return;
    }
    
    setIsGeneratingScreenshotCases(true);
    try {
      const screenshotDataUrls = attachedScreenshots.map(s => s.previewUrl || (s.data?.startsWith('data:') || s.data?.startsWith('http') ? s.data : `data:${s.mimeType || 'image/png'};base64,${s.data}`));

      const scenarioTitle = attachedDocFileName 
        ? `Input Source: Document (${attachedDocFileName})${attachedScreenshots.length > 0 ? ` & Screenshots (${attachedScreenshots.length})` : ''}`
        : `Input Source: Screenshots (${attachedScreenshots.length})`;

      const screenshotScenario: TestScenario = {
        id: 'scen-img-' + Date.now(),
        scenarioId: 'INPUT_SOURCE',
        title: scenarioTitle,
        type: 'Functional',
        description: `Test cases synthesized directly from ${attachedScreenshots.length} uploaded screenshot(s)${attachedDocFileName ? ` and document (${attachedDocFileName})` : ''}.`,
        expectedResults: 'Test cases generated based on UI screenshot analysis and requirements.',
        isApproved: true,
        testCases: [],
        moduleName: 'Screenshot Cases',
        userStoryNumber: 'UI-IMG',
        userStorySummary: 'UI Mockups & Screenshots',
        attachments: screenshotDataUrls,
        docContent: attachedDocContent,
        docFileName: attachedDocFileName
      };

      const generationContext = {
        url: appUrl,
        username: username,
        password: password,
        screenshots: attachedScreenshots,
        docContent: attachedDocContent,
        docFileName: attachedDocFileName,
        refineInstructions: refineInstructions
      };

      const cases = await generateTestCasesFromScenario(screenshotScenario, generationContext) as any[];
      
      const formattedCases: TestCase[] = cases.map((c: any, idx: number) => ({
        id: Math.random().toString(36).substr(2, 9),
        testCaseId: `TC-IMG-${(idx + 1).toString().padStart(3, '0')}`,
        userStoryId: 'UI-IMG',
        title: c.title,
        steps: maskPasswordArray(c.steps || [], password),
        expectedResult: maskPasswordText(c.expectedResult || "", password),
        status: TestStatus.NOT_EXECUTED,
        testType: c.testType || TestType.FUNCTIONAL,
        testIntent: c.testIntent || TestIntent.POSITIVE,
        priority: c.priority || TestPriority.HIGH,
        testDataSets: maskPasswordArray(c.testDataSets || [], password),
        attachments: undefined
      }));

      setSessionGeneratedItems([{ scenario: screenshotScenario, testCases: formattedCases }]);

      const initialRefs = new Set<string>();
      formattedCases.forEach(tc => initialRefs.add(`${screenshotScenario.id}|${tc.id}`));
      setSessionSelectedCaseRefs(initialRefs);

      setShowSavePromptModal(true);
      await logActivity(
        user.email,
        user.name,
        `Generated ${formattedCases.length} AI Test Cases from input artifacts`,
        project.id,
        project.name
      );

      toast.success(`Generated ${formattedCases.length} test cases from input analysis!`);
    } catch (err: any) {
      console.error("Failed to generate test cases from input:", err);
      toast.error("Failed to generate test cases from input. Please try again.");
    } finally {
      setIsGeneratingScreenshotCases(false);
    }
  };

  const executeSingleGeneration = async (scenario: TestScenario) => {
    if (isGenerating || bulkProgress.active) return;

    setIsGenerating(scenario.id);
    try {
      const newCases = await performGenerationForScenario(scenario, project);
      setSessionGeneratedItems([{ scenario, testCases: newCases }]);
      
      const initialRefs = new Set<string>();
      newCases.forEach(tc => initialRefs.add(`${scenario.id}|${tc.id}`));
      setSessionSelectedCaseRefs(initialRefs);
      
      setShowSavePromptModal(true);
      await logActivity(user.email, user.name, `Synthesized ${newCases.length} AI Test Cases for: ${scenario.title}`, project.id, project.name);

      toast.success(`Successfully generated ${newCases.length} test cases.`);
    } catch (err) {
      alert('Failed to generate test cases.');
    } finally {
      setIsGenerating(null);
    }
  };

  const handleGenerateCases = async (scenario: TestScenario) => {
    if ((scenario.testCases || []).length > 0) {
        setPendingIndividualScenario(scenario);
        setShowOverwriteModal(true);
        return;
    }
    await executeSingleGeneration(scenario);
  };

  const checkAndTriggerBulkGenerate = () => {
    if (isGenerating || bulkProgress.active) return;
    if (selectedScenarioIds.size === 0) return;

    // RESTRICTED: Enforce 30 item limit strictly for AI generation only
    if (selectedScenarioIds.size > 30) {
        alert(`AI Generation Limit Exceeded: You have selected ${selectedScenarioIds.size} scenarios. Batch AI synthesis is limited to 30 scenarios at a time to ensure token efficiency and stability. Please refine your selection and try again.`);
        return;
    }

    setPendingIndividualScenario(null); 
    const hasExisting = Array.from(selectedScenarioIds).some(id => {
        const s = project.scenarios.find(scen => scen.id === id);
        return s && (s.testCases || []).length > 0;
    });

    if (hasExisting) {
        setShowOverwriteModal(true);
    } else {
        startBulkGeneration(false);
    }
  };

  const startBulkGeneration = async (overwrite: boolean) => {
    setShowOverwriteModal(false);
    bulkCancelledRef.current = false;

    const targetIds = Array.from(selectedScenarioIds);
    setBulkProgress({ active: true, current: 0, total: targetIds.length, status: 'Initializing...', errors: [] });
    
    let currentProjectState = { ...project };
    let successCount = 0;
    const tempGeneratedItems: { scenario: TestScenario; testCases: TestCase[] }[] = [];

    for (let i = 0; i < targetIds.length; i++) {
        if (bulkCancelledRef.current) {
            break;
        }

        const id = targetIds[i];
        const scenario = currentProjectState.scenarios.find(s => s.id === id);
        if (!scenario) continue;
        
        // Skip if not overwriting and already has cases
        if (!overwrite && (scenario.testCases || []).length > 0) {
            setBulkProgress(prev => ({ ...prev, current: i + 1, status: `Skipping (Already exists): ${scenario.title}` }));
            continue;
        }

        setBulkProgress(prev => ({ ...prev, current: i + 1, status: `Synthesizing: ${scenario.title}` }));
        try {
            const newCases = await performGenerationForScenario(scenario, currentProjectState, i > 0);
            if (bulkCancelledRef.current) {
                break;
            }
            tempGeneratedItems.push({ scenario, testCases: newCases });
            successCount++;
        } catch (err: any) {
            if (bulkCancelledRef.current) {
                break;
            }
            console.error(`Bulk generation failed for ${id}:`, err);
            setBulkProgress(prev => ({ ...prev, errors: [...prev.errors, `${scenario.title}: ${err.message || 'API Error'}`] }));
        }
    }

    if (bulkCancelledRef.current) {
      toast.info('Bulk generation cancelled.');
    }

    if (tempGeneratedItems.length > 0) {
      setSessionGeneratedItems(tempGeneratedItems);
      
      const initialRefs = new Set<string>();
      tempGeneratedItems.forEach(item => {
        item.testCases.forEach(tc => initialRefs.add(`${item.scenario.id}|${tc.id}`));
      });
      setSessionSelectedCaseRefs(initialRefs);
      
      setShowSavePromptModal(true);

      const totalCasesCount = tempGeneratedItems.reduce((acc, item) => acc + item.testCases.length, 0);
      toast.success(`Generated ${totalCasesCount} test cases before process ended.`);
    }

    if (successCount > 0) {
      await logActivity(user.email, user.name, `Bulk synthesized AI test cases for ${successCount} scenarios`, project.id, project.name);
    }
    
    setBulkProgress(prev => ({ 
      ...prev, 
      status: bulkCancelledRef.current 
        ? `Cancelled. ${successCount} processed.` 
        : `Completed. ${successCount} processed successfully.`, 
      active: false 
    }));
    setSelectedScenarioIds(new Set());
  };

  const handleConfirmSaveToFolder = async () => {
    let finalFolderId = selectedFolderIdForSave;
    
    if (showCreateFolderInline) {
      const trimmedName = inlineNewFolderName.trim();
      if (!trimmedName) {
        setInlineFolderError("Please enter the folder name");
        return;
      }
      
      const isDuplicate = project.scenarios.some(s => 
        (['TESTCASE_FOLDER', 'MANUAL_FOLDER', 'SCENARIO_FOLDER'].includes(s.scenarioId) || (s.scenarioId && s.scenarioId.includes('FOLDER'))) && 
        s.title.toLowerCase() === trimmedName.toLowerCase()
      );
      if (isDuplicate) {
        setInlineFolderError("This folder name is already in use");
        return;
      }
      
      const newFolderId = Math.random().toString(36).substr(2, 9);
      const newFolder: TestScenario = {
        id: newFolderId,
        scenarioId: 'TESTCASE_FOLDER',
        title: trimmedName,
        type: 'Functional',
        description: 'Execution Folder',
        expectedResults: 'N/A',
        moduleName: 'Functional Folders',
        isApproved: true,
        testCases: [],
        createdAt: new Date().toISOString()
      };
      
      project.scenarios = [newFolder, ...project.scenarios];
      finalFolderId = newFolderId;
    } else {
      if (!finalFolderId) {
        toast.error("Please select a folder or create a new one");
        return;
      }
    }
    
    if (sessionSelectedCaseRefs.size === 0) {
      toast.error("Select at least 1 test case to proceed");
      return;
    }
    
    // Collect the selected test cases
    const selectedCases: TestCase[] = [];
    sessionSelectedCaseRefs.forEach(ref => {
      const [sId, tcId] = ref.split('|');
      const item = sessionGeneratedItems.find(it => it.scenario.id === sId);
      const testCase = item?.testCases.find(tc => tc.id === tcId);
      if (testCase) {
        selectedCases.push({ ...testCase });
      }
    });
    
    // Update the folder with the selected test cases
    let folderTitle = '';
    project.scenarios = project.scenarios.map(s => {
      if (s.id === finalFolderId) {
        folderTitle = s.title;
        const currentCases = s.testCases || [];
        return {
          ...s,
          testCases: [...currentCases, ...selectedCases]
        };
      }
      return s;
    });
    
    // Update parent scenarios of the selected test cases
    project.scenarios = project.scenarios.map(s => {
      const sessionItem = sessionGeneratedItems.find(item => item.scenario.id === s.id);
      if (sessionItem) {
        const selectedForThisScenario = sessionItem.testCases.filter(tc => 
          sessionSelectedCaseRefs.has(`${s.id}|${tc.id}`)
        );
        if (selectedForThisScenario.length > 0) {
          return {
            ...s,
            testCases: selectedForThisScenario,
            saved: true,
            isRemovedFromIndividual: true,
            folderId: finalFolderId
          };
        }
      }
      return s;
    });

    // Add any session scenario not yet present in project.scenarios (e.g. screenshot scenarios)
    sessionGeneratedItems.forEach(sessionItem => {
      const exists = project.scenarios.some(s => s.id === sessionItem.scenario.id);
      if (!exists) {
        const selectedForThisScenario = sessionItem.testCases.filter(tc => 
          sessionSelectedCaseRefs.has(`${sessionItem.scenario.id}|${tc.id}`)
        );
        if (selectedForThisScenario.length > 0) {
          project.scenarios.push({
            ...sessionItem.scenario,
            testCases: selectedForThisScenario,
            saved: true,
            isRemovedFromIndividual: true,
            folderId: finalFolderId
          });
        }
      }
    });
    
    // Save updated project state
    onUpdateProject({ ...project });
    
    // Reset and close modal immediately so popup closes automatically
    setShowSaveFolderSelectModal(false);
    setShowSavePromptModal(false);
    setShowOverwriteModal(false);
    setBulkProgress({ active: false, current: 0, total: 0, status: '', errors: [] });
    setIsGenerating(null);
    setIsGeneratingScreenshotCases(false);
    setSessionGeneratedItems([]);
    setSessionSelectedCaseRefs(new Set());
    setSelectedFolderIdForSave('');
    setInlineNewFolderName('');
    setInlineFolderError(null);
    setShowCreateFolderInline(false);
    
    toast.success("Test cases saved successfully!");

    try {
      await logActivity(
        user.email,
        user.name,
        `Saved ${selectedCases.length} test cases into folder: ${folderTitle}`,
        project.id,
        project.name
      );
    } catch (err) {
      console.warn("Failed to log activity:", err);
    }
  };

  const handleConfirmMoveScenario = async () => {
    if (!moveTargetScenario) return;

    if (!moveTargetScenario.testCases || moveTargetScenario.testCases.length === 0) {
      toast.error("Please generate AI test cases before moving this scenario to a folder.");
      return;
    }

    let finalFolderId = moveFolderId;
    let targetFolderTitle = '';

    if (showCreateMoveFolderInline) {
      const trimmedName = moveInlineNewFolderName.trim();
      if (!trimmedName) {
        setMoveInlineFolderError("Please enter folder name");
        return;
      }
      const isDuplicate = project.scenarios.some(s => 
        (['TESTCASE_FOLDER', 'MANUAL_FOLDER', 'SCENARIO_FOLDER'].includes(s.scenarioId) || (s.scenarioId && s.scenarioId.includes('FOLDER'))) && 
        s.title.toLowerCase() === trimmedName.toLowerCase()
      );
      if (isDuplicate) {
        setMoveInlineFolderError("This folder name is already in use");
        return;
      }

      const newFolderId = Math.random().toString(36).substr(2, 9);
      const newFolder: TestScenario = {
        id: newFolderId,
        scenarioId: 'TESTCASE_FOLDER',
        title: trimmedName,
        type: 'Functional',
        description: 'Execution Folder',
        expectedResults: 'N/A',
        moduleName: 'Functional Folders',
        isApproved: true,
        testCases: [...(moveTargetScenario.testCases || [])],
        createdAt: new Date().toISOString()
      };
      project.scenarios = [newFolder, ...project.scenarios];
      finalFolderId = newFolderId;
      targetFolderTitle = trimmedName;
    } else {
      if (!finalFolderId) {
        toast.error("Please select a folder or create a new one");
        return;
      }
      const targetFolder = project.scenarios.find(s => s.id === finalFolderId);
      if (targetFolder) {
        targetFolderTitle = targetFolder.title;
        const currentCases = targetFolder.testCases || [];
        const existingIds = new Set(currentCases.map(c => c.id));
        const newCases = (moveTargetScenario.testCases || []).filter(c => !existingIds.has(c.id));
        targetFolder.testCases = [...currentCases, ...newCases];
      }
    }

    // Update the target scenario
    project.scenarios = project.scenarios.map(s => {
      if (s.id === moveTargetScenario.id) {
        return {
          ...s,
          folderId: finalFolderId,
          saved: true,
          isRemovedFromIndividual: true
        };
      }
      return s;
    });

    onUpdateProject({ ...project });
    setShowMoveModal(false);
    setMoveTargetScenario(null);
    setMoveFolderId('');
    setShowCreateMoveFolderInline(false);
    setMoveInlineNewFolderName('');
    setMoveInlineFolderError(null);
    toast.success(`Moved scenario and test cases to "${targetFolderTitle}"!`);

    try {
      await logActivity(
        user.email,
        user.name,
        `Moved scenario to folder: ${targetFolderTitle}`,
        project.id,
        project.name
      );
    } catch (err) {
      console.warn("Activity logging failed:", err);
    }
  };

  const handleSaveFolder = async () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      setFolderError("Please enter the Folder name");
      return;
    }

    // Duplicate Check logic
    const isDuplicate = project.scenarios.some(s => 
      s.scenarioId === 'TESTCASE_FOLDER' && 
      s.id !== editingFolderId &&
      s.title.toLowerCase() === trimmedName.toLowerCase()
    );

    if (isDuplicate) {
      setFolderError('This folder name is already in use. Please enter a different name to continue');
      return;
    }

    if (selectedCaseRefs.size === 0) {
      setFolderError("Select atleast 1 testcase to proceed");
      return;
    }

    const selectedCases: TestCase[] = [];
    const memberScenarioIdSet = new Set<string>();
    selectedCaseRefs.forEach(ref => {
      const [sId, tcId] = ref.split('|');
      if (sId) memberScenarioIdSet.add(sId);
      const scenario = project.scenarios.find(s => s.id === sId);
      const testCase = (scenario?.testCases || []).find(tc => tc.id === tcId);
      // Fix: Preserve the original ID when copying into folder to ensure pre-selection works correctly on subsequent edits
      if (testCase) selectedCases.push({ ...testCase }); 
    });

    if (editingFolderId) {
      const updatedScenarios = project.scenarios.map(s => 
        s.id === editingFolderId ? { 
          ...s, 
          title: trimmedName, 
          testCases: selectedCases,
          memberScenarioIds: Array.from(memberScenarioIdSet)
        } : s
      );
      onUpdateProject({ ...project, scenarios: updatedScenarios });
      logActivity(user.email, user.name, `Updated AI Folder: ${trimmedName}`, project.id, project.name);
    } else {
      const folder: TestScenario = {
        id: Math.random().toString(36).substr(2, 9),
        scenarioId: 'TESTCASE_FOLDER',
        title: trimmedName,
        type: 'Functional',
        description: 'Execution Folder',
        expectedResults: 'N/A',
        moduleName: 'Functional Folders',
        isApproved: true,
        testCases: selectedCases,
        memberScenarioIds: Array.from(memberScenarioIdSet),
        createdAt: new Date().toISOString()
      };
      onUpdateProject({ ...project, scenarios: [folder, ...project.scenarios] });
      logActivity(user.email, user.name, `Created AI Folder: ${trimmedName}`, project.id, project.name);
    }
    setIsFolderModalOpen(false);
    setSelectedCaseRefs(new Set());
    setNewFolderName('');
    setEditingFolderId(null);
    setFolderError(null);
  };

  const handleOpenEditCase = (scenarioId: string, tc: TestCase) => {
    setEditingScenarioId(scenarioId);
    setEditingCaseId(tc.id);
    setEditForm({ ...tc });
  };

  const handleSaveEditCase = async () => {
    if (!editForm || !editingScenarioId || !editingCaseId) return;

    const updatedScenarios = project.scenarios.map(s => {
      if (s.id === editingScenarioId) {
        return {
          ...s,
          testCases: s.testCases.map(tc => tc.id === editingCaseId ? editForm : tc)
        };
      }
      // Also update in any folder containing the testcase
      if ((['TESTCASE_FOLDER', 'MANUAL_FOLDER', 'SCENARIO_FOLDER'].includes(s.scenarioId) || (s.scenarioId && s.scenarioId.includes('FOLDER'))) && s.testCases?.some(tc => tc.id === editingCaseId)) {
        return {
          ...s,
          testCases: s.testCases.map(tc => tc.id === editingCaseId ? editForm : tc)
        };
      }
      return s;
    });

    onUpdateProject({ ...project, scenarios: updatedScenarios });
    await logActivity(user.email, user.name, `Updated AI Test Case: ${editForm.title}`, project.id, project.name);
    setEditingCaseId(null);
    setEditingScenarioId(null);
    setEditForm(null);
  };

  const handleDownloadFolder = (folder: TestScenario) => {
    if (!folder.testCases || folder.testCases.length === 0) {
      alert("No test cases in this folder to export.");
      return;
    }

    const scPassword = folder.password || password;
    const data = folder.testCases.map(tc => ({
      'Test Case ID': tc.testCaseId || 'N/A',
      'Title': tc.title,
      'Steps': maskPasswordArray(tc.steps, scPassword).join('\n'),
      'Expected Result': maskPasswordText(tc.expectedResult, scPassword),
      'Type': tc.testType || 'Functional',
      'Intent': tc.testIntent || 'Positive',
      'Priority': tc.priority || 'Medium',
      'Test Data Set 1': maskPasswordText(tc.testDataSets?.[0] || '', scPassword),
      'Test Data Set 2': maskPasswordText(tc.testDataSets?.[1] || '', scPassword),
      'Test Data Set 3': maskPasswordText(tc.testDataSets?.[2] || '', scPassword),
      'Created At': folder.createdAt ? new Date(folder.createdAt).toLocaleDateString() : 'N/A'
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AI Test Cases");
    XLSX.writeFile(workbook, `AI_Folder_${folder.title.replace(/\s+/g, '_')}.xlsx`);
    logActivity(user.email, user.name, `Exported AI Folder: ${folder.title}`, project.id, project.name);
  };

  const handleExportIndividualScenarios = () => {
    const targetScenarios = individualScenarios;

    if (targetScenarios.length === 0) {
      alert("No individual scenarios found to export.");
      return;
    }

    const data = targetScenarios.flatMap(s => {
      const scPassword = s.password || password;
      return (s.testCases || []).map(tc => ({
        'Scenario': s.title,
        'Test Case ID': tc.testCaseId || 'N/A',
        'Title': tc.title,
        'Steps': maskPasswordArray(tc.steps, scPassword).join('\n'),
        'Expected Result': maskPasswordText(tc.expectedResult, scPassword),
        'Type': tc.testType || 'Functional',
        'Intent': tc.testIntent || 'Positive',
        'Priority': tc.priority || 'Medium',
        'Test Data Set 1': maskPasswordText(tc.testDataSets?.[0] || '', scPassword),
        'Test Data Set 2': maskPasswordText(tc.testDataSets?.[1] || '', scPassword),
        'Test Data Set 3': maskPasswordText(tc.testDataSets?.[2] || '', scPassword)
      }));
    });

    if (data.length === 0) {
      alert("No generated test cases found under individual scenarios.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AI Test Cases");
    XLSX.writeFile(workbook, `${project.name.replace(/\s+/g, '_')}_Individual_TestCases.xlsx`);
    logActivity(user.email, user.name, `Exported all individual AI test cases`, project.id, project.name);
  };

  const isAllVisibleSelected = paginatedScenarios.length > 0 && paginatedScenarios.every(s => selectedScenarioIds.has(s.id));

  const handleBulkDeleteAction = () => {
    if (selectedScenarioIds.size === 0) return;
    setDeleteTarget({ 
        type: 'bulk_scenario', 
        scenarioIds: Array.from(selectedScenarioIds),
        title: `${selectedScenarioIds.size} Scenarios`
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* 1. Page Header Section */}
      <div className="bg-white p-8 rounded-[1.5rem] border border-slate-100 shadow-sm flex flex-col gap-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black text-black uppercase tracking-tight">AI Test Cases</h2>
              <RAGStatusBadge
                enabled={ragEnabled}
                onToggle={setRagEnabled}
                retrievedChunks={retrievedRagChunks}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex-1 max-w-sm w-full">
          <div className="bg-slate-50 px-8 py-3 rounded-2xl border border-slate-100 flex flex-col items-center">
            <span className="text-[14px] font-black text-black uppercase tracking-widest mb-1">Total Testcases</span>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black text-indigo-600">{totalTestCasesCount}</span>
              <TrendingUp size={16} className="text-indigo-400" />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
           <div className="relative group w-64">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <input 
                type="text" 
                placeholder="Search cases or IDs..." 
                value={searchQueryRaw || ''}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-50/20 transition-all"
              />
           </div>
           <button 
             onClick={handleDownloadTemplate}
             className="flex items-center gap-2 bg-white text-slate-600 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
           >
              <FileSpreadsheet size={16} /> Template
           </button>
           <button 
             onClick={() => uploadInputRef.current?.click()}
             className="flex items-center gap-2 bg-white text-slate-600 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
           >
              <Upload size={16} /> Upload
              <input type="file" ref={uploadInputRef} className="hidden" accept=".xlsx,.csv" onChange={handleUploadScenarios} />
           </button>
           <button onClick={handleExportIndividualScenarios} className="flex items-center gap-2 bg-white text-slate-600 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all shadow-sm">
              <Download size={16} /> Export
           </button>
           <button onClick={() => openFolderModal()} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-indigo-100 hover:bg-indigo-100 transition-all shadow-sm active:scale-95">
              <FolderPlus size={16} /> Add Folder
           </button>
        </div>
      </div>
      </div>

      {/* 2. Generation Context Section */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-slate-50 bg-slate-50/20 flex items-center gap-4">
           <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-white shadow-md">
              <Settings2 size={20} />
           </div>
           <div>
             <h3 className="text-sm font-black text-black uppercase tracking-widest">Generation Context</h3>
             <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Configure global context for test case synthesis</p>
           </div>
        </div>
        <div className="p-10 space-y-8">
           <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-3">
                 <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1">Default App URL</label>
                 <div className="relative">
                    <Globe size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input 
                      value={appUrl || ''} 
                      onChange={e => setAppUrl(e.target.value)} 
                      placeholder="https://example.com" 
                      className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 focus:ring-4 ring-indigo-50 transition-all outline-none shadow-inner" 
                    />
                 </div>
              </div>
              <div className="space-y-3">
                 <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1">Default Username</label>
                 <div className="relative">
                    <User size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input 
                      value={username || ''} 
                      onChange={e => setUsername(e.target.value)} 
                      placeholder="admin@example.com" 
                      className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 focus:ring-4 ring-indigo-50 transition-all outline-none shadow-inner" 
                    />
                 </div>
              </div>
              <div className="space-y-3">
                 <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1">Default Password</label>
                 <div className="relative">
                    <Lock size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input 
                      type="password"
                      value={password || ''} 
                      onChange={e => setPassword(e.target.value)} 
                      placeholder="••••••••" 
                      className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 focus:ring-4 ring-indigo-50 transition-all outline-none shadow-inner" 
                    />
                 </div>
              </div>
           </div>
           <div className="bg-orange-50 border border-orange-100 px-6 py-4 rounded-2xl flex items-center gap-4">
              <Info size={18} className="text-orange-500" />
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-[0.1em]">System will intelligently detect if login is required. Provided credentials will be used only when necessary.</p>
           </div>

           {/* Document Uploader */}
           <div className="pt-2 space-y-2">
             <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1 block">
               Requirements Document <span className="text-slate-400 font-normal text-xs">(Optional)</span>
             </label>
             <div className="flex items-center gap-4">
               <label className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl hover:border-indigo-300 hover:bg-indigo-50/20 cursor-pointer transition-all">
                 <Paperclip size={18} className="text-indigo-500" />
                 <span className="text-xs font-bold text-slate-700 uppercase tracking-wider truncate max-w-md">
                   {attachedDocFileName ? attachedDocFileName : 'Upload Requirements Document (PDF, TXT, DOCX)'}
                 </span>
                 <input
                   type="file"
                   accept=".pdf,.txt,.doc,.docx,.md"
                   onChange={handleDocUpload}
                   className="hidden"
                 />
               </label>
               {attachedDocFileName && (
                 <button
                   type="button"
                   onClick={() => {
                     setAttachedDocFileName('');
                     setAttachedDocContent('');
                   }}
                   className="p-3 bg-rose-50 border border-rose-100 text-rose-500 rounded-2xl hover:bg-rose-100 transition-all cursor-pointer"
                   title="Remove document"
                 >
                   <X size={16} />
                 </button>
               )}
             </div>
           </div>

           <ScreenshotUploader
             screenshots={attachedScreenshots}
             onChange={setAttachedScreenshots}
             title="Generation Screenshots (Optional)"
             description="Attach screenshots to guide test case synthesis with visual UI layouts, buttons, forms, and workflows."
             className="pt-2"
           />

           {/* Refine Instructions Input Box */}
           <div className="pt-3 space-y-2">
             <div className="flex items-center justify-between">
               <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1 flex items-center gap-2">
                 <Sparkles size={16} className="text-indigo-600" />
                 Refine Instructions <span className="text-slate-400 font-normal text-xs">(Optional)</span>
               </label>
               <span className="text-[11px] font-bold text-slate-400">
                 {refineInstructions.length}/1000
               </span>
             </div>
             <textarea
               value={refineInstructions || ''}
               maxLength={1000}
               rows={3}
               onChange={e => setRefineInstructions(e.target.value)}
               placeholder="Enter instructions to refine test case generation (e.g., 'Focus on edge cases and validation rules', 'Include negative scenarios for input fields', 'Verify specific error messages')..."
               className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all resize-none shadow-inner"
             />
           </div>

           {(attachedScreenshots.length > 0 || attachedDocContent.trim().length > 0) && (
             <div className="mt-4 p-5 bg-indigo-50/80 border border-indigo-200/80 rounded-2xl flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 shadow-sm">
               <div className="flex items-center gap-3">
                 <div className="p-3 bg-indigo-600 text-white rounded-xl shadow-md">
                   <Sparkles size={20} />
                 </div>
                 <div>
                   <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                     {attachedScreenshots.length > 0 && attachedDocFileName
                       ? `${attachedScreenshots.length} Screenshot(s) & Document (${attachedDocFileName}) Uploaded`
                       : attachedScreenshots.length > 0
                       ? `${attachedScreenshots.length} Screenshot(s) Uploaded`
                       : `Document (${attachedDocFileName}) Uploaded`}
                   </h4>
                   <p className="text-[11px] font-medium text-indigo-800/80 mt-0.5">
                     You can generate test cases directly from analyzing these uploaded screenshots and document input.
                   </p>
                 </div>
               </div>

               <button
                 type="button"
                 disabled={isGeneratingScreenshotCases || bulkProgress.active || !!isGenerating}
                 onClick={handleGenerateFromScreenshots}
                 className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
               >
                 {isGeneratingScreenshotCases ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                 {isGeneratingScreenshotCases ? 'Analyzing Inputs...' : 'Generate Test Cases from Input'}
               </button>
             </div>
           )}
        </div>
      </div>

      {/* Selection Limit Info Banner */}
      <div className="px-6">
        <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-500">
           <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
              <Info size={18} strokeWidth={3} />
           </div>
           <div>
              <p className="text-[11px] font-black text-amber-700 uppercase tracking-tight">Bulk Selection Dynamics</p>
              <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest mt-0.5">Bulk selection is unlimited for deletion. AI generation is capped at 30 scenarios per batch to ensure artifact quality.</p>
           </div>
        </div>
      </div>

      {/* 3. Selected Scenarios Action Bar */}
      {selectedScenarioIds.size > 0 && (
        <div className="bg-slate-900 rounded-[2rem] p-6 flex items-center justify-between shadow-2xl animate-in slide-in-from-top-4 mx-6">
          <div className="flex items-center gap-4 ml-4">
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-white">
              <CheckSquare size={24} />
            </div>
            <div>
              <h4 className="text-sm font-black text-white uppercase tracking-tight">{selectedScenarioIds.size} Scenarios Selected</h4>
              <p className={`text-[9px] font-bold uppercase tracking-widest ${selectedScenarioIds.size > 30 ? 'text-amber-400' : 'text-slate-400'}`}>
                {selectedScenarioIds.size > 30 ? 'Batch Generation Limit Reached (30 Max)' : `${selectedScenarioIds.size}/30 synthesis capacity`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              disabled={bulkProgress.active || !!isGenerating}
              onClick={checkAndTriggerBulkGenerate} 
              className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkProgress.active ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {bulkProgress.active ? 'GENERATING SELECTED...' : 'AI GENERATE SELECTED'}
            </button>
            <button 
              onClick={handleBulkDeleteAction}
              className="flex items-center gap-2 bg-rose-900/50 text-rose-500 border border-rose-800/50 px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-900 transition-all active:scale-95"
            >
              <Trash2 size={16} /> Bulk Delete
            </button>
            <button onClick={() => setSelectedScenarioIds(new Set())} className="p-2 text-slate-500 hover:text-white transition-colors">
              <X size={24} />
            </button>
          </div>
        </div>
      )}

      {/* 4. Tabs */}
      <div className="flex gap-10 border-b border-slate-100 mt-10 px-6">
        <button onClick={() => setActiveTab('scenarios')} className={`pb-4 flex items-center gap-3 text-[11px] font-black uppercase tracking-widest relative transition-all ${activeTab === 'scenarios' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
          <LayoutGrid size={16} /> Individual Scenarios
          <span className="text-[10px] font-black text-slate-400 opacity-60 ml-1">
            {individualScenarios.length}
          </span>
          {activeTab === 'scenarios' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full shadow-lg" />}
        </button>
        <button onClick={() => setActiveTab('folders')} className={`pb-4 flex items-center gap-3 text-[11px] font-black uppercase tracking-widest relative transition-all ${activeTab === 'folders' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
          <Folder size={16} /> Folders
          <span className="text-[10px] font-black text-slate-400 opacity-60 ml-1">{availableModules.length}</span>
          {activeTab === 'folders' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full shadow-lg" />}
        </button>
      </div>

      {activeTab === 'scenarios' && (
        <div className="px-6 py-2">
           <button 
             onClick={() => {
                const visibleIds = paginatedScenarios.map(s => s.id);
                if (isAllVisibleSelected) {
                    const next = new Set(selectedScenarioIds);
                    visibleIds.forEach(id => next.delete(id));
                    setSelectedScenarioIds(next);
                } else {
                    const next = new Set(selectedScenarioIds);
                    for (const id of visibleIds) {
                        if (!next.has(id)) {
                           next.add(id);
                        }
                    }
                    setSelectedScenarioIds(next);
                }
             }}
             className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] transition-all hover:text-slate-600"
           >
              <div className={isAllVisibleSelected ? 'text-indigo-600' : 'text-slate-300'}>
                  {isAllVisibleSelected ? <CheckSquare size={20} /> : <Square size={20} />}
              </div>
              Select All Visible
           </button>
        </div>
      )}

      {/* 5. List Area */}
      <div className="space-y-4">
        {paginatedScenarios.map(scenario => {
          const isExpanded = expandedScenarios.has(scenario.id);
          const isSelected = selectedScenarioIds.has(scenario.id);
          const hasCases = (scenario.testCases || []).length > 0;
          const folderId = scenarioModuleMapping[scenario.id];

          return (
            <div key={scenario.id} className={`bg-white border rounded-[1.5rem] shadow-sm transition-all duration-300 ${isSelected ? 'border-indigo-500 ring-4 ring-indigo-50' : 'border-slate-100 hover:border-indigo-200'}`}>
               <div className="p-5 flex items-start justify-between group">
                  <div className="flex items-start gap-5 flex-1 min-w-0">
                    {activeTab === 'scenarios' && (
                      <button 
                        onClick={() => {
                          const next = new Set(selectedScenarioIds);
                          if (next.has(scenario.id)) {
                            next.delete(scenario.id);
                          } else {
                            next.add(scenario.id);
                          }
                          setSelectedScenarioIds(next);
                        }}
                        className={`mt-1 ${isSelected ? 'text-indigo-600' : 'text-slate-200 group-hover:text-slate-300 transition-colors'}`}
                      >
                        {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                      </button>
                    )}
                    
                    <button onClick={() => toggleExpand(scenario.id)} className={`p-1 transition-all mt-0.5 ${isExpanded ? 'rotate-0 text-indigo-600' : '-rotate-90 text-slate-300'}`}>
                      <ChevronDown size={20} strokeWidth={3} />
                    </button>

                    <div className="flex items-start gap-4 min-w-0 flex-1 group/title-wrap mr-8">
                      <h4 className="text-sm font-bold text-black uppercase tracking-tight flex-1 min-w-0 cursor-pointer whitespace-pre-wrap break-words" title={scenario.title}>{scenario.title}</h4>
                      {hasCases && (
                        <span className="w-5 h-5 flex-shrink-0 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-black flex items-center justify-center border border-indigo-100 shadow-inner mt-0.5">
                           {scenario.testCases.length}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 mt-1 flex-shrink-0">
                    {activeTab === 'scenarios' ? (
                      <>
                        <div className="relative group/module min-w-[200px]">
                            <div className="absolute top-full right-0 mt-3 w-72 p-3 bg-white border border-slate-200 rounded-xl shadow-2xl opacity-0 group-hover/module:opacity-100 transition-all duration-200 pointer-events-none z-[100] text-left">
                                <p className="text-[10px] font-bold text-slate-600 leading-relaxed">
                                    Select a folder to inherit existing test steps and continue testcase generation from there.
                                </p>
                                <div className="absolute -top-1 right-8 w-2 h-2 bg-white border-l border-t border-slate-200 rotate-45" />
                            </div>

                            <select 
                                value={folderId || ""}
                                onChange={e => handleUpdateModuleLink(scenario.id, e.target.value)}
                                className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none appearance-none cursor-pointer hover:bg-white transition-all shadow-inner text-slate-500"
                            >
                                <option value="">No Base Module</option>
                                {availableModules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                            </select>
                            <Layers size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                            <ChevronDown size={12} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" />
                        </div>

                        {(() => {
                          const hasTestCases = Boolean(scenario.testCases && scenario.testCases.length > 0);
                          return (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!hasTestCases) {
                                  toast.error("Please generate AI test cases before moving this scenario to a folder.");
                                  return;
                                }
                                setMoveTargetScenario(scenario);
                                setSelectedFolderIdForSave('');
                                setMoveFolderId(scenario.folderId || '');
                                setShowCreateMoveFolderInline(false);
                                setMoveInlineNewFolderName('');
                                setMoveInlineFolderError(null);
                                setShowMoveModal(true);
                              }}
                              disabled={!hasTestCases}
                              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all shadow-sm active:scale-95 ${
                                hasTestCases
                                  ? 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer'
                                  : 'bg-slate-100/80 border border-slate-200/60 text-slate-400 cursor-not-allowed opacity-60'
                              }`}
                              title={hasTestCases ? "Move scenario to folder" : "Please generate AI test cases before moving to a folder"}
                            >
                              <FolderPlus size={14} className={hasTestCases ? "text-indigo-600" : "text-slate-400"} /> Move to Folder
                            </button>
                          );
                        })()}

                        <button 
                          onClick={() => handleGenerateCases(scenario)}
                          disabled={isGenerating === scenario.id || bulkProgress.active}
                          className="flex items-center gap-2 px-6 py-2.5 bg-white border border-indigo-100 text-indigo-600 rounded-xl font-black text-[9px] uppercase tracking-[0.1em] hover:bg-indigo-50 transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGenerating === scenario.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          {isGenerating === scenario.id ? 'Generating...' : 'GENERATE AI TEST CASES'}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-indigo-100">Folder</span>
                        <button 
                          onClick={() => onRunFolder && onRunFolder(scenario.id)}
                          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95"
                        >
                          <PlayCircle size={14} fill="white" /> Run Folder
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDownloadFolder(scenario); }}
                          className="p-2 text-slate-300 hover:text-indigo-600 transition-colors"
                          title="Export Folder Test Cases"
                        >
                          <Download size={18} />
                        </button>
                        <button onClick={() => openFolderModal(scenario)} className="p-2 text-slate-300 hover:text-indigo-600 transition-colors" title="Add Test cases to Folder">
                          <Plus size={18} />
                        </button>
                      </>
                    )}
                    
                    <button onClick={(e) => triggerDeleteScenario(e, scenario.id)} className="p-2 text-slate-200 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all">
                      <Trash2 size={18} />
                    </button>
                  </div>
               </div>

               {isExpanded && (() => {
                  const isFolder = ['TESTCASE_FOLDER', 'MANUAL_FOLDER', 'SCENARIO_FOLDER'].includes(scenario.scenarioId) || (scenario.scenarioId && scenario.scenarioId.includes('FOLDER'));
                  const folderScenarios = isFolder ? project.scenarios.filter(s => s.folderId === scenario.id) : [];
                  return (
                     <div className="px-16 pb-10 space-y-10 animate-in slide-in-from-top-2 border-t border-slate-50 pt-8">
                        {folderScenarios.length > 0 ? (
                           <div className="space-y-10">
                              {folderScenarios.map((subSc) => (
                                 <div key={subSc.id} className="border border-indigo-100/50 rounded-[1.8rem] p-6 bg-indigo-50/5 space-y-6 shadow-sm">
                                    <div className="flex items-center justify-between border-b border-indigo-50 pb-4">
                                       <div className="flex items-center gap-3">
                                          <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 shadow-inner">
                                             <Layers size={14} />
                                          </div>
                                          <div>
                                             <span className="text-[9px] font-black text-indigo-500 uppercase tracking-[0.2em] block leading-none mb-1">Scenario Suite</span>
                                             <h5 className="text-sm font-bold text-slate-800 uppercase tracking-tight">{subSc.title}</h5>
                                          </div>
                                       </div>
                                       <span className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-indigo-100 shadow-inner">
                                          {(subSc.testCases || []).length} Test Cases
                                       </span>
                                    </div>
                                    {(subSc.userStoryId || subSc.userStoryNumber) && (
                                       <div className="bg-indigo-50/40 border border-indigo-100/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left mb-6 animate-in fade-in duration-200">
                                          <div className="flex flex-col">
                                             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">User Story ID</span>
                                             <span className="inline-block text-xs font-mono font-black text-indigo-600 bg-white border border-indigo-100 px-3 py-1 rounded-xl shadow-sm w-fit leading-none">
                                                {subSc.userStoryId || subSc.userStoryNumber}
                                             </span>
                                          </div>
                                          <div className="flex-1 sm:border-l sm:border-indigo-100 sm:pl-5 flex flex-col">
                                             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Scenario</span>
                                             <h6 className="text-xs font-bold text-slate-700 uppercase tracking-tight leading-normal">
                                                {subSc.title}
                                             </h6>
                                          </div>
                                       </div>
                                    )}
                                    <div className="space-y-12">
                                                                            {/* Display Source Input Artifacts: Document & Screenshots */}
                                     {((subSc as any).docContent || (subSc.attachments && subSc.attachments.length > 0)) && (
                                       <div className="mb-6 p-5 bg-indigo-50/40 border border-indigo-100 rounded-2xl space-y-4 shadow-sm">
                                         <div className="flex items-center gap-2 border-b border-indigo-100 pb-2">
                                           <FileText size={16} className="text-indigo-600" />
                                           <span className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                                             Source Input Artifacts
                                           </span>
                                         </div>

                                         {(subSc as any).docContent && (
                                           <div className="p-4 bg-white rounded-xl border border-indigo-100 shadow-sm">
                                             <div className="flex items-center gap-2 mb-2 text-slate-700">
                                               <Paperclip size={14} className="text-indigo-600" />
                                               <span className="text-xs font-bold uppercase font-mono text-indigo-800">
                                                 Requirements Document File: {(subSc as any).docFileName || 'Attached Document'}
                                               </span>
                                             </div>
                                             <div className="p-3 bg-slate-50 rounded-lg max-h-48 overflow-y-auto text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed border border-slate-100 custom-scrollbar">
                                               {sanitizeAndExtractDocContent((subSc as any).docContent, (subSc as any).docFileName || '')}
                                             </div>
                                           </div>
                                         )}

                                         {subSc.attachments && subSc.attachments.length > 0 && (
                                           <div className="p-4 bg-white rounded-xl border border-indigo-100 shadow-sm">
                                             <ScreenshotGallery
                                               images={subSc.attachments}
                                               title={`Input UI Screenshots (${subSc.attachments.length})`}
                                               compact
                                             />
                                           </div>
                                         )}
                                       </div>
                                     )}

                                        {(subSc.testCases || []).map((tc, tidx) => (
                                          <div key={tc.id} className="relative group/case animate-in fade-in duration-300">
                                             <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-4 min-w-0 flex-1">
                                                   <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-indigo-100 shadow-inner">{tidx + 1}</div>
                                                   
                                                   {tc.testCaseId && (
                                                     <div className="bg-slate-900 text-white px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-[0.1em] flex-shrink-0 flex items-center gap-1 shadow-sm">
                                                       <Hash size={10} /> {tc.testCaseId}
                                                     </div>
                                                   )}

                                                   <h5 className="text-base font-bold text-black tracking-tight line-clamp-2 whitespace-normal flex-1 min-w-0 cursor-pointer" title={tc.title}>{tc.title}</h5>

                                                   <div className="flex items-center gap-2 flex-shrink-0">
                                                      <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border border-indigo-100 shadow-sm">{tc.testType?.toUpperCase()}</span>
                                                      <span className={`${tc.testIntent === 'Positive' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'} px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border shadow-sm`}>{tc.testIntent?.toUpperCase()}</span>
                                                      <span className={`text-[9px] font-black flex items-center gap-1 uppercase tracking-tighter ml-1 drop-shadow-sm ${tc.priority === 'High' ? 'text-red-500' : tc.priority === 'Medium' ? 'text-orange-500' : 'text-slate-500'}`}>
                                                         <Zap size={10} fill="currentColor" /> {tc.priority?.toUpperCase()}
                                                      </span>
                                                   </div>
                                                </div>
                                                <div className="flex items-center gap-2 opacity-0 group-hover/case:opacity-100 transition-all">
                                                   <button 
                                                     onClick={() => handleOpenEditCase(subSc.id, tc)}
                                                     className="p-2 text-slate-300 hover:text-indigo-600 transition-colors"
                                                   >
                                                     <Pencil size={16}/>
                                                   </button>
                                                   <button 
                                                     onClick={() => setDeleteTarget({ type: 'testcase', scenarioId: subSc.id, testCaseId: tc.id, title: tc.title })}
                                                     className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                                                   >
                                                     <Trash2 size={16}/>
                                                   </button>
                                                </div>
                                             </div>

                                             <div className="ml-12 mb-6">
                                                <p className="text-sm font-bold text-indigo-600 leading-relaxed mb-5">
                                                   <span className="uppercase tracking-[0.15em] opacity-80 mr-1.5 font-black">Expected:</span> {maskPasswordText(tc.expectedResult, subSc.password || password)}
                                                </p>
                                                <div className="space-y-2.5">
                                                   {tc.steps.map((step, sidx) => (
                                                      <div key={sidx} className="flex gap-4 text-xs text-slate-600 font-medium">
                                                         <span className="text-slate-300 font-black w-4">{sidx + 1}.</span>
                                                         <p className="flex-1 leading-relaxed">{maskPasswordText(step, subSc.password || password)}</p>
                                                      </div>
                                                   ))}
                                                </div>
                                             </div>

                                             {(tc.attachments || scenario.attachments) && (
                                   <div className="ml-12 mb-6">
                                     <ScreenshotGallery
                                       images={tc.attachments && tc.attachments.length > 0 ? tc.attachments : scenario.attachments}
                                       title="Attached Screenshots"
                                       compact
                                     />
                                   </div>
                                 )}

                                 {tc.testDataSets && tc.testDataSets.length > 0 && (
                                               <div className="ml-12 mt-10 bg-[#F9FAFF] rounded-[2rem] border border-slate-100 p-10 shadow-inner">
                                                  <div className="flex items-center gap-3 mb-10">
                                                     <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100/50">
                                                        <Database size={24} />
                                                     </div>
                                                     <h6 className="text-[11px] font-black text-slate-800 uppercase tracking-[0.3em]">Execution Test Data Sets</h6>
                                                  </div>
                                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                                     {tc.testDataSets.slice(0, 3).map((set, sIdx) => (
                                                       <div key={sIdx} className="bg-white border border-slate-100 rounded-[1.8rem] p-8 shadow-sm group/set hover:border-indigo-200 hover:shadow-md transition-all">
                                                          <div className="flex items-center justify-between mb-5">
                                                             <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest border-b-2 border-indigo-50 pb-1">Set {sIdx + 1}</p>
                                                          </div>
                                                          <p className="text-[12px] text-slate-600 font-medium leading-relaxed font-mono break-words whitespace-pre-wrap">
                                                             {maskPasswordText(set, subSc.password || password)}
                                                          </p>
                                                       </div>
                                                     ))}
                                                  </div>
                                               </div>
                                             )}
                                             {tidx < subSc.testCases.length - 1 && <div className="ml-12 mt-14 border-b border-slate-100/50 shadow-sm" />}
                                          </div>
                                       ))}
                                    </div>
                                 </div>
                              ))}
                           </div>
                        ) : hasCases ? (
                        <>
                           {(scenario.userStoryId || scenario.userStoryNumber) && (
                              <div className="bg-indigo-50/40 border border-indigo-100/60 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left mb-6 animate-in fade-in duration-200">
                                 <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">User Story ID</span>
                                    <span className="inline-block text-xs font-mono font-black text-indigo-600 bg-white border border-indigo-100 px-3 py-1 rounded-xl shadow-sm w-fit leading-none">
                                       {scenario.userStoryId || scenario.userStoryNumber}
                                    </span>
                                 </div>
                                 <div className="flex-1 sm:border-l sm:border-indigo-100 sm:pl-5 flex flex-col">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Scenario</span>
                                    <h6 className="text-sm font-bold text-slate-700 uppercase tracking-tight leading-normal">
                                       {scenario.title}
                                    </h6>
                                 </div>
                              </div>
                           )}

                           {/* Display Source Input Artifacts: Document & Screenshots */}
                           {((scenario as any).docContent || (scenario.attachments && scenario.attachments.length > 0)) && (
                             <div className="mb-6 p-5 bg-indigo-50/40 border border-indigo-100 rounded-2xl space-y-4 shadow-sm">
                               <div className="flex items-center gap-2 border-b border-indigo-100 pb-2">
                                 <FileText size={16} className="text-indigo-600" />
                                 <span className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                                   Source Input Artifacts
                                 </span>
                               </div>

                               {(scenario as any).docContent && (
                                 <div className="p-4 bg-white rounded-xl border border-indigo-100 shadow-sm">
                                   <div className="flex items-center gap-2 mb-2 text-slate-700">
                                     <Paperclip size={14} className="text-indigo-600" />
                                     <span className="text-xs font-bold uppercase font-mono text-indigo-800">
                                       Requirements Document File: {(scenario as any).docFileName || 'Attached Document'}
                                     </span>
                                   </div>
                                   <div className="p-3 bg-slate-50 rounded-lg max-h-48 overflow-y-auto text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed border border-slate-100 custom-scrollbar">
                                     {sanitizeAndExtractDocContent((scenario as any).docContent, (scenario as any).docFileName || '')}
                                   </div>
                                 </div>
                               )}

                               {scenario.attachments && scenario.attachments.length > 0 && (
                                 <div className="p-4 bg-white rounded-xl border border-indigo-100 shadow-sm">
                                   <ScreenshotGallery
                                     images={scenario.attachments}
                                     title={`Input UI Screenshots (${scenario.attachments.length})`}
                                     compact
                                   />
                                 </div>
                               )}
                             </div>
                           )}

                           <div className="space-y-12">
                           {scenario.testCases.map((tc, tidx) => (
                             <div key={tc.id} className="relative group/case animate-in fade-in duration-300">
                                <div className="flex items-center justify-between mb-4">
                                   <div className="flex items-center gap-4 min-w-0 flex-1">
                                      <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-indigo-100 shadow-inner">{tidx + 1}</div>
                                      
                                      {tc.testCaseId && (
                                        <div className="bg-slate-900 text-white px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-[0.1em] flex-shrink-0 flex items-center gap-1 shadow-sm">
                                          <Hash size={10} /> {tc.testCaseId}
                                        </div>
                                      )}

                                      <h5 className="text-base font-bold text-black tracking-tight line-clamp-2 whitespace-normal flex-1 min-w-0 cursor-pointer" title={tc.title}>{tc.title}</h5>

                                      <div className="flex items-center gap-2 flex-shrink-0">
                                         <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border border-indigo-100 shadow-sm">{tc.testType?.toUpperCase()}</span>
                                         <span className={`${tc.testIntent === 'Positive' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'} px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border shadow-sm`}>{tc.testIntent?.toUpperCase()}</span>
                                         <span className={`text-[9px] font-black flex items-center gap-1 uppercase tracking-tighter ml-1 drop-shadow-sm ${tc.priority === 'High' ? 'text-red-500' : tc.priority === 'Medium' ? 'text-orange-500' : 'text-slate-500'}`}>
                                            <Zap size={10} fill="currentColor" /> {tc.priority?.toUpperCase()}
                                         </span>
                                      </div>
                                   </div>
                                   <div className="flex items-center gap-2 opacity-0 group-hover/case:opacity-100 transition-all">
                                      <button 
                                        onClick={() => handleOpenEditCase(scenario.id, tc)}
                                        className="p-2 text-slate-300 hover:text-indigo-600 transition-colors"
                                      >
                                        <Pencil size={16}/>
                                      </button>
                                      <button 
                                        onClick={() => setDeleteTarget({ type: 'testcase', scenarioId: scenario.id, testCaseId: tc.id, title: tc.title })}
                                        className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                                      >
                                        <Trash2 size={16}/>
                                      </button>
                                   </div>
                                </div>

                                <div className="ml-12 mb-6">
                                   <p className="text-sm font-bold text-indigo-600 leading-relaxed mb-5">
                                      <span className="uppercase tracking-[0.15em] opacity-80 mr-1.5 font-black">Expected:</span> {maskPasswordText(tc.expectedResult, scenario.password || password)}
                                   </p>
                                   <div className="space-y-2.5">
                                      {tc.steps.map((step, sidx) => (
                                         <div key={sidx} className="flex gap-4 text-xs text-slate-600 font-medium">
                                            <span className="text-slate-300 font-black w-4">{sidx + 1}.</span>
                                            <p className="flex-1 leading-relaxed">{maskPasswordText(step, scenario.password || password)}</p>
                                         </div>
                                      ))}
                                   </div>
                                </div>

                                {tc.testDataSets && tc.testDataSets.length > 0 && (
                                  <div className="ml-12 mt-10 bg-[#F9FAFF] rounded-[2rem] border border-slate-100 p-10 shadow-inner">
                                     <div className="flex items-center gap-3 mb-10">
                                        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100/50">
                                           <Database size={24} />
                                        </div>
                                        <h6 className="text-[11px] font-black text-slate-800 uppercase tracking-[0.3em]">Execution Test Data Sets</h6>
                                     </div>
                                     <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                        {tc.testDataSets.slice(0, 3).map((set, sIdx) => (
                                          <div key={sIdx} className="bg-white border border-slate-100 rounded-[1.8rem] p-8 shadow-sm group/set hover:border-indigo-200 hover:shadow-md transition-all">
                                             <div className="flex items-center justify-between mb-5">
                                                <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest border-b-2 border-indigo-50 pb-1">Set {sIdx + 1}</p>
                                             </div>
                                             <p className="text-[12px] text-slate-600 font-medium leading-relaxed font-mono break-words whitespace-pre-wrap">
                                                {maskPasswordText(set, scenario.password || password)}
                                             </p>
                                          </div>
                                        ))}
                                     </div>
                                  </div>
                                )}
                                {tidx < scenario.testCases.length - 1 && <div className="ml-12 mt-14 border-b border-slate-100/50 shadow-sm" />}
                             </div>
                           ))}
                        </div>
                        </>
                     ) : (
                        <div className="py-20 text-center bg-slate-50/30 border-2 border-dashed border-slate-100 rounded-[2rem] opacity-30">
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Awaiting AI Synthesis</p>
                        </div>
                     )}
                  </div>
                  );
               })()}
            </div>
          );
        })}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex flex-col md:flex-row items-center justify-between bg-white px-8 py-6 rounded-[2rem] border border-slate-200 shadow-sm gap-4">
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
             Showing {((currentPage - 1) * scenariosPerPage) + 1} - {Math.min(currentPage * scenariosPerPage, filteredScenarios.length)} of {filteredScenarios.length} {activeTab === 'folders' ? 'Folders' : 'Procedures'}
           </p>
           <div className="flex items-center gap-2">
              <button 
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 disabled:opacity-30 transition-all shadow-sm"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button 
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                    className={`w-10 h-10 rounded-xl text-[11px] font-black transition-all border ${currentPage === i + 1 ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <button 
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 disabled:opacity-30 transition-all shadow-sm"
              >
                <ChevronRight size={20} />
              </button>
           </div>
        </div>
      )}

      {/* Test Case Edit Modal */}
      {editingCaseId && editForm && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-4xl rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white animate-in zoom-in-95 duration-300">
              <div className="p-10 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-6">
                    <div className="p-5 bg-indigo-600 rounded-[1.5rem] text-white shadow-xl shadow-indigo-100">
                       <Edit3 size={32} />
                    </div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight leading-none">Update Testcase</h3>
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">Refine technical specifications & execution parameters</p>
                    </div>
                 </div>
                 <button onClick={() => setEditingCaseId(null)} className="p-3 text-slate-400 hover:text-slate-600 transition-all border border-transparent"><X size={32} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-12 space-y-10 custom-scrollbar bg-white">
                 <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-1.5"><Asterisk size={12} className="text-indigo-600" /> Title</label>
                    <input 
                      autoFocus
                      value={editForm.title || ''} 
                      onChange={e => setEditForm({...editForm, title: e.target.value})} 
                      className="w-full px-7 py-5 bg-slate-50 border border-slate-200 rounded-[1.8rem] text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner" 
                      placeholder="Test Case Title" 
                    />
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="space-y-3">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Type</label>
                       <div className="relative">
                          <select 
                            value={editForm.testType || ''} 
                            onChange={e => setEditForm({...editForm, testType: e.target.value as any})} 
                            className="w-full pl-6 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black uppercase outline-none appearance-none cursor-pointer hover:bg-white transition-all shadow-sm"
                          >
                             <option value="Functional">Functional</option>
                             <option value="Non-Functional">Non-Functional</option>
                             <option value="UI">UI / UX</option>
                          </select>
                          <ChevronDown size={14} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                       </div>
                    </div>
                    <div className="space-y-3">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Intent</label>
                       <div className="relative">
                          <select 
                            value={editForm.testIntent || ''} 
                            onChange={e => setEditForm({...editForm, testIntent: e.target.value as any})} 
                            className="w-full pl-6 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black uppercase outline-none appearance-none cursor-pointer hover:bg-white transition-all shadow-sm"
                          >
                             <option value="Positive">Positive</option>
                             <option value="Negative">Negative</option>
                          </select>
                          <ChevronDown size={14} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                       </div>
                    </div>
                    <div className="space-y-3">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Priority</label>
                       <div className="relative">
                          <select 
                            value={editForm.priority || ''} 
                            onChange={e => setEditForm({...editForm, priority: e.target.value as any})} 
                            className="w-full pl-6 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black uppercase outline-none appearance-none cursor-pointer hover:bg-white transition-all shadow-sm"
                          >
                             <option value="High">High</option>
                             <option value="Medium">Medium</option>
                             <option value="Low">Low</option>
                          </select>
                          <ChevronDown size={14} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                       </div>
                    </div>
                 </div>

                 <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-500" /> Expected Result</label>
                    <textarea 
                      value={editForm.expectedResult || ''} 
                      onChange={e => setEditForm({...editForm, expectedResult: e.target.value})} 
                      className="w-full h-32 px-8 py-6 bg-slate-50 border border-slate-200 rounded-[2rem] text-sm font-bold text-indigo-700 outline-none focus:ring-4 ring-indigo-50/5 transition-all resize-none shadow-inner" 
                      placeholder="Expected outcome..." 
                    />
                 </div>

                 <div className="space-y-6">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2"><List size={14} className="text-indigo-400" /> Execution Steps</label>
                    <div className="space-y-1">
                       {/* Insert at beginning */}
                       <div className="relative h-6 group/insert flex items-center justify-center ml-16">
                          <div className="absolute inset-x-0 h-px bg-indigo-100 opacity-0 group-hover/insert:opacity-100 transition-opacity" />
                          <button 
                            onClick={() => {
                              const next = ['', ...editForm.steps];
                              setEditForm({...editForm, steps: next});
                            }}
                            className="relative z-10 p-1 bg-indigo-600 text-white rounded-full shadow-sm opacity-0 group-hover/insert:opacity-100 transition-all scale-75 group-hover/insert:scale-100"
                            title="Insert step at beginning"
                          >
                            <Plus size={12} strokeWidth={4} />
                          </button>
                       </div>

                       {editForm.steps.map((step, sidx) => (
                          <React.Fragment key={sidx}>
                             <div className="flex gap-4 group/step">
                                <div className="w-12 h-14 flex items-center justify-center text-xs font-black text-slate-400 bg-slate-50 rounded-2xl border border-slate-100 shadow-inner flex-shrink-0">{sidx + 1}</div>
                                <div className="flex-1 relative group">
                                   <input 
                                     value={step || ''} 
                                     onChange={e => { const next = [...editForm.steps]; next[sidx] = e.target.value; setEditForm({...editForm, steps: next}); }} 
                                     className="w-full px-6 py-4 bg-white border border-slate-200 rounded-2xl text-xs font-medium outline-none focus:ring-4 ring-indigo-50 transition-all shadow-sm" 
                                   />
                                   <button 
                                     onClick={() => setEditForm({...editForm, steps: editForm.steps.filter((_, i) => i !== sidx)})} 
                                     className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-rose-500 transition-all p-2 hover:bg-rose-50 rounded-xl opacity-0 group-hover:opacity-100"
                                   >
                                      <X size={16}/>
                                   </button>
                                </div>
                             </div>
                             
                             {/* Insert after this step */}
                             <div className="relative h-6 group/insert flex items-center justify-center ml-16">
                                <div className="absolute inset-x-0 h-px bg-indigo-100 opacity-0 group-hover/insert:opacity-100 transition-opacity" />
                                <button 
                                  onClick={() => {
                                    const next = [...editForm.steps];
                                    next.splice(sidx + 1, 0, '');
                                    setEditForm({...editForm, steps: next});
                                  }}
                                  className="relative z-10 p-1 bg-indigo-600 text-white rounded-full shadow-sm opacity-0 group-hover/insert:opacity-100 transition-all scale-75 group-hover/insert:scale-100"
                                  title="Insert step here"
                                >
                                  <Plus size={12} strokeWidth={4} />
                                </button>
                             </div>
                          </React.Fragment>
                       ))}
                    </div>
                    <button onClick={() => setEditForm({...editForm, steps: [...editForm.steps, '']})} className="flex items-center gap-3 text-[11px] font-black uppercase text-indigo-600 hover:text-indigo-800 ml-16 transition-all px-4 py-2 hover:bg-indigo-50 rounded-xl w-fit"><Plus size={16} strokeWidth={3} /> Append New Step</button>
                 </div>

                 <div className="space-y-6 pt-6 border-t border-slate-100">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2"><DatabaseZap size={14} className="text-indigo-600" /> Test Data Sets</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                       {[0, 1, 2].map((idx) => (
                          <div key={idx} className="space-y-3">
                             <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest ml-2">Set {idx + 1}</p>
                             <textarea 
                                value={editForm.testDataSets?.[idx] || ''} 
                                onChange={e => {
                                   const nextData = [...(editForm.testDataSets || ['', '', ''])];
                                   nextData[idx] = e.target.value;
                                   setEditForm({...editForm, testDataSets: nextData});
                                }} 
                                className="w-full h-24 px-5 py-4 bg-white border border-slate-200 rounded-2xl text-xs font-mono font-medium outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner" 
                                placeholder={`Data Set ${idx + 1}...`} 
                             />
                          </div>
                       ))}
                    </div>
                 </div>
              </div>

              <div className="p-10 bg-white border-t border-slate-100 flex gap-5">
                 <button onClick={handleSaveEditCase} className="flex-1 py-5 bg-indigo-600 text-white rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-2xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-3"><Save size={20} /> Update</button>
                 <button onClick={() => setEditingCaseId(null)} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200 active:scale-95 transition-all">Cancel Operation</button>
              </div>
           </div>
        </div>
      )}

      {/* Bulk Progress Overlay */}
      {bulkProgress.active && (
        <div className="fixed inset-0 z-[5000] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
           <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl overflow-hidden relative border border-white">
              {/* Top Right Close / Cancel Button */}
              <button 
                onClick={() => {
                  bulkCancelledRef.current = true;
                  setBulkProgress(prev => ({ ...prev, status: 'Cancelling bulk generation...' }));
                }}
                className="absolute top-6 right-6 p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-all border border-slate-100 shadow-sm cursor-pointer"
                title="Cancel Generation"
              >
                <X size={20} />
              </button>

              <div className="flex items-center gap-5 mb-8 pr-10">
                 <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg animate-pulse">
                    <Sparkles size={28} />
                 </div>
                 <div>
                    <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">AI TEST CASES GENERATION</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Multi-scenario processing active</p>
                 </div>
              </div>

              <div className="space-y-6">
                 <div className="flex justify-between items-end px-1">
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] truncate max-w-[80%]">{bulkProgress.status}</span>
                    <span className="text-xs font-black text-slate-400">{Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</span>
                 </div>
                 
                 <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200 p-0.5">
                    <div 
                        className="h-full bg-indigo-600 rounded-full transition-all duration-700 shadow-[0_0_10px_rgba(79,70,229,0.4)]" 
                        style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                    />
                 </div>

                 {bulkProgress.errors.length > 0 && (
                    <div className="bg-slate-50 rounded-2xl p-4 border border-rose-100 max-h-40 overflow-y-auto custom-scrollbar">
                        <div className="space-y-2">
                           <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><AlertCircle size={12}/> Failure Logs</p>
                           {bulkProgress.errors.map((err, i) => (
                               <p key={i} className="text-[10px] text-rose-400 font-medium leading-relaxed">• {err}</p>
                           ))}
                        </div>
                    </div>
                 )}

                 <div className="text-center">
                    <p className="text-[11px] font-black text-emerald-600 uppercase tracking-[0.3em]">Processing {bulkProgress.current} of {bulkProgress.total} Scenarios</p>
                 </div>

                 {/* Cancel Button */}
                 <div className="pt-2">
                    <button
                      onClick={() => {
                        bulkCancelledRef.current = true;
                        setBulkProgress(prev => ({ ...prev, status: 'Cancelling bulk generation...' }));
                      }}
                      className="w-full py-3.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/80 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <XCircle size={18} /> Cancel Bulk Generation
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Overwrite Confirmation Modal */}
      {showOverwriteModal && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-md rounded-[3rem] p-10 text-center shadow-2xl border border-white">
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-8 text-amber-500">
               <AlertTriangle size={40} />
            </div>
            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-4">Existing Test Cases Detected</h3>
            <p className="text-sm text-slate-500 font-medium leading-relaxed mb-10 px-4">
                Some selected scenarios already contain generated test cases. How should the AI proceed with these items?
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                    if (pendingIndividualScenario) {
                        executeSingleGeneration(pendingIndividualScenario);
                        setShowOverwriteModal(false);
                        setPendingIndividualScenario(null);
                    } else {
                        startBulkGeneration(true);
                    }
                }} 
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl"
              >
                Regenerate All (Overwrite)
              </button>
              {!pendingIndividualScenario && (
                  <button 
                    onClick={() => startBulkGeneration(false)} 
                    className="w-full py-4 bg-white text-indigo-600 border-2 border-indigo-50 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-50"
                  >
                    Synthesize Only New (Skip)
                  </button>
              )}
              <button onClick={() => setShowOverwriteModal(false)} className="w-full py-4 bg-slate-50 text-slate-400 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-100">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Folder Modal */}
      {isFolderModalOpen && (
        <div className="fixed inset-0 z-[2000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-white">
             <div className="p-10 bg-white flex items-center justify-between">
                <div className="flex items-center gap-5">
                   <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-600 shadow-sm border border-indigo-100"><FolderPlus size={28} /></div>
                   <div>
                      <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">{editingFolderId ? 'Add Test cases to Folder' : 'CREATE FOLDER'}</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">ORGANIZE TEST CASES INDEPENDENTLY</p>
                   </div>
                </div>
                <button onClick={() => setIsFolderModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-all"><X size={24} /></button>
             </div>
             
             <div className="flex-1 overflow-y-auto px-10 pb-6 space-y-6 custom-scrollbar">
                <div className="space-y-3">
                   <input 
                     value={newFolderName || ''} 
                     onChange={e => { setNewFolderName(e.target.value); setFolderError(null); }} 
                     className={`w-full px-7 py-5 bg-slate-50 border rounded-[1.2rem] text-sm font-black outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner ${folderError ? 'border-rose-300' : 'border-slate-100'}`} 
                     placeholder="Folder Name" 
                   />
                </div>
                
                <button 
                  onClick={handleSelectAllInModal} 
                  className="w-full flex items-center gap-4 px-6 py-4 bg-slate-50 border border-slate-100 rounded-xl transition-all hover:bg-slate-100 group"
                >
                  <div className={selectedCaseRefs.size === allAvailableCases.length ? 'text-indigo-600' : 'text-slate-300'}>
                      {selectedCaseRefs.size === allAvailableCases.length ? <CheckSquare size={24} /> : <Square size={24} />}
                  </div>
                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                      SELECT ALL CASES ({allAvailableCases.length})
                  </span>
                </button>

                <div className="max-h-72 overflow-y-auto rounded-[1.5rem] border border-slate-100 p-3 custom-scrollbar space-y-2 bg-white shadow-inner">
                   {allAvailableCases.map(tc => (
                      <div 
                        key={tc.uniqueRef} 
                        onClick={() => { const next = new Set(selectedCaseRefs); if (next.has(tc.uniqueRef)) next.delete(tc.uniqueRef); else next.add(tc.uniqueRef); setSelectedCaseRefs(next); setFolderError(null); }} 
                        className={`flex items-center gap-5 p-5 rounded-2xl border transition-all cursor-pointer ${selectedCaseRefs.has(tc.uniqueRef) ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-50' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
                      >
                         <div className={`transition-all ${selectedCaseRefs.has(tc.uniqueRef) ? 'text-indigo-600 scale-110' : 'text-slate-200'}`}>
                            {selectedCaseRefs.has(tc.uniqueRef) ? <CheckSquare size={28} /> : <Square size={28} />}
                         </div>
                         <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2" title={tc.title}>
                               <p className="text-xs font-black text-slate-800 uppercase tracking-tight line-clamp-2 whitespace-normal leading-tight w-full cursor-pointer">{tc.title}</p>
                            </div>
                            <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5 tracking-widest truncate" title={tc.parentScenarioTitle}>{tc.parentScenarioTitle}</p>
                         </div>
                      </div>
                   ))}
                   {allAvailableCases.length === 0 && (
                     <div className="p-12 text-center">
                        <Database size={32} className="text-slate-200 mx-auto mb-4" />
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] italic">Repository Context Empty</p>
                     </div>
                   )}
                </div>
                {folderError && <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-[10px] font-black tracking-widest flex items-center gap-3 animate-in shake duration-500"><AlertTriangle size={16}/> {folderError}</div>}
             </div>
             
             <div className="p-10 bg-white border-t border-slate-100 flex gap-4">
                <button onClick={handleSaveFolder} className="flex-1 py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95 transition-all">SAVE FOLDER</button>
                <button onClick={() => setIsFolderModalOpen(false)} className="flex-1 py-5 bg-slate-50 text-slate-500 rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-all">CANCEL</button>
             </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
           <div className="bg-white w-full max-sm rounded-[3rem] p-10 text-center shadow-2xl animate-in zoom-in-95 border border-white">
              <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-8 text-rose-500 shadow-inner">
                 <AlertTriangle size={40} />
              </div>
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-4 leading-tight">Delete Confirm</h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed mb-10 px-4">
                {deleteTarget.type === 'testcase' 
                  ? `Permanently delete the test case "${deleteTarget.title}"?`
                  : deleteTarget.type === 'bulk_scenario'
                  ? `Permanently delete ${deleteTarget.scenarioIds?.length} selected scenarios?`
                  : `Permanently delete this scenario and all its test cases?`
                }
                This operation is final.
              </p>
              <div className="flex flex-col gap-3">
                 <button onClick={executeDeletion} className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-700 shadow-lg shadow-rose-100 active:scale-95 transition-all">Delete / Continue</button>
                 <button onClick={() => setDeleteTarget(null)} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {/* Save Prompt Modal */}
      {showSavePromptModal && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
           <div className="bg-white w-full max-w-xl rounded-[3rem] p-10 text-center shadow-2xl border border-white">
              <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-8 text-indigo-600 shadow-inner">
                 <Sparkles size={40} />
              </div>
              <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-4 animate-bounce">AI Test Cases Generated!</h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed mb-10 px-4">
                 Your AI-synthesized test cases are ready. Would you like to save them into a folder for structured organization and future execution?
              </p>
              <div className="flex flex-col gap-3">
                 <button 
                   onClick={() => {
                     setShowSavePromptModal(false);
                     setShowSaveFolderSelectModal(true);
                   }} 
                   className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-100 active:scale-95 transition-all"
                 >
                    Yes, Save to Folder
                 </button>
                 <button 
                   onClick={() => {
                     setShowSavePromptModal(false);
                     setSessionGeneratedItems([]);
                     toast.info("Generated test cases discarded.");
                   }} 
                   className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
                 >
                    Discard Test Cases
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Folder Selection & Review Dialog */}
      {showSaveFolderSelectModal && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-white">
             
             {/* Header */}
             <div className="p-10 bg-white border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-5">
                   <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-600 shadow-sm border border-indigo-100">
                      <FolderPlus size={28} />
                   </div>
                   <div>
                      <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Save Test Cases to Folder</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Review cases and assign to a folder suite</p>
                   </div>
                </div>
                <button 
                  onClick={() => {
                    setShowSaveFolderSelectModal(false);
                    setSessionGeneratedItems([]);
                  }} 
                  className="p-2 text-slate-400 hover:text-slate-600 transition-all"
                >
                   <X size={24} />
                </button>
             </div>
             
             {/* Scrollable Content */}
             <div className="flex-1 overflow-y-auto px-10 pb-6 space-y-8 custom-scrollbar">
                
                {/* Folder Selection Section */}
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Assign to Folder</label>
                  
                  {!showCreateFolderInline ? (
                    <div className="flex gap-4">
                      <div className="relative flex-1">
                        <select 
                          value={selectedFolderIdForSave || ''}
                          onChange={e => setSelectedFolderIdForSave(e.target.value)}
                          className="w-full pl-12 pr-10 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase outline-none appearance-none cursor-pointer hover:bg-white transition-all shadow-sm text-slate-600"
                        >
                          <option value="">-- Choose Existing Folder --</option>
                          {availableModules.map(m => (
                            <option key={m.id} value={m.id}>{m.title}</option>
                          ))}
                        </select>
                        <Folder size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-indigo-500" />
                        <ChevronDown size={14} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          setShowCreateFolderInline(true);
                          setSelectedFolderIdForSave('');
                        }}
                        className="px-6 py-4 bg-indigo-50 text-indigo-600 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-indigo-100 hover:bg-indigo-100 transition-all shadow-sm flex items-center gap-2"
                      >
                        <Plus size={14} strokeWidth={3} /> New Folder
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex gap-4">
                        <input 
                          autoFocus
                          value={inlineNewFolderName || ''} 
                          onChange={e => { setInlineNewFolderName(e.target.value); setInlineFolderError(null); }} 
                          className={`flex-1 px-6 py-4 bg-slate-50 border rounded-2xl text-sm font-bold outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner text-slate-800 ${inlineFolderError ? 'border-rose-300' : 'border-slate-200'}`} 
                          placeholder="Enter New Folder Name" 
                        />
                        <button 
                          type="button"
                          onClick={() => {
                            setShowCreateFolderInline(false);
                            setInlineNewFolderName('');
                            setInlineFolderError(null);
                          }}
                          className="px-6 py-4 bg-slate-100 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center"
                        >
                          Cancel
                        </button>
                      </div>
                      {inlineFolderError && (
                        <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mt-1 ml-1">{inlineFolderError}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Review Test Cases Header */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-6">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Review Generated Cases</span>
                  
                  {/* Select All Toggle */}
                  <button 
                    type="button"
                    onClick={() => {
                      const totalCasesCount = sessionGeneratedItems.reduce((acc, item) => acc + item.testCases.length, 0);
                      if (sessionSelectedCaseRefs.size === totalCasesCount) {
                        setSessionSelectedCaseRefs(new Set());
                      } else {
                        const nextRefs = new Set<string>();
                        sessionGeneratedItems.forEach(item => {
                          item.testCases.forEach(tc => nextRefs.add(`${item.scenario.id}|${tc.id}`));
                        });
                        setSessionSelectedCaseRefs(nextRefs);
                      }
                    }}
                    className="text-[10px] font-black text-indigo-600 uppercase tracking-wider hover:underline"
                  >
                    {sessionSelectedCaseRefs.size === sessionGeneratedItems.reduce((acc, item) => acc + item.testCases.length, 0) 
                      ? 'Deselect All' 
                      : 'Select All'
                    }
                  </button>
                </div>

                {/* Cases List */}
                <div className="max-h-80 overflow-y-auto rounded-[2rem] border border-slate-100 p-4 custom-scrollbar space-y-4 bg-slate-50/30 shadow-inner">
                  {sessionGeneratedItems.map(item => (
                    <div key={item.scenario.id} className="space-y-3">
                      <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                        <Layers size={12} className="text-indigo-600" />
                        <span className="text-[10px] font-black text-indigo-950 uppercase tracking-wider">{item.scenario.title}</span>
                      </div>

                      {/* Display Separate Input Document and Screenshot Artifacts */}
                      {((item.scenario as any).docContent || (item.scenario.attachments && item.scenario.attachments.length > 0)) && (
                        <div className="p-4 bg-white border border-indigo-100 rounded-2xl space-y-3 shadow-sm">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block border-b border-slate-100 pb-1">
                            Input Context Artifacts
                          </span>

                          {(item.scenario as any).docContent && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 text-slate-700">
                                <Paperclip size={12} className="text-indigo-600" />
                                <span className="text-[10px] font-bold font-mono text-indigo-800 uppercase">
                                  Document: {(item.scenario as any).docFileName || 'Requirements File'}
                                </span>
                              </div>
                              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl max-h-32 overflow-y-auto text-[10px] font-mono text-slate-600 whitespace-pre-wrap custom-scrollbar">
                                {sanitizeAndExtractDocContent((item.scenario as any).docContent, (item.scenario as any).docFileName || '')}
                              </div>
                            </div>
                          )}

                          {item.scenario.attachments && item.scenario.attachments.length > 0 && (
                            <div className="pt-1">
                              <ScreenshotGallery
                                images={item.scenario.attachments}
                                title={`Input Screenshots (${item.scenario.attachments.length})`}
                                compact
                              />
                            </div>
                          )}
                        </div>
                      )}
                      
                      <div className="space-y-2 pl-2">
                        {item.testCases.map(tc => {
                          const ref = `${item.scenario.id}|${tc.id}`;
                          const isSelected = sessionSelectedCaseRefs.has(ref);
                          return (
                            <div 
                              key={tc.id}
                              onClick={() => {
                                const next = new Set(sessionSelectedCaseRefs);
                                if (next.has(ref)) next.delete(ref);
                                else next.add(ref);
                                setSessionSelectedCaseRefs(next);
                              }}
                              className={`flex items-start gap-4 p-4 rounded-2xl border transition-all cursor-pointer bg-white ${isSelected ? 'border-indigo-500 shadow-md ring-1 ring-indigo-50' : 'border-slate-100 hover:border-slate-200'}`}
                            >
                              <div className={`mt-0.5 transition-all ${isSelected ? 'text-indigo-600 scale-105' : 'text-slate-200'}`}>
                                {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <h6 className="text-xs font-bold text-slate-800 uppercase tracking-tight line-clamp-1">{tc.title}</h6>
                                <p className="text-[9px] text-indigo-500 font-bold uppercase mt-1 tracking-wider">
                                  {tc.testType?.toUpperCase()} • {tc.testIntent?.toUpperCase()} • {tc.priority?.toUpperCase()}
                                </p>
                                {(tc.attachments || item.scenario.attachments) && (
                                  <ScreenshotGallery
                                    images={tc.attachments && tc.attachments.length > 0 ? tc.attachments : item.scenario.attachments}
                                    title="Attached Screenshots"
                                    compact
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

             </div>

             {/* Footer Actions */}
             <div className="p-10 bg-white border-t border-slate-100 flex gap-4">
                <button 
                  onClick={handleConfirmSaveToFolder} 
                  className="flex-1 py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95 transition-all"
                >
                   Confirm Save
                </button>
                <button 
                  onClick={() => {
                    setShowSaveFolderSelectModal(false);
                    setSessionGeneratedItems([]);
                  }} 
                  className="flex-1 py-5 bg-slate-50 text-slate-500 rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-all"
                >
                   Cancel
                </button>
             </div>

          </div>
        </div>
      )}

      {/* Move Scenario to Folder Modal */}
      {showMoveModal && moveTargetScenario && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-white">
            {/* Header */}
            <div className="p-8 bg-white border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600 shadow-sm border border-indigo-100">
                  <FolderPlus size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Move Scenario to Folder</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Assign scenario & test cases to a suite folder</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowMoveModal(false);
                  setMoveTargetScenario(null);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 space-y-6">
              <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Scenario Title</span>
                <h5 className="text-xs font-bold text-slate-800 uppercase tracking-tight">{moveTargetScenario.title}</h5>
                {moveTargetScenario.attachments && moveTargetScenario.attachments.length > 0 && (
                  <ScreenshotGallery images={moveTargetScenario.attachments} compact title="Attached Screenshots" />
                )}
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Select Destination Folder</label>
                {!showCreateMoveFolderInline ? (
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <select
                        value={moveFolderId || ''}
                        onChange={e => setMoveFolderId(e.target.value)}
                        className="w-full pl-12 pr-10 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase outline-none appearance-none cursor-pointer hover:bg-white transition-all shadow-sm text-slate-600"
                      >
                        <option value="">-- Choose Target Folder --</option>
                        {availableModules.map(m => (
                          <option key={m.id} value={m.id}>{m.title}</option>
                        ))}
                      </select>
                      <Folder size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-500" />
                      <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateMoveFolderInline(true);
                        setMoveFolderId('');
                      }}
                      className="px-5 py-3.5 bg-indigo-50 text-indigo-600 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-indigo-100 hover:bg-indigo-100 transition-all shadow-sm flex items-center gap-1.5"
                    >
                      <Plus size={14} strokeWidth={3} /> New Folder
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter new folder name..."
                        value={moveInlineNewFolderName || ''}
                        onChange={e => {
                          setMoveInlineNewFolderName(e.target.value);
                          setMoveInlineFolderError(null);
                        }}
                        className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold focus:bg-white outline-none shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateMoveFolderInline(false);
                          setMoveInlineNewFolderName('');
                          setMoveInlineFolderError(null);
                        }}
                        className="px-4 py-3 bg-slate-100 text-slate-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200"
                      >
                        Cancel
                      </button>
                    </div>
                    {moveInlineFolderError && (
                      <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest ml-1">{moveInlineFolderError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowMoveModal(false);
                  setMoveTargetScenario(null);
                }}
                className="px-6 py-3.5 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMoveScenario}
                className="px-8 py-3.5 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95 flex items-center gap-2"
              >
                <FolderPlus size={16} /> Confirm Move
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TestCaseManager;