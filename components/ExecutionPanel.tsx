import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Project, TestStatus, TestCase } from '../types';
import { 
  Activity, 
  Cpu, 
  CheckSquare, 
  Square, 
  CheckCircle2, 
  XCircle, 
  Folder, 
  ChevronDown, 
  ChevronRight, 
  X, 
  Paperclip, 
  MessageSquare, 
  Upload, 
  FileText, 
  Image as ImageIcon,
  Download,
  Search,
  Trash2,
  AlertTriangle,
  Clock,
  Zap,
  Camera,
  Maximize2,
  DatabaseZap,
  Link2,
  Plus,
  PlayCircle,
  FileVideo,
  ExternalLink,
  Loader2,
  Pencil,
  Ban,
  Hash,
  Info
} from 'lucide-react';
import { logActivity } from '../services/activityService';
import * as XLSX from 'xlsx';
import { estimateSize } from '../services/projectService';
import { JiraBugModal } from './JiraBugModal';
import { maskPasswordText } from './TestCaseManager';

interface ExecutionPanelProps {
  project: Project;
  user: { email: string, name: string };
  onUpdateProject: (p: Project) => void;
  defaultFilter?: 'ALL' | 'AI' | 'MANUAL';
  activeFolderId?: string | null;
  onClearActiveFolder?: () => void;
}

interface ExecutableTestCase extends TestCase {
  scenarioId: string;
  scenarioTitle: string;
  source: 'AI' | 'MANUAL';
  folderId?: string;
}

interface ExecutionGroup {
  id: string;
  source: 'AI' | 'MANUAL';
  cases: ExecutableTestCase[];
}

interface GroupedCases {
  [key: string]: ExecutionGroup;
}

interface DeleteTarget {
  type: 'group' | 'case';
  id: string; 
  source: 'AI' | 'MANUAL';
  title: string;
}

const ExecutionPanel: React.FC<ExecutionPanelProps> = ({ project, user, onUpdateProject, defaultFilter = 'ALL', activeFolderId, onClearActiveFolder }) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['ALL']));
  const [searchQuery, setSearchQuery] = useState('');

  // SESSION CACHE
  const [localTestCaseUpdates, setLocalTestCaseUpdates] = useState<Record<string, Partial<TestCase>>>({});

  // Evidence & Comment Modal State
  const [evidenceModal, setEvidenceModal] = useState<{ tc: ExecutableTestCase } | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [newLink, setNewLink] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  
  const [previewMedia, setPreviewMedia] = useState<{ url: string, type: 'image' | 'video', caseId?: string, scenarioId?: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const [jiraBugTestCase, setJiraBugTestCase] = useState<TestCase | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setActiveDropdownId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const excludedIds = useMemo(() => new Set(project.excludedFromExecutionIds || []), [project.excludedFromExecutionIds]);
  const activeExecutionFolderIds = useMemo(() => new Set(project.activeExecutionFolderIds || []), [project.activeExecutionFolderIds]);

  const allTestCases: ExecutableTestCase[] = useMemo(() => {
    const list: ExecutableTestCase[] = [];
    
    (project.scenarios || [])
      .filter(s => (s.scenarioId === 'MANUAL_FOLDER' || s.scenarioId === 'TESTCASE_FOLDER'))
      .forEach(s => {
        if (!activeExecutionFolderIds.has(s.id) || excludedIds.has(s.id)) return;
        
        const source: 'AI' | 'MANUAL' = s.scenarioId === 'TESTCASE_FOLDER' ? 'AI' : 'MANUAL';

        s.testCases.forEach(tc => {
            if (excludedIds.has(tc.id)) return;
            const updates = localTestCaseUpdates[`${s.id}_${tc.id}`] || {};
            const mergedCase: ExecutableTestCase = { 
              ...tc, 
              ...updates,
              scenarioId: s.id, 
              scenarioTitle: s.title, 
              source 
            };
            list.push(mergedCase);
        });
      });

    return list;
  }, [project, excludedIds, activeExecutionFolderIds, localTestCaseUpdates]);

  const searchedTestCases = useMemo(() => {
    if (!searchQuery.trim()) return allTestCases;
    const query = searchQuery.toLowerCase().trim();
    return allTestCases.filter(tc => 
      (tc.testCaseId || '').toLowerCase().includes(query) ||
      tc.scenarioTitle.toLowerCase().includes(query) ||
      tc.title.toLowerCase().includes(query) ||
      tc.expectedResult.toLowerCase().includes(query)
    );
  }, [allTestCases, searchQuery]);

  const groupedCases = useMemo((): GroupedCases => {
    const groups: GroupedCases = {};
    searchedTestCases.forEach(tc => {
      const groupKey = tc.scenarioTitle;
      if (!groups[groupKey]) {
          groups[groupKey] = {
              id: tc.scenarioId,
              source: tc.source,
              cases: []
          };
      }
      groups[groupKey].cases.push(tc);
    });
    return groups;
  }, [searchedTestCases]);

  // Update logic: When a specific folder is "Run", we auto-expand it instead of filtering others out.
  useEffect(() => {
    if (activeFolderId) {
      // Cast Object.entries to fix TS unknown error on group properties
      const groupEntry = (Object.entries(groupedCases) as [string, ExecutionGroup][]).find(([_, group]) => group.id === activeFolderId);
      if (groupEntry) {
        setExpandedGroups(prev => new Set([...Array.from(prev), groupEntry[0]]));
      }
    }
  }, [activeFolderId, groupedCases]);

  useEffect(() => {
    if (searchQuery.trim()) {
        setExpandedGroups(new Set(Object.keys(groupedCases)));
    }
  }, [searchQuery, groupedCases]);

  const handleUpdateStatus = (caseId: string, status: TestStatus, source: 'AI' | 'MANUAL', scenarioId?: string, updates: Partial<TestCase> = {}) => {
    const isReset = status === TestStatus.NOT_STARTED || status === TestStatus.NOT_EXECUTED;
    const executedAt = isReset ? undefined : new Date().toISOString();
    
    const apply = (tc: TestCase) => tc.id === caseId ? { ...tc, status, executedAt, ...updates } : tc;
    
    const updateKey = scenarioId ? `${scenarioId}_${caseId}` : caseId;
    setLocalTestCaseUpdates(prev => ({
      ...prev,
      [updateKey]: {
        ...(prev[updateKey] || {}),
        status,
        executedAt,
        ...updates
      }
    }));

    const updatedProject = { ...project };
    let targetCase: TestCase | undefined;

    updatedProject.scenarios = (project.scenarios || []).map(s => {
      if (scenarioId && s.id !== scenarioId) return s;
      const hasCase = s.testCases?.some(tc => tc.id === caseId);
      if (hasCase) {
        if (!targetCase) targetCase = s.testCases.find(tc => tc.id === caseId);
        return { ...s, testCases: s.testCases.map(apply) };
      }
      return s;
    });

    // Only update manualTestCases if no scenarioId is provided (global update)
    if (!scenarioId && project.manualTestCases) {
      const hasInManual = project.manualTestCases.some(tc => tc.id === caseId);
      if (hasInManual) {
        if (!targetCase) targetCase = project.manualTestCases.find(tc => tc.id === caseId);
        updatedProject.manualTestCases = project.manualTestCases.map(apply);
      }
    }
    
    onUpdateProject(updatedProject);

    if (targetCase) {
       logActivity(user.email, user.name, `Executed QA Check: ${targetCase.title} -> ${status}`, project.id, project.name);
    }
  };

  /**
   * Fix: Added handleDownloadFolder function to allow users to export the execution results of a folder to Excel.
   */
  const handleDownloadFolder = (folderName: string, cases: ExecutableTestCase[]) => {
    if (cases.length === 0) {
      alert("No test cases in this folder to export.");
      return;
    }

    const data = cases.map(tc => ({
      'Test Case ID': tc.testCaseId || 'N/A',
      'Folder': folderName,
      'Title': tc.title,
      'Steps': tc.steps.join('\n'),
      'Expected Result': tc.expectedResult,
      'Status': tc.status,
      'Comments': tc.comments || '',
      'Executed At': tc.executedAt ? new Date(tc.executedAt).toLocaleString() : 'NOT EXECUTED'
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Execution Results");
    const fileName = `${project.name.replace(/\s+/g, '_')}_${folderName.replace(/\s+/g, '_')}_Execution.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const executeDeletion = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'group') {
        // Clear local cache for cases in this group to ensure fresh state if re-added
        const group = groupedCases[deleteTarget.title];
        if (group) {
            const caseIds = group.cases.map(c => c.id);
            setLocalTestCaseUpdates(prev => {
                const next = { ...prev };
                caseIds.forEach(id => delete next[`${group.id}_${id}`]);
                return next;
            });
        }

        const updatedActiveFolders = (project.activeExecutionFolderIds || []).filter(id => id !== deleteTarget.id);
        onUpdateProject({ ...project, activeExecutionFolderIds: updatedActiveFolders });
    } else {
        const updatedExcludedIds = [...(project.excludedFromExecutionIds || []), deleteTarget.id];
        onUpdateProject({ ...project, excludedFromExecutionIds: updatedExcludedIds });
    }
    setDeleteTarget(null);
  };

  const toggleGroup = (name: string) => {
    const next = new Set(expandedGroups);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpandedGroups(next);
  };

  const openEvidenceModal = (tc: ExecutableTestCase) => {
    const sessionData = localTestCaseUpdates[`${tc.scenarioId}_${tc.id}`] || {};
    const mergedTc = { ...tc, ...sessionData };

    setEvidenceModal({ tc: mergedTc as ExecutableTestCase });
    setCommentInput(mergedTc.comments || '');
    setLinks(mergedTc.links || []);
    setAttachments(mergedTc.attachments || (mergedTc.evidence ? [mergedTc.evidence] : []));
    setNewLink('');
  };

  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_DIM = 800; // Aggressive downscaling
        if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) { height *= MAX_DIM / width; width = MAX_DIM; }
            else { width *= MAX_DIM / height; height = MAX_DIM; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.3)); // Low quality for extreme space savings
      };
      img.onerror = () => resolve(base64Str);
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const readers = Array.from(files).map((file: any) => {
      return new Promise<string>(async (resolve) => {
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
      setAttachments(prev => [...prev, ...results]);
      setIsUploading(false);
    }).catch(() => {
      setIsUploading(false);
    });
  };

  const handleAddLink = () => {
    const l = newLink.trim();
    if (!l) return;
    const finalLink = l.startsWith('http') ? l : `https://${l}`;
    setLinks(prev => [...prev, finalLink]);
    setNewLink('');
  };

  const saveEvidence = () => {
    if (!evidenceModal || isUploading) return;
    const { tc } = evidenceModal;
    
    // PRE-SAVE SIZE CHECK
    const totalSizeEstimate = estimateSize(project) + estimateSize(attachments);
    if (totalSizeEstimate > 980000) {
      alert("Workspace documentation limit reached (1MB). Please remove old performance reports or images before adding new evidence.");
      return;
    }

    handleUpdateStatus(tc.id, tc.status, tc.source, tc.scenarioId, {
      comments: commentInput,
      attachments: attachments,
      links: links,
      evidence: attachments.length > 0 ? attachments[0] : ''
    });
    
    setEvidenceModal(null);
  };

  const isVideo = (data: string) => data.startsWith('data:video') || data.toLowerCase().endsWith('.mp4') || data.toLowerCase().endsWith('.webm');

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      
      {previewMedia && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 md:p-12 animate-in fade-in duration-300" onClick={() => setPreviewMedia(null)}>
            <div className="absolute top-8 right-8 flex items-center gap-4 z-[5001]">
                <button className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all border border-white/20">
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

      {deleteTarget && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-md rounded-[2.5rem] p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <AlertTriangle size={32} className="text-red-500 mx-auto mb-6" />
            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-4">{deleteTarget.type === 'group' ? 'Remove Folder' : 'Exclude Case'}</h3>
            <p className="text-slate-500 text-sm mb-8">
              Remove <span className="font-bold text-slate-800">"{deleteTarget.title}"</span> from execution context?
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={executeDeletion} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700">Remove</button>
              <button onClick={() => setDeleteTarget(null)} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <JiraBugModal
        isOpen={!!jiraBugTestCase}
        onClose={() => setJiraBugTestCase(null)}
        project={project}
        testCase={jiraBugTestCase}
        user={user}
      />

      {evidenceModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-lg"><Paperclip size={24} /></div>
                        <div>
                            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Supporting Evidence</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Attach proofs, links and comments</p>
                        </div>
                    </div>
                    <button onClick={() => setEvidenceModal(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-full transition-all">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                    <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-1">Target Test Case</p>
                        <div className="flex items-center gap-2">
                           {evidenceModal.tc.testCaseId && <span className="text-[9px] font-black text-indigo-600 bg-white px-1.5 py-0.5 rounded border border-indigo-100">{evidenceModal.tc.testCaseId}</span>}
                           <p className="text-sm font-bold text-indigo-900 break-words whitespace-normal leading-relaxed" title={evidenceModal.tc.title}>{evidenceModal.tc.title}</p>
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3 flex items-center gap-2">
                            <MessageSquare size={14} className="text-indigo-400" /> Execution Comments
                        </label>
                        <textarea 
                            value={commentInput || ''}
                            onChange={(e) => setCommentInput(e.target.value)}
                            placeholder="Observations..."
                            className="w-full h-24 px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none shadow-inner"
                        />
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3 flex items-center gap-2">
                            <Link2 size={14} className="text-indigo-400" /> Reference Links (Jam, Jira etc)
                        </label>
                        <div className="flex gap-2 mb-4">
                           <input type="text" value={newLink || ''} onChange={e => setNewLink(e.target.value)} placeholder="e.g. Jira Ticket..." className="flex-1 px-5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none" onKeyDown={e => e.key === 'Enter' && handleAddLink()}/>
                           <button onClick={handleAddLink} className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 active:scale-95"><Plus size={20} /></button>
                        </div>
                        {links.length > 0 && (
                            <div className="space-y-2">
                                {links.map((link, lidx) => (
                                    <div key={lidx} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl group/link">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <ExternalLink size={12} className="text-slate-400 flex-shrink-0" /><a href={link} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-indigo-700 hover:underline truncate">{link}</a>
                                        </div>
                                        <button onClick={() => setLinks(prev => prev.filter((_, i) => i !== lidx))} className="p-1.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover/link:opacity-100"><X size={14} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3 flex items-center gap-2">
                            <Upload size={14} className="text-indigo-400" /> Evidence (Screenshot/Images)
                        </label>
                        <div 
                            onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.multiple = true;
                                input.accept = 'image/*,video/*';
                                input.onchange = (e) => handleFileSelect(e as any);
                                input.click();
                            }}
                            className={`border-2 border-dashed border-slate-200 rounded-[2rem] p-10 flex flex-col items-center justify-center gap-3 bg-slate-50 hover:bg-white hover:border-indigo-400 transition-all cursor-pointer group mb-6 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isUploading ? (
                                <div className="flex flex-col items-center gap-2"><Loader2 className="w-8 h-8 text-indigo-600 animate-spin" /><p className="text-[10px] font-black uppercase text-slate-400">Processing files...</p></div>
                            ) : (
                                <><div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-slate-300 group-hover:text-indigo-50 shadow-sm border border-slate-100"><Upload size={24} /></div><div className="center"><p className="text-xs font-bold text-slate-700 uppercase tracking-tight">Drop files or click to upload</p><p className="text-[9px] text-slate-400 font-bold uppercase mt-1">Aggressive Compression Applied</p></div></>
                            )}
                        </div>

                        {attachments.length > 0 && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-in slide-in-from-top-2">
                                {attachments.map((data, aidx) => (
                                    <div key={aidx} className="relative group/att rounded-2xl overflow-hidden aspect-video bg-slate-900 border border-slate-200 shadow-md">
                                        {isVideo(data) ? (
                                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-900 cursor-pointer" onClick={() => setPreviewMedia({ url: data, type: 'video' })}><FileVideo size={24} className="text-white/50" /><div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-all bg-indigo-600/20"><PlayCircle size={32} className="text-white" /></div></div>
                                        ) : (
                                            <img src={data || undefined} className="w-full h-full object-cover cursor-zoom-in group-hover/att:scale-110 transition-transform duration-500" onClick={() => setPreviewMedia({ url: data, type: 'image' })} alt="Evidence" />
                                        )}
                                        <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== aidx))} className="absolute top-2 right-2 p-1.5 bg-rose-500 text-white rounded-lg shadow-lg opacity-0 group-hover/att:opacity-100 transition-all z-10"><X size={12} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex gap-4">
                    <button onClick={saveEvidence} disabled={isUploading} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50">Save Evidence</button>
                    <button onClick={() => setEvidenceModal(null)} className="flex-1 py-4 bg-white text-slate-500 border border-slate-200 rounded-2xl font-black text-xs uppercase tracking-widest">Cancel</button>
                </div>
            </div>
        </div>
      )}

      <div className="bg-white p-8 md:p-10 rounded-[3rem] border border-slate-200 shadow-sm">
         <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-start md:items-center gap-6">
                <div className="p-5 bg-indigo-600 rounded-[1.5rem] text-white shadow-xl flex-shrink-0"><Activity size={28} /></div>
                <div>
                  <h3 className="text-2xl font-black text-black uppercase tracking-tight leading-none">Test Cases Execution</h3>
                  <p className="text-xs text-slate-500 font-bold mt-2 flex items-center gap-1.5 leading-relaxed">
                    <Info size={14} className="text-indigo-600 shrink-0" />
                    For execution add test cases from AI Test Cases page under Folders section by clicking on RUN FOLDER button
                  </p>
                </div>
            </div>
            <div className="relative group min-w-[320px]">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input type="text" placeholder="Search suites..." value={searchQuery || ''} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-12 pr-10 py-3.5 bg-slate-50 border border-slate-200 rounded-[1.2rem] text-sm focus:bg-white outline-none shadow-inner"/>
            </div>
         </div>
      </div>

      <div className="space-y-8">
        {Object.keys(groupedCases).length === 0 ? (
          <div className="py-20 text-center bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-8 flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center text-indigo-600 shadow-sm">
              <Folder size={32} />
            </div>
            <div className="max-w-lg">
              <h4 className="text-base font-black text-slate-800 uppercase tracking-tight mb-2">No Test Cases in Execution Queue</h4>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                For execution add test cases from AI Test Cases page under Folders section by clicking on <span className="text-indigo-600 font-black">RUN FOLDER</span> button
              </p>
            </div>
          </div>
        ) : (
          /* Cast Object.entries to fix TS unknown error on group properties */
          (Object.entries(groupedCases) as [string, ExecutionGroup][]).map(([groupName, group]) => {
          const cases = group.cases;
          const passed = cases.filter(c => c.status === TestStatus.PASS).length;
          const progress = cases.length > 0 ? (passed / cases.length) * 100 : 0;
          const isExpanded = expandedGroups.has(groupName);

          return (
            <div key={group.id} className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in slide-in-from-bottom-2 duration-500 group/group-card">
               <div className={`p-6 flex items-center justify-between transition-all ${isExpanded ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50 cursor-pointer'}`} onClick={(e) => { if ((e.target as HTMLElement).closest('.group-action')) return; toggleGroup(groupName); }}>
                  <div className="flex items-center gap-4">
                     <div className={`p-3 rounded-2xl ${isExpanded ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-300 group-hover:text-slate-400'}`}>{group.source === 'AI' ? <Folder size={20} /> : <FileText size={20} />}</div>
                     <div><div className="flex items-center gap-3"><h4 className="font-black text-slate-800 uppercase tracking-tight line-clamp-2 whitespace-normal">{groupName}</h4><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-white border border-slate-100 px-2 py-0.5 rounded shadow-sm">{group.source === 'AI' ? 'AI Suite' : 'Functional'}</span></div><div className="flex items-center gap-2 mt-1"><div className="w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} /></div><span className="text-[10px] font-black text-slate-400">{Math.round(progress)}% PASS</span></div></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDownloadFolder(groupName, cases); }} 
                      className="group-action p-2 text-slate-300 hover:text-indigo-600 hover:bg-white rounded-xl transition-all shadow-sm opacity-0 group-hover/group-card:opacity-100"
                    >
                      <Download size={18} />
                    </button>
                    <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                      <ChevronDown size={20} className="text-slate-400" />
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-8 space-y-6">
                    {cases.map((tc, idx) => (
                        <div key={tc.id} className={`group/case p-6 rounded-[2rem] border transition-all relative ${tc.status === TestStatus.PASS ? 'bg-emerald-50/20 border-emerald-100' : tc.status === TestStatus.FAIL ? 'bg-red-50/20 border-red-100' : tc.status === TestStatus.BLOCKED ? 'bg-amber-50/20 border-amber-100' : tc.status === TestStatus.NOT_STARTED ? 'bg-slate-50/40 border-slate-200' : 'bg-slate-50/40 border-slate-100 hover:bg-white hover:border-slate-200'}`}>
                          <div className="flex flex-col lg:flex-row gap-8">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-4 mb-4">
                                  <div className="w-10 h-10 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-xs font-black text-slate-400 shadow-sm">{idx + 1}</div>
                                  <div className="min-w-0">
                                     {tc.testCaseId && (
                                       <span className="text-[14px] font-black text-black uppercase tracking-widest inline-flex items-center gap-1 mb-1">
                                          Test case ID - {tc.testCaseId}
                                       </span>
                                     )}
                                     <h5 className="text-lg font-black text-slate-800 uppercase tracking-tight pr-10 break-words whitespace-normal leading-relaxed line-clamp-2" title={tc.title}>{tc.title}</h5>
                                  </div>
                                </div>
                                {(() => {
                                   const sc = project.scenarios.find(s => s.id === tc.scenarioId);
                                   const scPassword = sc?.password;
                                   return (
                                      <>
                                         <div className="bg-white/60 p-4 rounded-2xl border border-slate-100 mb-6 shadow-sm"><p className="text-[14px] font-black text-black uppercase tracking-widest mb-1">Expected Outcome</p><p className="text-xs text-indigo-950 font-bold leading-relaxed">{maskPasswordText(tc.expectedResult, scPassword)}</p></div>
                                         <div className="space-y-2 mb-6">{tc.steps.map((step, sidx) => (<div key={sidx} className="flex gap-3 text-[11px] text-slate-600 font-medium"><span className="text-slate-300 font-black">{sidx + 1}.</span><p className="break-words">{maskPasswordText(step, scPassword)}</p></div>))}</div>
                                      </>
                                   );
                                })()}
                                {tc.comments && (<div className="mb-4 p-4 bg-slate-50 border border-slate-100 rounded-2xl"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">QA Comments</p><p className="text-[11px] text-slate-600 italic">"{tc.comments}"</p></div>)}
                            </div>
                            <div className="lg:w-[320px] flex flex-col gap-4">
                                <div className="flex items-center justify-between px-1">
                                    <p className="text-[14px] font-black text-black uppercase tracking-[0.2em]">Execution Status</p>
                                </div>
                                <div className="relative">
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const dropdownKey = `${tc.scenarioId}_${tc.id}`;
                                            setActiveDropdownId(activeDropdownId === dropdownKey ? null : dropdownKey);
                                        }}
                                        className={`w-full py-3 px-4 rounded-2xl font-black text-[10px] uppercase transition-all border flex items-center justify-between gap-2 shadow-sm ${
                                            tc.status === TestStatus.PASS ? 'bg-emerald-500 text-white border-emerald-600' :
                                            tc.status === TestStatus.FAIL ? 'bg-red-500 text-white border-red-600' :
                                            tc.status === TestStatus.BLOCKED ? 'bg-amber-500 text-white border-amber-600' :
                                            'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {tc.status === TestStatus.PASS ? <CheckCircle2 size={14} /> :
                                             tc.status === TestStatus.FAIL ? <XCircle size={14} /> :
                                             tc.status === TestStatus.BLOCKED ? <Ban size={14} /> :
                                             <Clock size={14} />}
                                            <span>{tc.status === TestStatus.PASS ? 'Pass' : 
                                                   tc.status === TestStatus.FAIL ? 'Fail' : 
                                                   tc.status === TestStatus.BLOCKED ? 'Block' : 
                                                   'Not Started'}</span>
                                        </div>
                                        <ChevronDown size={14} className={`transition-transform duration-200 ${activeDropdownId === `${tc.scenarioId}_${tc.id}` ? 'rotate-180' : ''}`} />
                                    </button>

                                    {activeDropdownId === `${tc.scenarioId}_${tc.id}` && (
                                        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                            <button 
                                                onClick={() => {
                                                    handleUpdateStatus(tc.id, TestStatus.PASS, tc.source, tc.scenarioId);
                                                    setActiveDropdownId(null);
                                                }}
                                                className="w-full px-4 py-3 text-left hover:bg-emerald-50 flex items-center gap-3 transition-colors group/opt"
                                            >
                                                <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg group-hover/opt:bg-emerald-500 group-hover/opt:text-white transition-all"><CheckCircle2 size={12} /></div>
                                                <span className="text-[10px] font-black uppercase text-slate-600 group-hover/opt:text-emerald-700">Pass</span>
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    handleUpdateStatus(tc.id, TestStatus.FAIL, tc.source, tc.scenarioId);
                                                    setActiveDropdownId(null);
                                                }}
                                                className="w-full px-4 py-3 text-left hover:bg-red-50 flex items-center gap-3 transition-colors group/opt"
                                            >
                                                <div className="p-1.5 bg-red-100 text-red-600 rounded-lg group-hover/opt:bg-red-500 group-hover/opt:text-white transition-all"><XCircle size={12} /></div>
                                                <span className="text-[10px] font-black uppercase text-slate-600 group-hover/opt:text-red-700">Fail</span>
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    handleUpdateStatus(tc.id, TestStatus.BLOCKED, tc.source, tc.scenarioId);
                                                    setActiveDropdownId(null);
                                                }}
                                                className="w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors group/opt"
                                            >
                                                <div className="p-1.5 bg-amber-100 text-amber-600 rounded-lg group-hover/opt:bg-amber-500 group-hover/opt:text-white transition-all"><Ban size={12} /></div>
                                                <span className="text-[10px] font-black uppercase text-slate-600 group-hover/opt:text-amber-700">Block</span>
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    handleUpdateStatus(tc.id, TestStatus.NOT_STARTED, tc.source, tc.scenarioId);
                                                    setActiveDropdownId(null);
                                                }}
                                                className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center gap-3 transition-colors group/opt"
                                            >
                                                <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg group-hover/opt:bg-slate-500 group-hover/opt:text-white transition-all"><Clock size={12} /></div>
                                                <span className="text-[10px] font-black uppercase text-slate-600 group-hover/opt:text-slate-700">Not Started</span>
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {tc.status === TestStatus.FAIL && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const sessionData = localTestCaseUpdates[`${tc.scenarioId}_${tc.id}`] || {};
                                      setJiraBugTestCase({ ...tc, ...sessionData });
                                    }}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-wider transition-all shadow-md shadow-rose-100 cursor-pointer"
                                  >
                                    <AlertTriangle size={14} /> Create a bug in JIRA
                                  </button>
                                )}

                                <div className="flex-1 bg-white border border-slate-100 rounded-2xl p-4 flex flex-col items-center justify-center gap-3 relative overflow-hidden group/ev">
                                      {tc.attachments && tc.attachments.length > 0 ? (
                                        <div className="absolute inset-0 z-10">{isVideo(tc.attachments[0]) ? (<div className="w-full h-full bg-slate-900 flex items-center justify-center cursor-zoom-in" onClick={() => setPreviewMedia({ url: tc.attachments![0], type: 'video', caseId: tc.id, scenarioId: tc.scenarioId })}><FileVideo size={40} className="text-white/20" /><div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/ev:opacity-100 transition-opacity bg-black/40"><PlayCircle size={32} className="text-white" /></div></div>) : (<img src={tc.attachments[0] || undefined} className="w-full h-full object-cover transition-all cursor-zoom-in hover:scale-110" onClick={() => setPreviewMedia({ url: tc.attachments[0], type: 'image', caseId: tc.id, scenarioId: tc.scenarioId })} alt="Evidence" />)}<div className="absolute top-2 left-2 flex items-center gap-1 opacity-0 group-hover/ev:opacity-100 transition-opacity"><button onClick={(e) => { e.stopPropagation(); openEvidenceModal(tc); }} className="p-1.5 bg-white text-indigo-600 rounded-lg shadow-lg hover:bg-indigo-50"><Pencil size={12} /></button></div></div>
                                      ) : (<><button onClick={() => openEvidenceModal(tc)} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl font-black text-[9px] uppercase border border-indigo-100 hover:bg-indigo-100"><Paperclip size={14} /> Evidence</button></>)}
                                </div>

                                {tc.links && tc.links.length > 0 && (
                                  <div className="space-y-2">
                                    {tc.links.map((link, lidx) => (
                                      <a 
                                        key={lidx} 
                                        href={link} 
                                        target="_blank" 
                                        rel="noopener noreferrer" 
                                        className="flex items-center gap-2 p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl text-[10px] font-bold text-indigo-600 uppercase hover:bg-indigo-100 transition-all group/link"
                                      >
                                        <Link2 size={12} />
                                        <span className="truncate flex-1">{link}</span>
                                        <ExternalLink size={10} className="opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                      </a>
                                    ))}
                                  </div>
                                )}
                            </div>
                          </div>
                        </div>
                    ))}
                  </div>
                )}
            </div>
          );
        })
      )}
      </div>
    </div>
  );
};

export default ExecutionPanel;