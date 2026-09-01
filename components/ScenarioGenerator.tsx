import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Project, TestScenario } from '../types';
import { toast } from 'sonner';
import { formatAcceptanceCriteria } from '../services/apiUtils';
import { 
  Sparkles, 
  Trash2, 
  Loader2, 
  FileText, 
  X, 
  Info, 
  Search, 
  ChevronDown, 
  LayoutGrid, 
  Globe, 
  FileSearch, 
  Upload, 
  FolderPlus, 
  Folder, 
  CheckCircle2, 
  User, 
  Lock, 
  ChevronUp, 
  Layers, 
  Link, 
  Eye, 
  AlertTriangle, 
  FileSpreadsheet, 
  Download, 
  Check, 
  Pencil, 
  CheckSquare, 
  Square, 
  Save, 
  Asterisk, 
  PlusCircle, 
  Plus, 
  MinusCircle, 
  ChevronLeft, 
  ChevronRight,
  Copy,
  Paperclip
} from 'lucide-react';
import { generateScenariosFromInput } from '../geminiService';
import { recordFeatureConsumption } from '../services/tokenConsumptionService';
import { logActivity } from '../services/activityService';
import { ragEnrichPrompt, indexSingleItem } from '../services/ragService';
import { RAGStatusBadge } from './RAGStatusBadge';
import { VectorSearchResult } from '../types';
import { JiraImportModal } from './JiraImportModal';
import { ScreenshotUploader, ScreenshotFile } from './ScreenshotUploader';
import { ScreenshotGallery } from './ScreenshotGallery';
import * as XLSX from 'xlsx';
import { maskPasswordText } from './TestCaseManager';
import { parseDocumentFile, sanitizeAndExtractDocContent } from '../utils/docParser';

export { sanitizeAndExtractDocContent };

interface ScenarioGeneratorProps {
  project: Project;
  user: { email: string, name: string };
  onUpdateProject: (p: Project) => void;
  onRunFolder?: (folderId: string) => void;
}

const ScenarioGenerator: React.FC<ScenarioGeneratorProps> = ({ project, user, onUpdateProject, onRunFolder }) => {
  const [activeTab, setActiveTab] = useState<'text' | 'url' | 'doc'>('text');
  const [isJiraModalOpen, setIsJiraModalOpen] = useState(false);
  const [activeView, setActiveView] = useState<'scenarios' | 'folders'>('scenarios');
  const [description, setDescription] = useState('');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // URL State Management
  const [appUrl, setAppUrl] = useState(''); // Global Login Context URL
  const [analysisUrl, setAnalysisUrl] = useState(''); // Website URL Tab specific
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
interface LastInputDetails {
  activeTab: string;
  docFileName?: string;
  docContent?: string;
  description?: string;
  analysisUrl?: string;
  screenshots?: ScreenshotFile[];
  aiInstructions?: string;
  appUrl?: string;
  username?: string;
  timestamp: string;
}

  // Document State Management
  const [docContent, setDocContent] = useState('');
  const [docFileName, setDocFileName] = useState('');
  const [screenshots, setScreenshots] = useState<ScreenshotFile[]>([]);
  const [lastInputDetails, setLastInputDetails] = useState<LastInputDetails | null>(null);
  
  const [aiInstructions, setAiInstructions] = useState('Generate test scenarios using only the inputs provided. Identify actors, business rules, validation logic, and exceptions. Output Functional, Non-Functional, Edge Cases, and Negative scenarios.');
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<Set<string>>(new Set());
  
  // Edit State
  const [editingItem, setEditingItem] = useState<TestScenario | null>(null);
  const [editForm, setEditForm] = useState<Partial<TestScenario>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // Manage Items Modal State
  const [managingFolder, setManagingFolder] = useState<TestScenario | null>(null);
  const [tempMemberIds, setTempMemberIds] = useState<Set<string>>(new Set());

  // Folder Creation State
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // New States for AI Scenarios enhancement
  const [newlyGeneratedScenarios, setNewlyGeneratedScenarios] = useState<TestScenario[]>([]);
  const [isSaveConfirmModalOpen, setIsSaveConfirmModalOpen] = useState(false);
  const [isFolderSelectModalOpen, setIsFolderSelectModalOpen] = useState(false);
  const [selectedFolderIdForSave, setSelectedFolderIdForSave] = useState('');
  const [searchFolderQuery, setSearchFolderQuery] = useState('');
  const [showCreateFolderInline, setShowCreateFolderInline] = useState(false);
  const [inlineNewFolderName, setInlineNewFolderName] = useState('');
  const [inlineFolderError, setInlineFolderError] = useState<string | null>(null);
  const [scenariosToApproveAndSave, setScenariosToApproveAndSave] = useState<TestScenario[]>([]);
  const [scenariosToMoveWithoutApprove, setScenariosToMoveWithoutApprove] = useState<TestScenario[]>([]);
  const [ragEnabled, setRagEnabled] = useState(true);
  const [retrievedRagChunks, setRetrievedRagChunks] = useState<VectorSearchResult[]>([]);

  // States for importing user stories
  const [isImportStoriesModalOpen, setIsImportStoriesModalOpen] = useState(false);
  const [selectedImportStoryIds, setSelectedImportStoryIds] = useState<Set<string>>(new Set());
  const [searchImportStoryQuery, setSearchImportStoryQuery] = useState('');
  const [expandedImportFolders, setExpandedImportFolders] = useState<Set<string>>(new Set());

  const userStoriesList = useMemo(() => project.userStories || [], [project.userStories]);

  const userStoryFolders = useMemo(() => {
    return userStoriesList.filter(s => s.storyId === 'USERSTORY_FOLDER');
  }, [userStoriesList]);

  const individualUserStories = useMemo(() => {
    return userStoriesList.filter(s => 
      s.storyId !== 'USERSTORY_FOLDER' && s.storyId !== 'INPUT_SOURCE' && !s.isRemovedFromIndividual
    );
  }, [userStoriesList]);

  const filteredImportStories = useMemo(() => {
    const query = searchImportStoryQuery.toLowerCase().trim();
    if (!query) {
      return {
        folders: userStoryFolders,
        individuals: individualUserStories
      };
    }
    
    const filteredIndividuals = individualUserStories.filter(s => 
      (s.summary || '').toLowerCase().includes(query) ||
      (s.description || '').toLowerCase().includes(query) ||
      (s.acceptanceCriteria || '').toLowerCase().includes(query)
    );

    const filteredFolders = userStoryFolders.filter(folder => {
      const folderMatches = (folder.summary || '').toLowerCase().includes(query);
      if (folderMatches) return true;

      const memberIds = folder.memberStoryIds || [];
      const folderMembers = userStoriesList.filter(s => memberIds.includes(s.id));
      return folderMembers.some(s => 
        (s.summary || '').toLowerCase().includes(query) ||
        (s.description || '').toLowerCase().includes(query) ||
        (s.acceptanceCriteria || '').toLowerCase().includes(query)
      );
    });

    return {
      folders: filteredFolders,
      individuals: filteredIndividuals
    };
  }, [userStoriesList, userStoryFolders, individualUserStories, searchImportStoryQuery]);

  const docUploadRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const scenarios = project.scenarios || [];

  // All valid scenario test items (excluding structural folders and original generation input source artifacts)
  const allValidScenarios = useMemo(() => 
    scenarios.filter(s => !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId)),
  [scenarios]);

  const totalScenariosCount = allValidScenarios.length;
  const totalApprovedScenariosCount = useMemo(() => allValidScenarios.filter(s => s.isApproved).length, [allValidScenarios]);
  const totalUnapprovedScenariosCount = useMemo(() => allValidScenarios.filter(s => !s.isApproved).length, [allValidScenarios]);

  const individualCount = useMemo(() => 
    scenarios.filter(s => 
      !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId) && 
      !s.isApproved &&
      !s.isRemovedFromIndividual &&
      !s.saved
    ).length,
  [scenarios]);

  const folderCount = useMemo(() => 
    scenarios.filter(s => s.scenarioId === 'SCENARIO_FOLDER').length,
  [scenarios]);

  const filteredItems = useMemo(() => {
    let list = scenarios;
    if (activeView === 'folders') {
      list = list.filter(s => s.scenarioId === 'SCENARIO_FOLDER');
    } else {
      list = list.filter(s => 
        !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId) && 
        !s.isApproved &&
        !s.isRemovedFromIndividual &&
        !s.saved
      );
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(s =>
      s.title.toLowerCase().includes(q) || 
      s.description.toLowerCase().includes(q) || 
      s.moduleName.toLowerCase().includes(q)
    );
  }, [scenarios, searchQuery, activeView]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredItems.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredItems, currentPage]);

  // Handle pagination adjustment when items are deleted on the last page
  useEffect(() => {
    if (currentPage > 1 && paginatedItems.length === 0 && filteredItems.length > 0) {
      setCurrentPage(totalPages);
    } else if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [filteredItems.length, paginatedItems.length, currentPage, totalPages]);

  // Reset page when search or view changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeView]);

  // Reset uploaded document, screenshots, input details when project changes
  useEffect(() => {
    setDocContent('');
    setDocFileName('');
    setDescription('');
    setAnalysisUrl('');
    setScreenshots([]);
    setLastInputDetails(null);
    setNewlyGeneratedScenarios([]);
    setSelectedScenarioIds(new Set());
    if (docUploadRef.current) {
      docUploadRef.current.value = '';
    }
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  }, [project.id]);

  const allMangeableScenarios = useMemo(() => {
    return scenarios.filter(s => 
      !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId)
    );
  }, [scenarios]);

  const isAllVisibleSelected = useMemo(() => {
    return paginatedItems.length > 0 && paginatedItems.every(s => selectedScenarioIds.has(s.id));
  }, [paginatedItems, selectedScenarioIds]);

  const handleToggleAllVisible = () => {
    if (isAllVisibleSelected) {
      const next = new Set(selectedScenarioIds);
      paginatedItems.forEach(s => next.delete(s.id));
      setSelectedScenarioIds(next);
    } else {
      const next = new Set(selectedScenarioIds);
      paginatedItems.forEach(s => next.add(s.id));
      setSelectedScenarioIds(next);
    }
  };

  const handleImportStories = () => {
    if (selectedImportStoryIds.size === 0) {
      toast.error('Please select at least one user story to import.');
      return;
    }

    const allStories = project.userStories || [];
    const selectedStories = allStories.filter(s => selectedImportStoryIds.has(s.id));

    if (selectedStories.length === 0) {
      toast.error('Selected stories not found.');
      return;
    }

    const formattedText = selectedStories.map(s => {
      let text = `User Story Number: ${s.storyId || 'N/A'}\n`;
      text += `User Story Summary: ${s.summary}\n`;
      if (s.description && s.description !== 'Organization folder') {
        text += `User Story Description:\n${s.description}\n`;
      }
      if (s.acceptanceCriteria && s.acceptanceCriteria !== 'N/A') {
        text += `Acceptance Criteria:\n${formatAcceptanceCriteria(s.acceptanceCriteria)}\n`;
      }
      return text;
    }).join('\n---\n\n');

    const separator = description.trim() ? '\n\n---\n\n' : '';
    setDescription(prev => prev + separator + formattedText);
    
    setActiveTab('text');
    setIsImportStoriesModalOpen(false);
    setSelectedImportStoryIds(new Set());
    setSearchImportStoryQuery('');
    
    toast.success(`Imported ${selectedStories.length} user story/stories successfully!`);
  };

  const handleToggleImportStory = (id: string) => {
    const next = new Set(selectedImportStoryIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedImportStoryIds(next);
  };

  const handleToggleImportFolder = (folderId: string, memberIds: string[]) => {
    const next = new Set(selectedImportStoryIds);
    const allSelected = memberIds.length > 0 && memberIds.every(id => next.has(id));

    if (allSelected) {
      memberIds.forEach(id => next.delete(id));
    } else {
      memberIds.forEach(id => next.add(id));
    }
    setSelectedImportStoryIds(next);
  };

  const handleToggleExpandImportFolder = (folderId: string) => {
    const next = new Set(expandedImportFolders);
    if (next.has(folderId)) {
      next.delete(folderId);
    } else {
      next.add(folderId);
    }
    setExpandedImportFolders(next);
  };

  const handleGenerate = async () => {
    if (isGenerating) return;

    let finalInput = '';
    const loginContext = `\n\nGlobal Login Context:\nURL: ${appUrl}\nUsername: ${username}\nPassword: ${password}`;

    if (activeTab === 'text') {
        if (!description.trim() && screenshots.length === 0) {
            toast.error("Please provide feature description text or attach screenshot(s)");
            return;
        }
        finalInput = description.trim() 
          ? `Primary Input (Feature Description):\n${description}${loginContext}`
          : `Primary Input: Screenshots provided without textual description.${loginContext}`;
    } else if (activeTab === 'url') {
        if (!analysisUrl.trim() && screenshots.length === 0) {
            toast.error("Please provide website URL or attach screenshot(s)");
            return;
        }
        finalInput = analysisUrl.trim()
          ? `Target Analysis URL: ${analysisUrl}\nContext: ${description}${loginContext}`
          : `Primary Input: Screenshots provided without URL.${loginContext}`;
    } else if (activeTab === 'doc') {
        if (!docContent.trim() && screenshots.length === 0) {
            toast.error("Please attach requirements doc or attach screenshot(s)");
            return;
        }
        finalInput = docContent.trim()
          ? `Requirements Doc (${docFileName}) Content:\n${docContent}\nInstructions: ${description}${loginContext}`
          : `Primary Input: Screenshots provided without requirement doc content.${loginContext}`;
    }

    setIsGenerating(true);
    try {
      let enrichedInput = finalInput;
      if (ragEnabled) {
        const queryForRag = description || docContent || analysisUrl || 'Generate test scenarios';
        const enriched = await ragEnrichPrompt(queryForRag, project.id, 3);
        enrichedInput = `${enriched.prompt}\n\n${finalInput}`;
        setRetrievedRagChunks(enriched.chunks);
      } else {
        setRetrievedRagChunks([]);
      }

      const screenshotUrls = screenshots.map(s => s.previewUrl || (s.data?.startsWith('data:') || s.data?.startsWith('http') ? s.data : `data:${s.mimeType || 'image/png'};base64,${s.data}`));

      const results = (await generateScenariosFromInput(enrichedInput, activeTab as any, { aiInstructions, screenshots })) as any[];
      const newScenarios: TestScenario[] = results.map((s: any, idx: number) => {
        let scId = s.scenarioId;
        if (!scId || scId === 'AUTO' || !scId.trim()) {
          scId = s.userStoryNumber ? `TS-${s.userStoryNumber.replace(/[^a-zA-Z0-9]/g, '')}-${(idx + 1).toString().padStart(2, '0')}` : `TS-${(idx + 1).toString().padStart(3, '0')}`;
        }
        return {
          id: Math.random().toString(36).substr(2, 9),
          scenarioId: scId,
          title: s.title || 'Untitled Scenario',
          type: s.type || 'Functional',
          description: s.description || 'No description provided',
          expectedResults: s.expectedResults || 'No expected results defined',
          moduleName: s.moduleName || 'AI Generated',
          isApproved: false,
          testCases: [],
          createdAt: new Date().toISOString(),
          appUrl: appUrl || "",
          username: username || "",
          password: password || "",
          saved: false,
          folderId: "",
          priority: s.priority || 'Medium',
          tags: s.tags || [],
          userStoryNumber: s.userStoryNumber || '',
          userStorySummary: s.userStorySummary || '',
          userStoryId: s.userStoryNumber || '',
          attachments: undefined
        };
      });

      // Generated scenarios are automatically recorded into Token Consumption via the AI service call


      // Create a single consolidated input source item containing all input documents and screenshots together
      const inputSources: TestScenario[] = [];

      const hasDoc = activeTab === 'doc' && docContent.trim();
      const hasUrl = activeTab === 'url' && analysisUrl.trim();
      const hasText = activeTab === 'text' && description.trim();
      const hasScreenshots = screenshotUrls.length > 0;

      if (hasDoc || hasUrl || hasText || hasScreenshots || (aiInstructions && aiInstructions.trim()) || appUrl.trim() || username.trim()) {
        let singleTitle = 'Input Source: Documents & Context';
        if (docFileName && hasScreenshots) {
          singleTitle = `Input Source: Document (${docFileName}) & Screenshots (${screenshotUrls.length})`;
        } else if (docFileName) {
          singleTitle = `Input Source: Requirements Doc (${docFileName})`;
        } else if (hasScreenshots && (hasText || hasUrl)) {
          singleTitle = `Input Source: Requirements & Screenshots (${screenshotUrls.length})`;
        } else if (hasScreenshots) {
          singleTitle = `Input Source: Screenshots (${screenshotUrls.length})`;
        } else if (hasText) {
          singleTitle = 'Input Source: Feature Description';
        } else if (hasUrl) {
          singleTitle = 'Input Source: Website URL Analysis';
        }

        let combinedDesc = '';
        if (hasDoc) {
          const cleanDoc = sanitizeAndExtractDocContent(docContent, docFileName);
          combinedDesc += `Document File: ${docFileName || 'Attached Document'}\n\n${cleanDoc}`;
          if (description.trim()) {
            combinedDesc += `\n\nAdditional Instructions:\n${description.trim()}`;
          }
        } else if (hasUrl) {
          combinedDesc += `Analysis URL: ${analysisUrl.trim()}`;
          if (description.trim()) {
            combinedDesc += `\n\nAdditional Context:\n${description.trim()}`;
          }
        } else if (hasText) {
          combinedDesc += `Feature Description:\n${description.trim()}`;
        }

        if (hasScreenshots) {
          if (combinedDesc) combinedDesc += '\n\n';
          combinedDesc += `Attached Screenshots: ${screenshotUrls.length} image(s) uploaded.`;
        }

        if (appUrl.trim() || username.trim() || password.trim()) {
          if (combinedDesc) combinedDesc += '\n\n';
          combinedDesc += `Login Environment:\nURL: ${appUrl.trim() || 'N/A'}\nUser: ${username.trim() || 'N/A'}\nPassword: ${password ? '••••••••' : 'N/A'}`;
        }

        if (aiInstructions && aiInstructions.trim()) {
          if (combinedDesc) combinedDesc += '\n\n';
          combinedDesc += `Refining Constraints:\n${aiInstructions.trim()}`;
        }

        inputSources.push({
          id: Math.random().toString(36).substr(2, 9),
          scenarioId: 'INPUT_SOURCE',
          title: singleTitle,
          type: 'Functional',
          description: combinedDesc,
          expectedResults: 'Original input document(s) and screenshot(s) used for AI scenario synthesis.',
          moduleName: 'INPUTS',
          isApproved: false,
          testCases: [],
          createdAt: new Date().toISOString(),
          saved: false,
          folderId: "",
          priority: 'Medium',
          tags: ['input-source', 'original-input', ...(hasScreenshots ? ['screenshots'] : []), ...(hasDoc ? ['requirements-doc'] : [])],
          attachments: hasScreenshots ? screenshotUrls : undefined
        });
      }

      const allNewItems = [...newScenarios, ...inputSources];

      // Save input snapshot so details/document can be displayed under generated scenarios
      setLastInputDetails({
        activeTab,
        docFileName,
        docContent,
        description,
        analysisUrl,
        screenshots: [...screenshots],
        aiInstructions,
        appUrl,
        username,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      // Clear input document & fields so they disappear from generator input area
      setDescription('');
      setDocContent('');
      setDocFileName('');
      setAnalysisUrl('');
      setScreenshots([]);
      if (docUploadRef.current) {
        docUploadRef.current.value = '';
      }

      // Store in state so they remain visible on screen
      setNewlyGeneratedScenarios(allNewItems);

      // Add new items at the top to ensure visibility on the first page
      onUpdateProject({ ...project, scenarios: [...allNewItems, ...scenarios] });
      logActivity(user.email, user.name, `Generated ${newScenarios.length} Scenarios via ${activeTab.toUpperCase()} (Inputs saved to workspace)`, project.id, project.name).catch(err => console.error("Error logging activity:", err));

      toast.success(`Successfully generated ${newScenarios.length} test scenarios.`);
    } catch (e) {
      alert('Generation failed. Please check your API connection.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveScenario = async (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    
    const target = scenarios.find(s => s.id === id);
    if (!target) return;

    // Check if the scenario is already saved to a folder or belongs to a folder
    const isInFolder = target.folderId || target.saved || target.isRemovedFromIndividual ||
      scenarios.some(s => s.scenarioId === 'SCENARIO_FOLDER' && (s.memberScenarioIds || []).includes(target.id));

    if (isInFolder) {
      const updatedScenarios = scenarios.map(s => s.id === id ? { ...s, isApproved: true } : s);
      onUpdateProject({ ...project, scenarios: updatedScenarios });
      
      if (selectedScenarioIds.has(id)) {
        const next = new Set(selectedScenarioIds);
        next.delete(id);
        setSelectedScenarioIds(next);
      }
      
      await logActivity(user.email, user.name, `Approved Scenario: ${target.title}`, project.id, project.name);
      toast.success('Scenario approved successfully!');
      return;
    }

    // Otherwise, ask user to save it to a folder first!
    setScenariosToApproveAndSave([target]);
    setSelectedFolderIdForSave('');
    setShowCreateFolderInline(false);
    setInlineNewFolderName('');
    setInlineFolderError(null);
  };

  const handleSaveAndApproveScenario = async () => {
    if (scenariosToApproveAndSave.length === 0) return;
    
    try {
      let finalFolderId = selectedFolderIdForSave;
      let updatedScenariosList = [...scenarios];
      const targetIds = scenariosToApproveAndSave.map(s => s.id);
      const targetIdSet = new Set(targetIds);

      if (showCreateFolderInline) {
        const trimmedInlineName = inlineNewFolderName.trim();
        if (!trimmedInlineName) {
          setInlineFolderError('Please enter a folder name');
          return;
        }

        const isDuplicate = scenarios.some(s => 
          s.scenarioId === 'SCENARIO_FOLDER' && 
          s.title.toLowerCase() === trimmedInlineName.toLowerCase()
        );

        if (isDuplicate) {
          setInlineFolderError('This folder name is already in use.');
          return;
        }

        const newFolderId = Math.random().toString(36).substr(2, 9);
        const newFolder: TestScenario = {
          id: newFolderId,
          scenarioId: 'SCENARIO_FOLDER',
          title: trimmedInlineName,
          type: 'Functional',
          description: 'Organization folder',
          expectedResults: 'N/A',
          moduleName: 'AI SCENARIOS',
          isApproved: true,
          testCases: [],
          createdAt: new Date().toISOString(),
          memberScenarioIds: targetIds
        };

        // Remove target scenarios from all existing folders
        updatedScenariosList = updatedScenariosList.map(s => {
          if (s.scenarioId === 'SCENARIO_FOLDER') {
            return {
              ...s,
              memberScenarioIds: (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id))
            };
          }
          return s;
        });

        updatedScenariosList = [newFolder, ...updatedScenariosList];
        finalFolderId = newFolderId;
      } else {
        if (!finalFolderId) {
          toast.error('Please select a folder or create a new one');
          return;
        }

        // Add the target scenario IDs to the selected folder's memberScenarioIds AND remove from all other folders
        updatedScenariosList = updatedScenariosList.map(s => {
          if (s.scenarioId === 'SCENARIO_FOLDER') {
            if (s.id === finalFolderId) {
              const currentMembers = (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id));
              return {
                ...s,
                memberScenarioIds: Array.from(new Set([...currentMembers, ...targetIds]))
              };
            } else {
              return {
                ...s,
                memberScenarioIds: (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id))
              };
            }
          }
          return s;
        });
      }

      // Mark the target scenarios as saved, moved to folder, and approved!
      // Also mark any other selected scenarios as approved
      updatedScenariosList = updatedScenariosList.map(s => {
        if (targetIdSet.has(s.id)) {
          return {
            ...s,
            saved: true,
            folderId: finalFolderId,
            isRemovedFromIndividual: true,
            isApproved: true
          };
        } else if (selectedScenarioIds.has(s.id)) {
          return {
            ...s,
            isApproved: true
          };
        }
        return s;
      });

      // Update the project
      onUpdateProject({ ...project, scenarios: updatedScenariosList });

      // Clean selected scenario IDs
      const nextSelected = new Set(selectedScenarioIds);
      targetIds.forEach(id => nextSelected.delete(id));
      setSelectedScenarioIds(nextSelected);

      const count = scenariosToApproveAndSave.length;
      const activityMsg = count === 1
        ? `Saved & Approved Scenario: ${scenariosToApproveAndSave[0].title} into folder`
        : `Saved & Approved ${count} Scenarios into folder`;

      // Close modal immediately
      setScenariosToApproveAndSave([]);
      setInlineNewFolderName('');
      setInlineFolderError(null);
      setSelectedFolderIdForSave('');
      setShowCreateFolderInline(false);

      toast.success(count === 1 ? 'Scenario saved and approved successfully!' : `${count} scenarios saved and approved successfully!`);

      logActivity(
        user.email, 
        user.name, 
        activityMsg, 
        project.id, 
        project.name
      ).catch(err => console.error("Error logging activity:", err));
    } catch (error) {
      toast.error('Failed to save and approve scenario. Please try again.');
    }
  };

  const handleSaveScenariosWithoutApprove = async () => {
    if (scenariosToMoveWithoutApprove.length === 0) return;
    
    try {
      let finalFolderId = selectedFolderIdForSave;
      let updatedScenariosList = [...scenarios];
      const targetIds = scenariosToMoveWithoutApprove.map(s => s.id);
      const targetIdSet = new Set(targetIds);

      if (showCreateFolderInline) {
        const trimmedInlineName = inlineNewFolderName.trim();
        if (!trimmedInlineName) {
          setInlineFolderError('Please enter a folder name');
          return;
        }

        const isDuplicate = scenarios.some(s => 
          s.scenarioId === 'SCENARIO_FOLDER' && 
          s.title.toLowerCase() === trimmedInlineName.toLowerCase()
        );

        if (isDuplicate) {
          setInlineFolderError('This folder name is already in use.');
          return;
        }

        const newFolderId = Math.random().toString(36).substr(2, 9);
        const newFolder: TestScenario = {
          id: newFolderId,
          scenarioId: 'SCENARIO_FOLDER',
          title: trimmedInlineName,
          type: 'Functional',
          description: 'Organization folder',
          expectedResults: 'N/A',
          moduleName: 'AI SCENARIOS',
          isApproved: true,
          testCases: [],
          createdAt: new Date().toISOString(),
          memberScenarioIds: targetIds
        };

        // Remove target scenarios from all existing folders
        updatedScenariosList = updatedScenariosList.map(s => {
          if (s.scenarioId === 'SCENARIO_FOLDER') {
            return {
              ...s,
              memberScenarioIds: (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id))
            };
          }
          return s;
        });

        updatedScenariosList = [newFolder, ...updatedScenariosList];
        finalFolderId = newFolderId;
      } else {
        if (!finalFolderId) {
          toast.error('Please select a folder or create a new one');
          return;
        }

        // Add the target scenario IDs to the selected folder's memberScenarioIds AND remove from all other folders
        updatedScenariosList = updatedScenariosList.map(s => {
          if (s.scenarioId === 'SCENARIO_FOLDER') {
            if (s.id === finalFolderId) {
              const currentMembers = (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id));
              return {
                ...s,
                memberScenarioIds: Array.from(new Set([...currentMembers, ...targetIds]))
              };
            } else {
              return {
                ...s,
                memberScenarioIds: (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id))
              };
            }
          }
          return s;
        });
      }

      // Mark the target scenarios as saved and moved into folder WITHOUT approving (isApproved remains unchanged / false)
      updatedScenariosList = updatedScenariosList.map(s => {
        if (targetIdSet.has(s.id)) {
          return {
            ...s,
            saved: true,
            folderId: finalFolderId,
            isRemovedFromIndividual: true
            // isApproved is preserved as is (unapproved)
          };
        }
        return s;
      });

      // Update the project
      onUpdateProject({ ...project, scenarios: updatedScenariosList });

      // Clean selected scenario IDs
      const nextSelected = new Set(selectedScenarioIds);
      targetIds.forEach(id => nextSelected.delete(id));
      setSelectedScenarioIds(nextSelected);

      const count = scenariosToMoveWithoutApprove.length;
      const activityMsg = count === 1
        ? `Moved Scenario: ${scenariosToMoveWithoutApprove[0].title} to folder (Without Approving)`
        : `Moved ${count} Scenarios to folder (Without Approving)`;

      // Close modal immediately
      setScenariosToMoveWithoutApprove([]);
      setInlineNewFolderName('');
      setInlineFolderError(null);
      setSelectedFolderIdForSave('');
      setShowCreateFolderInline(false);

      toast.success(count === 1 ? 'Scenario moved to folder without approving!' : `${count} scenarios moved to folder without approving!`);

      logActivity(
        user.email, 
        user.name, 
        activityMsg, 
        project.id, 
        project.name
      ).catch(err => console.error("Error logging activity:", err));
    } catch (error) {
      toast.error('Failed to move scenarios to folder. Please try again.');
    }
  };

  const handleBulkMoveToFolder = () => {
    if (selectedScenarioIds.size === 0) return;

    const selectedScenarios = scenarios.filter(s => selectedScenarioIds.has(s.id) && !['SCENARIO_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId));
    if (selectedScenarios.length === 0) return;

    setScenariosToMoveWithoutApprove(selectedScenarios);
    setSelectedFolderIdForSave('');
    setShowCreateFolderInline(false);
    setInlineNewFolderName('');
    setInlineFolderError(null);
  };

  const handleBulkApprove = () => {
    if (selectedScenarioIds.size === 0) return;

    const selectedScenarios = scenarios.filter(s => selectedScenarioIds.has(s.id));
    const individualSelected = selectedScenarios.filter(s => !s.folderId && !s.saved && !s.isRemovedFromIndividual && s.scenarioId !== 'SCENARIO_FOLDER' && s.scenarioId !== 'INPUT_SOURCE');

    if (individualSelected.length > 0) {
      // Prompt user to save individual scenarios into a folder first!
      setScenariosToApproveAndSave(individualSelected);
      setSelectedFolderIdForSave('');
      setShowCreateFolderInline(false);
      setInlineNewFolderName('');
      setInlineFolderError(null);
      return;
    }

    // If all selected scenarios are already saved in folders, approve them directly
    const updatedScenarios = scenarios.map(s => selectedScenarioIds.has(s.id) ? { ...s, isApproved: true } : s);
    onUpdateProject({ ...project, scenarios: updatedScenarios });
    setSelectedScenarioIds(new Set());
    logActivity(user.email, user.name, `Bulk approved ${selectedScenarioIds.size} scenarios`, project.id, project.name);
    toast.success(`Bulk approved ${selectedScenarioIds.size} scenarios successfully!`);
  };

  const handleBulkDelete = () => {
    const selectedIds = new Set(selectedScenarioIds);
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const deletedFolderIds = new Set(
      scenarios.filter(s => s.scenarioId === 'SCENARIO_FOLDER' && selectedIds.has(s.id)).map(s => s.id)
    );

    let updatedScenarios = scenarios.filter(s => !selectedIds.has(s.id));
    
    // Clean up folder associations: reset folderId if folder was deleted, remove deleted IDs from folder members
    updatedScenarios = updatedScenarios.map(s => {
      if (s.folderId && deletedFolderIds.has(s.folderId)) {
        return { ...s, folderId: "", isRemovedFromIndividual: false };
      }
      if (s.scenarioId === 'SCENARIO_FOLDER') {
        const nextMembers = (s.memberScenarioIds || []).filter(mId => !selectedIds.has(mId));
        return { ...s, memberScenarioIds: nextMembers };
      }
      return s;
    });

    // Update newlyGeneratedScenarios state immediately
    setNewlyGeneratedScenarios(prev => prev.filter(s => !selectedIds.has(s.id)));

    onUpdateProject({ ...project, scenarios: updatedScenarios });
    setSelectedScenarioIds(new Set());
    setShowBulkDeleteConfirm(false);
    logActivity(user.email, user.name, `Bulk deleted ${count} scenarios`, project.id, project.name);
    toast.success(`Deleted ${count} scenarios successfully!`);
  };

  const handleDeleteScenario = (id: string) => {
    const targetFolder = scenarios.find(s => s.id === id && s.scenarioId === 'SCENARIO_FOLDER');
    let updatedScenarios = scenarios.filter(s => s.id !== id);

    if (targetFolder) {
      const memberIds = new Set(targetFolder.memberScenarioIds || []);
      updatedScenarios = updatedScenarios.map(s => {
        if (memberIds.has(s.id) || s.folderId === id) {
          return { ...s, folderId: "", isRemovedFromIndividual: false };
        }
        return s;
      });
    } else {
      // If deleted scenario belongs to any folder, remove its ID from folder's memberScenarioIds
      updatedScenarios = updatedScenarios.map(s => {
        if (s.scenarioId === 'SCENARIO_FOLDER' && s.memberScenarioIds?.includes(id)) {
          return {
            ...s,
            memberScenarioIds: s.memberScenarioIds.filter(mId => mId !== id)
          };
        }
        return s;
      });
    }

    // Update newlyGeneratedScenarios state immediately
    setNewlyGeneratedScenarios(prev => prev.filter(s => s.id !== id));

    onUpdateProject({ ...project, scenarios: updatedScenarios });
    
    // Remove the deleted scenario ID from the selection set
    if (selectedScenarioIds.has(id)) {
      const next = new Set(selectedScenarioIds);
      next.delete(id);
      setSelectedScenarioIds(next);
    }
    
    // Also remove from expanded items
    if (expandedItems.has(id)) {
      const nextExp = new Set(expandedItems);
      nextExp.delete(id);
      setExpandedItems(nextExp);
    }

    logActivity(user.email, user.name, `Deleted scenario ${id}`, project.id, project.name);
    toast.success("Scenario deleted successfully");
    setDeleteTargetId(null);
  };

  const handleDownloadTemplate = () => {
    const template = [
      { Title: 'Verify login flow', Module: 'Identity', Type: 'Functional', Description: 'Check user can sign in', ExpectedResults: 'User redirected to dashboard' }
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Scenarios");
    XLSX.writeFile(wb, "Scenario_Template.xlsx");
  };

  const handleDownloadRepository = () => {
    const data = scenarios.filter(s => s.isApproved && !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER'].includes(s.scenarioId)).map(s => {
      const scPassword = s.password || password;
      return {
        Title: s.title,
        Module: s.moduleName,
        Type: s.type,
        Description: maskPasswordText(s.description, scPassword),
        ExpectedResults: maskPasswordText(s.expectedResults, scPassword)
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Repository");
    XLSX.writeFile(wb, `${project.name}_Scenarios.xlsx`);
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

        const newScenarios: TestScenario[] = data.map((item, idx) => ({
          id: Math.random().toString(36).substr(2, 9),
          scenarioId: `UP-${Date.now().toString().slice(-4)}-${idx}`,
          title: item.Title || item.Scenario || 'Uploaded Scenario',
          type: (item.Type === 'Non-functional' || item.Type === 'Non-Functional') ? 'Non-functional' : 'Functional',
          description: item.Description || item.Scenario || 'No description',
          expectedResults: item.ExpectedResults || 'No expected results',
          moduleName: item.Module || 'Uploaded',
          isApproved: false, // Mark as false to ensure they appear in the pending individual scenarios list
          testCases: [],
          createdAt: new Date().toISOString(),
          appUrl: appUrl || "",
          username: username || "",
          password: password || ""
        }));

        // Insert at the beginning so they appear on page 1
        onUpdateProject({ ...project, scenarios: [...newScenarios, ...scenarios] });
        await logActivity(user.email, user.name, `Uploaded ${newScenarios.length} Scenarios via Excel`, project.id, project.name);
        
        if (uploadInputRef.current) uploadInputRef.current.value = '';
        alert(`Successfully uploaded ${newScenarios.length} scenarios. Please review them in the Individual Scenarios tab.`);
      } catch (err) {
        alert('Failed to parse file.');
      }
    };
    reader.readAsBinaryString(file as Blob);
  };

  const handleDownloadFolderScenarios = (folder: TestScenario, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    const memberIds = new Set(folder.memberScenarioIds || []);
    const members = scenarios.filter(s => memberIds.has(s.id) && s.scenarioId !== 'INPUT_SOURCE');
    
    if (members.length === 0) {
      alert("No scenarios found in this folder to export.");
      return;
    }

    const data = members.map(s => {
      const scPassword = s.password || folder.password || password;
      return {
        Title: s.title,
        Module: s.moduleName,
        Type: s.type,
        Description: maskPasswordText(s.description, scPassword),
        ExpectedResults: maskPasswordText(s.expectedResults, scPassword)
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Folder Scenarios");
    XLSX.writeFile(workbook, `${folder.title.replace(/\s+/g, '_')}_Scenarios.xlsx`);
  };

  const handleDownloadUserStoryScenarios = (userStoryNum: string, members: TestScenario[], folderTitle: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    const validMembers = members.filter(s => s.scenarioId !== 'INPUT_SOURCE');
    if (validMembers.length === 0) {
      toast.error("No scenarios found for this user story to export.");
      return;
    }

    const data = validMembers.map(s => {
      const scPassword = s.password || password;
      return {
        Title: s.title,
        Module: s.moduleName,
        Type: s.type,
        Description: maskPasswordText(s.description, scPassword),
        ExpectedResults: maskPasswordText(s.expectedResults, scPassword)
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "User Story Scenarios");
    const safeUserStoryNum = userStoryNum.replace(/[^a-zA-Z0-9-_]/g, '_');
    const safeFolderTitle = folderTitle.replace(/\s+/g, '_');
    XLSX.writeFile(workbook, `${safeUserStoryNum}_${safeFolderTitle}_Scenarios.xlsx`);
    
    toast.success(`Exported ${validMembers.length} scenarios for ${userStoryNum}`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocFileName(file.name);
    try {
      const cleanContent = await parseDocumentFile(file);
      setDocContent(cleanContent);
      toast.success(`Loaded document: ${file.name}`);
    } catch (err) {
      console.error("Failed to parse document file:", err);
      toast.error(`Failed to read document: ${file.name}`);
    }
  };

  const handleRemoveDoc = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDocFileName('');
    setDocContent('');
    if (docUploadRef.current) docUploadRef.current.value = '';
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedItems);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedItems(next);
  };

  const handleOpenEdit = (item: TestScenario, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingItem(item);
    setEditForm({ ...item });
    setEditErrors({});
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const errors: Record<string, string> = {};
    if (!editForm.title?.trim()) errors.title = "Title is required";
    if (editingItem.scenarioId !== 'SCENARIO_FOLDER' && !editForm.moduleName?.trim()) errors.moduleName = "Module name is required";
    
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }

    const updatedScenarios = scenarios.map(s => s.id === editingItem.id ? { ...s, ...editForm } as TestScenario : s);
    onUpdateProject({ ...project, scenarios: updatedScenarios });
    await logActivity(user.email, user.name, `Updated artifact: ${editForm.title}`, project.id, project.name);
    setEditingItem(null);
    setEditForm({});
  };

  const handleOpenManageItems = (folder: TestScenario, e: React.MouseEvent) => {
    e.stopPropagation();
    setManagingFolder(folder);
    const existingMemberIds = new Set(
      scenarios
        .filter(s => ((folder.memberScenarioIds || []).includes(s.id) || s.folderId === folder.id) && !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId))
        .map(s => s.id)
    );
    setTempMemberIds(existingMemberIds);
  };

  const handleToggleSelectAllMembers = () => {
    if (tempMemberIds.size === allMangeableScenarios.length) {
      setTempMemberIds(new Set());
    } else {
      setTempMemberIds(new Set(allMangeableScenarios.map(s => s.id)));
    }
  };

  const toggleTempMember = (id: string) => {
    const next = new Set(tempMemberIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setTempMemberIds(next);
  };

  const handleSaveFolderMembers = () => {
    if (!managingFolder) return;
    const memberIds = Array.from(tempMemberIds);
    const memberIdsSet = new Set(memberIds);

    const previousMemberIds = new Set(
      scenarios
        .filter(s => (s.folderId === managingFolder.id || (managingFolder.memberScenarioIds || []).includes(s.id)) && !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(s.scenarioId))
        .map(s => s.id)
    );
    const removedMemberIds = Array.from(previousMemberIds).filter(id => !memberIdsSet.has(id));

    const updatedScenarios = scenarios.map(s => {
        if (s.scenarioId === 'SCENARIO_FOLDER') {
            if (s.id === managingFolder.id) {
              return { ...s, memberScenarioIds: memberIds };
            } else {
              return {
                ...s,
                memberScenarioIds: (s.memberScenarioIds || []).filter(id => !memberIdsSet.has(id))
              };
            }
        }
        if (memberIdsSet.has(s.id)) {
            return {
                ...s,
                folderId: managingFolder.id,
                isRemovedFromIndividual: true
            };
        }
        if (removedMemberIds.includes(s.id)) {
            return {
                ...s,
                folderId: "",
                isRemovedFromIndividual: false
            };
        }
        return s;
    });
    onUpdateProject({ ...project, scenarios: updatedScenarios });
    logActivity(user.email, user.name, `Updated members for folder: ${managingFolder.title}`, project.id, project.name);
    setManagingFolder(null);
    toast.success('Folder scenarios updated successfully');
  };

  const handleCreateFolder = () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      setFolderError('Please enter the Folder name');
      return;
    }

    // Duplicate Check logic
    const isDuplicate = scenarios.some(s => 
      s.scenarioId === 'SCENARIO_FOLDER' && 
      s.title.toLowerCase() === trimmedName.toLowerCase()
    );

    if (isDuplicate) {
      setFolderError('This folder name is already in use. Please enter a different name to continue');
      return;
    }

    const folder: TestScenario = {
        id: Math.random().toString(36).substr(2, 9),
        scenarioId: 'SCENARIO_FOLDER',
        title: trimmedName,
        type: 'Functional',
        description: 'Organization folder',
        expectedResults: 'N/A',
        moduleName: 'AI SCENARIOS',
        isApproved: true,
        testCases: [],
        createdAt: new Date().toISOString(),
        memberScenarioIds: []
    };
    onUpdateProject({ ...project, scenarios: [folder, ...scenarios] });
    logActivity(user.email, user.name, `Created AI Folder: ${trimmedName}`, project.id, project.name);
    setNewFolderName('');
    setFolderError(null);
    setIsCreatingFolder(false);
  };

  const handleSaveScenariosToFolder = async () => {
    try {
      let finalFolderId = selectedFolderIdForSave;
      let updatedScenariosList = [...scenarios];
      const targetIds = newlyGeneratedScenarios.map(s => s.id);
      const targetIdSet = new Set(targetIds);

      if (showCreateFolderInline) {
        const trimmedInlineName = inlineNewFolderName.trim();
        if (!trimmedInlineName) {
          setInlineFolderError('Please enter a folder name');
          return;
        }

        const isDuplicate = scenarios.some(s => 
          s.scenarioId === 'SCENARIO_FOLDER' && 
          s.title.toLowerCase() === trimmedInlineName.toLowerCase()
        );

        if (isDuplicate) {
          setInlineFolderError('This folder name is already in use.');
          return;
        }

        const newFolderId = Math.random().toString(36).substr(2, 9);
        const newFolder: TestScenario = {
          id: newFolderId,
          scenarioId: 'SCENARIO_FOLDER',
          title: trimmedInlineName,
          type: 'Functional',
          description: 'Organization folder',
          expectedResults: 'N/A',
          moduleName: 'AI SCENARIOS',
          isApproved: true,
          testCases: [],
          createdAt: new Date().toISOString(),
          memberScenarioIds: targetIds
        };

        // Remove target scenarios from all other folders
        updatedScenariosList = updatedScenariosList.map(s => {
          if (s.scenarioId === 'SCENARIO_FOLDER') {
            return {
              ...s,
              memberScenarioIds: (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id))
            };
          }
          return s;
        });

        updatedScenariosList = [newFolder, ...updatedScenariosList];
        finalFolderId = newFolderId;
      } else {
        if (!finalFolderId) {
          toast.error('Please select a folder or create a new one');
          return;
        }

        // Add the scenario IDs to the selected folder's memberScenarioIds and remove from other folders
        updatedScenariosList = updatedScenariosList.map(s => {
          if (s.scenarioId === 'SCENARIO_FOLDER') {
            if (s.id === finalFolderId) {
              const currentMembers = (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id));
              return {
                ...s,
                memberScenarioIds: Array.from(new Set([...currentMembers, ...targetIds]))
              };
            } else {
              return {
                ...s,
                memberScenarioIds: (s.memberScenarioIds || []).filter(id => !targetIdSet.has(id))
              };
            }
          }
          return s;
        });
      }

      // Mark the newly generated scenarios as saved
      updatedScenariosList = updatedScenariosList.map(s => {
        if (targetIdSet.has(s.id)) {
          return {
            ...s,
            saved: true,
            folderId: finalFolderId,
            isRemovedFromIndividual: true
          };
        }
        return s;
      });

      // Update the project
      onUpdateProject({ ...project, scenarios: updatedScenariosList });

      // Update the newlyGeneratedScenarios state to reflect saved status
      setNewlyGeneratedScenarios(prev => prev.map(s => ({
        ...s,
        saved: true,
        folderId: finalFolderId,
        isRemovedFromIndividual: true
      })));

      // Close all modals immediately
      setIsFolderSelectModalOpen(false);
      setInlineNewFolderName('');
      setInlineFolderError(null);
      setSelectedFolderIdForSave('');
      setShowCreateFolderInline(false);

      toast.success('Scenarios saved successfully.');

      logActivity(user.email, user.name, `Saved ${newlyGeneratedScenarios.length} scenarios into folder`, project.id, project.name).catch(err => console.error('Error logging activity:', err));
    } catch (error) {
      toast.error('Failed to save scenarios. Please try again.');
    }
  };

  const isGenerateDisabled = useMemo(() => {
    return isGenerating;
  }, [isGenerating]);

  return (
    <div className="pb-20 animate-in fade-in duration-500">
      
      {/* AI Scenario Generation Card */}
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm mb-12 overflow-hidden relative">
        <div className="p-10">
          <div className="flex justify-between items-center mb-10">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black text-black uppercase tracking-tight">AI Scenarios</h2>
              <RAGStatusBadge
                enabled={ragEnabled}
                onToggle={setRagEnabled}
                retrievedChunks={retrievedRagChunks}
              />
            </div>
          </div>

          {/* Global Login Context Section */}
          <div className="bg-slate-50/50 border border-slate-100 rounded-[2.5rem] p-8 mb-10 relative">
            <div className="flex items-center gap-2 mb-6 ml-1">
              <Link size={14} className="text-indigo-400" />
              <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.15em]">Global Login Context (Applied to every generated scenario)</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="relative group">
                <Globe className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                <input 
                  value={appUrl || ''} 
                  onChange={e => setAppUrl(e.target.value)} 
                  placeholder="Application URL (e.g. https://app.qi)" 
                  className="w-full pl-12 pr-6 py-4 bg-white border border-slate-200 rounded-[1.2rem] text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-inner" 
                />
              </div>
              <div className="relative group">
                <User className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                <input 
                  value={username || ''} 
                  onChange={e => setUsername(e.target.value)} 
                  placeholder="Username / Email" 
                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-[1.2rem] text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-inner" 
                />
              </div>
              <div className="relative group">
                <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                <input 
                  type="password"
                  value={password || ''} 
                  onChange={e => setPassword(e.target.value)} 
                  placeholder="Login Password" 
                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-[1.2rem] text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-inner" 
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 mb-10 items-center justify-between">
            <div className="flex gap-4">
              {[
                { id: 'text', label: 'Feature Description', icon: <FileText size={16} /> },
                { id: 'url', label: 'Website URL', icon: <Globe size={16} /> },
                { id: 'doc', label: 'Requirements Doc', icon: <FileSearch size={16} /> }
              ].map(tab => (
                <button 
                  key={tab.id} 
                  onClick={() => setActiveTab(tab.id as any)} 
                  className={`flex items-center gap-3 px-8 py-3.5 rounded-[1.2rem] text-[14px] font-black uppercase tracking-widest transition-all border ${activeTab === tab.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-xl shadow-indigo-100' : 'bg-white text-slate-400 border-slate-100 hover:bg-slate-50'}`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <button 
                type="button"
                onClick={() => setIsJiraModalOpen(true)}
                className="flex items-center gap-3 px-8 py-3.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-[1.2rem] text-[14px] font-black uppercase tracking-widest hover:bg-indigo-600 hover:text-white transition-all shadow-md cursor-pointer"
              >
                <Sparkles size={16} className="text-yellow-500 animate-pulse" /> Import From Jira
              </button>
              <button 
                type="button"
                onClick={() => setIsImportStoriesModalOpen(true)}
                className="flex items-center gap-3 px-8 py-3.5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-[1.2rem] text-[14px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all shadow-md cursor-pointer"
              >
                <Folder size={16} className="text-emerald-500" /> Import From AI User Stories
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="flex items-center gap-2 mb-2 ml-1">
                <h3 className="text-[14px] font-black text-black uppercase tracking-widest">Primary Input Source</h3>
                <Info size={14} className="text-slate-300" />
              </div>
              
              <div className="bg-slate-50/30 border border-slate-100 rounded-[2.5rem] p-1.5 overflow-hidden group">
                {activeTab === 'doc' && !docFileName ? (
                  <div 
                    onClick={() => docUploadRef.current?.click()}
                    className="h-80 border-2 border-dashed border-slate-200 rounded-[2.5rem] flex flex-col items-center justify-center gap-4 hover:bg-white hover:border-indigo-400 transition-all cursor-pointer bg-white group"
                  >
                    <input type="file" ref={docUploadRef} className="hidden" accept=".txt,.pdf,.doc,.docx" onChange={handleFileChange} />
                    <div className="p-6 bg-slate-50 rounded-full text-slate-300 group-hover:bg-indigo-50 group-hover:text-indigo-400 transition-all">
                      <Upload size={40} />
                    </div>
                    <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Attach Requirements File</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-8 flex flex-col space-y-6">
                    {activeTab === 'url' && (
                      <div className="relative group animate-in slide-in-from-top-2">
                        <Globe className="absolute left-5 top-1/2 -translate-y-1/2 text-indigo-500" size={18} />
                        <input 
                          value={analysisUrl || ''} 
                          onChange={e => setAnalysisUrl(e.target.value)} 
                          placeholder="Enter target Website URL for analysis (e.g. https://example.com/flow)" 
                          className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 ring-indigo-50/10 transition-all"
                        />
                      </div>
                    )}

                    {activeTab === 'doc' && docFileName && (
                      <div className="flex items-center justify-between p-4 bg-indigo-50 rounded-2xl border border-indigo-100 animate-in slide-in-from-top-2">
                         <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-sm">
                               <FileText size={18} />
                            </div>
                            <span className="text-xs font-black text-indigo-900 uppercase truncate max-w-md">{docFileName}</span>
                         </div>
                         <button onClick={handleRemoveDoc} className="p-2 bg-white text-rose-500 hover:bg-rose-50 rounded-xl transition-all shadow-sm border border-slate-200">
                            <X size={16}/>
                         </button>
                      </div>
                    )}

                    <textarea 
                      value={description || ''} 
                      onChange={e => setDescription(e.target.value)} 
                      placeholder="Please provide detailed user story to generate scenarios"
                      className="w-full h-56 text-sm font-medium leading-relaxed outline-none resize-none placeholder:text-slate-300 italic text-slate-600"
                    />
                    
                    <div className="mt-4 pt-6 border-t border-slate-50 flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      <p className="text-[11px] font-black text-indigo-500 uppercase tracking-[0.1em]">
                        Optional: Attach UI screenshots below for multi-modal analysis (PNG, JPG, WEBP, GIF, SVG)
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Multi-Screenshot Input Uploader */}
              <ScreenshotUploader
                screenshots={screenshots}
                onChange={setScreenshots}
                title="Input Screenshots (Optional / Standalone)"
                description="Upload multiple screenshots. AI will analyze UI layouts, buttons, forms, and workflows to generate scenarios even if text is empty."
                className="mt-2"
              />
            </div>

            <div className="lg:col-span-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-black text-black uppercase tracking-widest ml-1 flex items-center gap-2">
                  <Sparkles size={16} className="text-indigo-600" />
                  Refine Instructions <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </h3>
                {aiInstructions && (
                  <span className="text-[11px] font-bold text-slate-400">
                    {aiInstructions.length}/1000
                  </span>
                )}
              </div>
              <div className="flex-1 bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-sm relative overflow-hidden">
                <textarea 
                  value={aiInstructions || ''}
                  onChange={e => setAiInstructions(e.target.value)}
                  placeholder="Generate test scenarios using only the inputs provided. Identify actors, business rules, validation logic, and exceptions. Output Functional, Non-Functional, Edge Cases, and Negative scenarios."
                  className="w-full h-full text-xs font-medium text-slate-400 leading-relaxed italic outline-none resize-none"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-12">
            <button 
              disabled={isGenerating}
              onClick={handleGenerate}
              className="bg-indigo-600 text-white px-16 py-5 rounded-full font-black text-xs uppercase tracking-widest flex items-center gap-3 shadow-2xl hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {isGenerating ? 'Generating AI Scenarios...' : 'Generate AI Scenarios'}
            </button>
          </div>
        </div>
      </div>

      {/* Newly Generated Scenarios Preview Section */}
      {newlyGeneratedScenarios.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-[2.5rem] p-10 mb-12 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8 border-b border-slate-200/60 pb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-black uppercase tracking-widest">
                  <Sparkles size={11} className="text-indigo-600" /> Latest Generation Result
                </span>
                {newlyGeneratedScenarios[0].saved ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-200 shadow-sm animate-pulse">
                    Saved to Folder
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-[10px] font-black uppercase tracking-widest border border-amber-200">
                    Unsaved
                  </span>
                )}
              </div>
              <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Newly Generated Scenarios</h3>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                Review the latest generated scenarios below. You can save them into an organization folder now.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {!newlyGeneratedScenarios[0].saved ? (
                <button
                  onClick={() => setIsFolderSelectModalOpen(true)}
                  className="flex items-center gap-2.5 bg-indigo-600 text-white px-8 py-4 rounded-full font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95"
                >
                  <Save size={15} /> Save to Folder
                </button>
              ) : (
                <div className="flex items-center gap-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-6 py-3.5 rounded-full font-black text-xs uppercase tracking-widest">
                  <Check size={16} strokeWidth={3} /> Saved Successfully
                </div>
              )}
              <button
                onClick={() => setNewlyGeneratedScenarios([])}
                className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 hover:text-slate-800 px-5 py-4 rounded-full font-black text-xs uppercase tracking-widest transition-all"
              >
                Clear Preview
              </button>
            </div>
          </div>

          <div className="space-y-12">
            {(() => {
              const groups: { [key: string]: typeof newlyGeneratedScenarios } = {};
              newlyGeneratedScenarios.forEach(s => {
                const key = s.userStoryNumber || 'No User Story';
                if (!groups[key]) groups[key] = [];
                groups[key].push(s);
              });

              const sortedGroupEntries = Object.entries(groups).sort(([keyA], [keyB]) => {
                if (keyA === 'No User Story') return 1;
                if (keyB === 'No User Story') return -1;
                return keyA.localeCompare(keyB);
              });

              return sortedGroupEntries.map(([userStoryNum, items]) => {
                const hasUS = userStoryNum !== 'No User Story';
                const usSummary = items.find(item => item.userStorySummary)?.userStorySummary || items[0]?.userStorySummary;

                return (
                  <div key={userStoryNum} className="space-y-6">
                    {hasUS && (
                      <div className="bg-indigo-50/45 border border-indigo-100/60 rounded-[2rem] p-6 text-left shadow-sm space-y-3 animate-in fade-in duration-200">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1">User Story ID / Number</span>
                          <div className="flex items-center gap-2.5">

                             <span className="inline-block text-xs font-mono font-black text-indigo-600 bg-white border border-indigo-100 px-3 py-1 rounded-xl shadow-sm w-fit leading-none">

                                {userStoryNum}

                             </span>

                             <button 

                                onClick={(e) => handleDownloadUserStoryScenarios(userStoryNum, items, 'Newly_Generated', e)}

                                className="flex items-center gap-1.5 bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-600 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer"

                                title={`Download scenarios for ${userStoryNum}`}

                             >

                                <Download size={12} /> Download

                             </button>

                          </div>
                        </div>
                        {usSummary && (
                          <div className="flex flex-col pt-3 border-t border-indigo-100/30">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1">User Story Summary</span>
                            <p className="text-sm font-bold text-slate-700 leading-normal">
                              {usSummary}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {items.map((ns, index) => {
                        const isInput = ns.scenarioId === 'INPUT_SOURCE';
                        return (
                          <div key={ns.id || index} className={`border rounded-3xl p-6 shadow-sm flex flex-col justify-between hover:border-indigo-400 transition-all group ${isInput ? 'bg-amber-50/20 border-amber-200/60 hover:border-amber-400' : 'bg-white border-slate-200/80'}`}>
                            <div className="space-y-4">
                              <div className="flex items-start justify-between gap-3">
                                {isInput ? (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-[9px] font-black uppercase tracking-wider">
                                    <Sparkles size={11} className="text-amber-600 animate-pulse" /> ORIGINAL INPUT
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-black text-indigo-600 font-mono tracking-wider bg-indigo-50 px-2 py-0.5 rounded">
                                    {ns.scenarioId}
                                  </span>
                                )}
                                <div className="flex items-center gap-1.5">
                                  {ns.priority && (
                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                                      ns.priority === 'High' ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                      ns.priority === 'Medium' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                      'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                    }`}>
                                      {ns.priority}
                                    </span>
                                  )}
                                  <span className="bg-slate-50 text-slate-500 border border-slate-100 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest">
                                    {isInput ? 'INPUT' : ns.type}
                                  </span>
                                </div>
                              </div>

                              <div>
                                <h4 className={`font-black text-sm uppercase tracking-tight transition-colors line-clamp-2 ${isInput ? 'text-amber-900 group-hover:text-amber-700' : 'text-slate-800 group-hover:text-indigo-600'}`}>
                                  {ns.title}
                                </h4>
                                {isInput ? (
                                  <div className="mt-2 text-xs text-amber-950 font-mono bg-amber-50/70 p-3.5 rounded-2xl border border-amber-200/80 whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar leading-relaxed shadow-inner">
                                    {maskPasswordText(ns.description, ns.password || password)}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-500 mt-2 leading-relaxed font-medium line-clamp-3">
                                    {maskPasswordText(ns.description, ns.password || password)}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                              <div>
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Expected Results</span>
                                <p className="text-xs font-semibold text-slate-700 leading-normal line-clamp-2">
                                  {maskPasswordText(ns.expectedResults, ns.password || password)}
                                </p>
                              </div>

                              {ns.tags && ns.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {ns.tags.map(t => (
                                    <span key={t} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-bold">
                                      #{t}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {isInput && ns.attachments && ns.attachments.length > 0 && (
                                <ScreenshotGallery images={ns.attachments} title="Attached Screenshots" compact />
                              )}

                              {!isInput && (
                                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${
                                      ns.isApproved 
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                                    }`}>
                                      {ns.isApproved ? 'Approved' : 'Unapproved'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {!ns.isApproved && (
                                      <button
                                        type="button"
                                        onClick={() => handleApproveScenario(ns.id)}
                                        className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg transition-all"
                                        title="Approve scenario"
                                      >
                                        <CheckCircle2 size={13} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => handleOpenEdit(ns, e)}
                                      className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg transition-all"
                                      title="Edit scenario"
                                    >
                                      <Pencil size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeleteTargetId(ns.id)}
                                      className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-all"
                                      title="Delete scenario"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Source Input Details & Document Section under Generated Scenarios */}
          {lastInputDetails && (
            <div className="mt-10 bg-amber-50/50 border border-amber-200/80 rounded-[2.5rem] p-8 shadow-sm animate-in fade-in slide-in-from-bottom-2">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-6 border-b border-amber-200/60">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-500 text-white rounded-2xl shadow-sm">
                    <FileText size={22} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-amber-950 uppercase tracking-wide flex items-center gap-2">
                      Source Input Details & Requirements Document
                      <span className="px-2.5 py-0.5 text-[9px] font-black bg-amber-200 text-amber-900 rounded-md uppercase tracking-wider">
                        {lastInputDetails.activeTab === 'doc' ? `Requirements Doc (${lastInputDetails.docFileName || 'Attached File'})` :
                         lastInputDetails.activeTab === 'url' ? 'Website URL Analysis' : 'Feature Description'}
                      </span>
                    </h4>
                    <p className="text-xs font-medium text-amber-800/80 mt-0.5">
                      Original requirements document & context used for synthesizing scenarios (Generated at {lastInputDetails.timestamp})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {(lastInputDetails.docContent || lastInputDetails.description || lastInputDetails.analysisUrl) && (
                    <button
                      type="button"
                      onClick={() => {
                        const contentToCopy = lastInputDetails.docContent || lastInputDetails.description || lastInputDetails.analysisUrl || '';
                        navigator.clipboard.writeText(contentToCopy);
                        toast.success("Source document copied to clipboard!");
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-amber-100 border border-amber-200 text-amber-900 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
                    >
                      <Copy size={13} /> Copy Document Text
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {lastInputDetails.docFileName && (
                  <div className="inline-flex items-center gap-2 text-xs font-black text-indigo-950 bg-white px-4 py-2 rounded-xl border border-indigo-100 shadow-sm">
                    <Paperclip size={14} className="text-indigo-600" /> Document File: <span className="font-mono text-indigo-700">{lastInputDetails.docFileName}</span>
                  </div>
                )}

                {(lastInputDetails.docContent || lastInputDetails.description || lastInputDetails.analysisUrl) && (
                  <div>
                    <span className="text-[10px] font-black text-amber-900 uppercase tracking-widest block mb-2 flex items-center gap-1.5">
                      <FileText size={12} className="text-amber-700" />
                      Document Content / Input Context
                    </span>
                    <div className="bg-white rounded-2xl border border-amber-200/80 p-5 max-h-72 overflow-y-auto font-sans text-xs text-slate-800 whitespace-pre-wrap leading-relaxed shadow-inner">
                      {sanitizeAndExtractDocContent(lastInputDetails.docContent || lastInputDetails.description || lastInputDetails.analysisUrl || '', lastInputDetails.docFileName || '')}
                    </div>
                  </div>
                )}

                {lastInputDetails.screenshots && lastInputDetails.screenshots.length > 0 && (
                  <div className="pt-2">
                    <span className="text-[10px] font-black text-amber-900 uppercase tracking-widest block mb-2">
                      Attached Visual Screenshots ({lastInputDetails.screenshots.length})
                    </span>
                    <ScreenshotGallery
                      images={lastInputDetails.screenshots.map(s => s.previewUrl || (s.data?.startsWith('data:') || s.data?.startsWith('http') ? s.data : `data:${s.mimeType || 'image/png'};base64,${s.data}`))}
                      title="Attached Screenshots"
                      compact
                    />
                  </div>
                )}

                {lastInputDetails.aiInstructions && (
                  <div className="pt-2">
                    <span className="text-[10px] font-black text-amber-900 uppercase tracking-widest block mb-1">
                      Refining System Constraints
                    </span>
                    <p className="text-xs font-medium text-amber-900/80 italic bg-amber-100/50 p-3 rounded-xl border border-amber-200/50">
                      "{lastInputDetails.aiInstructions}"
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Redesigned Scenario Repository Section */}
      <div className="bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-center gap-10 mb-12">
          <div>
            <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tight">Scenario Repository</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-3">Organize and manage generated test suites</p>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="relative group w-80">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                <input 
                  type="text" 
                  placeholder="Search repository..." 
                  value={searchQuery || ''}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-[1.2rem] text-sm font-bold focus:bg-white focus:ring-4 ring-indigo-50/10 outline-none transition-all shadow-inner"
                />
             </div>
             
             <button onClick={() => setIsCreatingFolder(true)} className="flex items-center gap-2 bg-[#F0F4FF] text-[#4F46E5] px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-indigo-50 hover:bg-indigo-100 transition-all shadow-sm">
                <FolderPlus size={18} /> ADD FOLDER
             </button>
             
             <button onClick={handleDownloadTemplate} className="flex items-center gap-2 bg-white text-slate-600 px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all shadow-sm">
                <FileSpreadsheet size={18} /> TEMPLATE
             </button>

             <button onClick={handleDownloadRepository} className="flex items-center gap-2 bg-[#ECFDF5] text-[#059669] px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-emerald-50 hover:bg-emerald-100 transition-all shadow-sm">
                <Download size={18} /> EXPORT
             </button>

             <button onClick={() => uploadInputRef.current?.click()} className="flex items-center gap-2 bg-white text-slate-600 px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all shadow-sm">
                <Upload size={18} /> UPLOAD
                <input type="file" ref={uploadInputRef} className="hidden" accept=".xlsx,.csv" onChange={handleUploadScenarios} />
             </button>
          </div>
        </div>

        {/* Total Scenarios = Approved + Unapproved Summary Widget Banner */}
        <div className="mb-8 p-6 bg-gradient-to-r from-slate-50 via-indigo-50/40 to-emerald-50/30 border border-slate-200/90 rounded-[2rem] flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-indigo-600 text-white rounded-2xl shadow-md flex items-center justify-center shrink-0">
              <Layers size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">
                  Total Scenarios Breakdown
                </h3>
                <span className="px-3 py-1 bg-indigo-600 text-white rounded-xl text-xs font-black font-mono shadow-xs">
                  {totalScenariosCount} Total
                </span>
              </div>
              <p className="text-xs font-bold text-slate-500 mt-1">
                Total Scenarios count equals the sum of all Approved and Unapproved scenarios.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap bg-white/95 backdrop-blur-xs px-5 py-3 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Total Scenarios ({totalScenariosCount})</span>
              <span className="text-slate-400 font-black text-sm">=</span>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-black shadow-2xs">
              <CheckCircle2 size={14} className="text-emerald-600" /> {totalApprovedScenariosCount} Approved
            </span>
            <span className="text-slate-400 font-black text-sm">+</span>
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-xs font-black shadow-2xs">
              <AlertTriangle size={14} className="text-amber-600" /> {totalUnapprovedScenariosCount} Unapproved
            </span>
          </div>
        </div>

        {/* Custom Tabs */}
        <div className="flex gap-10 border-b border-slate-100 mb-8 px-4">
          <button onClick={() => setActiveView('scenarios')} className={`pb-5 flex items-center gap-3 text-[14px] font-black uppercase tracking-widest relative transition-all ${activeView === 'scenarios' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
             <div className="flex items-center gap-2">
                <LayoutGrid size={16} />
                INDIVIDUAL SCENARIOS
             </div>
             <span className="bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-lg text-[10px] font-black">{individualCount}</span>
             {activeView === 'scenarios' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full shadow-lg" />}
          </button>
          <button onClick={() => setActiveView('folders')} className={`pb-5 flex items-center gap-3 text-[14px] font-black uppercase tracking-widest relative transition-all ${activeView === 'folders' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
             <div className="flex items-center gap-2">
                <Folder size={16} />
                FOLDERS
             </div>
             <span className="bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-lg text-[10px] font-black">{folderCount}</span>
             {activeView === 'folders' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full shadow-lg" />}
          </button>
        </div>

        <div className="mb-8 p-6 bg-[#F8FAFF] border border-[#E5EFFF] rounded-[1.5rem] flex items-start gap-4">
           <div className="p-2 bg-[#4F46E5] text-white rounded-lg shadow-md">
              <Info size={18} />
           </div>
           <div>
              <p className="text-sm font-bold text-[#1E293B]">Approved Scenarios will move to <span className="text-[#4F46E5]">AI Test Cases</span> page.</p>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">BEFORE THAT, USER CAN SAVE SCENARIOS IN FOLDERS IF REQUIRED.</p>
           </div>
        </div>

        {paginatedItems.length > 0 && activeView === 'scenarios' && (
          <div className="px-6 mb-6 flex items-center justify-between flex-wrap gap-4">
             <button 
                onClick={handleToggleAllVisible}
                className="flex items-center gap-3 text-[14px] font-black text-slate-400 uppercase tracking-[0.2em] transition-all hover:text-slate-600"
             >
                <div className={isAllVisibleSelected ? 'text-indigo-600' : 'text-slate-300'}>
                    {isAllVisibleSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                </div>
                SELECT ALL ON PAGE
             </button>
             
             {selectedScenarioIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 animate-in slide-in-from-right-4">
                   <button 
                     onClick={handleBulkApprove} 
                     className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-emerald-700 active:scale-95 transition-all"
                     title="Move to folder and approve all selected scenarios"
                   >
                      <CheckCircle2 size={14} /> BULK APPROVE SELECTED ({selectedScenarioIds.size})
                   </button>
                   <button 
                     onClick={handleBulkMoveToFolder} 
                     className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-indigo-700 active:scale-95 transition-all"
                     title="Move selected scenarios to a folder without approving"
                   >
                      <FolderPlus size={14} /> MOVE TO FOLDER ({selectedScenarioIds.size})
                   </button>
                   <button 
                     onClick={() => setShowBulkDeleteConfirm(true)} 
                     className="flex items-center gap-2 bg-rose-600 text-white px-5 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-rose-700 active:scale-95 transition-all"
                   >
                      <Trash2 size={14} /> BULK DELETE ({selectedScenarioIds.size})
                   </button>
                </div>
             )}
          </div>
        )}

        <div className="space-y-4 mb-8">
          {paginatedItems.length === 0 ? (
            <div className="py-32 text-center bg-white border-2 border-dashed border-slate-200 rounded-[3rem] opacity-30">
               <Layers size={64} className="mx-auto mb-6 text-slate-200" />
               <p className="text-sm font-black uppercase tracking-widest text-slate-500">Repository Empty</p>
            </div>
          ) : activeView === 'scenarios' ? (() => {
             // Group individual scenarios by userStoryNumber for the scenarios view
             const groups: { [key: string]: typeof paginatedItems } = {};
             paginatedItems.forEach(s => {
                const key = s.userStoryNumber || 'No User Story';
                if (!groups[key]) groups[key] = [];
                groups[key].push(s);
             });

             // Sort keys so that 'No User Story' comes last if multiple exist
             const sortedGroupEntries = Object.entries(groups).sort(([keyA], [keyB]) => {
                if (keyA === 'No User Story') return 1;
                if (keyB === 'No User Story') return -1;
                return keyA.localeCompare(keyB);
             });

             return (
                <div className="space-y-10 w-full">
                   {sortedGroupEntries.map(([userStoryNum, items]) => {
                      const hasUS = userStoryNum !== 'No User Story';
                      const usSummary = items[0]?.userStorySummary;
                      return (
                         <div key={userStoryNum} className="space-y-4">
                            {hasUS && (
                               <div className="bg-indigo-50/45 border border-indigo-100/60 rounded-[2rem] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left mb-2 animate-in fade-in duration-200 shadow-sm">
                                  <div className="flex flex-col">
                                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1">User Story ID / Number</span>
                                     <div className="flex items-center gap-2.5">

                                        <span className="inline-block text-xs font-mono font-black text-indigo-600 bg-white border border-indigo-100 px-3 py-1 rounded-xl shadow-sm w-fit leading-none">

                                           {userStoryNum}

                                        </span>

                                        <button 

                                           onClick={(e) => handleDownloadUserStoryScenarios(userStoryNum, items, 'Repository_Individual', e)}

                                           className="flex items-center gap-1.5 bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-600 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer"

                                           title={`Download scenarios for ${userStoryNum}`}

                                        >

                                           <Download size={12} /> Download

                                        </button>

                                     </div>
                                  </div>
                                  {usSummary && (
                                     <div className="flex-1 sm:border-l sm:border-indigo-100 sm:pl-5 flex flex-col">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1">User Story Summary</span>
                                        <p className="text-sm font-bold text-slate-700 leading-normal">
                                           {usSummary}
                                        </p>
                                     </div>
                                  )}
                               </div>
                            )}
                            <div className="space-y-4">
                               {items.map(s => {
                                  const isFolderItem = false;
                                  return (
                                     <div key={s.id} className={`bg-white border rounded-[1.8rem] overflow-hidden group transition-all shadow-sm ${selectedScenarioIds.has(s.id) ? 'border-indigo-500 ring-2 ring-indigo-50' : 'border-slate-100 hover:border-indigo-400'}`}>
                                        <div className="flex items-center justify-between p-6">
                                           <div className="flex items-center gap-6 flex-1 min-w-0">
                                              <button 
                                                onClick={() => {
                                                  const next = new Set(selectedScenarioIds);
                                                  if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                                                  setSelectedScenarioIds(next);
                                                }}
                                                className={`transition-all ${selectedScenarioIds.has(s.id) ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`}
                                              >
                                                 {selectedScenarioIds.has(s.id) ? <CheckSquare size={20} /> : <Square size={20} />}
                                              </button>
                                              
                                              <button onClick={() => toggleExpand(s.id)} className={`p-2 transition-all rounded-xl ${expandedItems.has(s.id) ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                                                {expandedItems.has(s.id) ? <ChevronUp size={22}/> : <ChevronDown size={22}/>}
                                              </button>

                                              <div className={`p-3.5 border rounded-2xl shadow-sm bg-[#F8FAFF] border-[#E5EFFF] text-indigo-500`}>
                                                 <FileText size={20}/>
                                              </div>

                                              <div className="min-w-0 flex-1 group/title-wrap">
                                                 <h4 className={`font-black text-black uppercase tracking-tight cursor-pointer ${expandedItems.has(s.id) ? 'break-words whitespace-normal leading-relaxed' : 'line-clamp-2 whitespace-normal'}`} title={s.title}>{s.title}</h4>
                                                 <div className="flex items-center gap-3 mt-1">
                                                    <span className="text-[10px] text-[#4F46E5] font-black uppercase tracking-widest">{s.scenarioId || s.moduleName}</span>
                                                    {(s.userStoryNumber || s.userStoryId) && (
                                                       <span className="px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80 flex items-center gap-1">
                                                          <span className="text-slate-400 font-medium">JIRA:</span> {s.userStoryNumber || s.userStoryId}
                                                       </span>
                                                     )}
                                                    <span className={`px-2.5 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest border ${!s.type?.toLowerCase().includes('non-functional') ? 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]' : 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]'}`}>
                                                       {s.type}
                                                    </span>
                                                 </div>
                                              </div>
                                           </div>

                                           <div className="flex items-center gap-4 flex-shrink-0">
                                              <button 
                                                onClick={(e) => handleApproveScenario(s.id, e)} 
                                                disabled={s.isApproved}
                                                className={`flex items-center gap-2 px-6 py-2.5 rounded-[1rem] font-black text-[10px] uppercase tracking-widest transition-all shadow-lg active:scale-95 border ${
                                                  s.isApproved 
                                                    ? 'bg-[#059669] text-white border-emerald-700 cursor-default' 
                                                    : 'bg-white text-[#059669] border-emerald-200 hover:bg-emerald-50/50 hover:border-emerald-300'
                                                }`}
                                              >
                                                 {s.isApproved ? (
                                                   <>
                                                      <CheckCircle2 size={16} /> APPROVED
                                                   </>
                                                 ) : (
                                                   <>
                                                      <Check size={16} strokeWidth={3} /> APPROVE
                                                   </>
                                                 )}
                                              </button>
                                              
                                              <button onClick={(e) => handleOpenEdit(s, e)} className="p-2.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all">
                                                <Pencil size={18} />
                                               </button>

                                               <button 
                                                 onClick={(e) => {
                                                   e.stopPropagation();
                                                   e.preventDefault();
                                                   setScenariosToMoveWithoutApprove([s]);
                                                   setSelectedFolderIdForSave(s.folderId || '');
                                                   setShowCreateFolderInline(false);
                                                   setInlineNewFolderName('');
                                                   setInlineFolderError(null);
                                                 }} 
                                                 className="flex items-center gap-1.5 px-4 py-2.5 rounded-[1rem] font-black text-[10px] uppercase tracking-widest bg-indigo-50/70 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 transition-all shadow-sm active:scale-95"
                                                 title="Move scenario to folder without approving"
                                               >
                                                 <FolderPlus size={15} /> MOVE TO FOLDER
                                              </button>

                                              <button onClick={() => setDeleteTargetId(s.id)} className="p-2.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all">
                                                <Trash2 size={18} />
                                              </button>
                                           </div>
                                        </div>
                                        
                                        {expandedItems.has(s.id) && (
                                          <div className="p-10 bg-[#F9FBFF] border-t border-slate-50 space-y-8 animate-in slide-in-from-top-2">
                                             <div className="space-y-6 w-full animate-in fade-in duration-200">
                                                {s.attachments && s.attachments.length > 0 && (
                                                   <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm mb-6">
                                                      <ScreenshotGallery images={s.attachments} title="Attached Screenshots" />
                                                   </div>
                                                )}
                                                {(s.userStoryNumber || s.userStorySummary) && (
                                                   <div className="grid grid-cols-1 md:grid-cols-2 gap-10 pb-6 border-b border-slate-100/80">
                                                      {s.userStoryNumber && (
                                                         <div>
                                                            <label className="text-[9px] font-black text-[#4F46E5] uppercase tracking-widest mb-2 block">User Story Number</label>
                                                            <span className="inline-block text-xs font-mono font-black text-[#4F46E5] bg-white border border-indigo-100 px-3 py-1 rounded-xl shadow-sm leading-none">
                                                               {s.userStoryNumber}
                                                            </span>
                                                         </div>
                                                      )}
                                                      {s.userStorySummary && (
                                                         <div>
                                                            <label className="text-[9px] font-black text-[#4F46E5] uppercase tracking-widest mb-2 block">User Story Summary</label>
                                                            <p className="text-sm font-bold text-slate-700 leading-normal bg-white p-4 rounded-2xl border border-indigo-100/30 shadow-inner">
                                                               {s.userStorySummary}
                                                            </p>
                                                         </div>
                                                      )}
                                                   </div>
                                                )}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                   <div>
                                                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Scenario Description</label>
                                                      <p className="text-sm text-slate-600 font-medium leading-relaxed bg-white p-6 rounded-3xl border border-slate-100 shadow-inner break-words whitespace-pre-wrap">{maskPasswordText((s.description || '').replace(/\\n/g, '\n'), s.password || password)}</p>
                                                   </div>
                                                   <div>
                                                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Expected Result</label>
                                                      <p className="text-sm text-indigo-900 font-bold leading-relaxed bg-white p-6 rounded-3xl border border-indigo-100/50 shadow-inner break-words whitespace-pre-wrap">{maskPasswordText((s.expectedResults || '').replace(/\\n/g, '\n'), s.password || password)}</p>
                                                   </div>
                                                </div>
                                             </div>
                                          </div>
                                        )}
                                     </div>
                                  );
                               })}
                            </div>
                         </div>
                      );
                   })}
                </div>
             );
          })() : (
            paginatedItems.map(s => {
               const isFolderItem = s.scenarioId === 'SCENARIO_FOLDER';
               const folderMembersList = scenarios.filter(mem => (mem.folderId === s.id || (s.memberScenarioIds || []).includes(mem.id)) && !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(mem.scenarioId));
               const memberCount = folderMembersList.length;
               
               return (
                 <div key={s.id} className="bg-white border rounded-[1.8rem] overflow-hidden group transition-all shadow-sm border-slate-100 hover:border-indigo-400">
                   <div className="flex items-center justify-between p-6">
                      <div className="flex items-center gap-6 flex-1 min-w-0">
                         <button onClick={() => toggleExpand(s.id)} className={`p-2 transition-all rounded-xl ${expandedItems.has(s.id) ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                           {expandedItems.has(s.id) ? <ChevronUp size={22}/> : <ChevronDown size={22}/>}
                         </button>

                         <div className="p-3.5 border rounded-2xl shadow-sm bg-[#FFFBEB] border-[#FEF3C7] text-[#D97706]">
                            <Folder size={20}/>
                         </div>

                         <div className="min-w-0 flex-1 group/title-wrap">
                            <h4 className={`font-black text-black uppercase tracking-tight cursor-pointer ${expandedItems.has(s.id) ? 'break-words whitespace-normal leading-relaxed' : 'line-clamp-2 whitespace-normal'}`} title={s.title}>{s.title}</h4>
                            <div className="flex items-center gap-3 mt-1">
                               <span className="text-[10px] text-[#4F46E5] font-black uppercase tracking-widest">AI SCENARIOS</span>
                               <span className="px-2.5 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest border bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]">
                                  FUNCTIONAL
                               </span>
                            </div>
                         </div>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0">
                         <button onClick={(e) => handleOpenEdit(s, e)} className="flex items-center gap-2 bg-[#4F46E5] text-white px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#4338CA] transition-all shadow-lg active:scale-95">
                            <Pencil size={16} /> EDIT FOLDER
                         </button>
                         <button onClick={() => setDeleteTargetId(s.id)} className="p-2.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all">
                           <Trash2 size={18} />
                         </button>
                      </div>
                   </div>
                   
                   {expandedItems.has(s.id) && (
                     <div className="p-10 bg-[#F9FBFF] border-t border-slate-50 space-y-8 animate-in slide-in-from-top-2">
                        {(() => {
                           const folderMembers = scenarios.filter(mem => (mem.folderId === s.id || (s.memberScenarioIds || []).includes(mem.id)) && !['SCENARIO_FOLDER', 'TESTCASE_FOLDER', 'MANUAL_FOLDER', 'INPUT_SOURCE'].includes(mem.scenarioId));
                           const pendingFolderMembers = folderMembers.filter(mem => !mem.isApproved && mem.scenarioId !== 'INPUT_SOURCE');
                           const hasPendingMembers = pendingFolderMembers.length > 0;
                           const isAllFolderSelected = hasPendingMembers && pendingFolderMembers.every(mem => selectedScenarioIds.has(mem.id));
                           const selectedFolderMembersCount = folderMembers.filter(mem => selectedScenarioIds.has(mem.id) && !mem.isApproved && mem.scenarioId !== 'INPUT_SOURCE').length;

                           return (
                             <div className="space-y-6">
                             <div className="flex items-center justify-between border-b border-slate-100 pb-4 flex-wrap gap-4">
                                <div className="flex items-center gap-4 flex-wrap">
                                   <div className="flex items-center gap-3">
                                      <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Layers size={18} /></div>
                                      <h5 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">Total Scenarios ({memberCount})</h5>
                                   </div>
                                   
                                   {/* Select All Button */}
                                   {hasPendingMembers && (
                                      <button 
                                         onClick={() => {
                                            const next = new Set(selectedScenarioIds);
                                            if (isAllFolderSelected) {
                                               pendingFolderMembers.forEach(mem => next.delete(mem.id));
                                            } else {
                                               pendingFolderMembers.forEach(mem => next.add(mem.id));
                                            }
                                            setSelectedScenarioIds(next);
                                         }}
                                         className="flex items-center gap-2 text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:bg-indigo-50 px-3.5 py-1.5 rounded-xl border border-indigo-100 transition-all cursor-pointer animate-in fade-in duration-200"
                                      >
                                         <div className={isAllFolderSelected ? 'text-indigo-600' : 'text-slate-400'}>
                                            {isAllFolderSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                                         </div>
                                         {isAllFolderSelected ? 'Deselect All' : 'Select All'}
                                      </button>
                                   )}

                                   {/* Bulk Approve Folder Button */}
                                   {selectedFolderMembersCount > 0 && (
                                      <button 
                                         onClick={async () => {
                                            const selectedIdsInFolder = folderMembers.filter(mem => selectedScenarioIds.has(mem.id) && !mem.isApproved && mem.scenarioId !== 'INPUT_SOURCE').map(mem => mem.id);
                                            if (selectedIdsInFolder.length === 0) return;
                                            
                                            const updatedScenarios = scenarios.map(sc => 
                                               selectedIdsInFolder.includes(sc.id) ? { ...sc, isApproved: true } : sc
                                            );
                                            onUpdateProject({ ...project, scenarios: updatedScenarios });
                                            
                                            // Deselect them from state
                                            const next = new Set(selectedScenarioIds);
                                            selectedIdsInFolder.forEach(id => next.delete(id));
                                            setSelectedScenarioIds(next);
                                            
                                            await logActivity(user.email, user.name, `Bulk approved ${selectedIdsInFolder.length} scenarios in folder ${s.title}`, project.id, project.name);
                                            toast.success(`Approved ${selectedIdsInFolder.length} scenarios successfully!`);
                                         }}
                                         className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md hover:bg-emerald-700 active:scale-95 transition-all cursor-pointer animate-in fade-in duration-200"
                                      >
                                         <CheckCircle2 size={14} /> Bulk Approve ({selectedFolderMembersCount})
                                      </button>
                                   )}
                                </div>
                                <button 
                                  onClick={(e) => handleOpenManageItems(s, e)}
                                  className="flex items-center gap-2 text-[#4F46E5] font-black text-[10px] uppercase tracking-widest hover:bg-indigo-50 px-4 py-2 rounded-xl transition-all"
                                >
                                   <Plus size={16} /> Add Scenarios
                                </button>
                             </div>
                             {memberCount === 0 ? (
                                <div className="py-12 text-center text-slate-400 italic text-sm border-2 border-dashed border-slate-100 rounded-3xl">
                                   This folder is currently empty. Click 'Add Scenarios' to add scenarios.
                                </div>
                             ) : (() => {
                                // Group folder members by userStoryNumber
                                const groups: { [key: string]: typeof folderMembers } = {};
                                folderMembers.forEach(mem => {
                                   const key = mem.userStoryNumber || 'No User Story';
                                   if (!groups[key]) groups[key] = [];
                                   groups[key].push(mem);
                                });

                                // Sort keys so that 'No User Story' comes last if multiple exist
                                const sortedGroupEntries = Object.entries(groups).sort(([keyA], [keyB]) => {
                                   if (keyA === 'No User Story') return 1;
                                   if (keyB === 'No User Story') return -1;
                                   return keyA.localeCompare(keyB);
                                });

                                return (
                                   <div className="space-y-10 w-full">
                                      {sortedGroupEntries.map(([userStoryNum, members]) => {
                                         const hasUS = userStoryNum !== 'No User Story';
                                         const usSummary = members[0]?.userStorySummary;
                                         return (
                                            <div key={userStoryNum} className="space-y-4">
                                               {hasUS && (
                                                  <div className="bg-indigo-50/45 border border-indigo-100/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left mb-2 animate-in fade-in duration-200 shadow-sm">
                                                     <div className="flex flex-col">
                                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">User Story ID / Number</span>
                                                        <div className="flex items-center gap-2.5">

                                                           <span className="inline-block text-xs font-mono font-black text-indigo-600 bg-white border border-indigo-100 px-3 py-1 rounded-xl shadow-sm w-fit leading-none">

                                                              {userStoryNum}

                                                           </span>

                                                           <button 

                                                              onClick={(e) => handleDownloadUserStoryScenarios(userStoryNum, members, s.title, e)}

                                                              className="flex items-center gap-1.5 bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-600 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer"

                                                              title={`Download scenarios for ${userStoryNum}`}

                                                           >

                                                              <Download size={12} /> Download

                                                           </button>

                                                        </div>
                                                     </div>
                                                     {usSummary && (
                                                        <div className="flex-1 sm:border-l sm:border-indigo-100 sm:pl-5 flex flex-col">
                                                           <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">User Story Summary</span>
                                                           <p className="text-xs font-bold text-slate-700 leading-normal">
                                                              {usSummary}
                                                           </p>
                                                        </div>
                                                     )}
                                                  </div>
                                               )}
                                               <div className="flex flex-col gap-4 w-full">
                                                  {members.map(mem => {
                                                     const isInput = mem.scenarioId === 'INPUT_SOURCE';
                                                     const isSelected = selectedScenarioIds.has(mem.id);
                                                     const isExpanded = expandedItems.has(mem.id);
                                                     return (
                                                        <div 
                                                          key={mem.id} 
                                                          className={`w-full p-5 sm:p-6 rounded-2xl flex flex-col gap-3.5 group/mem shadow-sm transition-all border ${
                                                            isInput 
                                                              ? 'bg-amber-50/40 border-amber-200 hover:border-amber-300' 
                                                              : isSelected 
                                                                ? 'bg-white border-indigo-500 ring-2 ring-indigo-100 shadow-md' 
                                                                : 'bg-white border-slate-200/90 hover:border-indigo-300 hover:shadow-md'
                                                          }`}
                                                        >
                                                           {/* Top Row: Checkbox / ID on the Left, Action Buttons in a Single Row on the Right */}
                                                           <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 w-full pb-2.5 border-b border-slate-100/90">
                                                              <div className="flex items-center gap-2.5 min-w-0">
                                                                 {!isInput && (
                                                                    <div className="flex-shrink-0">
                                                                       {!mem.isApproved ? (
                                                                          <button 
                                                                            onClick={() => {
                                                                              const next = new Set(selectedScenarioIds);
                                                                              if (next.has(mem.id)) next.delete(mem.id); else next.add(mem.id);
                                                                              setSelectedScenarioIds(next);
                                                                            }}
                                                                            className={`transition-all cursor-pointer ${selectedScenarioIds.has(mem.id) ? 'text-indigo-600' : 'text-slate-300 hover:text-slate-500'}`}
                                                                            title="Select scenario"
                                                                          >
                                                                             {selectedScenarioIds.has(mem.id) ? <CheckSquare size={19} /> : <Square size={19} />}
                                                                          </button>
                                                                       ) : (
                                                                          <div className="text-emerald-600 flex items-center justify-center" title="Approved">
                                                                             <CheckCircle2 size={19} className="stroke-[2.5]" />
                                                                          </div>
                                                                       )}
                                                                    </div>
                                                                 )}

                                                                 {/* Scenario ID Tag */}
                                                                 {!isInput ? (
                                                                    <span className="text-xs font-black text-indigo-700 font-mono tracking-wider bg-indigo-50/90 px-2.5 py-1 rounded-lg border border-indigo-200/80 shadow-xs">
                                                                       {mem.scenarioId && mem.scenarioId !== 'AUTO' ? mem.scenarioId : `TS-${(mem.id ? mem.id.slice(0, 4) : '001').toUpperCase()}`}
                                                                    </span>
                                                                 ) : (
                                                                    <span className="text-xs font-black text-amber-800 font-mono tracking-wider bg-amber-100/80 px-2.5 py-1 rounded-lg border border-amber-300/80 shadow-xs flex items-center gap-1.5">
                                                                       <Sparkles size={13} className="animate-pulse text-amber-600" /> INPUT SOURCE
                                                                    </span>
                                                                 )}

                                                                 {(mem.userStoryNumber || mem.userStoryId) && (
                                                                    <span className="px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">
                                                                       <span className="text-slate-400 font-medium">JIRA:</span> {mem.userStoryNumber || mem.userStoryId}
                                                                    </span>
                                                                 )}
                                                              </div>

                                                              {/* Action Buttons Top Right in a Single Row */}
                                                              <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-auto sm:ml-0">
                                                                 {!isInput && (
                                                                    <button 
                                                                      onClick={(e) => handleApproveScenario(mem.id, e)} 
                                                                      disabled={mem.isApproved}
                                                                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all shadow-xs active:scale-95 border ${
                                                                        mem.isApproved
                                                                          ? 'bg-emerald-600 text-white border-emerald-700 cursor-default'
                                                                          : 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300'
                                                                      }`}
                                                                      title={mem.isApproved ? "Approved" : "Approve scenario"}
                                                                    >
                                                                       <Check size={13} strokeWidth={3} /> {mem.isApproved ? 'Approved' : 'Approve'}
                                                                    </button>
                                                                 )}
                                                                 <button 
                                                                   onClick={(e) => handleOpenEdit(mem, e)} 
                                                                   className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-wider bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 transition-all shadow-xs active:scale-95" 
                                                                   title="Edit scenario"
                                                                 >
                                                                    <Pencil size={12} strokeWidth={2.5} /> Edit
                                                                 </button>
                                                                 {!isInput && (
                                                                    <button 
                                                                      onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        e.preventDefault();
                                                                        setScenariosToMoveWithoutApprove([mem]);
                                                                        setSelectedFolderIdForSave(mem.folderId || '');
                                                                        setShowCreateFolderInline(false);
                                                                        setInlineNewFolderName('');
                                                                        setInlineFolderError(null);
                                                                      }} 
                                                                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-wider bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-all shadow-xs active:scale-95"
                                                                      title="Move scenario to another folder"
                                                                    >
                                                                       <FolderPlus size={13} /> Move
                                                                    </button>
                                                                 )}
                                                                 <button 
                                                                   onClick={(e) => { e.stopPropagation(); setDeleteTargetId(mem.id); }} 
                                                                   className="p-1.5 bg-slate-50 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all border border-slate-200 shadow-xs active:scale-95" 
                                                                   title="Delete scenario"
                                                                 >
                                                                    <MinusCircle size={15} />
                                                                 </button>
                                                                 <button 
                                                                   onClick={(e) => { e.stopPropagation(); toggleExpand(mem.id); }} 
                                                                   className={`p-1.5 transition-all rounded-xl border shadow-xs ${isExpanded ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-slate-50 text-slate-400 hover:text-slate-700 border-slate-200'}`}
                                                                   title={isExpanded ? "Collapse Details" : "Expand Details"}
                                                                 >
                                                                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                                                 </button>
                                                              </div>
                                                           </div>

                                                           {/* Main Content: Scenario Title (Full Width) */}
                                                           <div className="w-full text-left">
                                                              <h4 
                                                                onClick={() => toggleExpand(mem.id)}
                                                                className="text-sm sm:text-base font-bold text-slate-900 leading-snug cursor-pointer hover:text-indigo-600 transition-colors"
                                                                title={mem.title}
                                                              >
                                                                 {mem.title}
                                                              </h4>
                                                           </div>

                                                           {/* Main Content: Description (Full Width, clear and readable) */}
                                                           {mem.description && (
                                                              <div className="w-full text-left">
                                                                 <p className="text-xs sm:text-sm text-slate-600 font-normal leading-relaxed break-words">
                                                                    <span className="font-semibold text-slate-700">Description: </span>
                                                                    {maskPasswordText(mem.description, mem.password || password)}
                                                                 </p>
                                                              </div>
                                                           )}

                                                           {/* Bottom Row / Metadata Bar: Module | Type | Status | Folder */}
                                                           <div className="flex flex-wrap items-center gap-y-2 gap-x-4 pt-2.5 border-t border-slate-100 text-[11px] font-medium text-slate-600">
                                                              <div className="flex items-center gap-1.5">
                                                                 <span className="font-bold text-slate-400 uppercase text-[10px] tracking-wider">Module:</span>
                                                                 <span className="font-semibold text-slate-800">{mem.moduleName || 'General'}</span>
                                                              </div>
                                                              <span className="text-slate-300 hidden sm:inline">|</span>
                                                              <div className="flex items-center gap-1.5">
                                                                 <span className="font-bold text-slate-400 uppercase text-[10px] tracking-wider">Type:</span>
                                                                 <span className="font-semibold text-indigo-700 bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100/80">{mem.type || 'Functional'}</span>
                                                              </div>
                                                              <span className="text-slate-300 hidden sm:inline">|</span>
                                                              <div className="flex items-center gap-1.5">
                                                                 <span className="font-bold text-slate-400 uppercase text-[10px] tracking-wider">Status:</span>
                                                                 <span className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border ${
                                                                    mem.isApproved 
                                                                       ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                                                       : 'bg-amber-50 text-amber-700 border-amber-200'
                                                                 }`}>
                                                                    {mem.isApproved ? 'Approved' : 'Unapproved'}
                                                                 </span>
                                                              </div>
                                                              <span className="text-slate-300 hidden sm:inline">|</span>
                                                              <div className="flex items-center gap-1.5">
                                                                 <span className="font-bold text-slate-400 uppercase text-[10px] tracking-wider">Folder:</span>
                                                                 <span className="font-semibold text-slate-700 flex items-center gap-1">
                                                                    <Folder size={12} className="text-indigo-500" />
                                                                    {s.title || 'Testing'}
                                                                 </span>
                                                              </div>
                                                           </div>

                                                           {/* Expandable Details (Steps, Expected Results, Attachments, User Story) */}
                                                           {isExpanded && (
                                                              <div className="mt-2 pt-4 border-t border-slate-100 flex flex-col gap-4 text-left animate-in slide-in-from-top-2">
                                                                 {isInput && mem.attachments && mem.attachments.length > 0 && (
                                                                    <div className="mb-2">
                                                                       <ScreenshotGallery images={mem.attachments} title="Attached Screenshots" compact />
                                                                    </div>
                                                                 )}
                                                                 {mem.userStorySummary && (
                                                                    <div>
                                                                       <label className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1 block">User Story Summary</label>
                                                                       <p className="text-xs font-bold text-slate-700 leading-normal bg-indigo-50/20 p-4 rounded-2xl border border-indigo-100/30">
                                                                          {mem.userStorySummary}
                                                                       </p>
                                                                    </div>
                                                                 )}
                                                                 <div>
                                                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Expected Result</label>
                                                                    <p className="text-xs text-indigo-900 font-bold leading-relaxed bg-indigo-50/30 p-4 rounded-2xl border border-indigo-100/50 shadow-inner break-words">
                                                                       {maskPasswordText(mem.expectedResults, mem.password || password)}
                                                                    </p>
                                                                 </div>
                                                              </div>
                                                           )}
                                                        </div>
                                                     );
                                                  })}
                                               </div>
                                            </div>
                                         );
                                      })}
                                   </div>
                                );
                             })()}
                             </div>
                           );
                        })()}
                     </div>
                   )}
                 </div>
               );
            })
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex flex-col md:flex-row items-center justify-between bg-white px-8 py-6 rounded-[2rem] border border-slate-200 shadow-sm gap-4">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
               Showing {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, filteredItems.length)} of {filteredItems.length} {activeView === 'folders' ? 'Folders' : 'Scenarios'}
             </p>
             <div className="flex items-center gap-2">
                <button 
                  disabled={currentPage === 1}
                  onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-white hover:border-indigo-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
                  title="Previous Page"
                >
                  <ChevronLeft size={20} />
                </button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }).map((_, i) => {
                    const pageNum = i + 1;
                    if (totalPages > 5) {
                      if (pageNum !== 1 && pageNum !== totalPages && Math.abs(pageNum - currentPage) > 1) {
                        if (pageNum === 2 && currentPage > 3) return <span key="dots-1" className="px-2 text-slate-300">...</span>;
                        if (pageNum === totalPages - 1 && currentPage < totalPages - 2) return <span key="dots-2" className="px-2 text-slate-300">...</span>;
                        if (Math.abs(pageNum - currentPage) > 1) return null;
                      }
                    }
                    return (
                      <button 
                        key={pageNum}
                        onClick={() => { setCurrentPage(pageNum); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className={`w-10 h-10 rounded-xl text-[11px] font-black transition-all border ${currentPage === pageNum ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button 
                  disabled={currentPage === totalPages}
                  onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-white hover:border-indigo-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
                  title="Next Page"
                >
                  <ChevronRight size={20} />
                </button>
             </div>
          </div>
        )}
      </div>

      {/* Manage Folder Items Modal */}
      {managingFolder && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-2xl rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-white">
              <div className="p-10 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-5">
                    <div className="p-4 bg-indigo-600 rounded-[1.5rem] text-white shadow-xl shadow-indigo-100"><Layers size={24} /></div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Add Scenarios</h3>
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-1">FOLDER: {managingFolder.title.toUpperCase()}</p>
                    </div>
                 </div>
                 <button onClick={() => setManagingFolder(null)} className="p-3 text-slate-400 hover:text-slate-600 transition-all"><X size={28} /></button>
              </div>

              {allMangeableScenarios.length > 0 && (
                <div className="px-10 py-4 bg-white border-b border-slate-50 flex items-center justify-between">
                  <button 
                    onClick={handleToggleSelectAllMembers}
                    className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] transition-all hover:text-slate-600 group"
                  >
                    <div className={tempMemberIds.size === allMangeableScenarios.length ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}>
                        {tempMemberIds.size === allMangeableScenarios.length ? <CheckSquare size={20} /> : <Square size={20} />}
                    </div>
                    {tempMemberIds.size === allMangeableScenarios.length ? 'Deselect All Scenarios' : 'Select All Scenarios'}
                  </button>
                  <span className="text-[10px] font-black text-indigo-600 uppercase bg-indigo-50 px-3 py-1 rounded-full">{tempMemberIds.size} Selected</span>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-8 space-y-4 custom-scrollbar bg-slate-50/20">
                 {allMangeableScenarios.length === 0 ? (
                    <div className="py-20 text-center text-slate-400 italic font-medium border-2 border-dashed border-slate-100 rounded-3xl">
                       No scenarios available to add.
                    </div>
                 ) : (
                    allMangeableScenarios.map(scen => (
                       <button 
                         key={scen.id} 
                         onClick={() => toggleTempMember(scen.id)}
                         className={`w-full flex items-center justify-between p-5 rounded-3xl border transition-all text-left ${tempMemberIds.has(scen.id) ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-50' : 'bg-white/60 border-slate-100 hover:border-slate-200'}`}
                       >
                          <div className="flex items-center gap-5 min-w-0">
                             <div className={`p-3 rounded-xl transition-colors ${tempMemberIds.has(scen.id) ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-50'}`}>
                                <FileText size={20} />
                             </div>
                             <div className="min-w-0">
                                <h5 className="text-sm font-black text-slate-800 uppercase tracking-tight break-words line-clamp-2 cursor-pointer" title={scen.title}>{scen.title}</h5>
                                <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5 tracking-widest">{scen.moduleName} • {scen.type}</p>
                             </div>
                          </div>
                          <div className={`transition-all ${tempMemberIds.has(scen.id) ? 'text-indigo-600 scale-110' : 'text-slate-200'}`}>
                             {tempMemberIds.has(scen.id) ? <CheckSquare size={28} /> : <Square size={28} />}
                          </div>
                       </button>
                    ))
                 )}
              </div>

              <div className="p-10 bg-white border-t border-slate-100 flex gap-4">
                 <button onClick={handleSaveFolderMembers} className="flex-1 py-5 bg-indigo-600 text-white rounded-[1.8rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-2xl shadow-indigo-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <CheckCircle2 size={18} /> Update Folder
                 </button>
                 <button onClick={() => setManagingFolder(null)} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-[1.8rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200 active:scale-[0.98]">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {/* Add Folder Modal */}
      {isCreatingFolder && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-md rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-white">
            <div className="p-10">
              <div className="flex items-center gap-5 mb-8">
                <div className="p-4 bg-indigo-600 rounded-[1.5rem] text-white shadow-xl shadow-indigo-100"><FolderPlus size={24} /></div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">New Scenario Folder</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Group your approved AI scenarios</p>
                </div>
              </div>
              <div className="space-y-6">
                <div className="space-y-3">
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 block">Folder Name</label>
                   <input 
                     autoFocus 
                     className={`w-full px-7 py-5 bg-slate-50 border rounded-[1.8rem] text-sm font-black outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner ${folderError ? 'border-rose-300' : 'border-slate-200'}`} 
                     placeholder="e.g. Dashboard Regression" 
                     value={newFolderName || ''} 
                     onChange={e => { setNewFolderName(e.target.value); setFolderError(null); }} 
                     onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                   />
                </div>
                {folderError && <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-[10px] font-black uppercase tracking-widest flex items-center gap-3 animate-in shake duration-500"><AlertTriangle size={16}/> {folderError}</div>}
                <div className="flex flex-col gap-3 pt-4">
                   <button onClick={handleCreateFolder} className="w-full py-5 bg-indigo-600 text-white rounded-[1.8rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95">Create Folder</button>
                   <button onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); setFolderError(null); }} className="w-full py-5 bg-slate-100 text-slate-500 rounded-[1.8rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-2xl rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-white">
              <div className="p-10 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-5">
                    <div className="p-5 bg-indigo-600 rounded-[1.5rem] text-white shadow-xl shadow-indigo-100">
                       <Pencil size={28} />
                    </div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">
                         {editingItem.scenarioId === 'SCENARIO_FOLDER' ? 'Edit Folder Name' : 'Edit Scenario'}
                       </h3>
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                         {editingItem.scenarioId === 'SCENARIO_FOLDER' ? 'Update the title of your organization suite' : 'Update the details and specifications of this scenario'}
                       </p>
                    </div>
                 </div>
                 <button onClick={() => setEditingItem(null)} className="p-3 text-slate-400 hover:text-slate-600 transition-all border border-transparent"><X size={28} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">
                 <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-1.5"><Asterisk size={12} className="text-indigo-600" /> Title / Name</label>
                    <input 
                      autoFocus
                      value={editForm.title || ''} 
                      onChange={e => setEditForm({...editForm, title: e.target.value})} 
                      className={`w-full px-6 py-5 bg-slate-50 border rounded-[1.5rem] text-sm font-bold outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner ${editErrors.title ? 'border-rose-300' : 'border-slate-200'}`} 
                      placeholder="Enter scenario or folder title..." 
                    />
                    {editErrors.title && <p className="text-rose-500 text-[10px] font-black mt-2 ml-3 uppercase tracking-widest">{editErrors.title}</p>}
                 </div>

                 {editingItem.scenarioId !== 'SCENARIO_FOLDER' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-3">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Module Name</label>
                           <input 
                            value={editForm.moduleName || ''} 
                            onChange={e => setEditForm({...editForm, moduleName: e.target.value})} 
                            className={`w-full px-6 py-4 bg-slate-50 border rounded-2xl text-xs font-black uppercase tracking-widest outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner ${editErrors.moduleName ? 'border-rose-300' : 'border-slate-200'}`} 
                            placeholder="e.g. Identity, Checkout, API" 
                           />
                           {editErrors.moduleName && <p className="text-rose-500 text-[10px] font-black mt-1 ml-3 uppercase tracking-widest">{editErrors.moduleName}</p>}
                        </div>
                        <div className="space-y-3">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Scenario Type</label>
                           <div className="relative">
                              <select 
                                value={editForm.type || ''} 
                                onChange={e => setEditForm({...editForm, type: e.target.value as any})} 
                                className="w-full pl-6 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase outline-none appearance-none cursor-pointer hover:bg-white transition-all shadow-sm"
                              >
                                 <option value="Functional">Functional</option>
                                 <option value="Non-functional">Non-Functional</option>
                              </select>
                              <ChevronDown size={14} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                           </div>
                        </div>
                    </div>
                 )}

                 {editingItem.scenarioId !== 'SCENARIO_FOLDER' && (
                    <>
                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2"><FileText size={14} className="text-indigo-400" /> Scenario Description</label>
                        <textarea 
                          value={editForm.description || ''} 
                          onChange={e => setEditForm({...editForm, description: e.target.value})} 
                          className="w-full h-32 px-8 py-6 bg-slate-50 border border-slate-200 rounded-[2rem] text-sm font-medium text-slate-600 outline-none focus:ring-4 ring-indigo-50/5 transition-all resize-none shadow-inner" 
                          placeholder="Detailed scenario interaction steps..." 
                        />
                    </div>

                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-500" /> Expected Result</label>
                        <textarea 
                          value={editForm.expectedResults || ''} 
                          onChange={e => setEditForm({...editForm, expectedResults: e.target.value})} 
                          className="w-full h-32 px-8 py-6 bg-slate-50 border border-slate-200 rounded-[2rem] text-sm font-bold text-indigo-700 outline-none focus:ring-4 ring-indigo-50/5 transition-all resize-none shadow-inner" 
                          placeholder="What defines a successful run?" 
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-slate-100 pt-6">
                        <div className="space-y-3">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">User Story Number</label>
                           <input 
                            value={editForm.userStoryNumber || ''} 
                            onChange={e => setEditForm({...editForm, userStoryNumber: e.target.value})} 
                            className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner font-mono text-indigo-600" 
                            placeholder="e.g. US-001" 
                           />
                        </div>
                        <div className="space-y-3">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">User Story Summary Line</label>
                           <input 
                            value={editForm.userStorySummary || ''} 
                            onChange={e => setEditForm({...editForm, userStorySummary: e.target.value})} 
                            className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner text-slate-700" 
                            placeholder="User Story Summary Line..." 
                           />
                        </div>
                    </div>
                    </>
                 )}
              </div>

              <div className="p-10 bg-white border-t border-slate-100 flex gap-5">
                 <button onClick={handleSaveEdit} className="flex-1 py-5 bg-indigo-600 text-white rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-2xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-3"><Save size={20} /> Commit Changes</button>
                 <button onClick={() => setEditingItem(null)} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200 active:scale-95 transition-all">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
           <div className="bg-white w-full max-sm rounded-[3rem] p-10 text-center shadow-2xl animate-in zoom-in-95 border border-white">
              <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-8 text-rose-500 shadow-inner">
                 <AlertTriangle size={40} />
              </div>
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-4">Delete Scenario?</h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed mb-10 px-4">This action will permanently erase this scenario from the workspace repository. This operation is final.</p>
              <div className="flex flex-col gap-3">
                 <button onClick={() => handleDeleteScenario(deleteTargetId)} className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-700 shadow-lg active:scale-95">Yes, Delete</button>
                 <button onClick={() => setDeleteTargetId(null)} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white w-full max-sm rounded-[3rem] p-10 text-center shadow-2xl animate-in zoom-in-95 border border-white">
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-8 text-red-500 shadow-inner">
                 <AlertTriangle size={40} />
              </div>
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-4">Delete {selectedScenarioIds.size} Scenarios?</h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed mb-10 px-4">This action will permanently erase all {selectedScenarioIds.size} selected scenarios from the workspace repository. This operation is final.</p>
              <div className="flex flex-col gap-3">
                 <button onClick={handleBulkDelete} className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-700 shadow-lg active:scale-95">Yes, Delete All Selected</button>
                 <button onClick={() => setShowBulkDeleteConfirm(false)} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {/* Save Confirmation Popup Modal */}
      {isSaveConfirmModalOpen && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-white p-10">
            <div className="flex items-center gap-5 mb-6">
              <div className="p-4 bg-indigo-100 text-indigo-600 rounded-[1.5rem] shadow-sm">
                <Sparkles size={24} />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Save Generated Scenarios</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Organize your workspace</p>
              </div>
            </div>
            
            <p className="text-sm text-slate-600 font-medium leading-relaxed mb-8">
              Your AI scenarios have been generated successfully. Would you like to save these scenarios into a folder?
            </p>

            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  setIsSaveConfirmModalOpen(false);
                  setIsFolderSelectModalOpen(true);
                }} 
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <FolderPlus size={16} /> Save to Folder
              </button>
              <button 
                onClick={() => {
                  setIsSaveConfirmModalOpen(false);
                  toast.info("Scenarios kept as Individual unsaved items.");
                }} 
                className="w-full py-4 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
              >
                Keep Unsaved (Individual)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Folder Selection Modal */}
      {isFolderSelectModalOpen && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-white p-10 flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-5 mb-6 shrink-0">
              <div className="p-4 bg-indigo-600 text-white rounded-[1.5rem] shadow-xl shadow-indigo-100">
                <Folder size={24} />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Select Folder</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Choose destination suite</p>
              </div>
            </div>

            <div className="space-y-6 flex-1 overflow-y-auto pr-1">
              <div className="flex items-center gap-6 border-b border-slate-100 pb-4 shrink-0">
                <button 
                  onClick={() => setShowCreateFolderInline(false)}
                  className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${!showCreateFolderInline ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  Existing Folder
                </button>
                <button 
                  onClick={() => {
                    setShowCreateFolderInline(true);
                    setInlineFolderError(null);
                  }}
                  className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${showCreateFolderInline ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  + Create New
                </button>
              </div>

              {showCreateFolderInline ? (
                <div className="space-y-4 animate-in slide-in-from-top-2 duration-200 shrink-0">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">New Folder Name</label>
                    <input 
                      autoFocus
                      type="text"
                      className={`w-full px-5 py-4 bg-slate-50 border rounded-2xl text-sm font-black outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner ${inlineFolderError ? 'border-rose-300' : 'border-slate-200'}`}
                      placeholder="e.g. Authentication Suite"
                      value={inlineNewFolderName || ''}
                      onChange={e => {
                        setInlineNewFolderName(e.target.value);
                        setInlineFolderError(null);
                      }}
                    />
                  </div>
                  {inlineFolderError && (
                    <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <AlertTriangle size={14}/> {inlineFolderError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-200 flex flex-col flex-1 min-h-[200px]">
                  <div className="relative shrink-0">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text"
                      className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black outline-none focus:ring-4 ring-indigo-50/5 transition-all"
                      placeholder="Search folders..."
                      value={searchFolderQuery || ''}
                      onChange={e => setSearchFolderQuery(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2 flex-1 overflow-y-auto max-h-[250px] pr-1">
                    {scenarios.filter(s => s.scenarioId === 'SCENARIO_FOLDER' && s.title.toLowerCase().includes(searchFolderQuery.toLowerCase())).length === 0 ? (
                      <div className="py-12 text-center text-slate-400 italic text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
                        No folders found. Create a new one!
                      </div>
                    ) : (
                      scenarios
                        .filter(s => s.scenarioId === 'SCENARIO_FOLDER' && s.title.toLowerCase().includes(searchFolderQuery.toLowerCase()))
                        .map(folder => (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() => setSelectedFolderIdForSave(folder.id)}
                            className={`w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all ${selectedFolderIdForSave === folder.id ? 'bg-indigo-50 border-indigo-400 text-indigo-950 font-black' : 'bg-white border-slate-100 hover:border-slate-200 text-slate-700 font-bold'}`}
                          >
                            <span className="text-xs uppercase tracking-tight break-all pr-2">{folder.title}</span>
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${selectedFolderIdForSave === folder.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200'}`}>
                              {selectedFolderIdForSave === folder.id && <Check size={12} strokeWidth={3} />}
                            </div>
                          </button>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={handleSaveScenariosToFolder}
                className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={16} /> Confirm Save
              </button>
              <button 
                onClick={() => {
                  setIsFolderSelectModalOpen(false);
                  setShowCreateFolderInline(false);
                  setInlineNewFolderName('');
                  setInlineFolderError(null);
                  setSelectedFolderIdForSave('');
                }} 
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move to Folder without Approving Modal */}
      {scenariosToMoveWithoutApprove.length > 0 && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-white p-10 flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-5 mb-6 shrink-0">
              <div className="p-4 bg-indigo-600 text-white rounded-[1.5rem] shadow-xl shadow-indigo-100">
                <FolderPlus size={24} />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Move to Folder</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                  Moving without approving • {scenariosToMoveWithoutApprove.length === 1 ? '1 scenario' : `${scenariosToMoveWithoutApprove.length} scenarios`}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500 font-semibold mb-4 leading-relaxed shrink-0">
              {scenariosToMoveWithoutApprove.length === 1 ? (
                <>Move <strong className="text-slate-800 uppercase">"{scenariosToMoveWithoutApprove[0].title}"</strong> to a folder. It will remain <span className="text-amber-600 font-bold">Unapproved</span> until explicitly approved.</>
              ) : (
                <>Move the selected <strong className="text-slate-800 uppercase">{scenariosToMoveWithoutApprove.length} scenarios</strong> to a folder. They will remain <span className="text-amber-600 font-bold">Unapproved</span> until explicitly approved.</>
              )}
            </p>

            <div className="space-y-6 flex-1 overflow-y-auto pr-1">
              <div className="flex items-center gap-6 border-b border-slate-100 pb-4 shrink-0">
                <button 
                  onClick={() => setShowCreateFolderInline(false)}
                  className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${!showCreateFolderInline ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  Existing Folder
                </button>
                <button 
                  onClick={() => {
                    setShowCreateFolderInline(true);
                    setInlineFolderError(null);
                  }}
                  className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${showCreateFolderInline ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  + Create New
                </button>
              </div>

              {showCreateFolderInline ? (
                <div className="space-y-4 animate-in slide-in-from-top-2 duration-200 shrink-0">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">New Folder Name</label>
                    <input 
                      autoFocus
                      type="text"
                      className={`w-full px-5 py-4 bg-slate-50 border rounded-2xl text-sm font-black outline-none focus:ring-4 ring-indigo-50/5 transition-all shadow-inner ${inlineFolderError ? 'border-rose-300' : 'border-slate-200'}`}
                      placeholder="e.g. Authentication Suite"
                      value={inlineNewFolderName || ''}
                      onChange={e => {
                        setInlineNewFolderName(e.target.value);
                        setInlineFolderError(null);
                      }}
                    />
                  </div>
                  {inlineFolderError && (
                    <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <AlertTriangle size={14}/> {inlineFolderError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-200 flex flex-col flex-1 min-h-[200px]">
                  <div className="relative shrink-0">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text"
                      className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black outline-none focus:ring-4 ring-indigo-50/5 transition-all"
                      placeholder="Search folders..."
                      value={searchFolderQuery || ''}
                      onChange={e => setSearchFolderQuery(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2 flex-1 overflow-y-auto max-h-[200px] pr-1">
                    {scenarios.filter(s => s.scenarioId === 'SCENARIO_FOLDER' && s.title.toLowerCase().includes(searchFolderQuery.toLowerCase())).length === 0 ? (
                      <div className="py-12 text-center text-slate-400 italic text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
                        No folders found. Create a new one!
                      </div>
                    ) : (
                      scenarios
                        .filter(s => s.scenarioId === 'SCENARIO_FOLDER' && s.title.toLowerCase().includes(searchFolderQuery.toLowerCase()))
                        .map(folder => (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() => setSelectedFolderIdForSave(folder.id)}
                            className={`w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all ${selectedFolderIdForSave === folder.id ? 'bg-indigo-50 border-indigo-400 text-indigo-950 font-black' : 'bg-white border-slate-100 hover:border-slate-200 text-slate-700 font-bold'}`}
                          >
                            <span className="text-xs uppercase tracking-tight break-all pr-2">{folder.title}</span>
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${selectedFolderIdForSave === folder.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200'}`}>
                              {selectedFolderIdForSave === folder.id && <Check size={12} strokeWidth={3} />}
                            </div>
                          </button>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={handleSaveScenariosWithoutApprove}
                className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <FolderPlus size={16} /> Move to Folder
              </button>
              <button 
                onClick={() => {
                  setScenariosToMoveWithoutApprove([]);
                  setShowCreateFolderInline(false);
                  setInlineNewFolderName('');
                  setInlineFolderError(null);
                  setSelectedFolderIdForSave('');
                }} 
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save and Approve Scenario Modal */}
      {scenariosToApproveAndSave.length > 0 && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-white p-10 flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-5 mb-6 shrink-0">
              <div className="p-4 bg-emerald-600 text-white rounded-[1.5rem] shadow-xl shadow-emerald-100">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Save & Approve</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                  Select folder for {scenariosToApproveAndSave.length === 1 ? 'scenario' : `${scenariosToApproveAndSave.length} scenarios`}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500 font-semibold mb-4 leading-relaxed shrink-0">
              {scenariosToApproveAndSave.length === 1 ? (
                <>To approve <strong className="text-slate-800 uppercase">"{scenariosToApproveAndSave[0].title}"</strong>, please save it into a suite folder. This moves it out of individual view and lists it under the selected folder.</>
              ) : (
                <>To approve the selected <strong className="text-slate-800 uppercase">{scenariosToApproveAndSave.length} scenarios</strong>, please save them into a suite folder. This moves them out of individual view and lists them under the selected folder.</>
              )}
            </p>

            <div className="space-y-6 flex-1 overflow-y-auto pr-1">
              <div className="flex items-center gap-6 border-b border-slate-100 pb-4 shrink-0">
                <button 
                  onClick={() => setShowCreateFolderInline(false)}
                  className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${!showCreateFolderInline ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  Existing Folder
                </button>
                <button 
                  onClick={() => {
                    setShowCreateFolderInline(true);
                    setInlineFolderError(null);
                  }}
                  className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${showCreateFolderInline ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  + Create New
                </button>
              </div>

              {showCreateFolderInline ? (
                <div className="space-y-4 animate-in slide-in-from-top-2 duration-200 shrink-0">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">New Folder Name</label>
                    <input 
                      autoFocus
                      type="text"
                      className={`w-full px-5 py-4 bg-slate-50 border rounded-2xl text-sm font-black outline-none focus:ring-4 ring-emerald-50/5 transition-all shadow-inner ${inlineFolderError ? 'border-rose-300' : 'border-slate-200'}`}
                      placeholder="e.g. Authentication Suite"
                      value={inlineNewFolderName || ''}
                      onChange={e => {
                        setInlineNewFolderName(e.target.value);
                        setInlineFolderError(null);
                      }}
                    />
                  </div>
                  {inlineFolderError && (
                    <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <AlertTriangle size={14}/> {inlineFolderError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-200 flex flex-col flex-1 min-h-[200px]">
                  <div className="relative shrink-0">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text"
                      className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black outline-none focus:ring-4 ring-emerald-50/5 transition-all"
                      placeholder="Search folders..."
                      value={searchFolderQuery || ''}
                      onChange={e => setSearchFolderQuery(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2 flex-1 overflow-y-auto max-h-[200px] pr-1">
                    {scenarios.filter(s => s.scenarioId === 'SCENARIO_FOLDER' && s.title.toLowerCase().includes(searchFolderQuery.toLowerCase())).length === 0 ? (
                      <div className="py-12 text-center text-slate-400 italic text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
                        No folders found. Create a new one!
                      </div>
                    ) : (
                      scenarios
                        .filter(s => s.scenarioId === 'SCENARIO_FOLDER' && s.title.toLowerCase().includes(searchFolderQuery.toLowerCase()))
                        .map(folder => (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() => setSelectedFolderIdForSave(folder.id)}
                            className={`w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all ${selectedFolderIdForSave === folder.id ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-black' : 'bg-white border-slate-100 hover:border-slate-200 text-slate-700 font-bold'}`}
                          >
                            <span className="text-xs uppercase tracking-tight break-all pr-2">{folder.title}</span>
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${selectedFolderIdForSave === folder.id ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200'}`}>
                              {selectedFolderIdForSave === folder.id && <Check size={12} strokeWidth={3} />}
                            </div>
                          </button>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={handleSaveAndApproveScenario}
                className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 shadow-xl shadow-emerald-100 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={16} /> Save & Approve
              </button>
              <button 
                onClick={() => {
                  setScenariosToApproveAndSave([]);
                  setShowCreateFolderInline(false);
                  setInlineNewFolderName('');
                  setInlineFolderError(null);
                  setSelectedFolderIdForSave('');
                }} 
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import User Stories Modal */}
      {isImportStoriesModalOpen && (
        <div className="fixed inset-0 z-[6000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-white p-10 flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-6 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-5">
                <div className="p-4 bg-emerald-600 text-white rounded-[1.5rem] shadow-xl shadow-emerald-100">
                  <Folder size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Import From AI User Stories</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Select stories from your story generator folders</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsImportStoriesModalOpen(false);
                  setSelectedImportStoryIds(new Set());
                  setSearchImportStoryQuery('');
                }}
                className="p-3 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-all border border-slate-200 shadow-sm"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search and Selection summary */}
            <div className="py-6 space-y-4 shrink-0">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="text"
                  className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black outline-none focus:ring-4 ring-emerald-50/5 transition-all"
                  placeholder="Search user stories by summary, description, or acceptance criteria..."
                  value={searchImportStoryQuery || ''}
                  onChange={e => setSearchImportStoryQuery(e.target.value)}
                />
              </div>

              {selectedImportStoryIds.size > 0 && (
                <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-800 text-[10px] font-black uppercase tracking-widest">
                  <span>Selected {selectedImportStoryIds.size} story/stories to import</span>
                  <button 
                    onClick={() => setSelectedImportStoryIds(new Set())}
                    className="text-emerald-600 hover:text-emerald-800 underline uppercase tracking-widest cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto space-y-6 pr-2 mb-6">
              {/* Folders Section */}
              {filteredImportStories.folders.length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Folders ({filteredImportStories.folders.length})</h4>
                  <div className="space-y-3">
                    {filteredImportStories.folders.map(folder => {
                      const memberIds = folder.memberStoryIds || [];
                      const folderMembers = userStoriesList.filter(s => memberIds.includes(s.id));
                      const isExpanded = expandedImportFolders.has(folder.id);
                      const allSelected = memberIds.length > 0 && memberIds.every(id => selectedImportStoryIds.has(id));

                      return (
                        <div key={folder.id} className="border border-slate-100 rounded-[2rem] bg-white overflow-hidden shadow-sm hover:border-slate-200 transition-all">
                          {/* Folder Header */}
                          <div className="p-4 bg-slate-50/50 flex items-center justify-between gap-4">
                            <div 
                              className="flex items-center gap-3 cursor-pointer flex-1"
                              onClick={() => handleToggleExpandImportFolder(folder.id)}
                            >
                              <div className="text-slate-400">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </div>
                              <Folder className="text-indigo-500 shrink-0" size={18} />
                              <div className="truncate">
                                <span className="text-xs font-black text-slate-800 uppercase tracking-tight break-all">{folder.summary}</span>
                                <span className="ml-2 text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{folderMembers.length} stories</span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleToggleImportFolder(folder.id, memberIds)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border ${allSelected ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                            >
                              {allSelected ? 'All Selected' : 'Select All'}
                            </button>
                          </div>

                          {/* Folder Stories List */}
                          {isExpanded && (
                            <div className="border-t border-slate-100 divide-y divide-slate-50 p-2 bg-white max-h-60 overflow-y-auto">
                              {folderMembers.length === 0 ? (
                                <div className="p-4 text-center text-[10px] text-slate-400 italic">This folder is empty.</div>
                              ) : (
                                folderMembers.map(story => {
                                  const isChecked = selectedImportStoryIds.has(story.id);
                                  return (
                                    <div 
                                      key={story.id} 
                                      onClick={() => handleToggleImportStory(story.id)}
                                      className={`p-3 rounded-2xl flex items-start gap-3 transition-all cursor-pointer ${isChecked ? 'bg-emerald-50/30' : 'hover:bg-slate-50/50'}`}
                                    >
                                      <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isChecked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'}`}>
                                        {isChecked && <Check size={10} strokeWidth={4} />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-bold text-slate-700 uppercase tracking-tight truncate">{story.summary}</span>
                                          {story.storyId && (
                                            <span className="text-[8px] font-mono font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{story.storyId}</span>
                                          )}
                                        </div>
                                        {story.description && story.description !== 'Organization folder' && (
                                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{story.description}</p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Individual Section */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Individual Stories ({filteredImportStories.individuals.length})</h4>
                {filteredImportStories.individuals.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 italic text-xs border border-dashed border-slate-200 rounded-[2rem] bg-slate-50/30">
                    No individual stories found.
                  </div>
                ) : (
                  <div className="border border-slate-100 rounded-[2rem] bg-white divide-y divide-slate-100 shadow-sm overflow-hidden max-h-60 overflow-y-auto">
                    {filteredImportStories.individuals.map(story => {
                      const isChecked = selectedImportStoryIds.has(story.id);
                      return (
                        <div 
                          key={story.id} 
                          onClick={() => handleToggleImportStory(story.id)}
                          className={`p-4 flex items-start gap-4 transition-all cursor-pointer ${isChecked ? 'bg-emerald-50/30' : 'hover:bg-slate-50/50'}`}
                        >
                          <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 ${isChecked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'}`}>
                            {isChecked && <Check size={12} strokeWidth={4} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-black text-slate-800 uppercase tracking-tight truncate">{story.summary}</span>
                              {story.storyId && (
                                <span className="text-[8px] font-mono font-bold bg-slate-150 text-slate-500 px-1.5 py-0.5 rounded">{story.storyId}</span>
                              )}
                            </div>
                            {story.description && (
                              <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">{story.description}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Absolute Empty State */}
              {filteredImportStories.folders.length === 0 && filteredImportStories.individuals.length === 0 && (
                <div className="py-16 text-center border border-dashed border-slate-200 rounded-[3rem] bg-slate-50/30">
                  <div className="w-16 h-16 bg-slate-100 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Folder size={28} />
                  </div>
                  <h5 className="text-sm font-black text-slate-600 uppercase tracking-tight">No user stories found</h5>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Generate or create user stories in the Story Generator page first.</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="pt-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={handleImportStories}
                disabled={selectedImportStoryIds.size === 0}
                className="flex-1 py-4 bg-emerald-600 text-white disabled:opacity-50 disabled:pointer-events-none rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 shadow-xl shadow-emerald-100 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={16} /> Import Selected ({selectedImportStoryIds.size})
              </button>
              <button 
                onClick={() => {
                  setIsImportStoriesModalOpen(false);
                  setSelectedImportStoryIds(new Set());
                  setSearchImportStoryQuery('');
                }} 
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jira Import Modal component */}
      <JiraImportModal 
        isOpen={isJiraModalOpen} 
        onClose={() => setIsJiraModalOpen(false)} 
        project={project} 
        user={user} 
        onUpdateProject={onUpdateProject} 
      />

    </div>
  );
};

export default ScenarioGenerator;