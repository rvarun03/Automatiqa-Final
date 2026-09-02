import React, { useState, useEffect } from 'react';
import { 
  X, 
  UploadCloud, 
  Play, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  FileCode, 
  Eye, 
  Layers, 
  Globe, 
  Sparkles, 
  ArrowRight, 
  Copy, 
  Check, 
  Download, 
  RefreshCw,
  Sliders,
  ChevronRight,
  ShieldCheck,
  Code2,
  Video,
  ListOrdered,
  FileCheck,
  Save,
  Folder,
  Plus,
  FileText,
  Trash2,
  ChevronDown
} from 'lucide-react';
import { toast } from 'sonner';
import { ExtractedVideoFrame, extractVideoFrames } from '../utils/videoExtractor';
import { 
  analyzeVideoWalkthroughAndSynthesizeFlow, 
  VideoFlowAnalysisResult, 
  MatchedStepAction 
} from '../services/videoFlowDetectionService';
import { RecordedStep, AutomationTool, ProgrammingLanguage, Project, AutomationScript } from '../types';
import { 
  BddDocumentParsed, 
  parseBddDocument, 
  getFrameworksForAutomation 
} from '../utils/automationFrameworkOptions';

interface RecordPlayVideoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyStepsToFlow: (steps: RecordedStep[], flowMetadata: { name: string; url: string; description?: string }) => void;
  initialTargetUrl?: string;
  platform?: 'web' | 'mobile';
  project?: Project;
  onUpdateProject?: (project: Project) => Promise<void> | void;
  onSaveGeneratedScript?: (script: AutomationScript) => void;
}

export const RecordPlayVideoUploadModal: React.FC<RecordPlayVideoUploadModalProps> = ({
  isOpen,
  onClose,
  onApplyStepsToFlow,
  initialTargetUrl = '',
  platform = 'web',
  project,
  onUpdateProject,
  onSaveGeneratedScript
}) => {
  // Upload & Extraction State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFrames, setVideoFrames] = useState<ExtractedVideoFrame[]>([]);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractionProgress, setExtractionProgress] = useState<string>('');

  // Target URL & Configuration
  const [targetUrl, setTargetUrl] = useState<string>(initialTargetUrl || 'https://ecommerce-playground.lambdatest.io');
  const [selectedTool, setSelectedTool] = useState<AutomationTool>('Playwright');
  const [selectedLanguage, setSelectedLanguage] = useState<ProgrammingLanguage>('TypeScript');
  const [selectedFramework, setSelectedFramework] = useState<string>('Page Object Model (POM)');
  const [userDirectives, setUserDirectives] = useState<string>('');

  // BDD Document Upload State
  const [bddDocument, setBddDocument] = useState<BddDocumentParsed | null>(null);
  const [bddFileName, setBddFileName] = useState<string>('');
  const [isBddUploading, setIsBddUploading] = useState<boolean>(false);

  // Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStage, setAnalysisStage] = useState<string>('');
  const [analysisPercent, setAnalysisPercent] = useState<number>(0);
  const [analysisResult, setAnalysisResult] = useState<VideoFlowAnalysisResult | null>(null);

  // Active View Tab
  const [activeTab, setActiveTab] = useState<'steps' | 'script' | 'dom'>('steps');
  const [selectedActionIndex, setSelectedActionIndex] = useState<number>(0);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [activeFileTab, setActiveFileTab] = useState<number>(0);

  // Save Script Modal State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState<boolean>(false);
  const [saveTitle, setSaveTitle] = useState<string>('');
  const [saveDescription, setSaveDescription] = useState<string>('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [isSavingScript, setIsSavingScript] = useState<boolean>(false);

  // Dynamic frameworks list based on tool & language
  const availableFrameworks = getFrameworksForAutomation(selectedTool, selectedLanguage);

  useEffect(() => {
    if (availableFrameworks && availableFrameworks.length > 0) {
      if (!availableFrameworks.includes(selectedFramework)) {
        setSelectedFramework(availableFrameworks[0]);
      }
    }
  }, [selectedTool, selectedLanguage]);

  if (!isOpen) return null;

  const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB limit

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Handle Video File Selection (Supports up to 1GB)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      toast.error('Please upload a valid video file (.mp4, .webm, .mov, etc.)');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(`File size exceeds 1GB limit (${formatFileSize(file.size)}). Please select a video up to 1GB.`);
      return;
    }

    setVideoFile(file);
    setAnalysisResult(null);
    setIsExtracting(true);
    setExtractionProgress(`Analyzing video (${formatFileSize(file.size)})...`);

    try {
      const extracted = await extractVideoFrames(file, {
        maxFrames: 24,
        intervalSeconds: 1.5,
        onProgress: (msg) => setExtractionProgress(msg)
      });

      setVideoFrames(extracted.frames);
      setVideoDuration(extracted.duration);
      toast.success(`Extracted ${extracted.frames.length} keyframes across ${extracted.duration.toFixed(1)}s walkthrough video (${formatFileSize(file.size)})`);
    } catch (err: any) {
      console.error('Video extraction error:', err);
      toast.error(`Frame extraction notice: ${err.message || 'Failed to extract video frames'}`);
    } finally {
      setIsExtracting(false);
      setExtractionProgress('');
    }
  };

  // Handle BDD Document Upload (.feature, .txt, .gherkin, .md)
  const handleBddFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsBddUploading(true);
    try {
      const text = await file.text();
      const parsed = parseBddDocument(text, file.name);
      setBddDocument(parsed);
      setBddFileName(file.name);
      
      // Auto-suggest BDD/Cucumber framework if not already set
      if (!selectedFramework.toLowerCase().includes('cucumber') && !selectedFramework.toLowerCase().includes('bdd')) {
        const bddChoice = availableFrameworks.find(f => f.toLowerCase().includes('bdd') || f.toLowerCase().includes('cucumber'));
        if (bddChoice) {
          setSelectedFramework(bddChoice);
        }
      }

      toast.success(`Loaded BDD Document "${file.name}" with ${parsed.scenarios.length} scenario(s)!`);
    } catch (err: any) {
      console.error('BDD parse error:', err);
      toast.error(`Failed to parse BDD document: ${err.message || 'Invalid format'}`);
    } finally {
      setIsBddUploading(false);
    }
  };

  const handleRemoveBddDoc = () => {
    setBddDocument(null);
    setBddFileName('');
    toast.info('BDD Document removed');
  };

  // Run End-to-End Analysis Pipeline
  const handleRunAnalysis = async () => {
    if (videoFrames.length === 0) {
      toast.error('Please upload a video walkthrough first');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisStage('Initiating visual action detection & DOM inspection...');
    setAnalysisPercent(10);

    try {
      const result = await analyzeVideoWalkthroughAndSynthesizeFlow(videoFrames, {
        targetUrlOverride: targetUrl.trim() || undefined,
        videoFileName: videoFile?.name || 'Walkthrough Video',
        videoDuration: videoDuration,
        platform,
        tool: selectedTool,
        language: selectedLanguage,
        framework: selectedFramework,
        bddDocument: bddDocument || undefined,
        userDirectives: userDirectives.trim() || undefined,
        onProgress: (stage, pct) => {
          setAnalysisStage(stage);
          setAnalysisPercent(pct);
        }
      });

      setAnalysisResult(result);
      if (result.detectedUrl && result.detectedUrl !== targetUrl) {
        setTargetUrl(result.detectedUrl);
      }
      setSelectedActionIndex(0);
      setSaveTitle(`${result.flowName || 'Video Flow'} - ${selectedTool} ${selectedFramework}`);
      setSaveDescription(result.flowDescription || 'Automated script generated from video walkthrough');
      toast.success(`Synthesized ${result.steps.length} automated steps with DOM-verified locators for ${selectedFramework}!`);
    } catch (err: any) {
      console.error('Flow analysis error:', err);
      toast.error(`Analysis notice: ${err.message || 'Failed to complete video action analysis'}`);
    } finally {
      setIsAnalyzing(false);
      setAnalysisStage('');
      setAnalysisPercent(0);
    }
  };

  // Copy Script to Clipboard
  const handleCopyScript = () => {
    if (!analysisResult) return;
    const textToCopy = analysisResult.scriptFiles?.[activeFileTab]?.content || analysisResult.generatedScript;
    navigator.clipboard.writeText(textToCopy);
    setIsCopied(true);
    toast.success('Script copied to clipboard!');
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Download Script
  const handleDownloadScript = () => {
    if (!analysisResult) return;
    const activeFile = analysisResult.scriptFiles?.[activeFileTab];
    const content = activeFile ? activeFile.content : analysisResult.generatedScript;
    const filename = activeFile ? activeFile.path.split('/').pop() || 'automation_test.spec.ts' : `${analysisResult.flowName.replace(/[^a-zA-Z0-9]/g, '_')}_test.ts`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  // Open Save Script Dialog
  const handleOpenSaveModal = () => {
    if (!analysisResult) return;
    setSaveTitle(saveTitle || `${analysisResult.flowName} - ${selectedTool} (${selectedFramework})`);
    setSaveDescription(saveDescription || analysisResult.flowDescription || 'Generated automation script from video');
    
    // Auto-select first matching script folder for this platform if available
    if (project?.automationFolders) {
      const defaultFolder = project.automationFolders.find(f => (f.platform === platform || !f.platform));
      if (defaultFolder) {
        setSelectedFolderId(defaultFolder.id);
      }
    }
    setIsSaveModalOpen(true);
  };

  // Execute Save Script to Project
  const handleSaveScriptToProject = async () => {
    if (!analysisResult) return;
    if (!saveTitle.trim()) {
      toast.error('Please enter a script title');
      return;
    }

    setIsSavingScript(true);
    try {
      let finalFolderId = selectedFolderId;
      let updatedFolders = project?.automationFolders || [];
      let finalFolderName: string | undefined = undefined;

      if (isCreatingFolder && newFolderName.trim()) {
        const existing = updatedFolders.find(f => (f.platform === platform || (!f.platform && platform === 'web')) && f.name.trim().toLowerCase() === newFolderName.trim().toLowerCase());
        if (existing) {
          finalFolderId = existing.id;
          finalFolderName = existing.name;
        } else {
          finalFolderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          finalFolderName = newFolderName.trim();
          updatedFolders = [
            ...updatedFolders,
            {
              id: finalFolderId,
              name: finalFolderName,
              type: 'script',
              platform: platform
            }
          ];
        }
      } else if (finalFolderId) {
        const selectedObj = updatedFolders.find(f => f.id === finalFolderId);
        finalFolderName = selectedObj?.name;
      }

      const files = analysisResult.scriptFiles && analysisResult.scriptFiles.length > 0
        ? analysisResult.scriptFiles.map(f => ({ path: f.path, content: f.content }))
        : [{ path: 'test.spec.ts', content: analysisResult.generatedScript }];

      const mainFile = files.find(f => f.path.includes('spec') || f.path.includes('test') || f.path.includes('Test')) || files[0];

      const newScript: AutomationScript = {
        id: Math.random().toString(36).substr(2, 9),
        title: saveTitle.trim(),
        description: saveDescription.trim() || `${selectedFramework} script generated from video walkthrough`,
        content: mainFile?.content || analysisResult.generatedScript,
        files: files,
        tool: selectedTool,
        language: selectedLanguage,
        createdAt: new Date().toISOString(),
        folderId: finalFolderId || undefined,
        folderName: finalFolderName,
        isApproved: true,
        source: 'record_play',
        platform: platform,
        appUrl: targetUrl
      };

      if (onSaveGeneratedScript) {
        onSaveGeneratedScript(newScript);
      }

      if (project && onUpdateProject) {
        const updatedScripts = [...(project.automationScripts || []), newScript];
        await onUpdateProject({
          ...project,
          automationScripts: updatedScripts,
          automationFolders: updatedFolders
        });
      }

      toast.success(`Saved "${newScript.title}" to project repository under "${finalFolderName || 'Root'}"!`);
      setIsSaveModalOpen(false);
    } catch (err: any) {
      console.error('Save script error:', err);
      toast.error(`Failed to save script: ${err.message || err}`);
    } finally {
      setIsSavingScript(false);
    }
  };

  // Apply to Main Record & Play Component
  const handleApply = () => {
    if (!analysisResult || analysisResult.steps.length === 0) {
      toast.error('No steps to apply');
      return;
    }

    onApplyStepsToFlow(analysisResult.steps, {
      name: analysisResult.flowName,
      url: analysisResult.detectedUrl,
      description: analysisResult.flowDescription
    });

    toast.success(`Successfully loaded ${analysisResult.steps.length} video-detected steps into Record & Play!`);
    onClose();
  };

  const selectedMatchedAction: MatchedStepAction | undefined = analysisResult?.matchedActions?.[selectedActionIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-100">Upload Video & Generate Automation Script</h2>
                <span className="px-2 py-0.5 text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full">
                  AI Action + Multi-Framework
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Extracts keyframes, inspects live DOM, binds BDD/TestNG frameworks, and generates Page Object Model automation scripts.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* STEP 1: Upload Video & Target Configuration */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Upload Area */}
            <div className="lg:col-span-7 space-y-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                1. Upload Walkthrough Video
              </label>

              <div className="relative border-2 border-dashed border-slate-700 hover:border-cyan-500/60 bg-slate-950/40 rounded-xl p-6 transition-all text-center group cursor-pointer">
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex flex-col items-center justify-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform">
                    {isExtracting ? <Loader2 className="w-6 h-6 animate-spin" /> : <UploadCloud className="w-6 h-6" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      {videoFile ? `${videoFile.name} (${formatFileSize(videoFile.size)})` : 'Drag & drop walkthrough video, or click to browse'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Supports MP4, WebM, MOV, AVI, MKV (Accepts up to 1GB)
                    </p>
                  </div>
                </div>
              </div>

              {/* Extraction Progress */}
              {isExtracting && (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  <span className="text-xs text-cyan-300">{extractionProgress}</span>
                </div>
              )}

              {/* Keyframes Preview Reel */}
              {videoFrames.length > 0 && !isExtracting && (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      Extracted Chronological Keyframes ({videoFrames.length} frames • {videoDuration.toFixed(1)}s)
                    </span>
                    <span className="text-emerald-400 font-medium">Ready for Multi-Framework Synthesis</span>
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700">
                    {videoFrames.map((frame, idx) => (
                      <div key={idx} className="flex-shrink-0 relative group rounded-lg overflow-hidden border border-slate-800 w-24 aspect-video bg-black">
                        <img 
                          src={frame.image} 
                          alt={`Frame ${idx + 1}`} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute bottom-0 inset-x-0 bg-black/70 px-1 py-0.5 text-[9px] text-slate-300 text-center font-mono">
                          {frame.timestamp}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Target URL & Settings */}
            <div className="lg:col-span-5 space-y-3.5 bg-slate-950/40 border border-slate-800 rounded-xl p-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                2. Target URL & Framework Configuration
              </label>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  Application Web URL
                </label>
                <input
                  type="text"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://ecommerce-playground.lambdatest.io"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              {/* Tool & Language */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Automation Tool
                  </label>
                  <select
                    value={selectedTool}
                    onChange={(e) => setSelectedTool(e.target.value as AutomationTool)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Playwright">Playwright</option>
                    <option value="Selenium">Selenium</option>
                    <option value="Appium">Appium</option>
                    <option value="Cypress">Cypress</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Language
                  </label>
                  <select
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value as ProgrammingLanguage)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="TypeScript">TypeScript</option>
                    <option value="JavaScript">JavaScript</option>
                    <option value="Python">Python</option>
                    <option value="Java">Java</option>
                    <option value="C#">C#</option>
                  </select>
                </div>
              </div>

              {/* Chosen Framework (TestNG, Cucumber, POM, PyTest, JUnit, etc.) */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                    Target Framework Architecture
                  </span>
                  <span className="text-[10px] text-cyan-400 font-mono font-normal">
                    {availableFrameworks.length} Options
                  </span>
                </label>
                <div className="relative">
                  <select
                    value={selectedFramework}
                    onChange={(e) => setSelectedFramework(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500 appearance-none"
                  >
                    {availableFrameworks.map((fw, idx) => (
                      <option key={idx} value={fw}>{fw}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* BDD Document Upload */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    Upload BDD Document (Optional)
                  </span>
                  <span className="text-[10px] text-slate-500">
                    .feature, .txt, .gherkin
                  </span>
                </label>

                {bddDocument ? (
                  <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/30 rounded-lg flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                        <FileCheck className="w-3.5 h-3.5" />
                        {bddFileName || bddDocument.featureTitle}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {bddDocument.scenarios.length} Scenario(s) • {bddDocument.tags.join(', ') || 'No tags'}
                      </div>
                    </div>
                    <button
                      onClick={handleRemoveBddDoc}
                      className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                      title="Remove BDD Document"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="border border-dashed border-slate-700 hover:border-emerald-500/60 bg-slate-900/60 rounded-lg p-2.5 flex items-center justify-center gap-2 cursor-pointer transition-colors group">
                    <input
                      type="file"
                      accept=".feature,.txt,.gherkin,.md,.json"
                      onChange={handleBddFileUpload}
                      className="hidden"
                    />
                    <UploadCloud className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                    <span className="text-xs text-slate-400 group-hover:text-slate-200">
                      {isBddUploading ? 'Parsing document...' : 'Attach BDD Feature File to Guide Generation'}
                    </span>
                  </label>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Custom Directives (Optional)
                </label>
                <input
                  type="text"
                  value={userDirectives}
                  onChange={(e) => setUserDirectives(e.target.value)}
                  placeholder="e.g., Use TestNG DataProvider and assert success banner"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Action Trigger Button */}
              <button
                onClick={handleRunAnalysis}
                disabled={videoFrames.length === 0 || isAnalyzing || isExtracting}
                className="w-full mt-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{analysisStage || 'Analyzing Video & Inspecting DOM...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate {selectedFramework} Scripts from Video</span>
                  </>
                )}
              </button>

              {isAnalyzing && (
                <div className="space-y-1.5 pt-1">
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${analysisPercent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-cyan-400 font-mono text-center">
                    {analysisStage} ({analysisPercent}%)
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* STEP 2: Analysis Results, Detected Steps, Locators & Script */}
          {analysisResult && (
            <div className="border border-slate-800 rounded-xl bg-slate-950/60 overflow-hidden space-y-0">
              
              {/* Summary Bar */}
              <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-slate-100">{analysisResult.flowName}</h3>
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                      {analysisResult.steps.length} Steps Detected
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full">
                      {selectedFramework}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full">
                      {analysisResult.domElementsCount} Live DOM Elements
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{analysisResult.flowDescription}</p>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setActiveTab('steps')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      activeTab === 'steps' 
                        ? 'bg-cyan-600 text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    Steps ({analysisResult.steps.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('script')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      activeTab === 'script' 
                        ? 'bg-cyan-600 text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    Generated Script ({analysisResult.scriptFiles?.length || 1} Files)
                  </button>
                </div>
              </div>

              {/* TAB 1: Sequential Steps & Keyframe Inspector */}
              {activeTab === 'steps' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
                  
                  {/* Step List */}
                  <div className="lg:col-span-5 p-4 space-y-2 overflow-y-auto max-h-[440px]">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                      <span>Chronological User Actions</span>
                      <span className="text-[10px] text-slate-500">Click to inspect locator</span>
                    </div>

                    {analysisResult.matchedActions?.map((item, idx) => {
                      const isSelected = selectedActionIndex === idx;
                      const primaryLoc = item.step.locator.primary;

                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedActionIndex(idx)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected 
                              ? 'bg-cyan-950/40 border-cyan-500/60 shadow-md shadow-cyan-950' 
                              : 'bg-slate-900/50 hover:bg-slate-900 border-slate-800'
                          }`}
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-[10px] font-mono font-bold">
                                {idx + 1}
                              </span>
                              <span className="text-xs font-bold text-slate-200 truncate">
                                {item.detectedAction.targetHint || item.detectedAction.elementName || item.step.elementName}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 truncate">
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 font-bold uppercase text-[9px]">
                                {item.step.action}
                              </span>
                              <span className="truncate">{primaryLoc.value}</span>
                            </div>
                          </div>

                          {item.extractedFrame?.image && (
                            <div className="w-12 h-8 rounded bg-black flex-shrink-0 overflow-hidden border border-slate-700">
                              <img 
                                src={item.extractedFrame.image} 
                                alt={`Thumb ${idx + 1}`} 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Step Detail & Match Inspector */}
                  <div className="lg:col-span-7 p-5 space-y-4 overflow-y-auto max-h-[440px]">
                    {selectedMatchedAction ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                            <span className="w-6 h-6 rounded-md bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs font-mono">
                              #{selectedActionIndex + 1}
                            </span>
                            {selectedMatchedAction.step.elementName}
                          </h4>

                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            selectedMatchedAction.matchScore > 0 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {selectedMatchedAction.matchScore > 0 ? `DOM Matched (${selectedMatchedAction.matchScore}%)` : 'AI Synthesized'}
                          </span>
                        </div>

                        {/* Video Keyframe & Visual Context */}
                        {selectedMatchedAction.extractedFrame?.image && (
                          <div className="rounded-xl overflow-hidden border border-slate-800 bg-black relative max-h-48 flex items-center justify-center">
                            <img 
                              src={selectedMatchedAction.extractedFrame.image} 
                              alt="Step Frame" 
                              className="max-h-48 object-contain"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute top-2 left-2 bg-black/80 px-2 py-1 rounded text-[10px] font-mono text-cyan-300">
                              Keyframe @ {selectedMatchedAction.detectedAction.timestamp}
                            </div>
                          </div>
                        )}

                        {/* Visual Context description */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1">
                          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Visual UI Action</span>
                          <p className="text-xs text-slate-200">
                            {selectedMatchedAction.detectedAction.visualContext || 'User performed interaction on the element visible on screen.'}
                          </p>
                        </div>

                        {/* Stable Primary Locator */}
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            Primary Stable Locator ({selectedMatchedAction.step.locator.primary.type})
                          </span>
                          <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-3 font-mono text-xs text-emerald-300 break-all select-all">
                            {selectedMatchedAction.step.locator.primary.playwright || selectedMatchedAction.step.locator.primary.value}
                          </div>
                        </div>

                        {/* Alternative Locators */}
                        {selectedMatchedAction.step.locator.alternatives.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              Alternative Locators ({selectedMatchedAction.step.locator.alternatives.length})
                            </span>
                            <div className="space-y-1.5">
                              {selectedMatchedAction.step.locator.alternatives.map((alt, aIdx) => (
                                <div key={aIdx} className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between text-xs font-mono">
                                  <span className="text-amber-400 text-[10px] uppercase font-bold">{alt.type}</span>
                                  <span className="text-slate-300 text-[11px] truncate max-w-[80%]">{alt.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                        Select a step from the list to view its locator details
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: Generated Automation Script */}
              {activeTab === 'script' && (
                <div className="p-4 space-y-4">
                  {/* File Selector Tabs if multi-file POM */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2 overflow-x-auto">
                      {analysisResult.scriptFiles && analysisResult.scriptFiles.length > 0 ? (
                        analysisResult.scriptFiles.map((file, fIdx) => (
                          <button
                            key={fIdx}
                            onClick={() => setActiveFileTab(fIdx)}
                            className={`px-3 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap ${
                              activeFileTab === fIdx
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <FileCode className="w-3.5 h-3.5 inline mr-1" />
                            {file.path}
                          </button>
                        ))
                      ) : (
                        <span className="text-xs font-mono text-cyan-300">
                          <FileCode className="w-3.5 h-3.5 inline mr-1" />
                          script.spec.ts
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleCopyScript}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {isCopied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={handleDownloadScript}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </button>
                    </div>
                  </div>

                  {/* Code Viewer */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 overflow-x-auto max-h-[360px] leading-relaxed select-all scrollbar-thin scrollbar-thumb-slate-700">
                    <pre>
                      {analysisResult.scriptFiles?.[activeFileTab]?.content || analysisResult.generatedScript}
                    </pre>
                  </div>

                  {/* Save Script Action Bar at the Bottom of Generated Script */}
                  <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
                        <Save className="w-4 h-4" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-slate-100">Save Script into Repository</h5>
                        <p className="text-[10px] text-slate-400">
                          Store this {selectedFramework} script inside your project's folders for CI/CD test execution
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            setIsSavingScript(true);
                            const files = analysisResult.scriptFiles && analysisResult.scriptFiles.length > 0
                              ? analysisResult.scriptFiles.map(f => ({ path: f.path, content: f.content }))
                              : [{ path: 'test.spec.ts', content: analysisResult.generatedScript }];
                            const mainFile = files.find(f => f.path.includes('spec') || f.path.includes('test') || f.path.includes('Test')) || files[0];

                            const newScript: AutomationScript = {
                              id: Math.random().toString(36).substr(2, 9),
                              title: saveTitle.trim() || `${selectedFramework} Video Script`,
                              description: saveDescription.trim() || `${selectedFramework} script generated from video walkthrough`,
                              content: mainFile?.content || analysisResult.generatedScript,
                              files: files,
                              tool: selectedTool,
                              language: selectedLanguage,
                              createdAt: new Date().toISOString(),
                              folderId: selectedFolderId || undefined,
                              isApproved: true,
                              source: 'record_play',
                              platform: platform,
                              appUrl: targetUrl
                            };

                            if (onSaveGeneratedScript) {
                              onSaveGeneratedScript(newScript);
                            }

                            if (project && onUpdateProject) {
                              const updatedScripts = [...(project.automationScripts || []), newScript];
                              await onUpdateProject({
                                ...project,
                                automationScripts: updatedScripts
                              });
                            }

                            toast.success(`Script approved and added to Execution Hub!`);
                          } catch (err: any) {
                            toast.error(`Failed to approve script: ${err.message || err}`);
                          } finally {
                            setIsSavingScript(false);
                          }
                        }}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950 transition-all cursor-pointer"
                        title="Approve script for Execution Hub"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve for Execution Hub
                      </button>
                      <button
                        onClick={handleOpenSaveModal}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save Script
                      </button>
                    </div>
                  </div>

                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-3">
            {analysisResult && (
              <>
                <button
                  onClick={handleOpenSaveModal}
                  className="px-4 py-2.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 rounded-xl shadow-md flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Save className="w-4 h-4 text-emerald-400" />
                  Save Script
                </button>

                <button
                  onClick={handleApply}
                  className="px-5 py-2.5 text-xs font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  Apply {analysisResult.steps.length} Steps to Flow
                </button>
              </>
            )}
          </div>
        </div>

      </div>

      {/* Save Script Modal Dialog */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5 text-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                  <Save className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Save Generated Script</h3>
                  <p className="text-[10px] text-slate-400">Save to project script repository</p>
                </div>
              </div>
              <button onClick={() => setIsSaveModalOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Script Title</label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  placeholder="e.g. Video Walkthrough Flow - Playwright POM"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Description</label>
                <textarea
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 resize-none"
                  placeholder="Description of the test script..."
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-400">Target Folder</label>
                  <button
                    type="button"
                    onClick={() => setIsCreatingFolder(!isCreatingFolder)}
                    className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    {isCreatingFolder ? 'Select Existing Folder' : '+ Create New Folder'}
                  </button>
                </div>

                {isCreatingFolder ? (
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Enter new folder name..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                ) : (
                  <select
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Root Directory</option>
                    {project?.automationFolders?.filter(f => f.platform === platform || !f.platform).map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveScriptToProject}
                disabled={isSavingScript || !saveTitle.trim()}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center gap-2 transition-colors cursor-pointer"
              >
                {isSavingScript ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Script
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
