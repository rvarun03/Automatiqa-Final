import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Code2,
  Film,
  Play,
  Download,
  Sparkles,
  Check,
  Copy,
  FileText,
  Layers,
  Folder,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit3,
  RefreshCw,
  Eye,
  EyeOff,
  Archive,
  FileCode,
  ShieldCheck,
  Save,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  X,
  FileSpreadsheet,
  Cpu,
  MonitorPlay,
  CheckSquare,
  Square,
  Clock,
  FolderPlus,
  FolderCheck,
  ListChecks,
  Maximize2,
  ZoomIn,
  Search,
  Filter,
  Globe,
  User as UserIcon,
  Lock,
  Upload,
  Image as ImageIcon,
  HelpCircle,
  Package,
  Plus,
  GitBranch,
  Send,
  CheckCircle
} from 'lucide-react';
import { toast } from 'sonner';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Project,
  AutomationScript,
  AutomationScriptFile,
  AutomationTool,
  ProgrammingLanguage,
  TestCase,
  TestStatus,
  TestType,
  TestIntent,
  TestPriority,
  TestScenario,
  User,
  VectorSearchResult
} from '../types';
import { ScreenshotUploader, ScreenshotFile } from './ScreenshotUploader';
import { VideoInputUploader, VideoWalkthroughData } from './VideoInputUploader';
import { RAGStatusBadge } from './RAGStatusBadge';
import { GithubPushModal } from './GithubPushModal';
import { JiraSyncModal } from './JiraSyncModal';
import {
  generateAutomationScript,
  refineAutomationScript,
  generateFallbackAutomationScript
} from '../geminiService';
import { logActivity } from '../services/activityService';

interface ScriptGeneratorProps {
  project: Project;
  user: User;
  onUpdateProject: (p: Project) => void;
  viewOnly?: boolean;
}

// Utility to parse generated markdown output into individual files
export const parseScriptIntoFiles = (
  rawMarkdown: string,
  tool: AutomationTool = 'Playwright',
  language: ProgrammingLanguage = 'TypeScript'
): AutomationScriptFile[] => {
  if (!rawMarkdown || rawMarkdown.trim().length === 0) return [];

  const files: AutomationScriptFile[] = [];
  const fileRegex = /###?\s+`?([a-zA-Z0-9_\-./\\]+(?:\.[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]+))`?[\s\S]*?```(?:[a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fileRegex.exec(rawMarkdown)) !== null) {
    const rawPath = match[1].trim().replace(/^`+|`+$/g, '');
    const content = match[2].trim();
    if (rawPath && content) {
      files.push({ path: rawPath, content });
    }
  }

  if (files.length > 0) {
    return files;
  }

  // Fallback: extract code blocks
  const codeBlockRegex = /```(?:[a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  while ((match = codeBlockRegex.exec(rawMarkdown)) !== null) {
    if (match[1].trim()) blocks.push(match[1].trim());
  }

  const isTs = language === 'TypeScript';
  const isPython = language === 'Python';
  const isJava = language === 'Java';
  const ext = isTs ? 'ts' : isPython ? 'py' : isJava ? 'java' : 'js';
  const isBdd = tool.includes('BDD') || tool.includes('Cucumber');

  if (blocks.length > 0) {
    if (isBdd) {
      return [
        {
          path: `features/workflow.feature`,
          content: blocks[0]
        },
        ...(blocks.length > 1 ? [{
          path: `steps/workflow.steps.${ext}`,
          content: blocks[1]
        }] : []),
        ...(blocks.length > 2 ? [{
          path: `pages/WorkflowPage.${ext}`,
          content: blocks[2]
        }] : [])
      ];
    }
    return [
      {
        path: `tests/workflow.spec.${ext}`,
        content: blocks[0]
      },
      ...(blocks.length > 1 ? [{
        path: `pages/WorkflowPage.${ext}`,
        content: blocks[1]
      }] : [])
    ];
  }

  return [
    {
      path: isBdd ? `features/generated_feature.feature` : `tests/generated_suite.spec.${ext}`,
      content: rawMarkdown
    }
  ];
};

export const ScriptGenerator: React.FC<ScriptGeneratorProps> = ({
  project,
  user,
  onUpdateProject,
  viewOnly = false
}) => {
  // Navigation Tabs: INDIVIDUAL TEST CASES | FOLDERS | SCRIPT FOLDERS | IMPORTED SCRIPT FOLDERS
  const [activeTab, setActiveTab] = useState<'individual' | 'folders' | 'scripts' | 'imported'>('individual');
  const [searchQuery, setSearchQuery] = useState('');
  const [artifactFilter, setArtifactFilter] = useState('');

  // Automation Configuration (Matches Image 1)
  const [selectedTool, setSelectedTool] = useState<AutomationTool>('Playwright');
  const [selectedLanguage, setSelectedLanguage] = useState<ProgrammingLanguage>('TypeScript');
  const [targetUrl, setTargetUrl] = useState('');
  const [appPackage, setAppPackage] = useState('');

  // Global Test Context & Security
  const [contextEmail, setContextEmail] = useState('');
  const [contextPassword, setContextPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // RAG Toggle
  const [ragEnabled, setRagEnabled] = useState(true);
  const [retrievedRagChunks, setRetrievedRagChunks] = useState<VectorSearchResult[]>([]);

  // Selection States
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [selectedScriptIds, setSelectedScriptIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteScriptsConfirm, setShowBulkDeleteScriptsConfirm] = useState(false);

  // Screenshot & Video Accordion
  const [isScreenshotAccordionOpen, setIsScreenshotAccordionOpen] = useState(false);
  const [screenshots, setScreenshots] = useState<ScreenshotFile[]>([]);
  const [videoData, setVideoData] = useState<VideoWalkthroughData | null>(null);

  // Instruction Field
  const [instructionText, setInstructionText] = useState('');

  // Generating State
  const [isGenerating, setIsGenerating] = useState(false);

  // Refinement Prompts map by script ID
  const [refinementPrompts, setRefinementPrompts] = useState<{ [scriptId: string]: string }>({});
  const [refiningScriptId, setRefiningScriptId] = useState<string | null>(null);

  // Edit Script Title Modal State
  const [editingScript, setEditingScript] = useState<AutomationScript | null>(null);
  const [editTitleText, setEditTitleText] = useState('');

  // Delete Confirmation States
  const [deleteCaseTarget, setDeleteCaseTarget] = useState<{ scenarioId: string; testCaseId: string; title: string } | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<TestScenario | null>(null);
  const [deleteScriptTarget, setDeleteScriptTarget] = useState<AutomationScript | null>(null);

  // Modals for GitHub & Jira
  const [selectedScriptForGithub, setSelectedScriptForGithub] = useState<AutomationScript | null>(null);
  const [selectedScriptForJira, setSelectedScriptForJira] = useState<AutomationScript | null>(null);

  // File Upload Refs
  const importScriptFileRef = useRef<HTMLInputElement>(null);
  const importFolderRef = useRef<HTMLInputElement>(null);

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
      steps: scen.description ? [scen.description] : [],
      expectedResult: scen.expectedResults || 'Execution validates requirements successfully.',
      status: TestStatus.NOT_EXECUTED,
      isApproved: Boolean(scen.isApproved),
      priority: (scen.priority as TestPriority) || TestPriority.MEDIUM,
      testType: TestType.FUNCTIONAL
    }];
  }, []);

  // Helper to resolve all test cases for a folder
  const getFolderCases = useCallback((folder: TestScenario): TestCase[] => {
    const directCases = folder.testCases || [];
    const memberScenarios = (project.scenarios || []).filter(s => 
      (folder.memberScenarioIds || []).includes(s.id) &&
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
  }, [project.scenarios, getScenarioCases]);

  // Flattened Valid Scenarios and Test Cases
  const validScenarios = useMemo(() => {
    return (project.scenarios || []).filter(s => 
      s.scenarioId !== 'MANUAL_FOLDER' && 
      s.scenarioId !== 'INPUT_SOURCE'
    );
  }, [project.scenarios]);

  const allTestCases = useMemo(() => {
    const list: Array<{ scenario: TestScenario; testCase: TestCase }> = [];
    const seenCaseIds = new Set<string>();

    validScenarios.forEach(scen => {
      const isFolder = ['SCENARIO_FOLDER', 'TESTCASE_FOLDER'].includes(scen.scenarioId);
      if (isFolder) {
        const folderCases = getFolderCases(scen);
        folderCases.forEach(tc => {
          if (!seenCaseIds.has(tc.id)) {
            seenCaseIds.add(tc.id);
            list.push({ scenario: scen, testCase: tc });
          }
        });
      } else {
        const scenarioCases = getScenarioCases(scen);
        scenarioCases.forEach(tc => {
          if (!seenCaseIds.has(tc.id)) {
            seenCaseIds.add(tc.id);
            list.push({ scenario: scen, testCase: tc });
          }
        });
      }
    });

    return list;
  }, [validScenarios, getFolderCases, getScenarioCases]);

  // Saved automation scripts
  const savedScripts = useMemo(() => {
    return project.automationScripts || [];
  }, [project.automationScripts]);

  // Imported scripts
  const importedScripts = useMemo(() => {
    return (project.automationScripts || []).filter(s => (s as any).isImported);
  }, [project.automationScripts]);

  // Filtered Test Cases for Individual Tab
  const filteredCases = useMemo(() => {
    if (!searchQuery.trim()) return allTestCases;
    const q = searchQuery.toLowerCase();
    return allTestCases.filter(({ scenario, testCase }) => 
      (testCase.testCaseId || '').toLowerCase().includes(q) ||
      testCase.title.toLowerCase().includes(q) ||
      scenario.title.toLowerCase().includes(q)
    );
  }, [allTestCases, searchQuery]);

  // Filtered Folders
  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return validScenarios;
    const q = searchQuery.toLowerCase();
    return validScenarios.filter(s => 
      s.title.toLowerCase().includes(q) ||
      (s.moduleName || '').toLowerCase().includes(q)
    );
  }, [validScenarios, searchQuery]);

  // Filtered Artifacts in Repository
  const filteredArtifacts = useMemo(() => {
    if (!artifactFilter.trim()) return savedScripts;
    const q = artifactFilter.toLowerCase();
    return savedScripts.filter(s => 
      s.title.toLowerCase().includes(q) ||
      s.tool.toLowerCase().includes(q) ||
      s.language.toLowerCase().includes(q) ||
      (s.content && s.content.toLowerCase().includes(q))
    );
  }, [savedScripts, artifactFilter]);

  // Selection helpers
  const toggleSelectCase = (id: string) => {
    const next = new Set(selectedCaseIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCaseIds(next);
  };

  const toggleSelectFolder = (id: string) => {
    const next = new Set(selectedFolderIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFolderIds(next);

    // Also auto-select or deselect test cases inside this folder
    const scen = validScenarios.find(s => s.id === id);
    if (scen) {
      const folderCases = getFolderCases(scen);
      const caseNext = new Set(selectedCaseIds);
      if (!selectedFolderIds.has(id)) {
        folderCases.forEach(tc => caseNext.add(tc.id));
      } else {
        folderCases.forEach(tc => caseNext.delete(tc.id));
      }
      setSelectedCaseIds(caseNext);
    }
  };

  // Select All Handlers
  const isAllVisibleCasesSelected = useMemo(() => {
    if (filteredCases.length === 0) return false;
    return filteredCases.every(({ testCase }) => selectedCaseIds.has(testCase.id));
  }, [filteredCases, selectedCaseIds]);

  const toggleSelectAllVisibleCases = () => {
    const next = new Set(selectedCaseIds);
    if (isAllVisibleCasesSelected) {
      filteredCases.forEach(({ testCase }) => next.delete(testCase.id));
    } else {
      filteredCases.forEach(({ testCase }) => next.add(testCase.id));
    }
    setSelectedCaseIds(next);
  };

  const isAllVisibleFoldersSelected = useMemo(() => {
    if (filteredFolders.length === 0) return false;
    return filteredFolders.every(f => selectedFolderIds.has(f.id));
  }, [filteredFolders, selectedFolderIds]);

  const toggleSelectAllVisibleFolders = () => {
    const nextFolders = new Set(selectedFolderIds);
    const nextCases = new Set(selectedCaseIds);
    if (isAllVisibleFoldersSelected) {
      filteredFolders.forEach(f => {
        nextFolders.delete(f.id);
        const folderCases = getFolderCases(f);
        folderCases.forEach(tc => nextCases.delete(tc.id));
      });
    } else {
      filteredFolders.forEach(f => {
        nextFolders.add(f.id);
        const folderCases = getFolderCases(f);
        folderCases.forEach(tc => nextCases.add(tc.id));
      });
    }
    setSelectedFolderIds(nextFolders);
    setSelectedCaseIds(nextCases);
  };

  // Script Selection Helpers
  const toggleSelectScript = (id: string) => {
    const next = new Set(selectedScriptIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedScriptIds(next);
  };

  const isAllVisibleScriptsSelected = useMemo(() => {
    if (filteredArtifacts.length === 0) return false;
    return filteredArtifacts.every(s => selectedScriptIds.has(s.id));
  }, [filteredArtifacts, selectedScriptIds]);

  const toggleSelectAllVisibleScripts = () => {
    const next = new Set(selectedScriptIds);
    if (isAllVisibleScriptsSelected) {
      filteredArtifacts.forEach(s => next.delete(s.id));
    } else {
      filteredArtifacts.forEach(s => next.add(s.id));
    }
    setSelectedScriptIds(next);
  };

  const handleConfirmBulkDeleteScripts = () => {
    if (selectedScriptIds.size === 0) return;
    const count = selectedScriptIds.size;
    const updatedScripts = (project.automationScripts || []).filter(s => !selectedScriptIds.has(s.id));
    onUpdateProject({ ...project, automationScripts: updatedScripts });
    setSelectedScriptIds(new Set());
    setShowBulkDeleteScriptsConfirm(false);
    toast.success(`Deleted ${count} script${count > 1 ? 's' : ''} from repository`);
  };

  // Delete Action Implementations
  const handleConfirmDeleteCase = () => {
    if (!deleteCaseTarget) return;
    const targetCaseId = deleteCaseTarget.testCaseId;
    const targetScenarioId = deleteCaseTarget.scenarioId;

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
    const nextSelected = new Set(selectedCaseIds);
    nextSelected.delete(targetCaseId);
    setSelectedCaseIds(nextSelected);

    toast.success('Test case deleted');
    setDeleteCaseTarget(null);
  };

  const handleConfirmDeleteFolder = () => {
    if (!deleteFolderTarget) return;
    const folderId = deleteFolderTarget.id;
    const folderCases = getFolderCases(deleteFolderTarget);
    const folderCaseIds = new Set(folderCases.map(c => c.id));

    const updatedScenarios = (project.scenarios || []).filter(s => s.id !== folderId);
    onUpdateProject({ ...project, scenarios: updatedScenarios });

    const nextSelectedFolders = new Set(selectedFolderIds);
    nextSelectedFolders.delete(folderId);
    setSelectedFolderIds(nextSelectedFolders);

    const nextSelectedCases = new Set(selectedCaseIds);
    folderCaseIds.forEach(id => nextSelectedCases.delete(id));
    setSelectedCaseIds(nextSelectedCases);

    toast.success(`Folder "${deleteFolderTarget.title}" deleted`);
    setDeleteFolderTarget(null);
  };

  const handleConfirmDeleteScript = () => {
    if (!deleteScriptTarget) return;
    const scriptId = deleteScriptTarget.id;
    const updatedScripts = (project.automationScripts || []).filter(s => s.id !== scriptId);
    onUpdateProject({ ...project, automationScripts: updatedScripts });
    const nextSelected = new Set(selectedScriptIds);
    nextSelected.delete(scriptId);
    setSelectedScriptIds(nextSelected);
    toast.success(`Script "${deleteScriptTarget.title}" deleted`);
    setDeleteScriptTarget(null);
  };

  const selectedCount = selectedCaseIds.size;

  // Handle Script Generation
  const handleGenerateScript = async () => {
    const targetCases = allTestCases
      .filter(({ testCase }) => selectedCaseIds.has(testCase.id))
      .map(item => item.testCase);

    if (targetCases.length === 0 && selectedFolderIds.size === 0 && !instructionText.trim()) {
      toast.error('Please select at least one testcase or folder to generate scripts');
      return;
    }

    setIsGenerating(true);

    const title = targetCases.length > 0 
      ? (targetCases.length === 1 ? targetCases[0].title : `${selectedTool} Suite: ${targetCases[0].title.slice(0, 30)}... (${targetCases.length} cases)`)
      : `${selectedTool} Automated Suite`;

    try {
      const contextPayload: any = {
        appUrl: targetUrl,
        credentials: {
          username: contextEmail,
          password: contextPassword
        },
        instructionText,
        pomStructure: true,
        dataDriven: true
      };

      if (screenshots.length > 0) {
        contextPayload.screenshots = screenshots.map(s => `data:${s.mimeType};base64,${s.data}`);
      }

      if (videoData?.frames?.length) {
        contextPayload.videoFrames = videoData.frames;
        contextPayload.videoFileName = videoData.fileName;
      }

      const generatedCode = await generateAutomationScript(
        targetCases,
        { tool: selectedTool, language: selectedLanguage },
        contextPayload,
        []
      );

      if (!generatedCode || generatedCode.trim().length === 0) {
        throw new Error('No script code received from AI generator.');
      }

      const files = parseScriptIntoFiles(generatedCode, selectedTool, selectedLanguage);

      // Save to project automation scripts with isApproved: false
      const newScript: AutomationScript = {
        id: Math.random().toString(36).substr(2, 9),
        title,
        description: `Production-ready ${selectedTool} ${selectedLanguage} POM suite`,
        tool: selectedTool,
        language: selectedLanguage,
        content: generatedCode,
        files,
        createdAt: new Date().toISOString(),
        testCaseTitles: targetCases.map(c => c.title),
        isApproved: false,
        source: 'script_generator',
        platform: selectedTool === 'Appium' ? 'mobile' : 'web',
        appUrl: targetUrl || undefined,
        appPackage: appPackage || undefined
      };

      const updatedScripts = [newScript, ...(project.automationScripts || [])];
      onUpdateProject({
        ...project,
        automationScripts: updatedScripts
      });

      toast.success(`Generated POM script suite: ${title}`);
      await logActivity(user.email, user.name, `Generated ${selectedTool} Script: ${title}`, project.id, project.name);
    } catch (err: any) {
      console.error('Script generation error:', err);
      toast.error(`Generation error: ${err.message || 'Failed to synthesize script'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Refine Script
  const handleRefineScript = async (scriptId: string) => {
    const prompt = refinementPrompts[scriptId];
    if (!prompt || !prompt.trim()) {
      toast.error('Please enter a refinement instruction');
      return;
    }

    const script = savedScripts.find(s => s.id === scriptId);
    if (!script) return;

    setRefiningScriptId(scriptId);

    try {
      const refinedCode = await refineAutomationScript(
        script.content,
        prompt,
        { tool: script.tool, language: script.language },
        { appUrl: script.appUrl, credentials: { username: contextEmail, password: contextPassword } }
      );

      if (refinedCode) {
        const files = parseScriptIntoFiles(refinedCode, script.tool, script.language);
        const updatedScripts = (project.automationScripts || []).map(s => {
          if (s.id === scriptId) {
            return {
              ...s,
              content: refinedCode,
              files
            };
          }
          return s;
        });

        onUpdateProject({
          ...project,
          automationScripts: updatedScripts
        });

        setRefinementPrompts(prev => ({ ...prev, [scriptId]: '' }));
        toast.success('Script refined successfully!');
        await logActivity(user.email, user.name, `Refined script: ${script.title}`, project.id, project.name);
      }
    } catch (err: any) {
      toast.error(`Refinement failed: ${err.message || 'Error occurred'}`);
    } finally {
      setRefiningScriptId(null);
    }
  };

  // Toggle Script Approval
  const handleToggleApprove = (script: AutomationScript) => {
    const updatedScripts = (project.automationScripts || []).map(s => 
      s.id === script.id ? { ...s, isApproved: !s.isApproved } : s
    );
    onUpdateProject({ ...project, automationScripts: updatedScripts });
    if (!script.isApproved) {
      toast.success('Script approved and added to Execution Hub!');
    } else {
      toast.info('Script removed from Execution Hub');
    }
  };

  // Copy Script Content
  const handleCopyScript = (script: AutomationScript) => {
    navigator.clipboard.writeText(script.content);
    toast.success('Script copied to clipboard!');
  };

  // Download Script or ZIP
  const handleDownloadScript = async (script: AutomationScript) => {
    const files = script.files && script.files.length > 0 
      ? script.files 
      : parseScriptIntoFiles(script.content, script.tool, script.language);

    if (files.length > 1) {
      const zip = new JSZip();
      files.forEach(f => zip.file(f.path, f.content));
      zip.file('README.md', `# ${script.title}\n\nGenerated with ${script.tool} (${script.language})\n\n## Run\n\`\`\`bash\nnpx playwright test\n\`\`\``);
      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, `${script.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`);
      toast.success('Downloaded POM project zip archive');
    } else {
      const ext = script.language === 'Python' ? 'py' : script.language === 'Java' ? 'java' : 'ts';
      const blob = new Blob([script.content], { type: 'text/plain;charset=utf-8' });
      saveAs(blob, `${script.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.spec.${ext}`);
      toast.success('Downloaded script file');
    }
  };

  // Delete Script
  const handleDeleteScript = (scriptId: string) => {
    const updatedScripts = (project.automationScripts || []).filter(s => s.id !== scriptId);
    onUpdateProject({ ...project, automationScripts: updatedScripts });
    toast.success('Script removed from repository');
  };

  // Import Script from Disk
  const handleImportScriptFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const newScript: AutomationScript = {
        id: Math.random().toString(36).substr(2, 9),
        title: file.name.replace(/\.[^/.]+$/, ''),
        tool: selectedTool,
        language: selectedLanguage,
        content,
        createdAt: new Date().toISOString(),
        isApproved: false,
        isImported: true,
        source: 'script_generator'
      };

      onUpdateProject({
        ...project,
        automationScripts: [newScript, ...(project.automationScripts || [])]
      });
      toast.success(`Imported script: ${file.name}`);
    };
    reader.readAsText(file);
    if (importScriptFileRef.current) importScriptFileRef.current.value = '';
  };

  // Append context or cases to existing script
  const handleAppendToScript = (script: AutomationScript) => {
    const targetCases = allTestCases
      .filter(({ testCase }) => selectedCaseIds.has(testCase.id))
      .map(item => item.testCase);

    if (targetCases.length === 0 && !instructionText.trim()) {
      toast.info('Select additional test cases or add instruction to append to this script suite.');
      return;
    }

    const appendNote = `\n\n// --- APPENDED SPECIFICATIONS: ${targetCases.map(c => c.title).join(', ')} ---\n` +
      `// Context Note: ${instructionText}\n`;

    const updatedContent = script.content + appendNote;
    const updatedScripts = (project.automationScripts || []).map(s => 
      s.id === script.id ? { ...s, content: updatedContent } : s
    );

    onUpdateProject({ ...project, automationScripts: updatedScripts });
    toast.success(`Appended ${targetCases.length} items to ${script.title}`);
  };

  return (
    <div className="space-y-6 pb-28 max-w-7xl mx-auto">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER (Matches Image 1)                                           */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-7 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                AUTOMATION
              </h1>
              {/* RAG Vector Grounding pill badge with interactive toggle */}
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-50 border border-teal-200/80 rounded-full text-[11px] font-black text-teal-800 tracking-wide shadow-2xs">
                <Sparkles size={13} className="text-teal-600" />
                <span>RAG Vector Grounding</span>
                <button
                  type="button"
                  onClick={() => {
                    setRagEnabled(!ragEnabled);
                    toast.info(ragEnabled ? 'RAG Grounding disabled' : 'RAG Grounding enabled');
                  }}
                  className={`w-7 h-4 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                    ragEnabled ? 'bg-teal-600 justify-end' : 'bg-slate-300 justify-start'
                  }`}
                  title="Toggle RAG Vector Grounding"
                >
                  <div className="bg-white w-3 h-3 rounded-full shadow-xs" />
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mt-1.5">
              SYNTHESIZE INCREMENTAL POM SCRIPTS WITH ARCHITECTURAL OVERSIGHT & RAG GROUNDING
            </p>
          </div>
        </div>

        {/* Row 1: Framework, Language, App URL, App Package */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Framework & Tool */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
              <span className="text-rose-500">*</span> ⚙️ FRAMEWORK & TOOL
            </label>
            <select
              value={selectedTool}
              onChange={(e) => setSelectedTool(e.target.value as AutomationTool)}
              className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500 focus:bg-white transition-all cursor-pointer"
            >
              <option value="Playwright">Playwright</option>
              <option value="Cypress">Cypress</option>
              <option value="Selenium">Selenium</option>
              <option value="Appium">Appium</option>
              <option value="Puppeteer">Puppeteer</option>
              <option value="Playwright BDD (Cucumber)">Playwright BDD (Cucumber)</option>
            </select>
          </div>

          {/* Language */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
              <span className="text-rose-500">*</span> &gt;_ LANGUAGE
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as ProgrammingLanguage)}
              className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500 focus:bg-white transition-all cursor-pointer"
            >
              <option value="TypeScript">TypeScript</option>
              <option value="JavaScript">JavaScript</option>
              <option value="Python">Python</option>
              <option value="Java">Java</option>
              <option value="C#">C#</option>
            </select>
          </div>

          {/* App URL (Optional) */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
              🔗 APP URL (OPTIONAL)
            </label>
            <input
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://app.example.com"
              className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all"
            />
          </div>

          {/* App Package (Appium Only) */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
              📱 APP PACKAGE (APPIUM ONLY)
            </label>
            <input
              type="text"
              value={appPackage}
              onChange={(e) => setAppPackage(e.target.value)}
              disabled={selectedTool !== 'Appium'}
              placeholder={selectedTool === 'Appium' ? 'com.example.app' : 'Enabled only for Appium'}
              className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 disabled:opacity-50 disabled:bg-slate-100/70"
            />
          </div>
        </div>

        {/* Row 2: Global Test Context & Security */}
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <h3 className="text-[11px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
            🛡️ GLOBAL TEST CONTEXT & SECURITY
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative">
              <UserIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={contextEmail}
                onChange={(e) => setContextEmail(e.target.value)}
                placeholder="Email / Phone"
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all"
              />
            </div>

            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={contextPassword}
                onChange={(e) => setContextPassword(e.target.value)}
                placeholder="Password"
                className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Row 3: Tabs Bar and Search */}
        <div className="pt-2 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
            <button
              type="button"
              onClick={() => setActiveTab('individual')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'individual'
                  ? 'border-b-2 border-teal-600 text-teal-700 font-black'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🗂️ INDIVIDUAL TEST CASES</span>
              <span className="px-2 py-0.5 bg-teal-100 text-teal-800 rounded-full text-[10px] font-bold">
                {allTestCases.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('folders')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'folders'
                  ? 'border-b-2 border-teal-600 text-teal-700 font-black'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>📁 FOLDERS</span>
              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] font-bold">
                {validScenarios.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('scripts')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'scripts'
                  ? 'border-b-2 border-teal-600 text-teal-700 font-black'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>📁 SCRIPT FOLDERS</span>
              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] font-bold">
                {savedScripts.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('imported')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'imported'
                  ? 'border-b-2 border-teal-600 text-teal-700 font-black'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>📁 IMPORTED SCRIPT FOLDERS</span>
              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] font-bold">
                {importedScripts.length}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative shrink-0">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search test cases..."
              className="pl-9 pr-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white w-full sm:w-60 transition-all shadow-2xs"
            />
          </div>
        </div>

        {/* Selection / Select All Subheader for Active Tab */}
        {activeTab === 'individual' && (
          <div className="flex items-center justify-between px-1 pt-2 pb-1">
            <button
              type="button"
              onClick={toggleSelectAllVisibleCases}
              className="flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-teal-700 cursor-pointer transition-colors"
            >
              {isAllVisibleCasesSelected ? (
                <CheckSquare size={16} className="text-teal-600" />
              ) : (
                <Square size={16} className="text-slate-400" />
              )}
              <span>Select All Visible ({filteredCases.length})</span>
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>Selected: <strong className="text-teal-700 font-black">{selectedCaseIds.size}</strong></span>
              <span>Showing <strong className="text-slate-800 font-bold">{filteredCases.length}</strong> of {allTestCases.length} Cases</span>
            </div>
          </div>
        )}

        {activeTab === 'folders' && (
          <div className="flex items-center justify-between px-1 pt-2 pb-1">
            <button
              type="button"
              onClick={toggleSelectAllVisibleFolders}
              className="flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-teal-700 cursor-pointer transition-colors"
            >
              {isAllVisibleFoldersSelected ? (
                <CheckSquare size={16} className="text-teal-600" />
              ) : (
                <Square size={16} className="text-slate-400" />
              )}
              <span>Select All Visible Folders ({filteredFolders.length})</span>
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>Selected: <strong className="text-teal-700 font-black">{selectedFolderIds.size}</strong></span>
              <span>Showing <strong className="text-slate-800 font-bold">{filteredFolders.length}</strong> of {validScenarios.length} Folders</span>
            </div>
          </div>
        )}

        {/* Test Case Selection Grid (Matches Image 1) */}
        {activeTab === 'individual' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
            {filteredCases.length === 0 ? (
              <div className="col-span-full p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl">
                No test cases match your search criteria.
              </div>
            ) : (
              filteredCases.map(({ scenario, testCase }) => {
                const isSelected = selectedCaseIds.has(testCase.id);

                return (
                  <div
                    key={testCase.id}
                    onClick={() => toggleSelectCase(testCase.id)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-teal-50/40 border-teal-500 ring-2 ring-teal-500/20 shadow-2xs'
                        : 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0">
                        {isSelected ? (
                          <CheckSquare size={18} className="text-teal-600" />
                        ) : (
                          <Square size={18} className="text-slate-300 hover:text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-black uppercase text-slate-800 truncate">
                          {testCase.title}
                        </h4>
                        <span className="text-[10px] font-bold uppercase text-slate-400">
                          {scenario.title || 'GENERAL'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteCaseTarget({
                          scenarioId: scenario.id,
                          testCaseId: testCase.id,
                          title: testCase.title
                        });
                      }}
                      className="text-slate-300 hover:text-rose-500 p-1.5 rounded-lg shrink-0 cursor-pointer transition-colors"
                      title="Delete Test Case"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Folders Tab Content */}
        {activeTab === 'folders' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
            {filteredFolders.length === 0 ? (
              <div className="col-span-full p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl">
                No folders found.
              </div>
            ) : (
              filteredFolders.map(scen => {
                const isSelected = selectedFolderIds.has(scen.id);
                const count = getFolderCases(scen).length || scen.testCases?.length || (scen.scenarioId && !['SCENARIO_FOLDER', 'MANUAL_FOLDER', 'TESTCASE_FOLDER', 'INPUT_SOURCE'].includes(scen.scenarioId) ? 1 : 0);

                return (
                  <div
                    key={scen.id}
                    onClick={() => toggleSelectFolder(scen.id)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-teal-50/40 border-teal-500 ring-2 ring-teal-500/20 shadow-2xs'
                        : 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0">
                        {isSelected ? (
                          <CheckSquare size={18} className="text-teal-600" />
                        ) : (
                          <Square size={18} className="text-slate-300 hover:text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-black uppercase text-slate-800 truncate">
                          {scen.title}
                        </h4>
                        <span className="text-[10px] font-bold uppercase text-slate-400">
                          {count} TEST CASES • {scen.moduleName || 'GENERAL'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md">
                        {count} cases
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteFolderTarget(scen);
                        }}
                        className="text-slate-300 hover:text-rose-500 p-1.5 rounded-lg shrink-0 cursor-pointer transition-colors"
                        title="Delete Folder"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Script Folders Tab */}
        {activeTab === 'scripts' && (
          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {savedScripts.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl">
                No generated script folders in this project yet.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                  <button
                    type="button"
                    onClick={toggleSelectAllVisibleScripts}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    {isAllVisibleScriptsSelected ? (
                      <CheckSquare size={14} className="text-teal-600" />
                    ) : (
                      <Square size={14} className="text-slate-400" />
                    )}
                    <span>Select All ({savedScripts.length})</span>
                  </button>
                  {selectedScriptIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowBulkDeleteScriptsConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                    >
                      <Trash2 size={13} />
                      Delete Selected ({selectedScriptIds.size})
                    </button>
                  )}
                </div>
                {savedScripts.map(script => {
                  const isSelected = selectedScriptIds.has(script.id);
                  return (
                    <div
                      key={script.id}
                      className={`bg-white rounded-2xl border p-3.5 flex items-center justify-between gap-4 shadow-2xs transition-all ${
                        isSelected ? 'border-teal-500 bg-teal-50/20 ring-1 ring-teal-500/30' : 'border-slate-200/90'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectScript(script.id);
                          }}
                          className="text-slate-400 hover:text-teal-600 cursor-pointer transition-colors"
                        >
                          {isSelected ? (
                            <CheckSquare size={16} className="text-teal-600" />
                          ) : (
                            <Square size={16} className="text-slate-300" />
                          )}
                        </button>
                        <div className="p-2 bg-teal-50 text-teal-600 rounded-xl">
                          <FileCode size={16} />
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-slate-900">{script.title}</h4>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {script.tool} • {script.language} • {script.files?.length || 1} files
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleApprove(script)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            script.isApproved
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700'
                          }`}
                        >
                          <CheckCircle2 size={13} className={script.isApproved ? 'text-emerald-600' : 'text-slate-400'} />
                          {script.isApproved ? 'Approved' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteScriptTarget(script)}
                          className="text-slate-300 hover:text-rose-500 p-1.5 rounded-lg shrink-0 cursor-pointer transition-colors"
                          title="Delete Script"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* Imported Script Folders Tab */}
        {activeTab === 'imported' && (
          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {importedScripts.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl">
                No imported script folders. Use "Import Script" below to upload external code.
              </div>
            ) : (
              importedScripts.map(script => (
                <div
                  key={script.id}
                  className="bg-white rounded-2xl border border-slate-200/90 p-3.5 flex items-center justify-between gap-4 shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Archive size={16} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-900">{script.title}</h4>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {script.tool} • {script.language}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleApprove(script)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                        script.isApproved
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700'
                      }`}
                    >
                      <CheckCircle2 size={13} className={script.isApproved ? 'text-emerald-600' : 'text-slate-400'} />
                      {script.isApproved ? 'Approved' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteScriptTarget(script)}
                      className="text-slate-300 hover:text-rose-500 p-1.5 rounded-lg shrink-0 cursor-pointer transition-colors"
                      title="Delete Imported Script"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 2. INSTRUCTION FIELD (Matches Image 2)                                    */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            💬 INSTRUCTION FIELD
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-400">
              {instructionText.length}/1000
            </span>
            {instructionText && (
              <button
                type="button"
                onClick={() => setInstructionText('')}
                className="text-slate-400 hover:text-slate-600 text-[10px] cursor-pointer"
                title="Clear instruction"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <textarea
          value={instructionText}
          onChange={(e) => setInstructionText(e.target.value.slice(0, 1000))}
          placeholder="e.g. 'Use specific naming conventions', 'Add BasePage class', 'Locator strategy: data-testid first'"
          rows={3}
          className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all resize-none font-medium leading-relaxed"
        />

        <p className="text-[11px] text-amber-600 font-medium">
          * Note: Instruction text may override default behavior if there is a conflict.
        </p>
      </div>

      {/* ========================================================================= */}
      {/* 3. AI PROMPT SYNTHESIS BAR (Matches Image 2)                              */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left info badge */}
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 bg-teal-500/10 text-teal-600 rounded-2xl flex items-center justify-center shrink-0 border border-teal-500/20">
            <Sparkles size={24} className="text-teal-600" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
              AI PROMPT SYNTHESIS
            </h3>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
              GENERATE SMART. AUTOMATE FASTER.
            </p>
            <div className="text-[10px] font-black uppercase tracking-wider text-teal-600 mt-0.5">
              {selectedCount} SELECTED • POM STRUCTURE DEFAULT
            </div>
          </div>
        </div>

        {/* Right action buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => importScriptFileRef.current?.click()}
            className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shadow-2xs"
          >
            <Upload size={14} className="text-slate-500" />
            IMPORT SCRIPT
          </button>
          <input
            ref={importScriptFileRef}
            type="file"
            accept=".ts,.js,.py,.java,.cs"
            className="hidden"
            onChange={handleImportScriptFile}
          />

          <button
            type="button"
            onClick={() => importFolderRef.current?.click()}
            className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shadow-2xs"
          >
            <Folder size={14} className="text-slate-500" />
            IMPORT SCRIPT FOLDER
          </button>
          <input
            ref={importFolderRef}
            type="file"
            // @ts-ignore
            webkitdirectory="true"
            directory="true"
            className="hidden"
            onChange={handleImportScriptFile}
          />

          <button
            type="button"
            onClick={handleGenerateScript}
            disabled={isGenerating}
            className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isGenerating ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <Code2 size={15} />
            )}
            {isGenerating ? 'SYNTHESIZING...' : 'GENERATE POM SCRIPT'}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. AUTOMATION REPOSITORY (Matches Image 2 & 3)                            */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
              🗄️ AUTOMATION REPOSITORY
            </h2>
            {filteredArtifacts.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleSelectAllVisibleScripts}
                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  {isAllVisibleScriptsSelected ? (
                    <CheckSquare size={14} className="text-teal-600" />
                  ) : (
                    <Square size={14} className="text-slate-400" />
                  )}
                  <span>Select All ({filteredArtifacts.length})</span>
                </button>
                {selectedScriptIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowBulkDeleteScriptsConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                  >
                    <Trash2 size={13} />
                    Delete Selected ({selectedScriptIds.size})
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={artifactFilter}
              onChange={(e) => setArtifactFilter(e.target.value)}
              placeholder="Filter artifacts..."
              className="pl-9 pr-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 shadow-2xs w-full sm:w-56 transition-all"
            />
          </div>
        </div>

        {filteredArtifacts.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center text-slate-500 text-xs">
            No automation scripts generated yet. Select test cases above and click <span className="font-bold text-teal-600">GENERATE POM SCRIPT</span>.
          </div>
        ) : (
          filteredArtifacts.map((script) => {
            const formattedDate = script.createdAt 
              ? new Date(script.createdAt).toLocaleDateString('en-GB') 
              : '17/08/2026';
            const isSelected = selectedScriptIds.has(script.id);

            return (
              <div
                key={script.id}
                className={`bg-white rounded-3xl border overflow-hidden shadow-xs space-y-0 transition-all ${
                  isSelected ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-slate-200/90'
                }`}
              >
                {/* Script Card Header (Matches Image 2 & 3) */}
                <div className="p-4 sm:px-6 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Checkbox, Terminal icon, Script Title, Date, Tag Badge */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectScript(script.id);
                      }}
                      className="text-slate-400 hover:text-teal-600 cursor-pointer transition-colors p-1"
                      title={isSelected ? 'Deselect script' : 'Select script'}
                    >
                      {isSelected ? (
                        <CheckSquare size={18} className="text-teal-600" />
                      ) : (
                        <Square size={18} className="text-slate-300" />
                      )}
                    </button>
                    <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center font-mono font-bold text-sm shrink-0 border border-teal-100">
                      &gt;_
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-sm font-black text-teal-700 uppercase tracking-tight">
                          {script.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-400 font-mono">
                          {formattedDate}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider text-teal-700 border border-teal-300 bg-teal-50/50 flex items-center gap-1">
                          <Folder size={10} />
                          {script.title.slice(0, 16)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Action Buttons Row (Saved, Approve, Append, Edit, Download, Code, Git, Copy, Delete) */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Saved Status Badge */}
                    <div className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-400 bg-slate-50 border border-slate-200/60 flex items-center gap-1">
                      <Save size={12} />
                      SAVED
                    </div>

                    {/* Approve Toggle Button */}
                    <button
                      type="button"
                      onClick={() => handleToggleApprove(script)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 border ${
                        script.isApproved
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300 shadow-2xs'
                          : 'bg-white hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border-slate-200'
                      }`}
                      title={script.isApproved ? 'Approved for Execution Hub' : 'Approve for Execution Hub'}
                    >
                      <CheckCircle2 size={13} className={script.isApproved ? 'text-emerald-600' : 'text-slate-400'} />
                      {script.isApproved ? 'APPROVED' : 'APPROVE'}
                    </button>

                    {/* Append Button */}
                    <button
                      type="button"
                      onClick={() => handleAppendToScript(script)}
                      className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer"
                      title="Append selected cases to this script"
                    >
                      <Plus size={12} />
                      APPEND
                    </button>

                    {/* Edit Title Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingScript(script);
                        setEditTitleText(script.title);
                      }}
                      className="p-2 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl text-xs transition-all cursor-pointer"
                      title="Rename script"
                    >
                      <Edit3 size={14} />
                    </button>

                    {/* Download Button */}
                    <button
                      type="button"
                      onClick={() => handleDownloadScript(script)}
                      className="p-2 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl text-xs transition-all cursor-pointer"
                      title="Download script or POM project ZIP"
                    >
                      <Download size={14} />
                    </button>

                    {/* Push to GitHub Button */}
                    <button
                      type="button"
                      onClick={() => setSelectedScriptForGithub(script)}
                      className="p-2 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl text-xs transition-all cursor-pointer"
                      title="Push to GitHub repository"
                    >
                      <GitBranch size={14} />
                    </button>

                    {/* Sync to Jira */}
                    <button
                      type="button"
                      onClick={() => setSelectedScriptForJira(script)}
                      className="p-2 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl text-xs transition-all cursor-pointer"
                      title="Sync status with Jira"
                    >
                      <Send size={14} />
                    </button>

                    {/* Copy Button (Dark Pill) */}
                    <button
                      type="button"
                      onClick={() => handleCopyScript(script)}
                      className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                      title="Copy full script"
                    >
                      <Copy size={12} />
                      COPY
                    </button>

                    {/* Delete Button */}
                    <button
                      type="button"
                      onClick={() => setDeleteScriptTarget(script)}
                      className="p-2 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 rounded-xl text-xs transition-all cursor-pointer"
                      title="Delete script"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Dark Code Container (Matches Image 2 & 3) */}
                <div className="bg-[#0b0f19] text-slate-200 p-6 font-mono text-xs overflow-x-auto min-h-[300px] max-h-[520px] overflow-y-auto leading-relaxed select-text border-t border-slate-900">
                  <pre className="whitespace-pre-wrap font-mono text-slate-100">{script.content}</pre>
                </div>

                {/* Refinement Section (Matches Image 3) */}
                <div className="p-5 bg-white border-t border-slate-100 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={13} className="text-teal-600" />
                    <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                      REFINE POM PROJECT OR FOLDER STRUCTURE
                    </h4>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <div className="relative flex-1 w-full">
                      <Sparkles size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={refinementPrompts[script.id] || ''}
                        onChange={(e) => setRefinementPrompts(prev => ({ ...prev, [script.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRefineScript(script.id);
                        }}
                        placeholder="e.g. 'Add a BasePage class' or 'Organize tests by functional module'"
                        className="w-full pl-9 pr-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all font-medium"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRefineScript(script.id)}
                      disabled={refiningScriptId === script.id}
                      className="w-full sm:w-auto px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {refiningScriptId === script.id ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      {refiningScriptId === script.id ? 'REFINING...' : 'REFINE'}
                    </button>
                  </div>

                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    YOUR JOB IS TO EXTEND OR REFINE THE USER'S AUTOMATION SUITE, NOT REPLACE IT.
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ========================================================================= */}
      {/* 5. EDIT TITLE MODAL                                                       */}
      {/* ========================================================================= */}
      {editingScript && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-sm font-black text-slate-900 uppercase">Rename Script</h3>
            <input
              type="text"
              value={editTitleText}
              onChange={(e) => setEditTitleText(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingScript(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const updatedScripts = (project.automationScripts || []).map(s => 
                    s.id === editingScript.id ? { ...s, title: editTitleText.trim() || s.title } : s
                  );
                  onUpdateProject({ ...project, automationScripts: updatedScripts });
                  setEditingScript(null);
                  toast.success('Script renamed');
                }}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE CONFIRMATION MODALS                                               */}
      {/* ========================================================================= */}

      {/* 1. Delete Test Case Confirmation Modal */}
      {deleteCaseTarget && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="text-base font-black text-slate-900">Delete Test Case?</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-800 font-bold">"{deleteCaseTarget.title}"</strong>? This will remove it from the test case repository.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteCaseTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCase}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Delete Folder Confirmation Modal */}
      {deleteFolderTarget && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="text-base font-black text-slate-900">Delete Folder?</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Are you sure you want to delete folder <strong className="text-slate-800 font-bold">"{deleteFolderTarget.title}"</strong> and all its associated test cases?
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteFolderTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteFolder}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-colors"
              >
                Delete Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Delete Script Confirmation Modal */}
      {deleteScriptTarget && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="text-base font-black text-slate-900">Delete Script?</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Are you sure you want to delete automation script <strong className="text-slate-800 font-bold">"{deleteScriptTarget.title}"</strong> from the repository?
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteScriptTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteScript}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-colors"
              >
                Delete Script
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Bulk Delete Scripts Confirmation Modal */}
      {showBulkDeleteScriptsConfirm && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="text-base font-black text-slate-900">Delete {selectedScriptIds.size} Scripts?</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Are you sure you want to permanently delete <strong className="text-slate-800 font-bold">{selectedScriptIds.size}</strong> selected script{selectedScriptIds.size > 1 ? 's' : ''} from the repository?
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBulkDeleteScriptsConfirm(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDeleteScripts}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-colors"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. GITHUB PUSH MODAL & JIRA MODAL                                         */}
      {/* ========================================================================= */}
      <GithubPushModal
        isOpen={!!selectedScriptForGithub}
        onClose={() => setSelectedScriptForGithub(null)}
        project={project}
        script={selectedScriptForGithub}
      />

      <JiraSyncModal
        isOpen={!!selectedScriptForJira}
        onClose={() => setSelectedScriptForJira(null)}
        project={project}
        script={selectedScriptForJira}
      />
    </div>
  );
};

export default ScriptGenerator;
