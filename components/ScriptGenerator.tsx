import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Project, ScriptConfig, AutomationScript, TestCase, TestStatus, User } from '../types';
import { toast } from 'sonner';
import { 
  Code2, 
  Cpu, 
  Lock, 
  X, 
  Terminal, 
  Download, 
  Loader2, 
  CheckSquare, 
  Square, 
  CheckCircle2, 
  Trash2, 
  Zap, 
  AlertTriangle, 
  ChevronDown, 
  ChevronRight,
  MonitorPlay,
  RotateCcw,
  ArrowLeft,
  ArrowRight as ArrowRightIcon,
  Crosshair,
  ShieldAlert,
  Fingerprint,
  CirclePlay,
  Keyboard,
  MousePointer,
  Info,
  ExternalLink,
  Navigation,
  Link2, 
  ShieldCheck,
  LayoutGrid,
  FileCode,
  Copy,
  History,
  Play,
  Eye,
  EyeOff,
  Settings2,
  Search,
  Plus,
  Check,
  Database,
  User as UserIcon,
  Sparkles,
  Smartphone,
  BookOpen,
  MousePointer2,
  Settings,
  Pencil,
  Folder,
  Clock,
  Save,
  CheckCircle,
  Activity,
  Paperclip,
  FileVideo,
  ImageIcon,
  Calendar,
  Upload,
  Maximize2,
  ChevronUp,
  RefreshCw,
  FolderUp,
  FileArchive
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { analyzeTestIntent, analyzeLocatorsAndActions, generateFinalPomScript, generateAutomationScript, refineAutomationScript, appendToAutomationScript } from '../geminiService';
import { logActivity } from '../services/activityService';
import { ragEnrichPrompt, indexSingleItem } from '../services/ragService';
import { RAGStatusBadge } from './RAGStatusBadge';
import { VectorSearchResult } from '../types';
import { ScreenshotUploader, ScreenshotFile } from './ScreenshotUploader';
import { GithubPushModal } from './GithubPushModal';
import { JiraBugModal } from './JiraBugModal';
import { JiraSyncModal } from './JiraSyncModal';
import { Github } from 'lucide-react';

interface ScriptGeneratorProps {
  project: Project;
  user: User;
  onUpdateProject: (p: Project) => void;
  viewOnly?: boolean;
}

interface CapturedAction {
    id: string;
    type: 'click' | 'fill' | 'hover' | 'press' | 'select' | 'assert' | 'navigate';
    description: string;
    code: string;
    inputValue?: string;
    timestamp: string;
}

type WorkflowStep = 'config' | 'parsing' | 'capture' | 'review' | 'generating';
type SubPage = 'repository' | 'recorder';

const VALID_FRAMEWORK_LANGUAGES: Record<string, ('TypeScript' | 'JavaScript' | 'Python' | 'Java')[]> = {
  Playwright: ['TypeScript', 'JavaScript', 'Python', 'Java'],
  Selenium: ['Java', 'Python', 'JavaScript', 'TypeScript'],
  Cypress: ['TypeScript', 'JavaScript'],
  Appium: ['Java', 'Python', 'JavaScript', 'TypeScript']
};

const PROXY_SERVICE = "https://api.allorigins.win/raw?url=";

const ScriptGenerator: React.FC<ScriptGeneratorProps> = ({ project, user, onUpdateProject, viewOnly = false }) => {
  const [activeSubPage, setActiveSubPage] = useState<SubPage>('repository');
  const [githubPushScript, setGithubPushScript] = useState<AutomationScript | null>(null);
  const [jiraBugScript, setJiraBugScript] = useState<AutomationScript | null>(null);
  const [jiraSyncScript, setJiraSyncScript] = useState<AutomationScript | null>(null);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('config');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCopied, setIsCopied] = useState<string | null>(null);

  const [selectionTab, setSelectionTab] = useState<'individual' | 'folders' | 'importedFolders' | 'scriptFolders'>('individual');
  const [config, setConfig] = useState<ScriptConfig>({ tool: 'Playwright', language: 'TypeScript' });
  const [appUrl, setAppUrl] = useState('');
  const [appPackage, setAppPackage] = useState('');
  const [emailContext, setEmailContext] = useState('');
  const [passwordContext, setPasswordContext] = useState('');
  const [architecturalInstructions, setArchitecturalInstructions] = useState('');
  const [ragEnabled, setRagEnabled] = useState(true);
  const [retrievedRagChunks, setRetrievedRagChunks] = useState<VectorSearchResult[]>([]);
  
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [selectedLocatorIds, setSelectedLocatorIds] = useState<Set<string>>(new Set());

  const [currentRecordingUrl, setCurrentRecordingUrl] = useState('');
  const [capturedActions, setCapturedActions] = useState<CapturedAction[]>([]);
  const [locatorAnalysis, setLocatorAnalysis] = useState<any[]>([]);
  const [hasConfirmedReview, setHasConfirmedReview] = useState(false);
  
  const [isAssertionMode, setIsAssertionMode] = useState(false);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [scriptSearch, setScriptSearch] = useState('');
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editScriptContent, setEditScriptContent] = useState('');
  const [visibleCodeIds, setVisibleCodeIds] = useState<Set<string>>(new Set());
  const [refinementInputs, setRefinementInputs] = useState<Record<string, string>>({});
  const [isRefining, setIsRefining] = useState<Record<string, boolean>>({});

  // Evidence Modal State for Automation Scripts
  const [evidenceModalScript, setEvidenceModalScript] = useState<AutomationScript | null>(null);
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview Media State
  const [previewMedia, setPreviewMedia] = useState<{ url: string, type: 'image' | 'video', scriptId?: string } | null>(null);

  // Folder Scripts Modal State
  const [folderScriptsModal, setFolderScriptsModal] = useState<{ folderId: string, name: string } | null>(null);

  // Append Script Modal State
  const [appendModalScript, setAppendModalScript] = useState<AutomationScript | null>(null);
  const [selectedAppendItemIds, setSelectedAppendItemIds] = useState<Set<string>>(new Set());
  const [selectedAppendFolderIds, setSelectedAppendFolderIds] = useState<Set<string>>(new Set());
  const [selectedAppendScriptIds, setSelectedAppendScriptIds] = useState<Set<string>>(new Set());
  const [isAppending, setIsAppending] = useState(false);

  // Delete Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'script' | 'scenario' | 'folder' | 'locator', id: string, name: string } | null>(null);

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isGeneratedScriptSaved, setIsGeneratedScriptSaved] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState<Record<string, { content: string, titles: string[] }>>({});
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [selectedScriptFolderId, setSelectedScriptFolderId] = useState<string | null>(null);
  const [isCreatingNewFolder, setIsCreatingNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [searchFolderQuery, setSearchFolderQuery] = useState('');
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scriptScreenshots, setScriptScreenshots] = useState<ScreenshotFile[]>([]);
  const [isImportingZip, setIsImportingZip] = useState(false);
  const [targetCasesForSave, setTargetCasesForSave] = useState<any[]>([]);

  // Redesign States
  const [isScreenshotExpanded, setIsScreenshotExpanded] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testCaseSearch, setTestCaseSearch] = useState('');
  const [previewScreenshotModal, setPreviewScreenshotModal] = useState<ScreenshotFile | null>(null);

  const importScriptInputRef = useRef<HTMLInputElement>(null);
  const importZipInputRef = useRef<HTMLInputElement>(null);
  const screenshotFileInputRef = useRef<HTMLInputElement>(null);
  const replaceScreenshotFileInputRef = useRef<HTMLInputElement>(null);

  // Reset screenshots, selections, and generated scripts when project changes
  useEffect(() => {
    setScriptScreenshots([]);
    setSelectedItemIds(new Set());
    setSelectedFolderIds(new Set());
    setSelectedLocatorIds(new Set());
    setGeneratedContent(null);
    if (importScriptInputRef.current) {
      importScriptInputRef.current.value = '';
    }
    if (importZipInputRef.current) {
      importZipInputRef.current.value = '';
    }
    if (screenshotFileInputRef.current) {
      screenshotFileInputRef.current.value = '';
    }
    if (replaceScreenshotFileInputRef.current) {
      replaceScreenshotFileInputRef.current.value = '';
    }
  }, [project.id]);

  // Folder Modal States
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [folderTitle, setFolderTitle] = useState('');
  const [folderDescription, setFolderDescription] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);

  const individualItems = useMemo(() => {
    const aiItems = project.scenarios
      .filter(s => 
        s.isApproved && 
        !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId) &&
        s.moduleName !== 'API Testing' &&
        !s.isApiScenario &&
        (!s.scenarioId || !s.scenarioId.startsWith('API-'))
      )
      .map(s => {
        const enrichedCases = (s.testCases && s.testCases.length > 0)
          ? s.testCases.map((tc, idx) => ({
              ...tc,
              testCaseId: tc.testCaseId || `TC-${idx + 1}`,
              scenarioTitle: s.title,
              scenarioDescription: s.description,
              moduleName: s.moduleName || 'AI Repository',
              userStoryNumber: s.userStoryNumber || tc.userStoryId,
              userStorySummary: s.userStorySummary,
              expectedResult: tc.expectedResult || s.expectedResults || 'Action should succeed as expected',
              steps: (tc.steps && tc.steps.length > 0) ? tc.steps : (s.description ? [s.description] : [tc.title])
            }))
          : [{
              id: s.id,
              testCaseId: s.scenarioId || 'TC-01',
              title: s.title,
              description: s.description,
              steps: s.description ? [s.description] : [s.title],
              expectedResult: s.expectedResults || 'Action should succeed as expected',
              status: TestStatus.PENDING,
              scenarioTitle: s.title,
              scenarioDescription: s.description,
              moduleName: s.moduleName || 'AI Repository',
              userStoryNumber: s.userStoryNumber,
              userStorySummary: s.userStorySummary
            }];

        return { 
          id: s.id, 
          title: s.title, 
          subtitle: s.moduleName || 'AI Repository', 
          source: 'AI', 
          cases: enrichedCases 
        };
      });
    
    const manualItems = (project.manualTestCases || [])
      .filter(c => c.isApproved)
      .map((c, idx) => ({ 
        id: c.id, 
        title: c.title, 
        subtitle: 'Functional Repository', 
        source: 'MANUAL', 
        cases: [{
          ...c,
          testCaseId: c.testCaseId || `MTC-${idx + 1}`,
          scenarioTitle: c.title,
          moduleName: 'Functional Repository',
          expectedResult: c.expectedResult || 'Action should complete successfully',
          steps: (c.steps && c.steps.length > 0) ? c.steps : (c.description ? [c.description] : [c.title])
        }] 
      }));

    return [...aiItems, ...manualItems];
  }, [project.scenarios, project.manualTestCases]);

  const filteredIndividualItems = useMemo(() => {
    if (!testCaseSearch.trim()) return individualItems;
    const q = testCaseSearch.toLowerCase();
    return individualItems.filter(item => 
      item.title.toLowerCase().includes(q) || 
      item.subtitle.toLowerCase().includes(q)
    );
  }, [individualItems, testCaseSearch]);

  const folderItems = useMemo(() => {
    return project.scenarios
      .filter(s => 
        ['TESTCASE_FOLDER', 'MANUAL_FOLDER'].includes(s.scenarioId) &&
        s.moduleName !== 'API Testing' &&
        !s.isApiScenario &&
        (!s.scenarioId || !s.scenarioId.startsWith('API-'))
      )
      .map(s => ({ 
        id: s.id, 
        title: s.title, 
        subtitle: s.scenarioId === 'TESTCASE_FOLDER' ? 'AI Execution Folder' : 'Functional Execution Folder', 
        source: s.scenarioId === 'TESTCASE_FOLDER' ? 'AI' : 'MANUAL', 
        cases: (s.testCases || []).map((tc, idx) => ({
          ...tc,
          testCaseId: tc.testCaseId || `TC-${idx + 1}`,
          scenarioTitle: s.title,
          moduleName: s.title,
          expectedResult: tc.expectedResult || 'Action should succeed as expected',
          steps: (tc.steps && tc.steps.length > 0) ? tc.steps : (tc.description ? [tc.description] : [tc.title])
        }))
      }));
  }, [project.scenarios]);

  const filteredFolderItems = useMemo(() => {
    if (!testCaseSearch.trim()) return folderItems;
    const q = testCaseSearch.toLowerCase();
    return folderItems.filter(f => 
      f.title.toLowerCase().includes(q) || 
      f.subtitle.toLowerCase().includes(q)
    );
  }, [folderItems, testCaseSearch]);

  const handleScreenshotFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validImageFiles = fileArray.filter(file => 
      file.type.startsWith('image/') || 
      /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name)
    );

    if (validImageFiles.length === 0) {
      toast.error("Please select a valid image file (PNG, JPG, JPEG, WEBP, GIF, SVG)");
      return;
    }

    const file = validImageFiles[0]; // Restrict to single screenshot
    try {
      const screenshot = await new Promise<ScreenshotFile>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const mimeType = file.type || 'image/png';
          const base64Data = result.split(',')[1] || '';
          resolve({
            id: Math.random().toString(36).substring(2, 9),
            name: file.name,
            data: base64Data,
            mimeType: mimeType,
            previewUrl: result,
            size: file.size
          });
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });

      setScriptScreenshots([screenshot]);
      toast.success(`Attached screenshot: ${file.name}`);
    } catch (e) {
      console.error("Failed to read image", e);
      toast.error("Failed to read image file");
    }
  };

  const handleReplaceScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const mimeType = file.type || 'image/png';
          const base64Data = result.split(',')[1] || '';
          const replacedScreenshot: ScreenshotFile = {
            id: Math.random().toString(36).substring(2, 9),
            name: file.name,
            data: base64Data,
            mimeType: mimeType,
            previewUrl: result,
            size: file.size
          };
          setScriptScreenshots([replacedScreenshot]);
          toast.success(`Screenshot replaced with ${file.name}`);
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error("Failed to replace screenshot", err);
      }
      e.target.value = '';
    }
  };

  const handleRemoveScreenshots = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setScriptScreenshots([]);
    toast.info("Screenshot removed");
  };

  const handleDeleteIndividualScenario = (item: { id: string, title: string, source: string }, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    
    let updatedProject = { ...project };
    if (item.source === 'AI') {
      updatedProject.scenarios = (project.scenarios || []).filter(s => s.id !== item.id);
    } else {
      updatedProject.manualTestCases = (project.manualTestCases || []).filter(c => c.id !== item.id);
    }
    
    if (selectedItemIds.has(item.id)) {
      const nextSelected = new Set(selectedItemIds);
      nextSelected.delete(item.id);
      setSelectedItemIds(nextSelected);
    }
    
    onUpdateProject(updatedProject);
    logActivity(user.email, user.name, `Deleted scenario from Script Generator: ${item.title}`, project.id, project.name);
    toast.success(`Scenario "${item.title}" deleted`);
  };



  const locatorItems = useMemo(() => {
    return project.locators || [];
  }, [project.locators]);

  const filteredScripts = useMemo(() => {
    let scripts = (project.automationScripts || []).filter(s => (!s.source || s.source === 'script_generator') && s.source !== 'record_play');

    if (viewOnly) {
      const executionIds = new Set(project.automationExecutionIds || []);
      scripts = scripts.filter(s => executionIds.has(s.id));
    }
    
    if (!scriptSearch.trim()) return scripts;
    const q = scriptSearch.toLowerCase();
    return scripts.filter(s => 
      s.tool.toLowerCase().includes(q) || 
      s.language.toLowerCase().includes(q) || 
      s.title?.toLowerCase().includes(q) ||
      s.testCaseTitles?.some(t => t.toLowerCase().includes(q))
    );
  }, [project.automationScripts, project.automationExecutionIds, scriptSearch, viewOnly]);

  const loadUrlInIframe = (targetUrl: string) => {
    if (!iframeRef.current) return;
    setIsLoadingUrl(true);
    iframeRef.current.src = `${PROXY_SERVICE}${encodeURIComponent(targetUrl)}`;
  };

  const handleRunAnalysis = async () => {
    setIsProcessing(true);
    try {
      const targetCases: any[] = [];
      individualItems.forEach(item => { if (selectedItemIds.has(item.id)) targetCases.push(...item.cases); });
      folderItems.forEach(item => { if (selectedFolderIds.has(item.id)) targetCases.push(...item.cases); });

      if (targetCases.length === 0) {
        alert("Please select target cases in the repository before finalizing session.");
        setIsProcessing(false);
        return;
      }

      const intent = await analyzeTestIntent(targetCases);
      const analysis = await analyzeLocatorsAndActions(intent, capturedActions, config.tool);
      
      setLocatorAnalysis(analysis);
      setWorkflowStep('review');
    } catch (err) {
      alert("Architecture analysis failed. Please verify captured browser interactions.");
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinalizeRecorderScript = async () => {
    setIsProcessing(true);
    try {
      const targetCases: any[] = [];
      individualItems.forEach(item => { if (selectedItemIds.has(item.id)) targetCases.push(...item.cases); });
      folderItems.forEach(item => { if (selectedFolderIds.has(item.id)) targetCases.push(...item.cases); });

      const intent = await analyzeTestIntent(targetCases);
      const context = {
        appUrl, appPackage, emailContext, passwordContext, architecturalInstructions,
        locators: locatorAnalysis.map(a => a.recommendedLocator)
      };

      const content = await generateFinalPomScript(intent, capturedActions, config, context);
      
      const newScript: AutomationScript = {
        id: Math.random().toString(36).substr(2, 9),
        content,
        tool: config.tool,
        language: config.language,
        testCaseTitles: targetCases.map(tc => tc.title),
        createdAt: new Date().toISOString(),
        lastExecutionStatus: TestStatus.NOT_EXECUTED,
        appPackage: appPackage,
        appUrl: appUrl,
        isApproved: false,
        source: 'script_generator'
      };

      onUpdateProject({ ...project, automationScripts: [newScript, ...(project.automationScripts || [])] });
      logActivity(user.email, user.name, `Generated POM suite from live recording`, project.id, project.name);
      
      setWorkflowStep('config');
      setActiveSubPage('repository');
      setCapturedActions([]);
      setLocatorAnalysis([]);
      alert("POM Suite successfully synthesized and archived.");
    } catch (err) {
      alert("Script generation failed.");
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateFolder = () => {
    const trimmedTitle = folderTitle.trim();
    if (!trimmedTitle) {
      toast.error("Folder name cannot be empty.");
      return;
    }
    
    const isDuplicate = (project.automationFolders || [])
      .filter(f => !f.type || f.type === 'script_generator')
      .some(f => f.name.trim().toLowerCase() === trimmedTitle.toLowerCase() && f.id !== editingFolderId);
    
    if (isDuplicate) {
      toast.error("A folder with this name already exists in this project.");
      return;
    }
    
    const newFolder = {
      id: editingFolderId || `sf-${Date.now()}`,
      name: folderTitle.trim(),
      description: folderDescription.trim(),
      type: 'script_generator' as const
    };

    let updatedFolders = [...(project.automationFolders || [])];
    if (editingFolderId) {
      updatedFolders = updatedFolders.map(f => f.id === editingFolderId ? newFolder : f);
    } else {
      updatedFolders.push(newFolder);
    }

    onUpdateProject({ ...project, automationFolders: updatedFolders });
    setIsFolderModalOpen(false);
    setFolderTitle('');
    setFolderDescription('');
    setEditingFolderId(null);
  };

  const handleGenerateScriptDirect = async () => {
    if (isGenerating) return;
    if (selectedItemIds.size === 0 && selectedFolderIds.size === 0 && scriptScreenshots.length === 0) {
      toast.error("Please select target test cases or attach screenshot(s)");
      return;
    }

    if (appUrl.trim()) {
      const urlPattern = /^(https?:\/\/)?(localhost(:\d+)?|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?)(\/.*)?$/i;
      if (!urlPattern.test(appUrl.trim())) {
        toast.error("Please enter a valid App URL (e.g., https://example.com)");
        return;
      }
    }

    const langMap: Record<string, string> = {
      'TypeScript': '.ts',
      'JavaScript': '.js',
      'Python': '.py',
      'Java': '.java',
      'C#': '.cs'
    };

    const extension = langMap[config.language];
    if (!extension) {
      alert("Error: Unsupported language selected");
      return;
    }

    setIsGenerating(true);
    try {
      const targetCases: any[] = [];
      individualItems.forEach(item => { if (selectedItemIds.has(item.id)) targetCases.push(...item.cases); });
      folderItems.forEach(item => { if (selectedFolderIds.has(item.id)) targetCases.push(...item.cases); });

      const isOtpInvolved = targetCases.some(tc => {
        const text = (tc.title + ' ' + (tc.steps || []).join(' ')).toLowerCase();
        return text.includes('otp') || text.includes('one time password') || text.includes('verification code') || text.includes('2fa');
      });

      const cleanedScreenshots = scriptScreenshots.map(s => ({
        id: s.id,
        name: s.name,
        data: s.data,
        mimeType: s.mimeType,
        size: s.size
      }));

      let enrichedInstructions = architecturalInstructions;
      if (ragEnabled) {
        const queryText = targetCases.map(tc => tc.title).join('\n') || architecturalInstructions || 'Generate automation script';
        const enriched = await ragEnrichPrompt(queryText, project.id, 3);
        enrichedInstructions = `${architecturalInstructions}\n\n${enriched.prompt}`;
        setRetrievedRagChunks(enriched.chunks);
      } else {
        setRetrievedRagChunks([]);
      }

      const context = {
        appUrl, appPackage, emailContext, passwordContext, architecturalInstructions: enrichedInstructions,
        isOtpInvolved,
        screenshots: cleanedScreenshots,
        locators: Array.from(selectedLocatorIds).map(id => project.locators?.find(l => l.id === id)),
        projectName: project.name,
        projectId: project.id
      };

      const existingScripts = (project.automationScripts || []).filter(s => (!s.source || s.source === 'script_generator') && s.source !== 'record_play');
      const content = await generateAutomationScript(targetCases, config, context, existingScripts);
      
      setGeneratedContent(content);
      setTargetCasesForSave(targetCases);
      setIsGeneratedScriptSaved(false);
      
      logActivity(user.email, user.name, `Generated incremental POM script for ${targetCases.length} test cases`, project.id, project.name);
      
      setSelectedItemIds(new Set());
      setSelectedFolderIds(new Set());
      setSelectedLocatorIds(new Set());
      
      // Auto-scroll to generated content
      setTimeout(() => {
        const element = document.getElementById('generated-script-panel');
        if (element) element.scrollIntoView({ behavior: 'smooth' });
      }, 100);

    } catch (err) {
      alert("Failed to synthesize script. Check console for details.");
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveScript = () => {
    if (!saveTitle.trim() || !saveDescription.trim() || !generatedContent) {
      alert("Project Title and Description are mandatory.");
      return;
    }

    if (isCreatingNewFolder && !newFolderName.trim()) {
      alert("Please provide a name for the new folder.");
      return;
    }

    if (!isCreatingNewFolder && !selectedScriptFolderId) {
      alert("Please select a target folder.");
      return;
    }

    let folderId = selectedScriptFolderId;
    let updatedFolders = project.automationFolders || [];

    if (isCreatingNewFolder) {
      folderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      updatedFolders = [...updatedFolders, { id: folderId, name: newFolderName, isImported: true, type: 'script_generator' }];
    }

    const newScript: AutomationScript = {
      id: Math.random().toString(36).substr(2, 9),
      content: generatedContent,
      tool: config.tool,
      language: config.language,
      testCaseTitles: targetCasesForSave.map(tc => tc.title),
      title: saveTitle,
      description: saveDescription,
      folderId: folderId || undefined,
      createdAt: new Date().toISOString(),
      lastExecutionStatus: TestStatus.NOT_EXECUTED,
      appPackage: appPackage,
      appUrl: appUrl,
      isApproved: false,
      source: 'script_generator'
    };

    const updatedScripts = [newScript, ...(project.automationScripts || [])];

    onUpdateProject({ 
      ...project, 
      automationScripts: updatedScripts,
      automationFolders: updatedFolders
    });

    logActivity(user.email, user.name, `Saved Automation Script: ${saveTitle}`, project.id, project.name);
    
    setIsGeneratedScriptSaved(true);
    setIsSaveModalOpen(false);
    setSaveTitle('');
    setSaveDescription('');
    setGeneratedContent(null);
    setTargetCasesForSave([]);
    setIsCreatingNewFolder(false);
    setNewFolderName('');
    alert("Automation script saved successfully.");
  };

  const toggleItemSelection = (id: string) => {
    const next = new Set(selectedItemIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedItemIds(next);
  };

  const toggleFolderSelection = (id: string) => {
    const next = new Set(selectedFolderIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedFolderIds(next);
  };

  const toggleLocatorSelection = (id: string) => {
    const next = new Set(selectedLocatorIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedLocatorIds(next);
  };

  const handleApproveScript = (id: string) => {
    const script = (project.automationScripts || []).find(s => s.id === id);
    if (!script) return;

    const newApprovalStatus = !script.isApproved;
    
    const updatedScripts = (project.automationScripts || []).map(s => 
      s.id === id ? { ...s, isApproved: newApprovalStatus } : s
    );

    let updatedExecutionIds = [...(project.automationExecutionIds || [])];
    if (newApprovalStatus) {
      if (!updatedExecutionIds.includes(id)) {
        updatedExecutionIds.push(id);
      }
    } else {
      updatedExecutionIds = updatedExecutionIds.filter(eid => eid !== id);
    }

    onUpdateProject({ 
      ...project, 
      automationScripts: updatedScripts,
      automationExecutionIds: updatedExecutionIds
    });
    
    logActivity(user.email, user.name, `${newApprovalStatus ? 'Approved' : 'Unapproved'} Script: ${id}`, project.id, project.name);
  };

  const handleUpdateStatus = (id: string, status: string) => {
    const updated = (project.automationScripts || []).map(s => 
      s.id === id ? { ...s, lastExecutionStatus: status as any, lastExecutedAt: new Date().toISOString() } : s
    );
    onUpdateProject({ ...project, automationScripts: updated });
    logActivity(user.email, user.name, `Updated Script Execution Status to ${status}`, project.id, project.name);
  };

  const handleStartEditScript = (script: AutomationScript) => {
    setEditingScriptId(script.id);
    setEditScriptContent(script.content);
  };

  const handleSaveEditScript = () => {
    if (!editingScriptId) return;
    const updated = (project.automationScripts || []).map(s => 
      s.id === editingScriptId ? { ...s, content: editScriptContent } : s
    );
    onUpdateProject({ ...project, automationScripts: updated });
    setEditingScriptId(null);
  };

  const handleCopyScript = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setIsCopied(id);
    setTimeout(() => setIsCopied(null), 2000);
  };

  const handleDownloadScript = (script: AutomationScript) => {
    const langMap: Record<string, string> = {
      'TypeScript': 'ts',
      'JavaScript': 'js',
      'Python': 'py',
      'Java': 'java',
      'C#': 'cs'
    };
    const ext = langMap[script.language] || 'ts';
    // Use unsaved content if available (e.g. after appending)
    const content = unsavedChanges[script.id]?.content || script.content;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TestScript_${script.id.substring(0,4)}.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadScriptAsZip = async (script: { id: string; title?: string; tool: string; language: string; content: string }) => {
    try {
      const zip = new JSZip();
      const content = unsavedChanges[script.id]?.content || script.content;

      // Parse files from the markdown content
      const files: { path: string; content: string }[] = [];
      const lines = content.split('\n');
      
      let currentFileContent: string[] = [];
      let inCodeBlock = false;
      let codeBlockLang = '';
      let lastLinesBeforeBlock: string[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        if (trimmedLine.startsWith('```')) {
          if (!inCodeBlock) {
            inCodeBlock = true;
            codeBlockLang = trimmedLine.slice(3).trim().toLowerCase();
            currentFileContent = [];
          } else {
            inCodeBlock = false;
            
            // Try to identify file path
            let filePath = '';
            
            // Check first line comment
            if (currentFileContent.length > 0) {
              const firstLine = currentFileContent[0].trim();
              const commentMatch = firstLine.match(/^(?:\/\/\/|\/\/|#|--|;\/|\/\*)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_]+)/);
              if (commentMatch && commentMatch[1]) {
                const possiblePath = commentMatch[1].trim();
                if (possiblePath.includes('.') && !possiblePath.includes(' ') && !possiblePath.includes(':')) {
                  filePath = possiblePath;
                  currentFileContent.shift(); // remove file path header comment
                }
              }
            }
            
            // Check preceding lines
            if (!filePath) {
              for (let j = lastLinesBeforeBlock.length - 1; j >= 0; j--) {
                const prevLine = lastLinesBeforeBlock[j].trim();
                if (!prevLine) continue;
                
                // Remove formatting marks
                const cleaned = prevLine
                  .replace(/^(?:#+\s*|\-\-\-\s*|\d+\.\s*|File:\s*|File\s+Path:\s*)/i, '')
                  .replace(/[\*\`\'\"]/g, '')
                  .trim();
                
                if (cleaned && cleaned.includes('.') && !cleaned.includes(' ') && !cleaned.includes(':') && /^[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_]+$/.test(cleaned)) {
                  filePath = cleaned;
                  break;
                }
                
                const pathMatch = cleaned.match(/([a-zA-Z0-9_\-\/]+\.[a-zA-Z0-9_]+)/);
                if (pathMatch && pathMatch[1] && !pathMatch[1].includes(' ')) {
                  filePath = pathMatch[1];
                  break;
                }
              }
            }
            
            if (filePath) {
              filePath = filePath.replace(/^\/+/, '');
              filePath = filePath.replace(/^(?:automation-project|playwright-java-project|playwright-python-automation|playwright-python-project)\//i, '');
              
              files.push({
                path: filePath,
                content: currentFileContent.join('\n').trim()
              });
            } else {
              let guessedPath = '';
              if (codeBlockLang === 'xml' || codeBlockLang === 'maven') {
                guessedPath = 'pom.xml';
              } else if (codeBlockLang === 'json') {
                guessedPath = 'package.json';
              } else if (codeBlockLang === 'ini') {
                guessedPath = 'pytest.ini';
              } else if (codeBlockLang === 'yaml' || codeBlockLang === 'yml') {
                guessedPath = '.github/workflows/ci.yml';
              }
              
              if (guessedPath) {
                files.push({
                  path: guessedPath,
                  content: currentFileContent.join('\n').trim()
                });
              } else {
                const ext = codeBlockLang === 'typescript' ? 'ts' : 
                            codeBlockLang === 'javascript' ? 'js' : 
                            codeBlockLang === 'python' ? 'py' : 
                            codeBlockLang === 'java' ? 'java' : 
                            codeBlockLang === 'csharp' ? 'cs' : 'txt';
                
                files.push({
                  path: `scripts/AutoScript_${files.length + 1}.${ext}`,
                  content: currentFileContent.join('\n').trim()
                });
              }
            }
            lastLinesBeforeBlock = [];
          }
        } else {
          if (inCodeBlock) {
            currentFileContent.push(line);
          } else {
            lastLinesBeforeBlock.push(line);
            if (lastLinesBeforeBlock.length > 5) {
              lastLinesBeforeBlock.shift();
            }
          }
        }
      }

      if (files.length === 0) {
        const langMap: Record<string, string> = {
          'TypeScript': 'ts',
          'JavaScript': 'js',
          'Python': 'py',
          'Java': 'java',
          'C#': 'cs'
        };
        const ext = langMap[script.language] || 'ts';
        files.push({
          path: `TestScript.${ext}`,
          content: content
        });
      }

      const hasPackageJson = files.some(f => f.path.toLowerCase() === 'package.json');
      const hasPomXml = files.some(f => f.path.toLowerCase() === 'pom.xml');
      const hasRequirementsTxt = files.some(f => f.path.toLowerCase() === 'requirements.txt');
      const hasDotEnv = files.some(f => f.path.toLowerCase() === '.env');

      if (!hasDotEnv) {
        files.push({
          path: '.env',
          content: `# Automation Framework Credentials & Config\nAPP_URL=${appUrl || 'https://example.com'}\nAPP_PACKAGE=${appPackage || 'com.example'}\nUSER_EMAIL=${emailContext || 'user@example.com'}\nUSER_PASSWORD=${passwordContext || 'password123'}\n`
        });
      }

      if (script.language === 'Java' && !hasPomXml) {
        files.push({
          path: 'pom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.automatiqa</groupId>
    <artifactId>automation-pom-suite</artifactId>
    <version>1.0-SNAPSHOT</version>
    <properties>
        <maven.compiler.source>11</maven.compiler.source>
        <maven.compiler.target>11</maven.compiler.target>
        <playwright.version>1.40.0</playwright.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>com.microsoft.playwright</groupId>
            <artifactId>playwright</artifactId>
            <version>\${playwright.version}</version>
        </dependency>
        <dependency>
            <groupId>org.testng</groupId>
            <artifactId>testng</artifactId>
            <version>7.8.0</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.github.cdimascio</groupId>
            <artifactId>dotenv-java</artifactId>
            <version>3.0.0</version>
        </dependency>
    </dependencies>
</project>`
        });
      } else if (script.language === 'Python' && !hasRequirementsTxt) {
        files.push({
          path: 'requirements.txt',
          content: `pytest>=7.4.0\npytest-playwright>=0.4.0\npython-dotenv>=1.0.0\n`
        });
      } else if ((script.language === 'JavaScript' || script.language === 'TypeScript') && !hasPackageJson) {
        files.push({
          path: 'package.json',
          content: JSON.stringify({
            name: "automation-pom-suite",
            version: "1.0.0",
            description: "POM Automation Suite downloaded from AutomatiQA",
            main: "index.js",
            scripts: {
              "test": script.tool === 'Playwright' ? "playwright test" : "wdio run wdio.conf.js"
            },
            dependencies: {
              "dotenv": "^16.3.1"
            },
            devDependencies: script.tool === 'Playwright' ? {
              "@playwright/test": "^1.40.0"
            } : {
              "@wdio/cli": "^8.24.0",
              "@wdio/local-runner": "^8.24.0",
              "@wdio/mocha-framework": "^8.24.0",
              "@wdio/spec-reporter": "^8.24.0"
            }
          }, null, 2)
        });
      }

      files.forEach(f => {
        zip.file(f.path, f.content);
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const archiveName = `${(script.title || 'POM-Suite').replace(/\s+/g, '-').toLowerCase()}-framework.zip`;
      saveAs(zipBlob, archiveName);
      toast.success(`POM framework ZIP created successfully: ${archiveName}`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate POM structure ZIP");
    }
  };

  const handleRefineScript = async (script: AutomationScript) => {
    const instruction = refinementInputs[script.id];
    if (!instruction?.trim()) {
      toast.error("Please provide input before proceeding");
      return;
    }

    setIsRefining(prev => ({ ...prev, [script.id]: true }));
    try {
      const cleanedScreenshots = scriptScreenshots.map(s => ({
        id: s.id,
        name: s.name,
        data: s.data,
        mimeType: s.mimeType,
        size: s.size
      }));

      const context = {
        appUrl, appPackage, emailContext, passwordContext, architecturalInstructions,
        screenshots: cleanedScreenshots,
        locators: project.locators
      };

      const refinedContent = await refineAutomationScript(script.content, instruction, config, context);
      
      const updated = (project.automationScripts || []).map(s => 
        s.id === script.id ? { ...s, content: refinedContent } : s
      );
      
      onUpdateProject({ ...project, automationScripts: updated });
      setRefinementInputs(prev => ({ ...prev, [script.id]: '' }));
      logActivity(user.email, user.name, `Refined Automation Script: ${script.id}`, project.id, project.name);
      alert("Script refined successfully.");
    } catch (err) {
      console.error(err);
      alert("Refinement failed. Please try again.");
    } finally {
      setIsRefining(prev => ({ ...prev, [script.id]: false }));
    }
  };

  const toggleCodeVisibility = (id: string) => {
    const next = new Set(visibleCodeIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setVisibleCodeIds(next);
  };

  const isVideo = (data: string) => data.startsWith('data:video') || data.toLowerCase().includes('.mp4') || data.toLowerCase().includes('.mov') || data.toLowerCase().includes('.webm');

  const handleFileUploadEvidence = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !evidenceModalScript) return;

    setIsUploadingEvidence(true);
    const reader = new FileReader();
    reader.onloadend = () => {
        const result = reader.result as string;
        setEvidenceModalScript({ ...evidenceModalScript, evidence: result });
        setIsUploadingEvidence(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEvidence = () => {
    if (!evidenceModalScript) return;
    
    const updated = (project.automationScripts || []).map(s => 
      s.id === evidenceModalScript.id ? { 
        ...s, 
        evidence: evidenceModalScript.evidence,
        evidenceUrl: evidenceModalScript.evidenceUrl 
      } : s
    );
    onUpdateProject({ ...project, automationScripts: updated });
    setEvidenceModalScript(null);
    alert("Execution evidence saved.");
  };

  const handleSaveExistingScript = (scriptId: string) => {
    const unsaved = unsavedChanges[scriptId];
    if (!unsaved) return;

    const updated = (project.automationScripts || []).map(s => 
      s.id === scriptId ? { 
        ...s, 
        content: unsaved.content,
        testCaseTitles: unsaved.titles
      } : s
    );
    onUpdateProject({ ...project, automationScripts: updated });
    
    const nextUnsaved = { ...unsavedChanges };
    delete nextUnsaved[scriptId];
    setUnsavedChanges(nextUnsaved);
    
    logActivity(user.email, user.name, `Saved changes to Automation Script: ${scriptId}`, project.id, project.name);
    alert("Script changes saved successfully.");
  };

  const handleDiscardChanges = (scriptId: string) => {
    const nextUnsaved = { ...unsavedChanges };
    delete nextUnsaved[scriptId];
    setUnsavedChanges(nextUnsaved);
    logActivity(user.email, user.name, `Discarded changes for Automation Script: ${scriptId}`, project.id, project.name);
  };

  const handleAppendGenerate = async () => {
    if (isAppending) return;
    if (!appendModalScript) return;
    
    const targetCases: any[] = [];
    individualItems.forEach(item => { if (selectedAppendItemIds.has(item.id)) targetCases.push(...item.cases); });
    folderItems.forEach(item => { if (selectedAppendFolderIds.has(item.id)) targetCases.push(...item.cases); });

    const scriptsToAppend = (project.automationScripts || []).filter(s => selectedAppendScriptIds.has(s.id));

    if (targetCases.length === 0 && scriptsToAppend.length === 0) {
      alert("Please select at least one test case or script to append.");
      return;
    }
    if (targetCases.length > 20) {
      alert("You can select up to 20 test cases.");
      return;
    }

    setIsAppending(true);
    try {
      const isOtpInvolved = targetCases.some(tc => {
        const text = (tc.title + ' ' + (tc.steps || []).join(' ')).toLowerCase();
        return text.includes('otp') || text.includes('one time password') || text.includes('verification code') || text.includes('2fa');
      });

      const cleanedScreenshots = scriptScreenshots.map(s => ({
        id: s.id,
        name: s.name,
        data: s.data,
        mimeType: s.mimeType,
        size: s.size
      }));

      const context = {
        appUrl: appendModalScript.appUrl || appUrl,
        appPackage: appendModalScript.appPackage || appPackage,
        emailContext, passwordContext, architecturalInstructions,
        isOtpInvolved,
        screenshots: cleanedScreenshots,
        locators: project.locators,
        scriptsToAppend: scriptsToAppend.map(s => ({ title: s.title, content: s.content }))
      };

      const appendedContent = await appendToAutomationScript(appendModalScript.content, targetCases, config, context);
      
      setUnsavedChanges(prev => ({ 
        ...prev, 
        [appendModalScript.id]: { 
          content: appendedContent, 
          titles: [
            ...(appendModalScript.testCaseTitles || []), 
            ...targetCases.map(tc => tc.title),
            ...scriptsToAppend.map(s => s.title || 'Appended Script')
          ] 
        } 
      }));
      
      setAppendModalScript(null);
      setSelectedAppendItemIds(new Set());
      setSelectedAppendFolderIds(new Set());
      setSelectedAppendScriptIds(new Set());
      alert("Script appended successfully. Please click 'Save Script' on the card to commit changes.");
    } catch (err) {
      console.error(err);
      alert("Append failed. Please try again.");
    } finally {
      setIsAppending(false);
    }
  };

  const handleImportScriptClick = () => {
    importScriptInputRef.current?.click();
  };

  const handleImportZipClick = () => {
    importZipInputRef.current?.click();
  };

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      alert("Please upload a valid ZIP file.");
      return;
    }

    setIsProcessing(true);
    setIsImportingZip(true);
    
    // Use setTimeout to allow UI to update and show loading state
    setTimeout(async () => {
      try {
        const zip = await JSZip.loadAsync(file);
        const scripts: AutomationScript[] = [];
        const folders: { id: string, name: string, isImported: boolean, type?: 'flow' | 'script' | 'script_generator' }[] = [];
        
        let hasPytest = false;
        let hasPlaywright = false;
        
        const fileEntries = Object.entries(zip.files).filter(([path, zipFile]) => !zipFile.dir);
        
        if (fileEntries.length === 0) {
          throw new Error("The ZIP file is empty or contains no valid script files.");
        }

        // Performance Optimization: Safety limit of 100 files max per folder import
        if (fileEntries.length > 100) {
          throw new Error("Import limit exceeded: Maximum 100 files allowed per ZIP import to ensure stability.");
        }

        // Framework Detection
        for (const [path, zipFile] of fileEntries) {
          // Performance Optimization: 1MB file size limit per script file
          // zipFile._data.uncompressedSize is internal, better to check after async('string') or use async('uint8array')
          // But async('string') is fine for small files.
          
          const content = await zipFile.async('string');
          
          // Check size (rough estimate from string length)
          if (content.length > 1024 * 1024) {
            throw new Error(`File size limit exceeded for ${path}: Maximum 1MB allowed per script file.`);
          }

          const fileName = path.split('/').pop() || '';
          const extension = fileName.split('.').pop()?.toLowerCase();
          
          if (extension === 'py') {
            if (content.includes('pytest') || fileName.startsWith('test_') || fileName.endsWith('_test.py') || path.includes('conftest.py')) {
              hasPytest = true;
            }
          } else if (extension === 'ts' || extension === 'js') {
            if (content.includes('@playwright/test') || path.includes('playwright.config')) {
              hasPlaywright = true;
            }
          }
        }

        if (hasPytest && hasPlaywright) {
          throw new Error("Mixed frameworks detected (Pytest and Playwright). Please upload a single framework project.");
        }

        const detectedTool = hasPlaywright ? 'Playwright' : (hasPytest ? 'Selenium' : null);
        const finalTool = detectedTool || 'Playwright';
        const finalLang = hasPytest ? 'Python' : 'TypeScript';

        const existingFolders = project.automationFolders || [];

        for (const [path, zipFile] of fileEntries) {
          const content = await zipFile.async('string');
          const pathParts = path.split('/');
          const fileName = pathParts.pop() || '';
          const extension = fileName.split('.').pop()?.toLowerCase();
          
          const validExtensions = ['ts', 'js', 'py', 'java', 'cs'];
          if (!validExtensions.includes(extension || '')) continue;

          // Determine module/folder
          const folderName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'Imported Scripts';
          
          // Check if folder exists in existing project folders
          let folderId = existingFolders.find(f => f.name === folderName)?.id;
          
          // If not in existing, check if we already created it in this import session
          if (!folderId) {
            folderId = folders.find(f => f.name === folderName)?.id;
          }
          
          if (!folderId) {
            folderId = `zip-folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            folders.push({ id: folderId, name: folderName, isImported: true, type: 'script_generator' });
          }

          scripts.push({
            id: `zip-script-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            content,
            tool: finalTool as any,
            language: finalLang as any,
            title: fileName,
            description: `Imported from ${path}`,
            folderId,
            createdAt: new Date().toISOString(),
            lastExecutionStatus: TestStatus.NOT_EXECUTED,
            isApproved: false,
            source: 'script_generator'
          });
        }

        if (scripts.length === 0) {
          throw new Error("No valid automation scripts found in the ZIP file.");
        }

        // Merge folders and scripts into project
        const newFolders = folders.filter(nf => !existingFolders.some(ef => ef.name === nf.name));
        
        onUpdateProject({
          ...project,
          automationFolders: [...existingFolders, ...newFolders],
          automationScripts: [...scripts, ...(project.automationScripts || [])]
        });

        logActivity(user.email, user.name, `Imported script folder from ${file.name} (${scripts.length} scripts)`, project.id, project.name);
        alert(`Successfully imported ${scripts.length} scripts across ${folders.length} modules.`);
        
      } catch (err: any) {
        alert(`Import failed: ${err.message}`);
        console.error(err);
      } finally {
        setIsProcessing(false);
        setIsImportingZip(false);
        if (e.target) e.target.value = '';
      }
    }, 100);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setGeneratedContent(content);
        setSaveTitle(file.name.split('.')[0]);
        setSaveDescription(`Imported script from ${file.name}`);
        setIsSaveModalOpen(true);
        setIsGeneratedScriptSaved(false);
        alert("Script imported. Please review and save it to the repository.");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  const handleDeleteConfirmed = () => {
    if (!deleteTarget) return;

    const { type, id, name } = deleteTarget;
    let updatedProject = { ...project };

    if (type === 'script') {
      if (viewOnly) {
        updatedProject.automationExecutionIds = (project.automationExecutionIds || []).filter(sid => sid !== id);
        logActivity(user.email, user.name, `Removed Automation Script from Execution: ${name}`, project.id, project.name);
      } else {
        updatedProject.automationScripts = (project.automationScripts || []).filter(s => s.id !== id);
        updatedProject.automationExecutionIds = (project.automationExecutionIds || []).filter(sid => sid !== id);
        logActivity(user.email, user.name, `Deleted Automation Script: ${name}`, project.id, project.name);
      }
      toast.success(`Script "${name}" deleted`);
    } else if (type === 'scenario' || type === 'folder') {
      updatedProject.scenarios = (project.scenarios || []).filter(s => s.id !== id);
      updatedProject.manualTestCases = (project.manualTestCases || []).filter(c => c.id !== id);
      updatedProject.automationFolders = (project.automationFolders || []).filter(f => f.id !== id);
      updatedProject.automationScripts = (project.automationScripts || []).map(s => s.folderId === id ? { ...s, folderId: undefined } : s);
      const nextItems = new Set(selectedItemIds); nextItems.delete(id); setSelectedItemIds(nextItems);
      const nextFolders = new Set(selectedFolderIds); nextFolders.delete(id); setSelectedFolderIds(nextFolders);
      logActivity(user.email, user.name, `Deleted Folder: ${name}`, project.id, project.name);
      toast.success(`Folder "${name}" deleted`);
    } else if (type === 'locator') {
      updatedProject.locators = (project.locators || []).filter(l => l.id !== id);
      toast.success(`Locator "${name}" deleted`);
    }

    onUpdateProject(updatedProject);
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-500">
      
      {!viewOnly && (
        <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200/90 shadow-sm relative overflow-hidden space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-6">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl md:text-2xl font-black text-slate-900 uppercase tracking-tight">Automation</h2>
                  <RAGStatusBadge
                    enabled={ragEnabled}
                    onToggle={setRagEnabled}
                    retrievedChunks={retrievedRagChunks}
                  />
                </div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">
                  Synthesize incremental POM scripts with architectural oversight & RAG grounding
                </p>
              </div>
          </div>

          {/* Configuration Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-2">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="text-rose-500 font-bold">*</span>
                    <Settings size={13} className="text-teal-600" /> Framework & Tool
                  </label>
                  <div className="relative group">
                      <select 
                        value={config.tool || ''} 
                        onChange={e => {
                          const newTool = e.target.value as 'Playwright' | 'Selenium' | 'Cypress' | 'Appium';
                          const validLangs = VALID_FRAMEWORK_LANGUAGES[newTool] || ['TypeScript', 'JavaScript', 'Python', 'Java'];
                          const currentLangValid = validLangs.includes(config.language);
                          setConfig({
                            ...config,
                            tool: newTool,
                            language: currentLangValid ? config.language : validLangs[0]
                          });
                          if (newTool !== 'Appium') {
                            setAppPackage('');
                          }
                        }} 
                        className="w-full pl-4 pr-10 py-3.5 bg-slate-50/60 hover:bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 outline-none appearance-none cursor-pointer focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all"
                      >
                          {['Playwright', 'Selenium', 'Cypress', 'Appium'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
              </div>

              <div className="space-y-2">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="text-rose-500 font-bold">*</span>
                    <Terminal size={13} className="text-teal-600" /> Language
                  </label>
                  <div className="relative group">
                      <select 
                        value={config.language || ''} 
                        onChange={e => setConfig({...config, language: e.target.value as any})} 
                        className="w-full pl-4 pr-10 py-3.5 bg-slate-50/60 hover:bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 outline-none appearance-none cursor-pointer focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all"
                      >
                          {(VALID_FRAMEWORK_LANGUAGES[config.tool] || ['TypeScript', 'JavaScript', 'Python', 'Java']).map(l => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                      </select>
                      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
              </div>

              <div className="space-y-2">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Link2 size={13} className="text-teal-600" /> App URL (Optional)
                  </label>
                  <input 
                    value={appUrl || ''} 
                    onChange={e => setAppUrl(e.target.value)} 
                    placeholder="https://app.example.com" 
                    className="w-full px-4 py-3.5 bg-slate-50/60 hover:bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all" 
                  />
              </div>

              <div className="space-y-2">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Smartphone size={13} className={config.tool === 'Appium' ? 'text-teal-600' : 'text-slate-400'} /> App Package {config.tool === 'Appium' ? '(Appium)' : '(Appium Only)'}
                  </label>
                  <input 
                    value={appPackage || ''} 
                    onChange={e => setAppPackage(e.target.value)} 
                    placeholder={config.tool === 'Appium' ? "com.example.app" : "Enabled only for Appium"} 
                    disabled={config.tool !== 'Appium'}
                    className={`w-full px-4 py-3.5 border rounded-2xl text-xs font-bold transition-all ${
                      config.tool === 'Appium'
                        ? 'bg-slate-50/60 hover:bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10'
                        : 'bg-slate-100/70 border-slate-200/60 text-slate-400 placeholder:text-slate-400 cursor-not-allowed'
                    }`}
                  />
              </div>
          </div>

          {config.tool === 'Playwright' && config.language === 'Java' && (
              <div className="p-6 bg-amber-50/60 border border-amber-200 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-start gap-4">
                      <div className="p-3 bg-amber-100 rounded-xl text-amber-700 shadow-sm flex-shrink-0">
                          <Info size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                              <h5 className="text-xs font-black text-amber-900 uppercase tracking-wider">
                                  Java 11 Compatibility & VS Code Support
                              </h5>
                              <span className="bg-amber-200/70 text-amber-800 px-2 py-0.5 rounded-md text-[9px] font-black">STABLE</span>
                          </div>
                          <p className="text-xs text-amber-800 font-medium leading-relaxed mb-4">
                              The generated <code className="bg-amber-100/80 px-1.5 py-0.5 rounded font-mono text-amber-900 text-[11px]">pom.xml</code> is optimized for Java 11 and Visual Studio Code:
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                              {[
                                  { name: 'Playwright', version: '1.42.0', icon: <Terminal size={11}/> },
                                  { name: 'JUnit Jupiter', version: '5.10.2', icon: <CheckCircle2 size={11}/> },
                                  { name: 'Dotenv Java', version: '3.0.0', icon: <Lock size={11}/> },
                                  { name: 'Maven Compiler', version: '3.13.0', icon: <Settings size={11}/> },
                                  { name: 'Maven Surefire', version: '3.2.5', icon: <Zap size={11}/> },
                                  { name: 'Playwright Plugin', version: '1.42.0', icon: <Cpu size={11}/> }
                              ].map(dep => (
                                  <div key={dep.name} className="bg-white/80 p-3 rounded-xl border border-amber-200/60 flex flex-col gap-1 shadow-sm">
                                      <div className="flex items-center gap-1.5 text-[9px] font-bold text-amber-700 uppercase truncate">
                                          {dep.icon}
                                          <span className="truncate">{dep.name}</span>
                                      </div>
                                      <div className="text-xs font-black text-amber-950 font-mono">{dep.version}</div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          )}

          {/* Global Test Context & Security */}
          <div className="space-y-3">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck size={14} className="text-teal-600" />
                Global Test Context & Security
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="relative group">
                      <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-600 transition-colors" size={16} />
                      <input 
                        value={emailContext || ''} 
                        onChange={e => setEmailContext(e.target.value)} 
                        placeholder="Email / Phone" 
                        className="w-full pl-11 pr-4 py-3.5 bg-slate-50/60 hover:bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all" 
                      />
                  </div>
                  <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-600 transition-colors" size={16} />
                      <input 
                        type={showPassword ? "text" : "password"} 
                        value={passwordContext || ''} 
                        onChange={e => setPasswordContext(e.target.value)} 
                        placeholder="Password" 
                        className="w-full pl-11 pr-11 py-3.5 bg-slate-50/60 hover:bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all" 
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors"
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                  </div>
              </div>
          </div>

          {/* Test Cases & Folders Selection Section */}
          <div className="space-y-4 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-2">
              <div className="flex items-center gap-6 overflow-x-auto whitespace-nowrap scrollbar-none pb-2 sm:pb-0">
                  {[
                      { id: 'individual', label: 'Individual Test Cases', icon: <LayoutGrid size={15}/>, count: individualItems.length },
                      { id: 'folders', label: 'Folders', icon: <Folder size={15}/>, count: folderItems.length },
                      { id: 'scriptFolders', label: 'Script Folders', icon: <Folder size={15}/>, count: (project.automationFolders || []).filter(f => (!f.type || f.type === 'script_generator') && !f.isImported).length },
                      { id: 'importedFolders', label: 'Imported script Folders', icon: <Folder size={15}/>, count: (project.automationFolders || []).filter(f => (!f.type || f.type === 'script_generator') && f.isImported).length }
                  ].map(tab => (
                      <button 
                        key={tab.id}
                        onClick={() => setSelectionTab(tab.id as any)}
                        className={`pb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider relative transition-all flex-shrink-0 ${
                          selectionTab === tab.id 
                            ? 'text-teal-700' 
                            : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                          {tab.icon}
                          <span>{tab.label}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            selectionTab === tab.id ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {tab.count}
                          </span>
                          {selectionTab === tab.id && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />
                          )}
                      </button>
                  ))}
              </div>

              {(selectionTab === 'individual' || selectionTab === 'folders') && (
                <div className="relative w-full sm:w-64 flex-shrink-0">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={testCaseSearch}
                    onChange={e => setTestCaseSearch(e.target.value)}
                    placeholder="Search test cases..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 outline-none focus:border-teal-500 transition-all placeholder:text-slate-400"
                  />
                  {testCaseSearch && (
                    <button 
                      onClick={() => setTestCaseSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="min-h-[160px] max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
                {selectionTab === 'individual' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {filteredIndividualItems.map(item => {
                          const isSelected = selectedItemIds.has(item.id);
                          return (
                            <div 
                              key={item.id} 
                              onClick={() => toggleItemSelection(item.id)} 
                              className={`group/item px-4 py-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                isSelected 
                                  ? 'bg-teal-50/50 border-teal-300 shadow-sm' 
                                  : 'bg-white border-slate-200/80 hover:border-teal-200 hover:bg-slate-50/40'
                              }`}
                            >
                                <div className="flex items-center gap-3.5 min-w-0">
                                    <div className={`flex-shrink-0 transition-colors ${isSelected ? 'text-teal-600' : 'text-slate-300 group-hover/item:text-slate-400'}`}>
                                        {isSelected ? <CheckSquare size={18} className="fill-teal-50 text-teal-600" /> : <Square size={18} />}
                                    </div>
                                    <div className="min-w-0">
                                        <h5 className="text-xs font-black text-slate-800 uppercase tracking-tight break-words whitespace-normal leading-snug line-clamp-2" title={item.title}>
                                          {item.title}
                                        </h5>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                                          {item.subtitle}
                                        </p>
                                    </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteIndividualScenario(item, e)}
                                  className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all flex-shrink-0"
                                  title="Delete Scenario"
                                >
                                  <Trash2 size={15} />
                                </button>
                            </div>
                          );
                        })}
                        {filteredIndividualItems.length === 0 && (
                          <div className="md:col-span-2 py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                            <p className="text-xs font-bold uppercase tracking-wider">No test cases found</p>
                          </div>
                        )}
                    </div>
                )}

                {selectionTab === 'folders' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {filteredFolderItems.map(folder => {
                          const isSelected = selectedFolderIds.has(folder.id);
                          return (
                            <div 
                              key={folder.id} 
                              onClick={() => toggleFolderSelection(folder.id)} 
                              className={`group/item px-4 py-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                isSelected 
                                  ? 'bg-teal-50/50 border-teal-300 shadow-sm' 
                                  : 'bg-white border-slate-200/80 hover:border-teal-200 hover:bg-slate-50/40'
                              }`}
                            >
                                <div className="flex items-center gap-3.5 min-w-0">
                                    <div className={`flex-shrink-0 transition-colors ${isSelected ? 'text-teal-600' : 'text-slate-300 group-hover/item:text-slate-400'}`}>
                                        {isSelected ? <CheckSquare size={18} className="fill-teal-50 text-teal-600" /> : <Square size={18} />}
                                    </div>
                                    <div className="min-w-0">
                                        <h5 className="text-xs font-black text-slate-800 uppercase tracking-tight break-words whitespace-normal leading-snug line-clamp-2" title={folder.title}>
                                          {folder.title}
                                        </h5>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                                          {folder.subtitle}
                                        </p>
                                    </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    setDeleteTarget({ type: 'folder', id: folder.id, name: folder.title });
                                  }}
                                  className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all flex-shrink-0"
                                  title="Delete Folder"
                                >
                                  <Trash2 size={15} />
                                </button>
                            </div>
                          );
                        })}
                        {filteredFolderItems.length === 0 && (
                          <div className="md:col-span-2 py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                            <p className="text-xs font-bold uppercase tracking-wider">No folders found</p>
                          </div>
                        )}
                    </div>
                )}

                {selectionTab === 'scriptFolders' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <div 
                          onClick={() => {
                            setEditingFolderId(null);
                            setFolderTitle('');
                            setFolderDescription('');
                            setIsFolderModalOpen(true);
                          }}
                          className="p-4 rounded-2xl border border-dashed border-slate-200 hover:border-teal-300 hover:bg-teal-50/20 transition-all cursor-pointer flex items-center justify-center gap-2.5 text-slate-500 hover:text-teal-700 md:col-span-2"
                        >
                            <Plus size={18} />
                            <span className="text-xs font-black uppercase tracking-wider">Create Script Folder</span>
                        </div>
                        {(project.automationFolders || []).filter(f => (!f.type || f.type === 'script_generator') && !f.isImported).map(folder => (
                            <div 
                              key={folder.id} 
                              onClick={() => setFolderScriptsModal({ folderId: folder.id, name: folder.name })} 
                              className="group/item p-4 rounded-2xl border bg-white border-slate-200/80 hover:border-teal-200 hover:bg-teal-50/20 transition-all cursor-pointer flex items-center justify-between gap-3"
                            >
                                <div className="flex items-center gap-3.5 min-w-0">
                                    <div className="text-slate-300 group-hover/item:text-teal-600 transition-colors flex-shrink-0">
                                        <Folder size={20}/>
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <h5 className="text-xs font-black text-slate-800 uppercase tracking-tight truncate" title={folder.name}>{folder.name}</h5>
                                          <button 
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingFolderId(folder.id);
                                              setFolderTitle(folder.name);
                                              setFolderDescription(folder.description || '');
                                              setIsFolderModalOpen(true);
                                            }}
                                            className="p-1 text-slate-300 hover:text-teal-600 transition-colors"
                                            title="Edit Folder"
                                          >
                                            <Pencil size={12} />
                                          </button>
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                                            {(project.automationScripts || []).filter(s => (!s.source || s.source === 'script_generator') && s.folderId === folder.id).length} Saved Scripts
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteTarget({ type: 'folder', id: folder.id, name: folder.name });
                                      }}
                                      className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                      title="Delete Folder"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                    <ChevronRight size={16} className="text-slate-300 group-hover/item:text-teal-600 transition-all" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {selectionTab === 'importedFolders' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {(project.automationFolders || []).filter(f => (!f.type || f.type === 'script_generator') && f.isImported).map(folder => (
                            <div 
                              key={folder.id} 
                              onClick={() => setFolderScriptsModal({ folderId: folder.id, name: folder.name })} 
                              className="group/item p-4 rounded-2xl border bg-white border-slate-200/80 hover:border-teal-200 hover:bg-teal-50/20 transition-all cursor-pointer flex items-center justify-between gap-3"
                            >
                                <div className="flex items-center gap-3.5 min-w-0">
                                    <div className="text-slate-300 group-hover/item:text-teal-600 transition-colors flex-shrink-0">
                                        <Folder size={20}/>
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <h5 className="text-xs font-black text-slate-800 uppercase tracking-tight truncate" title={folder.name}>{folder.name}</h5>
                                          <button 
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingFolderId(folder.id);
                                              setFolderTitle(folder.name);
                                              setFolderDescription(folder.description || '');
                                              setIsFolderModalOpen(true);
                                            }}
                                            className="p-1 text-slate-300 hover:text-teal-600 transition-colors"
                                            title="Edit Folder"
                                          >
                                            <Pencil size={12} />
                                          </button>
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                                            {(project.automationScripts || []).filter(s => (!s.source || s.source === 'script_generator') && s.folderId === folder.id).length} Saved Scripts
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteTarget({ type: 'folder', id: folder.id, name: folder.name });
                                      }}
                                      className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                      title="Delete Folder"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                    <ChevronRight size={16} className="text-slate-300 group-hover/item:text-teal-600 transition-all" />
                                </div>
                            </div>
                        ))}
                        {(project.automationFolders || []).filter(f => (!f.type || f.type === 'script_generator') && f.isImported).length === 0 && (
                          <div className="md:col-span-2 py-10 flex flex-col items-center justify-center text-slate-400 gap-3 border border-dashed border-slate-200 rounded-2xl">
                            <Folder size={36} className="opacity-30" />
                            <p className="text-xs font-bold uppercase tracking-wider">No imported folders yet</p>
                          </div>
                        )}
                    </div>
                )}
            </div>
          </div>

          {/* Hidden inputs for screenshot upload and replace (strictly single image) */}
          <input
            type="file"
            ref={screenshotFileInputRef}
            onChange={(e) => {
              if (e.target.files) handleScreenshotFiles(e.target.files);
              e.target.value = '';
            }}
            accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.svg"
            className="hidden"
          />
          <input
            type="file"
            ref={replaceScreenshotFileInputRef}
            onChange={handleReplaceScreenshot}
            accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.svg"
            className="hidden"
          />

          {/* Collapsible Screenshot Accordion Section */}
          <div className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-sm">
            <div 
              onClick={() => setIsScreenshotExpanded(!isScreenshotExpanded)}
              className="flex items-center justify-between p-4 md:p-5 bg-slate-50/50 hover:bg-slate-50/90 cursor-pointer transition-all select-none"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-teal-50 text-teal-600 rounded-xl border border-teal-100 flex-shrink-0">
                  <ImageIcon size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                      Screenshot (Optional but Recommended)
                    </h4>
                    {scriptScreenshots.length > 0 && (
                      <span className="px-2 py-0.5 text-[10px] font-black bg-teal-600 text-white rounded-full">
                        1 Attached
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium mt-0.5 truncate">
                    Upload a screenshot of the UI to help AI generate accurate and reliable scripts.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                {/* Small thumbnail in collapsed view when screenshot is uploaded */}
                {!isScreenshotExpanded && scriptScreenshots.length > 0 && (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewScreenshotModal(scriptScreenshots[0]);
                    }}
                    className="relative group/thumb w-11 h-8 rounded-lg overflow-hidden border border-slate-200 shadow-sm bg-slate-100 flex-shrink-0 cursor-pointer"
                    title="Click to view full preview"
                  >
                    <img 
                      src={scriptScreenshots[0].previewUrl} 
                      alt={scriptScreenshots[0].name}
                      className="w-full h-full object-cover group-hover/thumb:scale-110 transition-transform" 
                    />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                      <Maximize2 size={11} className="text-white" />
                    </div>
                  </div>
                )}

                {/* Header Action buttons when screenshot is attached */}
                {scriptScreenshots.length > 0 && (
                  <div className="hidden sm:flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        replaceScreenshotFileInputRef.current?.click();
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 rounded-lg text-xs font-bold transition-all shadow-sm"
                    >
                      <RotateCcw size={11} /> Replace
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveScreenshots(e)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:border-rose-300 text-slate-600 hover:text-rose-600 rounded-lg text-xs font-bold transition-all shadow-sm"
                    >
                      <Trash2 size={11} /> Remove
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewScreenshotModal(scriptScreenshots[0]);
                      }}
                      className="p-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 rounded-lg transition-all shadow-sm"
                      title="Fullscreen Preview"
                    >
                      <Maximize2 size={13} />
                    </button>
                  </div>
                )}

                <div
                  aria-label={isScreenshotExpanded ? "Collapse Screenshot Section" : "Expand Screenshot Section"}
                  className={`p-1.5 rounded-lg transition-all ${isScreenshotExpanded ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}
                >
                  <ChevronDown size={16} className={`transition-transform duration-300 ${isScreenshotExpanded ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </div>

            {/* Expanded Content */}
            {isScreenshotExpanded && (
              <div className="p-6 border-t border-slate-100 bg-white animate-in slide-in-from-top-2 duration-300">
                {scriptScreenshots.length > 0 ? (
                  /* Single Screenshot Attached View */
                  <div className="flex flex-col bg-slate-50/50 border border-slate-200/80 rounded-2xl p-4 md:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/60 mb-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-1.5 bg-teal-100 text-teal-700 rounded-lg flex-shrink-0">
                          <ImageIcon size={15} />
                        </div>
                        <div className="min-w-0">
                          <h5 className="text-xs font-black text-slate-800 uppercase tracking-tight truncate max-w-sm" title={scriptScreenshots[0].name}>
                            {scriptScreenshots[0].name}
                          </h5>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                            {scriptScreenshots[0].size ? `${(scriptScreenshots[0].size / 1024).toFixed(1)} KB • ` : ''}{scriptScreenshots[0].mimeType || 'IMAGE'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => replaceScreenshotFileInputRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-bold transition-all shadow-sm"
                        >
                          <RotateCcw size={12} /> Replace Image
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleRemoveScreenshots(e)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-rose-300 text-slate-700 hover:text-rose-600 rounded-xl text-xs font-bold transition-all shadow-sm"
                        >
                          <Trash2 size={12} /> Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewScreenshotModal(scriptScreenshots[0])}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-bold transition-all shadow-sm"
                          title="Fullscreen"
                        >
                          <Maximize2 size={12} /> Fullscreen
                        </button>
                      </div>
                    </div>

                    <div 
                      onClick={() => setPreviewScreenshotModal(scriptScreenshots[0])}
                      className="group relative w-full h-[260px] md:h-[320px] bg-slate-100/90 border border-slate-200 rounded-2xl overflow-hidden cursor-pointer flex items-center justify-center p-3"
                    >
                      <img 
                        src={scriptScreenshots[0].previewUrl} 
                        alt={scriptScreenshots[0].name}
                        className="max-h-full max-w-full object-contain rounded-xl shadow-sm group-hover:scale-[1.01] transition-transform" 
                      />
                      <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <span className="bg-white/95 backdrop-blur-sm text-slate-800 px-4 py-2 rounded-xl text-xs font-bold shadow-lg flex items-center gap-2">
                          <Maximize2 size={14} /> Click to View Fullscreen Preview
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Empty State: Upload Area */
                  <div
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleScreenshotFiles(e.dataTransfer.files);
                      }
                    }}
                    className="border-2 border-dashed border-slate-200 hover:border-teal-400 rounded-2xl p-8 text-center bg-slate-50/40 hover:bg-teal-50/20 transition-all flex flex-col items-center justify-center min-h-[220px]"
                  >
                    <div className="w-14 h-14 mb-3 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center border border-teal-100 shadow-sm">
                      <Upload size={24} />
                    </div>
                    <p className="text-xs font-bold text-slate-700">
                      Drag & drop your screenshot here
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 my-2">or</p>
                    <button
                      type="button"
                      onClick={() => screenshotFileInputRef.current?.click()}
                      className="bg-[#0D9488] hover:bg-[#0F766E] text-white px-6 py-2.5 rounded-xl font-bold text-xs shadow-md shadow-teal-500/10 transition-all active:scale-95 flex items-center gap-2"
                    >
                      <Upload size={14} /> Upload Screenshot
                    </button>
                    <p className="text-[10px] text-slate-400 font-medium mt-3">
                      PNG, JPG, JPEG up to 10MB (Single Image)
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Instruction Field */}
          <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  <Sparkles size={14} className="text-teal-600" />
                  Instruction Field
                </label>
                <span className="text-[11px] font-bold text-slate-400">
                  {architecturalInstructions.length}/1000
                </span>
              </div>
              <textarea 
                value={architecturalInstructions || ''}
                maxLength={1000}
                rows={3}
                onChange={e => setArchitecturalInstructions(e.target.value)}
                placeholder="e.g. 'Use specific naming conventions', 'Add BasePage class', 'Locator strategy: data-testid first'"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all resize-none shadow-sm"
              />
              <p className="text-[10px] font-bold text-amber-600">
                * Note: Instruction text may override default behavior if there is a conflict.
              </p>
          </div>

          {/* AI Prompt Synthesis Action Bar */}
          <div className="p-6 bg-slate-50/80 border border-slate-200/90 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#0D9488] text-white flex items-center justify-center shadow-md shadow-teal-500/20 flex-shrink-0">
                      <Sparkles size={22} />
                  </div>
                  <div>
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">AI PROMPT SYNTHESIS</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                          GENERATE SMART. AUTOMATE FASTER.
                      </p>
                      <p className="text-[10px] text-teal-700 font-black uppercase tracking-wider mt-0.5">
                          {selectedItemIds.size} Selected • POM Structure Default
                      </p>
                  </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
                  <input 
                    type="file" 
                    ref={importScriptInputRef} 
                    onChange={handleFileImport} 
                    className="hidden" 
                    accept=".ts,.js,.py,.java,.cs,.txt"
                  />
                  <input 
                    type="file" 
                    ref={importZipInputRef} 
                    onChange={handleZipImport} 
                    className="hidden" 
                    accept=".zip"
                  />
                  <button 
                    type="button"
                    onClick={handleImportScriptClick}
                    className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
                  >
                      <Upload size={15} className="text-teal-600" />
                      Import Script
                  </button>
                  <button 
                    type="button"
                    onClick={handleImportZipClick}
                    disabled={isImportingZip}
                    className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                  >
                      {isImportingZip ? <Loader2 size={15} className="animate-spin text-teal-600" /> : <FolderUp size={15} className="text-teal-600" />}
                      Import Script Folder
                  </button>
                  <button 
                    type="button"
                    onClick={handleGenerateScriptDirect}
                    disabled={isGenerating}
                    className="flex items-center gap-2 bg-[#0D9488] hover:bg-[#0F766E] text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-teal-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                      {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <FileCode size={16} />}
                      {isGenerating ? 'Generating POM Script...' : 'Generate POM Script'}
                  </button>
                  {generatedContent && (
                    <button 
                      type="button"
                      onClick={() => {
                        setSaveTitle('');
                        setSaveDescription('');
                        setSelectedScriptFolderId(null);
                        setIsCreatingNewFolder(false);
                        setNewFolderName('');
                        setIsSaveModalOpen(true);
                      }}
                      disabled={isGeneratedScriptSaved}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50"
                    >
                        <Save size={15} />
                        {isGeneratedScriptSaved ? 'Saved' : 'Save Script'}
                    </button>
                  )}
              </div>
          </div>

          {/* GENERATED SCRIPT PANEL */}
          {generatedContent && (
            <div id="generated-script-panel" className="mt-10 bg-slate-950 rounded-[3rem] border border-slate-900 shadow-2xl overflow-hidden animate-in slide-in-from-top-10 duration-700">
               <div className="p-10 border-b border-white/5 flex items-center justify-between bg-white/5">
                  <div className="flex items-center gap-5">
                     <div className="p-4 bg-indigo-500/20 text-indigo-400 rounded-2xl">
                        <Terminal size={24} />
                     </div>
                     <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Generated POM Framework</h3>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Review the synthesized architecture below</p>
                     </div>
                  </div>
                  <div className="flex gap-3">
                     <button 
                       onClick={() => handleDownloadScriptAsZip({
                         id: 'temp-generated',
                         title: saveTitle || 'POM-Suite',
                         tool: config.tool,
                         language: config.language,
                         content: generatedContent
                       })}
                       title="Download POM Structure (ZIP)"
                       className="p-4 bg-white/5 text-slate-400 hover:text-indigo-400 rounded-2xl transition-all border border-white/5 flex items-center gap-2 font-black text-[11px] uppercase tracking-wider"
                     >
                        <Download size={20} />
                        <span>Download ZIP</span>
                     </button>
                     <button 
                       onClick={() => {
                         navigator.clipboard.writeText(generatedContent);
                         alert("Copied to clipboard");
                       }}
                       className="p-4 bg-white/5 text-slate-400 hover:text-white rounded-2xl transition-all border border-white/5"
                     >
                        <Copy size={20} />
                     </button>
                     <button 
                       onClick={() => setGeneratedContent(null)}
                       className="p-4 bg-white/5 text-slate-400 hover:text-rose-500 rounded-2xl transition-all border border-white/5"
                     >
                        <X size={20} />
                     </button>
                  </div>
               </div>
               <div className="p-10">
                  <pre className="text-sm font-mono text-slate-300 leading-relaxed overflow-auto custom-scrollbar max-h-[600px] whitespace-pre-wrap selection:bg-indigo-500/30">
                     {generatedContent}
                  </pre>
               </div>
               <div className="p-10 bg-white/5 border-t border-white/5 flex items-center justify-end gap-4">
                  <button 
                    onClick={() => setGeneratedContent(null)}
                    className="px-8 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-500 hover:text-white transition-all"
                  >
                    Discard
                  </button>
                  <button 
                    onClick={() => handleDownloadScriptAsZip({
                      id: 'temp-generated',
                      title: saveTitle || 'POM-Suite',
                      tool: config.tool,
                      language: config.language,
                      content: generatedContent
                    })}
                    className="px-10 py-4 bg-slate-800 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-700 transition-all shadow-xl active:scale-95 flex items-center gap-2"
                  >
                    <Download size={16} /> Download POM ZIP
                  </button>
                  <button 
                    onClick={() => {
                      setSaveTitle('');
                      setSaveDescription('');
                      setIsSaveModalOpen(true);
                    }}
                    disabled={isGeneratedScriptSaved}
                    className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl active:scale-95 disabled:opacity-50"
                  >
                    {isGeneratedScriptSaved ? 'Saved to Repository' : 'Confirm & Save to Repository'}
                  </button>
               </div>
            </div>
          )}
        </div>
      )}

      {/* EXECUTION HUB STYLE HEADER FOR viewOnly MODE */}
      {viewOnly ? (
        <div className="bg-white p-8 md:p-10 rounded-[3.5rem] border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start md:items-center gap-6">
            <div className="p-5 md:p-6 bg-indigo-600 rounded-[2rem] text-white shadow-2xl shadow-indigo-200 flex-shrink-0">
               <Terminal size={32} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-black uppercase tracking-tight leading-none">Script Execution</h2>
              <p className="text-xs text-slate-500 font-bold mt-2 flex items-center gap-1.5 leading-relaxed">
                <Info size={14} className="text-indigo-600 shrink-0" />
                To execute automation scripts, navigate to Automation → Script Generator, locate the generated script in the Automation Repository, and click the Approve button.
              </p>
            </div>
          </div>
          
          <div className="relative group w-full lg:w-[380px]">
             <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
             <input 
               type="text" 
               placeholder="Search scripts by test case or tool..." 
               value={scriptSearch || ''}
               onChange={(e) => setScriptSearch(e.target.value)}
               className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-inner"
             />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
               <div className="p-3 bg-slate-100 rounded-2xl text-slate-400">
                  <Database size={24} />
               </div>
               <div>
                  <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Automation Repository</h2>
               </div>
            </div>
            <div className="relative group max-w-sm w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={16} />
                <input 
                  type="text" 
                  placeholder="Filter artifacts..." 
                  value={scriptSearch || ''}
                  onChange={(e) => setScriptSearch(e.target.value)}
                  className="w-full pl-11 pr-5 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold focus:ring-4 ring-indigo-50/10 outline-none transition-all"
                />
            </div>
        </div>
      )}

      {/* SCRIPT LIST */}
      <div className="space-y-6">
        {filteredScripts.length === 0 ? (
            viewOnly ? (
              <div className="py-20 text-center bg-white border-2 border-dashed border-slate-200 rounded-[3.5rem] p-8 flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center text-indigo-600 shadow-sm">
                    <Terminal size={32} />
                  </div>
                  <div className="max-w-lg">
                    <h4 className="text-base font-black text-slate-800 uppercase tracking-tight mb-2">No Approved Scripts in Execution Queue</h4>
                    <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                      To execute automation scripts, navigate to <span className="text-indigo-600 font-black">Automation → Script Generator</span>, locate the generated script in the Automation Repository, and click the <span className="text-emerald-600 font-black">Approve</span> button.
                    </p>
                  </div>
              </div>
            ) : (
              <div className="py-32 text-center bg-white border-2 border-dashed border-slate-200 rounded-[3.5rem] flex flex-col items-center justify-center gap-6 opacity-30">
                  <Database size={64} className="text-slate-300" />
                  <p className="text-sm font-black uppercase tracking-[0.4em] text-slate-500">No active scripts found</p>
              </div>
            )
        ) : (
            <div className="flex flex-col gap-6">
                {filteredScripts.map(script => (
                    viewOnly ? (
                      /* EXECUTION HUB CARD STYLE */
                      <div key={script.id} className="bg-white rounded-[2.5rem] border border-indigo-100 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col group/exec-card">
                         <div className="p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                            <div className="flex items-center gap-8 min-w-0">
                               <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center text-xl font-black shadow-inner flex-shrink-0">
                                  {script.tool.charAt(0).toUpperCase()}
                               </div>
                               <div className="min-w-0">
                                  <div className="flex items-center gap-4">
                                     <h4 className="text-xl font-black text-slate-800 uppercase tracking-tight break-words whitespace-normal leading-relaxed" title={script.title || `${script.tool.toUpperCase()} SCRIPT`}>{script.title || `${script.tool.toUpperCase()} SCRIPT`}</h4>
                                     <span className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-full text-[9px] font-black text-slate-500 uppercase tracking-widest">{script.language}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-2 text-slate-400">
                                     <Calendar size={14} className="opacity-50" />
                                     <span className="text-[11px] font-bold">{new Date(script.createdAt).toLocaleDateString('en-GB')}</span>
                                  </div>
                                  {(script.evidence || script.evidenceUrl) && (
                                     <div className="flex items-center gap-2 mt-2 flex-wrap">
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-black uppercase tracking-wider">
                                           <Paperclip size={12} /> Evidence Attached
                                        </span>
                                        {script.evidenceUrl && (
                                           <a 
                                             href={script.evidenceUrl} 
                                             target="_blank" 
                                             rel="noopener noreferrer"
                                             onClick={(e) => e.stopPropagation()}
                                             className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full text-[10px] font-bold hover:bg-indigo-100 transition-all"
                                           >
                                              <Link2 size={12} /> Video Link <ExternalLink size={10} />
                                           </a>
                                        )}
                                     </div>
                                  )}
                               </div>
                            </div>

                            <div className="flex flex-col md:flex-row md:items-center gap-8">
                               <div className="flex flex-col gap-2">
                                  <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1">Execution Status</label>
                                  <div className="relative w-64">
                                     <select 
                                       value={script.lastExecutionStatus || TestStatus.NOT_EXECUTED}
                                       onChange={(e) => handleUpdateStatus(script.id, e.target.value)}
                                       className={`w-full pl-5 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-widest outline-none appearance-none cursor-pointer focus:ring-4 ring-indigo-50/10 transition-all hover:bg-white shadow-inner ${
                                         script.lastExecutionStatus === TestStatus.PASS || script.lastExecutionStatus === 'SUCCESS' ? 'text-emerald-600 bg-emerald-50/50' :
                                         script.lastExecutionStatus === TestStatus.FAIL || script.lastExecutionStatus === 'FAILURE' ? 'text-red-600 bg-red-50/50' :
                                         script.lastExecutionStatus === TestStatus.BLOCKED ? 'text-amber-600 bg-amber-50/50' :
                                         'text-slate-500'
                                       }`}
                                     >
                                        <option value={TestStatus.NOT_EXECUTED}>NOT EXECUTED</option>
                                        <option value={TestStatus.PASS}>PASSED</option>
                                        <option value={TestStatus.FAIL}>FAILED</option>
                                        <option value={TestStatus.BLOCKED}>BLOCKED</option>
                                     </select>
                                     <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                                  </div>
                               </div>

                               <div className="flex items-center gap-4">
                                  <div className="flex flex-col items-center gap-2">
                                     {script.evidence && (
                                        <div 
                                          onClick={() => setPreviewMedia({ url: script.evidence!, type: isVideo(script.evidence!) ? 'video' : 'image', scriptId: script.id })}
                                          className="w-14 h-14 rounded-2xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer hover:ring-2 ring-indigo-500 transition-all relative group/thumb flex-shrink-0 bg-slate-900"
                                          title="Click to zoom evidence preview"
                                        >
                                           {isVideo(script.evidence) ? (
                                             <div className="w-full h-full flex items-center justify-center text-white/80">
                                               <FileVideo size={24} />
                                             </div>
                                           ) : (
                                             <img src={script.evidence || undefined} className="w-full h-full object-cover" alt="Evidence" />
                                           )}
                                           <div className="absolute inset-0 bg-indigo-600/20 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
                                              <Maximize2 size={16} />
                                           </div>
                                        </div>
                                     )}
                                     {script.evidenceUrl && (
                                        <a 
                                          href={script.evidenceUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="text-[9px] font-black text-indigo-600 hover:text-indigo-700 underline uppercase tracking-widest flex items-center gap-1"
                                        >
                                           <Link2 size={10} /> Video URL
                                        </a>
                                     )}
                                  </div>
                                  <button 
                                    onClick={() => setEvidenceModalScript(script)}
                                    className={`flex items-center gap-3 bg-white border px-8 py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-sm active:scale-95 ${(script.evidence || script.evidenceUrl) ? 'text-emerald-600 border-emerald-100 hover:bg-emerald-50' : 'text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                                  >
                                     {(script.evidence || script.evidenceUrl) ? <Check size={18} className="text-emerald-500" /> : <Paperclip size={18} className="text-indigo-600" />} {(script.evidence || script.evidenceUrl) ? 'ATTACHED' : 'ATTACH'}
                                  </button>
                                  <button 
                                    onClick={() => toggleCodeVisibility(script.id)}
                                    className="flex items-center gap-3 bg-white border border-slate-200 text-slate-700 px-8 py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95"
                                  >
                                     <Eye size={18} className="text-indigo-600" /> {visibleCodeIds.has(script.id) ? 'HIDE CODE' : 'VIEW CODE'}
                                  </button>
                                  <button 
                                    onClick={() => setGithubPushScript(script)}
                                    title="Push script code to GitHub Repository"
                                    className="p-3.5 bg-white border border-slate-200 text-slate-400 hover:text-slate-900 rounded-2xl transition-all shadow-sm active:scale-95"
                                  >
                                     <Github size={18} />
                                  </button>
                                  {(script.lastExecutionStatus === TestStatus.FAIL || script.lastExecutionStatus === 'FAILURE') && (
                                     <button 
                                       onClick={() => setJiraBugScript(script)}
                                       title="Create Jira Bug Ticket"
                                       className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-5 py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-rose-100 transition-all shadow-sm active:scale-95 animate-in"
                                     >
                                        <AlertTriangle size={18} /> Create Bug
                                     </button>
                                  )}
                                  <button 
                                    onClick={() => setDeleteTarget({ type: 'script', id: script.id, name: script.testCaseTitles?.[0] || 'Artifact' })}
                                    className="p-3.5 bg-white border border-slate-200 text-slate-300 rounded-2xl hover:text-rose-500 transition-all shadow-sm active:scale-95"
                                  >
                                     <Trash2 size={18} />
                                  </button>
                               </div>
                            </div>
                         </div>

                         {/* EXPANDABLE CODE PREVIEW */}
                         {visibleCodeIds.has(script.id) && (
                           <div className="bg-slate-950 p-8 border-t border-slate-900 animate-in slide-in-from-top-4 duration-300">
                              <div className="flex items-center justify-between mb-6">
                                 <h5 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Automation Logic Stream</h5>
                                 <div className="flex gap-2">
                                    <button onClick={() => handleCopyScript(script.content, script.id)} className="p-2.5 bg-white/5 text-white/50 hover:text-white rounded-xl transition-all">
                                      {isCopied === script.id ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                                    </button>
                                    <button onClick={() => handleDownloadScript(script)} className="p-2.5 bg-white/5 text-white/50 hover:text-white rounded-xl transition-all" title="Download Raw File"><Download size={16} /></button><button onClick={() => handleDownloadScriptAsZip(script)} className="p-2.5 bg-white/5 text-indigo-400 hover:text-indigo-300 rounded-xl transition-all ml-2" title="Download POM Structure (ZIP)"><FileArchive size={16} /></button>
                                 </div>
                              </div>
                              <pre className="text-sm font-mono text-white leading-relaxed overflow-auto custom-scrollbar max-h-[500px] whitespace-pre-wrap selection:bg-indigo-500/30">
                                 {script.content}
                              </pre>
                           </div>
                         )}
                      </div>
                    ) : (
                      /* WORKSPACE REPOSITORY CARD STYLE */
                      <div key={script.id} className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col transition-all hover:shadow-xl group">
                          <div className="p-8 flex items-center justify-between border-b border-slate-50 bg-slate-50/30">
                              <div className="flex items-center gap-5">
                                  <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl">
                                      <Terminal size={24} />
                                  </div>
                                  <div>
                                      <h4 className="font-black text-indigo-600 text-lg uppercase tracking-tight">
                                          {script.title || `${script.tool.toUpperCase()} — ${script.language.toUpperCase()}`}
                                      </h4>
                                      <div className="flex items-center gap-3 mt-1">
                                          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                                              {new Date(script.createdAt).toLocaleDateString('en-GB')}
                                          </p>
                                          {script.folderId && (
                                             <span className="flex items-center gap-1 text-[9px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100 uppercase tracking-tighter shadow-sm">
                                                 <Folder size={10} /> {project.automationFolders?.find(f => f.id === script.folderId)?.name || 'Folder'}
                                             </span>
                                          )}
                                          {script.isApproved && (
                                              <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-tighter shadow-sm">
                                                  <CheckCircle size={10} strokeWidth={3} /> Verified Artifact
                                              </span>
                                          )}
                                      </div>
                                  </div>
                              </div>
                              
                              <div className="flex items-center gap-3">
                                  <button 
                                      onClick={() => {
                                          if (unsavedChanges[script.id]) {
                                              handleSaveExistingScript(script.id);
                                          } else {
                                              setSaveTitle(script.title || '');
                                              setSaveDescription(script.description || '');
                                              setSelectedScriptFolderId(script.folderId || null);
                                              setIsSaveModalOpen(true);
                                          }
                                      }}
                                      disabled={!unsavedChanges[script.id]}
                                      className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50 ${unsavedChanges[script.id] ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400'}`}
                                  >
                                      <Save size={16} /> {unsavedChanges[script.id] ? 'Save Changes' : 'Saved'}
                                  </button>

                                  {unsavedChanges[script.id] && (
                                    <button 
                                        onClick={() => handleDiscardChanges(script.id)}
                                        className="flex items-center gap-2 px-6 py-2.5 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all shadow-sm active:scale-95"
                                    >
                                        <RotateCcw size={16} /> Discard
                                    </button>
                                  )}

                                  <button 
                                      onClick={() => handleApproveScript(script.id)}
                                      className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${script.isApproved ? 'bg-indigo-600 text-white border-indigo-700 shadow-lg' : 'bg-white text-slate-400 border-slate-200 hover:text-indigo-600 hover:border-indigo-200'}`}
                                  >
                                      <CheckCircle size={16} /> {script.isApproved ? 'Approved' : 'Approve'}
                                  </button>

                                  <button 
                                      onClick={() => {
                                        setAppendModalScript(script);
                                        setSelectedAppendItemIds(new Set());
                                        setSelectedAppendFolderIds(new Set());
                                      }}
                                      className="flex items-center gap-2 px-6 py-2.5 bg-white text-slate-400 border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm active:scale-95"
                                  >
                                      <Plus size={16} /> Append
                                  </button>
                                  
                                  <button onClick={() => handleStartEditScript(script)} className="p-3 bg-white text-slate-400 border border-slate-200 rounded-xl hover:text-indigo-600 transition-all shadow-sm" title="Edit Content"><Pencil size={18} /></button>
                                  <button onClick={() => handleDownloadScript(script)} className="p-3 bg-white text-slate-400 border border-slate-200 rounded-xl hover:text-indigo-600 transition-all shadow-sm" title="Download Raw File"><Download size={18} /></button>
                                  <button onClick={() => handleDownloadScriptAsZip(script)} className="p-3 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-all shadow-sm" title="Download POM Structure (ZIP)"><FileArchive size={18} /></button>
                                  <button 
                                      onClick={() => setGithubPushScript(script)}
                                      title="Push script code to GitHub Repository"
                                      className="p-3 bg-white text-slate-400 border border-slate-200 rounded-xl hover:text-slate-900 hover:border-slate-300 transition-all shadow-sm active:scale-95"
                                  >
                                      <Github size={18} />
                                  </button>
                                  {(script.lastExecutionStatus === TestStatus.FAIL || script.lastExecutionStatus === 'FAILURE') && (
                                      <button 
                                          onClick={() => setJiraBugScript(script)}
                                          title="Create Jira Bug Ticket"
                                          className="flex items-center gap-2 px-6 py-2.5 bg-rose-50 text-rose-605 text-rose-600 border border-rose-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all shadow-sm active:scale-95"
                                      >
                                          <AlertTriangle size={16} /> Create Bug
                                      </button>
                                  )}
                                  <button onClick={() => handleCopyScript(script.content, script.id)} className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg active:scale-95">
                                      {isCopied === script.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />} 
                                      {isCopied === script.id ? 'Copied' : 'Copy'}
                                  </button>
                                  <button onClick={() => setDeleteTarget({ type: 'script', id: script.id, name: script.testCaseTitles?.[0] || 'Artifact' })} className="p-3 bg-white text-slate-300 border border-slate-100 rounded-xl hover:text-rose-500 transition-all shadow-sm"><Trash2 size={18} /></button>
                              </div>
                          </div>

                          <div className="bg-slate-950 p-8 relative group/code overflow-hidden">
                              {script.description && (
                                 <div className="px-8 py-4 bg-white/5 border-b border-white/10">
                                    <p className="text-xs text-white font-medium leading-relaxed italic">
                                       "{script.description}"
                                    </p>
                                 </div>
                              )}
                              {editingScriptId === script.id ? (
                                  <div className="space-y-4 animate-in fade-in duration-300">
                                      <textarea 
                                          value={editScriptContent || ''}
                                          onChange={e => setEditScriptContent(e.target.value)}
                                          className="w-full h-[400px] bg-slate-900 text-white font-mono text-sm leading-relaxed p-6 rounded-2xl border border-white/5 outline-none focus:ring-2 ring-indigo-500/30 shadow-inner resize-none"
                                      />
                                      <div className="flex justify-end gap-3">
                                          <button onClick={() => setEditingScriptId(null)} className="px-6 py-2 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:text-white transition-all">Cancel</button>
                                          <button onClick={handleSaveEditScript} className="flex items-center gap-2 px-8 py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-xl"><Save size={14} /> Commit Changes</button>
                                      </div>
                                  </div>
                              ) : (
                                  <pre className="text-sm font-mono text-white leading-relaxed overflow-auto custom-scrollbar max-h-[500px] whitespace-pre-wrap selection:bg-indigo-500/30">
                                      {unsavedChanges[script.id]?.content || script.content}
                                  </pre>
                              )}
                          </div>

                          {/* REFINE SECTION */}
                          {!viewOnly && (
                            <div className="p-8 bg-slate-50 border-t border-slate-100">
                                <div className="flex items-center gap-3 mb-4 ml-2">
                                    <Sparkles size={16} className="text-indigo-600" />
                                    <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Refine POM Project or Folder Structure</h5>
                                </div>
                                <div className="flex flex-col md:flex-row gap-4">
                                    <div className="flex-1 relative group">
                                        <Sparkles className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                                        <input 
                                          type="text"
                                          value={refinementInputs[script.id] || ''}
                                          onChange={e => setRefinementInputs(prev => ({ ...prev, [script.id]: e.target.value }))}
                                          placeholder="e.g. 'Add a BasePage class' or 'Organize tests by functional module'"
                                          className="w-full pl-14 pr-6 py-4 bg-white border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-sm"
                                          onKeyDown={e => e.key === 'Enter' && handleRefineScript(script)}
                                        />
                                    </div>
                                    <button 
                                      onClick={() => handleRefineScript(script)}
                                      disabled={isRefining[script.id]}
                                      className="flex items-center justify-center gap-3 bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95 disabled:opacity-50 min-w-[160px]"
                                    >
                                        {isRefining[script.id] ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                        Refine
                                    </button>
                                </div>
                                <p className="mt-4 text-[9px] text-slate-400 font-bold uppercase tracking-widest ml-4 italic">
                                    Your job is to extend or refine the user’s automation suite, not replace it.
                                </p>
                            </div>
                          )}
                      </div>
                    )
                ))}
            </div>
        )}
      </div>

      {/* SCRIPT FOLDER MODAL */}
      {isFolderModalOpen && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 border border-white">
              <div className="p-8 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-lg"><Folder size={22} /></div>
                    <div>
                       <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">{editingFolderId ? 'Edit Folder' : 'Create Folder'}</h3>
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Organize your automation scripts</p>
                    </div>
                 </div>
                 <button onClick={() => setIsFolderModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-all"><X size={24} /></button>
              </div>
              <div className="p-8 space-y-6">
                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Folder Title</label>
                    <input 
                      type="text" 
                      value={folderTitle || ''}
                      onChange={e => setFolderTitle(e.target.value)}
                      placeholder="e.g. Smoke Tests"
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all"
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Description</label>
                    <textarea 
                      value={folderDescription || ''}
                      onChange={e => setFolderDescription(e.target.value)}
                      placeholder="What's in this folder?"
                      rows={3}
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all resize-none"
                    />
                 </div>
                 <div className="flex gap-3 pt-4">
                    <button onClick={() => setIsFolderModalOpen(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
                    <button 
                      onClick={handleCreateFolder}
                      disabled={!folderTitle.trim()}
                      className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                    >
                       {editingFolderId ? 'Update Folder' : 'Add Folder'}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* EVIDENCE UPLOAD MODAL */}
      {evidenceModalScript && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-lg rounded-[3rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 border border-white">
              <div className="p-8 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-lg"><Paperclip size={22} /></div>
                    <div>
                       <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Attach Evidence</h3>
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Sign-off artifact with execution proof</p>
                    </div>
                 </div>
                 <button onClick={() => setEvidenceModalScript(null)} className="p-2 text-slate-400 hover:text-slate-600 transition-all"><X size={24} /></button>
              </div>
               <div className="p-10 space-y-8">
                 <div 
                   onClick={() => !isUploadingEvidence && fileInputRef.current?.click()}
                   className={`border-4 border-dashed border-slate-100 rounded-[2rem] p-12 flex flex-col items-center justify-center gap-4 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 transition-all cursor-pointer group ${isUploadingEvidence ? 'opacity-50' : ''}`}
                 >
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*" onChange={handleFileUploadEvidence} />
                    {isUploadingEvidence ? (
                      <Loader2 size={32} className="animate-spin text-indigo-600" />
                    ) : evidenceModalScript.evidence ? (
                      <div className="relative w-full h-32 rounded-xl overflow-hidden">
                        <img src={evidenceModalScript.evidence || undefined} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Upload size={24} className="text-white" />
                        </div>
                      </div>
                    ) : (
                      <Upload size={32} className="text-slate-300 group-hover:text-indigo-400" />
                    )}
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Upload Screenshot</p>
                 </div>

                 <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2">
                       <Link2 size={12} /> Or Paste Video URL
                    </label>
                    <input 
                       type="text" 
                       placeholder="https://example.com/video.mp4"
                       className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-600 focus:outline-none focus:ring-2 ring-indigo-500/20 transition-all"
                       value={evidenceModalScript.evidenceUrl || ''}
                       onChange={(e) => setEvidenceModalScript({ ...evidenceModalScript, evidenceUrl: e.target.value })}
                    />
                 </div>

                 {(evidenceModalScript.evidence || evidenceModalScript.evidenceUrl) && (
                   <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center gap-3">
                      <CheckCircle2 size={18} className="text-emerald-600" />
                      <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Evidence staged</p>
                   </div>
                 )}

                 <div className="flex gap-3">
                    <button onClick={handleSaveEvidence} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95">Save Evidence</button>
                    <button onClick={() => setEvidenceModalScript(null)} className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* APPEND SCRIPT MODAL */}
      {appendModalScript && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-4xl rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 border border-white max-h-[90vh]">
              <div className="p-10 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-6">
                    <div className="p-5 bg-indigo-600 rounded-[1.5rem] text-white shadow-2xl shadow-indigo-100">
                       <Plus size={32} />
                    </div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Append to Script</h3>
                       <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-1">Select up to 20 test cases to append</p>
                    </div>
                 </div>
                 <button onClick={() => setAppendModalScript(null)} className="p-3 text-slate-400 hover:text-slate-600 hover:bg-white rounded-full transition-all border border-slate-100 shadow-sm"><X size={32} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-12 space-y-12 custom-scrollbar bg-white">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Reuse selection logic UI but for append */}
                      <div className="space-y-6">
                          <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-2">Individual Test Cases</h4>
                          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                              {individualItems.map(item => (
                                  <div 
                                    key={item.id} 
                                    onClick={() => {
                                      const next = new Set(selectedAppendItemIds);
                                      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                                      setSelectedAppendItemIds(next);
                                    }} 
                                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center gap-4 ${selectedAppendItemIds.has(item.id) ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-100 hover:bg-white hover:border-indigo-100'}`}
                                  >
                                      <div className={selectedAppendItemIds.has(item.id) ? 'text-indigo-600' : 'text-slate-300'}>
                                          {selectedAppendItemIds.has(item.id) ? <CheckSquare size={20}/> : <Square size={20}/>}
                                      </div>
                                      <div className="min-w-0">
                                          <p className="text-xs font-bold text-slate-700 truncate">{item.title}</p>
                                          <p className="text-[9px] text-slate-400 font-bold uppercase">{item.subtitle}</p>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>

                      <div className="space-y-6">
                          <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-2">Test Case Folders</h4>
                          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                              {folderItems.map(folder => (
                                  <div 
                                    key={folder.id} 
                                    onClick={() => {
                                      const next = new Set(selectedAppendFolderIds);
                                      if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
                                      setSelectedAppendFolderIds(next);
                                    }} 
                                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center gap-4 ${selectedAppendFolderIds.has(folder.id) ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-100 hover:bg-white hover:border-indigo-100'}`}
                                  >
                                      <div className={selectedAppendFolderIds.has(folder.id) ? 'text-indigo-600' : 'text-slate-300'}>
                                          {selectedAppendFolderIds.has(folder.id) ? <CheckSquare size={20}/> : <Square size={20}/>}
                                      </div>
                                      <div className="min-w-0">
                                          <p className="text-xs font-bold text-slate-700 truncate">{folder.title}</p>
                                          <p className="text-[9px] text-slate-400 font-bold uppercase">{folder.subtitle}</p>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>

                      <div className="space-y-6">
                          <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-2">Scripts from Folders</h4>
                          <div className="space-y-3">
                              {(project.automationScripts || [])
                                .filter(s => (!s.source || s.source === 'script_generator') && s.id !== appendModalScript.id)
                                .map(script => (
                                  <div 
                                    key={script.id} 
                                    onClick={() => {
                                      const next = new Set(selectedAppendScriptIds);
                                      if (next.has(script.id)) next.delete(script.id); else next.add(script.id);
                                      setSelectedAppendScriptIds(next);
                                    }} 
                                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center gap-4 ${selectedAppendScriptIds.has(script.id) ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-100 hover:bg-white hover:border-indigo-100'}`}
                                  >
                                      <div className={selectedAppendScriptIds.has(script.id) ? 'text-indigo-600' : 'text-slate-300'}>
                                          {selectedAppendScriptIds.has(script.id) ? <CheckSquare size={20}/> : <Square size={20}/>}
                                      </div>
                                      <div className="min-w-0">
                                          <p className="text-xs font-bold text-slate-700 truncate">{script.title || `${script.tool} Script`}</p>
                                          <p className="text-[9px] text-slate-400 font-bold uppercase">
                                            {project.automationFolders?.find(f => f.id === script.folderId)?.name || 'Root'}
                                          </p>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>

              <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex items-center justify-end gap-4">
                  <div className="mr-auto">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          Selected: {Array.from(selectedAppendItemIds).length + Array.from(selectedAppendFolderIds).length + Array.from(selectedAppendScriptIds).length} Items
                      </p>
                  </div>
                  <button 
                    onClick={() => {
                      setAppendModalScript(null);
                      setSelectedAppendItemIds(new Set());
                      setSelectedAppendFolderIds(new Set());
                      setSelectedAppendScriptIds(new Set());
                    }} 
                    className="px-8 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleAppendGenerate}
                    disabled={isAppending || (Array.from(selectedAppendItemIds).length + Array.from(selectedAppendFolderIds).length + Array.from(selectedAppendScriptIds).length === 0)}
                    className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-700 shadow-xl active:scale-95 transition-all flex items-center gap-3 disabled:opacity-50"
                  >
                    {isAppending ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
                    {isAppending ? 'Appending...' : 'Generate & Append'}
                  </button>
              </div>
           </div>
        </div>
      )}

      {/* FULL SCREEN MEDIA PREVIEW */}
      {previewMedia && (
        <div className="fixed inset-0 z-[7000] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 md:p-12 animate-in fade-in duration-300" onClick={() => setPreviewMedia(null)}>
            <div className="absolute top-8 right-8 flex items-center gap-4 z-[7001]">
                {previewMedia.scriptId && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        const updated = (project.automationScripts || []).map(s => 
                          s.id === previewMedia.scriptId ? { ...s, evidence: undefined, evidenceUrl: undefined } : s
                        );
                        onUpdateProject({ ...project, automationScripts: updated });
                        setPreviewMedia(null);
                      }}
                      className="p-3 bg-rose-500/20 hover:bg-rose-500 text-rose-500 hover:text-white rounded-full transition-all border border-rose-500/30 flex items-center gap-2 px-6"
                    >
                        <Trash2 size={20} />
                        <span className="text-[10px] font-black uppercase tracking-widest">Delete Evidence</span>
                    </button>
                )}
                <button 
                  onClick={() => setPreviewMedia(null)}
                  className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all border border-white/20"
                >
                    <X size={32} />
                </button>
            </div>
            <div className="relative w-full h-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
                {previewMedia.type === 'video' ? (
                    <video src={previewMedia.url || undefined} controls autoPlay className="max-w-full max-h-full rounded-xl shadow-2xl" />
                ) : (
                    <img src={previewMedia.url || undefined} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl animate-in zoom-in-95 duration-300" alt="Evidence Preview" />
                )}
            </div>
        </div>
      )}

      {/* SAVE SCRIPT MODAL */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-emerald-600 rounded-xl text-white shadow-lg">
                            <Save size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Save Script</h3>
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Archive to repository</p>
                        </div>
                    </div>
                    <button onClick={() => setIsSaveModalOpen(false)} className="p-2 text-slate-400 hover:text-rose-500 transition-all">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 space-y-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Title (Mandatory)</label>
                        <input 
                          value={saveTitle || ''}
                          onChange={e => setSaveTitle(e.target.value)}
                          placeholder="e.g. Login Flow Validation"
                          className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Description (Mandatory)</label>
                        <textarea 
                          value={saveDescription || ''}
                          onChange={e => setSaveDescription(e.target.value)}
                          placeholder="What does this script cover?"
                          rows={3}
                          className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all resize-none"
                        />
                    </div>

                    <div className="space-y-4">
                        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Target Folder (Mandatory)</label>
                        <div className="flex items-center gap-4 border-b border-slate-100 pb-3 shrink-0">
                            <button 
                              type="button"
                              onClick={() => setIsCreatingNewFolder(false)}
                              className={`flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${!isCreatingNewFolder ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                            >
                              Existing Folder
                            </button>
                            <button 
                              type="button"
                              onClick={() => {
                                setIsCreatingNewFolder(true);
                              }}
                              className={`flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${isCreatingNewFolder ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                            >
                              + Create New
                            </button>
                        </div>
                        
                        {isCreatingNewFolder ? (
                            <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                                <input 
                                    value={newFolderName || ''}
                                    onChange={e => setNewFolderName(e.target.value)}
                                    placeholder="Enter new folder name"
                                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all"
                                />
                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest ml-1">Folder will be created under Imported Scripts</p>
                            </div>
                        ) : (
                            <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-200 flex flex-col">
                                <div className="relative shrink-0">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input 
                                      type="text"
                                      className="w-full pl-12 pr-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all"
                                      placeholder="Search folders..."
                                      value={searchFolderQuery || ''}
                                      onChange={e => setSearchFolderQuery(e.target.value)}
                                    />
                                </div>

                                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                                    {((project.automationFolders || []).filter(f => (!f.type || f.type === 'script_generator') && f.name.toLowerCase().includes(searchFolderQuery.toLowerCase())).length === 0) ? (
                                      <div className="py-6 text-center text-slate-400 italic text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
                                        No folders found. Create a new one!
                                      </div>
                                    ) : (
                                      (project.automationFolders || [])
                                        .filter(f => (!f.type || f.type === 'script_generator') && f.name.toLowerCase().includes(searchFolderQuery.toLowerCase()))
                                        .map(folder => (
                                          <button
                                            key={folder.id}
                                            type="button"
                                            onClick={() => setSelectedScriptFolderId(folder.id)}
                                            className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left transition-all ${selectedScriptFolderId === folder.id ? 'bg-indigo-50 border-indigo-400 text-indigo-950 font-black' : 'bg-white border-slate-100 hover:border-slate-200 text-slate-700 font-bold'}`}
                                          >
                                            <span className="text-xs uppercase tracking-tight break-all pr-2">{folder.name}</span>
                                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${selectedScriptFolderId === folder.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200'}`}>
                                              {selectedScriptFolderId === folder.id && <Check size={12} strokeWidth={3} />}
                                            </div>
                                          </button>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-8 bg-slate-50/50 border-t border-slate-100 flex items-center justify-end gap-3">
                    <button onClick={() => setIsSaveModalOpen(false)} className="px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-all">
                        Cancel
                    </button>
                    <button 
                      onClick={handleSaveScript}
                      disabled={!saveTitle.trim() || !saveDescription.trim() || (isCreatingNewFolder ? !newFolderName.trim() : !selectedScriptFolderId)}
                      className="px-8 py-3 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95 disabled:opacity-50"
                    >
                        Confirm & Save
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* FOLDER SCRIPTS MODAL */}
      {folderScriptsModal && (
        <div className="fixed inset-0 z-[6500] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 border border-white">
              <div className="p-8 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-lg"><Folder size={22} /></div>
                    <div>
                       <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">{folderScriptsModal.name}</h3>
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Saved scripts in this folder</p>
                    </div>
                 </div>
                 <div className="flex items-center gap-2">
                   <button 
                     type="button"
                     onClick={() => {
                       const folderId = folderScriptsModal.folderId;
                       const folderName = folderScriptsModal.name;
                       setFolderScriptsModal(null);
                       setDeleteTarget({ type: 'folder', id: folderId, name: folderName });
                     }}
                     className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                     title="Delete Folder"
                   >
                     <Trash2 size={20} />
                   </button>
                   <button onClick={() => setFolderScriptsModal(null)} className="p-2 text-slate-400 hover:text-slate-600 transition-all"><X size={24} /></button>
                 </div>
              </div>
              <div className="p-8 overflow-y-auto custom-scrollbar space-y-4">
                 {(project.automationScripts || [])
                   .filter(s => (!s.source || s.source === 'script_generator') && s.folderId === folderScriptsModal.folderId)
                   .map(script => (
                    <div 
                      key={script.id} 
                      onClick={() => {
                        setFolderScriptsModal(null);
                        setScriptSearch(script.title || script.tool);
                        setTimeout(() => {
                          const element = document.getElementById(`script-card-${script.id}`);
                          if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                      }}
                      className="p-6 bg-slate-50 border border-slate-100 rounded-[2rem] hover:border-indigo-200 hover:bg-white transition-all cursor-pointer group/script-item"
                    >
                       <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                             <div className="p-3 bg-white rounded-xl text-indigo-600 shadow-sm border border-slate-100 group-hover/script-item:bg-indigo-600 group-hover/script-item:text-white transition-all">
                                <Terminal size={18} />
                             </div>
                             <div>
                                <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">{script.title || `${script.tool} Script`}</h4>
                                <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{script.language} • {new Date(script.createdAt).toLocaleDateString()}</p>
                             </div>
                          </div>
                          <div className="flex items-center gap-2">
                             <button
                               type="button"
                               onClick={(e) => {
                                 e.stopPropagation();
                                 setDeleteTarget({ type: 'script', id: script.id, name: script.title || script.tool });
                               }}
                               className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                               title="Delete Script"
                             >
                               <Trash2 size={16} />
                             </button>
                             <ChevronRight size={18} className="text-slate-300 group-hover/script-item:text-indigo-400" />
                          </div>
                       </div>
                    </div>
                 ))}
                 {(project.automationScripts || []).filter(s => (!s.source || s.source === 'script_generator') && s.source !== 'record_play' && s.folderId === folderScriptsModal.folderId).length === 0 && (
                    <div className="py-12 text-center">
                       <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No scripts found in this folder</p>
                    </div>
                 )}
              </div>
              <div className="p-8 bg-slate-50/50 border-t border-slate-100">
                 <button onClick={() => setFolderScriptsModal(null)} className="w-full py-4 bg-white text-slate-500 border border-slate-200 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all">Close</button>
              </div>
           </div>
        </div>
      )}

      {/* DELETE MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-sm rounded-[3rem] p-10 text-center shadow-2xl animate-in zoom-in-95">
             <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-8 text-red-500">
                <AlertTriangle size={40} />
             </div>
             <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-4">Confirm Deletion</h3>
             <p className="text-sm text-slate-500 font-medium leading-relaxed mb-10 px-4">
                Permanently remove <span className="font-bold text-slate-800">"{deleteTarget.name}"</span>? 
                This action is irreversible.
             </p>
             <div className="flex flex-col gap-3">
                <button onClick={handleDeleteConfirmed} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700 shadow-lg active:scale-95">Delete Permanently</button>
                <button onClick={() => setDeleteTarget(null)} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200">Keep It</button>
             </div>
          </div>
        </div>
      )}

      {/* SCREENSHOT FULLSCREEN PREVIEW MODAL */}
      {previewScreenshotModal && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col border border-slate-200 animate-in zoom-in-95 duration-200">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-teal-50 text-teal-600 rounded-xl border border-teal-100">
                  <ImageIcon size={18} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight truncate max-w-md">
                    {previewScreenshotModal.name}
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                    {previewScreenshotModal.size ? `${(previewScreenshotModal.size / 1024).toFixed(1)} KB • ` : ''}{previewScreenshotModal.mimeType || 'IMAGE'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setPreviewScreenshotModal(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-900/5 flex items-center justify-center min-h-[300px]">
              <img 
                src={previewScreenshotModal.previewUrl} 
                alt={previewScreenshotModal.name}
                className="max-h-[70vh] max-w-full object-contain rounded-xl shadow-md"
              />
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPreviewScreenshotModal(null);
                    replaceScreenshotFileInputRef.current?.click();
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-sm"
                >
                  <RotateCcw size={13} /> Replace Image
                </button>
                <button
                  onClick={(e) => {
                    handleRemoveScreenshots(e);
                    setPreviewScreenshotModal(null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-rose-300 text-slate-700 hover:text-rose-600 rounded-xl text-xs font-bold transition-all shadow-sm"
                >
                  <Trash2 size={13} /> Remove
                </button>
              </div>
              <button
                onClick={() => setPreviewScreenshotModal(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GITHUB & JIRA INTEGRATION MODALS */}
      <GithubPushModal 
        isOpen={!!githubPushScript} 
        onClose={() => setGithubPushScript(null)} 
        project={project} 
        script={githubPushScript} 
      />
      
      <JiraBugModal 
        isOpen={!!jiraBugScript} 
        onClose={() => setJiraBugScript(null)} 
        project={project} 
        script={jiraBugScript} 
        user={user}
      />
      
      <JiraSyncModal 
        isOpen={!!jiraSyncScript} 
        onClose={() => setJiraSyncScript(null)} 
        project={project} 
        script={jiraSyncScript} 
      />

      {/* GLOBAL PROCESSING OVERLAY */}
      {isProcessing && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/40 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-white flex flex-col items-center gap-6 animate-in zoom-in-95 duration-300">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-100 rounded-full blur-2xl animate-pulse" />
              <Loader2 size={48} className="text-indigo-600 animate-spin relative" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Processing Folder</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">Extracting and validating scripts...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScriptGenerator;