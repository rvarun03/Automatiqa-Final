import React, { useState, useEffect } from 'react';
import { Project, AutomationScript, TestCase } from '../types';
import { X, Sparkles, AlertCircle, Link2, CheckCircle2, Loader2, Paperclip, MessageSquare, ExternalLink, Image as ImageIcon, FileVideo } from 'lucide-react';
import { parseApiResponse } from '../services/apiUtils';

interface JiraBugModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  script?: AutomationScript | null;
  testCase?: TestCase | null;
  customTitle?: string;
  customDescription?: string;
  customAttachments?: string[];
  customLinks?: string[];
  customComments?: string;
  user?: { name: string, email: string; role?: any } | null;
}

export const JiraBugModal: React.FC<JiraBugModalProps> = ({
  isOpen,
  onClose,
  project,
  script = null,
  testCase = null,
  customTitle = '',
  customDescription = '',
  customAttachments = [],
  customLinks = [],
  customComments = '',
  user = null
}) => {
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [severity, setSeverity] = useState('Major');

  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; key?: string; bugUrl?: string; error?: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const tcAttachments = customAttachments.length > 0
    ? customAttachments
    : (script?.evidence ? [script.evidence] : (testCase?.attachments && testCase.attachments.length > 0 ? testCase.attachments : (testCase?.evidence ? [testCase.evidence] : [])));

  const tcLinks = customLinks.length > 0
    ? customLinks
    : (script?.evidenceUrl ? [script.evidenceUrl] : (testCase?.links || []));

  const tcComments = customComments || testCase?.comments || '';

  useEffect(() => {
    if (customTitle) {
      setIssueTitle(customTitle);
      setIssueDescription(customDescription || '');
      setPriority('High');
      setResult(null);
    } else if (script && project) {
      setIssueTitle(`[FAIL] ${script.title || 'Automation Run'} - Test Run Failure`);
      let scriptDesc = 
        `AutomatiQA Failure Report\n` +
        `----------------------------------------\n` +
        `Script: ${script.title || 'Artifact'}\n` +
        `Framework: ${script.tool} (${script.language})\n` +
        `Created on: ${new Date(script.createdAt).toLocaleDateString('en-GB')}\n\n` +
        `Description: ${script.description || 'Automation Script Execution Failure'}\n\n`;

      if (script.evidenceUrl) {
        scriptDesc += `Reference Evidence URL: ${script.evidenceUrl}\n\n`;
      }
      if (script.evidence) {
        scriptDesc += `Attached Evidences: 1 file(s) attached to this bug report.\n\n`;
      }
      scriptDesc += `Recommended Fix: Check selector availability and verify site server and database synchronization responses.`;

      setIssueDescription(scriptDesc);
      setPriority(script.lastExecutionStatus === 'FAILURE' || script.lastExecutionStatus === 'FAIL' ? 'High' : 'Medium');
      setResult(null);
    } else if (testCase && project) {
      const stepsText = testCase.steps && testCase.steps.length > 0
        ? testCase.steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')
        : '1. Executed specified manual steps.';

      const attachmentsCount = tcAttachments.length;

      let desc = `AutomatiQA Functional Test Case Failure Report\n` +
        `----------------------------------------\n` +
        `Test Case ID: ${testCase.testCaseId || 'N/A'}\n` +
        `Title: ${testCase.title}\n` +
        `Type: ${testCase.testType || 'Functional'}\n` +
        `Priority: ${testCase.priority || 'Medium'}\n\n` +
        `Steps to Reproduce:\n` +
        `${stepsText}\n\n` +
        `Expected Result: ${testCase.expectedResult}\n`;

      if (testCase.actualResult) {
        desc += `Actual Result: ${testCase.actualResult}\n`;
      }
      if (tcComments) {
        desc += `\nExecution Comments:\n${tcComments}\n`;
      }
      if (tcLinks.length > 0) {
        desc += `\nReference Links:\n` + tcLinks.map((l, i) => `${i + 1}. ${l}`).join('\n') + `\n`;
      }
      if (attachmentsCount > 0) {
        desc += `\nAttached Evidences: ${attachmentsCount} file(s) attached to this bug report.\n`;
      }
      desc += `\nReported via Functional Test Execution page.`;

      setIssueTitle(`[FAIL] ${testCase.testCaseId || 'TC'} - ${testCase.title}`);
      setIssueDescription(desc);
      setPriority(testCase.priority === 'High' ? 'High' : testCase.priority === 'Low' ? 'Low' : 'Medium');
      setResult(null);
    }
  }, [script, testCase, project, customTitle, customDescription]);

  if (!isOpen || (!script && !testCase && !customTitle)) return null;

  const jiraConfig = project.jiraConfig;
  const isConfigured = jiraConfig && jiraConfig.jiraUrl && jiraConfig.email && jiraConfig.apiToken && jiraConfig.projectKey;

  const handlePostBug = async () => {
    if (!isConfigured) return;
    setPosting(true);
    setResult(null);

    try {
      const response = await fetch('/api/integration/jira/post-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          projectName: project.name,
          jiraConfig: project.jiraConfig,
          slackConfig: project.slackConfig,
          issueTitle,
          issueDescription,
          priority,
          severity,
          reporter: user ? (user.name || user.email) : 'QA Engineer',
          attachments: tcAttachments,
          links: tcLinks,
          comments: tcComments
        })
      });

      const parsed = await parseApiResponse(response);
      if (parsed.ok && parsed.data?.success) {
        setResult({
          success: true,
          key: parsed.data.key,
          bugUrl: parsed.data.bugUrl
        });
      } else {
        setResult({
          success: false,
          error: parsed.error || 'Jira ticket creation failed.'
        });
      }
    } catch (err: any) {
      setResult({
        success: false,
        error: err.message || 'Error occurred while contacting backend'
      });
    } finally {
      setPosting(false);
    }
  };

  const isVideo = (data: string) => data.startsWith('data:video') || data.toLowerCase().endsWith('.mp4') || data.toLowerCase().endsWith('.webm');

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[7000] p-4 animate-in fade-in duration-200">
      
      {/* Zoomed Evidence Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-6" onClick={() => setPreviewImage(null)}>
          <button onClick={() => setPreviewImage(null)} className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all">
            <X size={28} />
          </button>
          <img src={previewImage || undefined} className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl" alt="Evidence Large Preview" />
        </div>
      )}

      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
        
        {/* Header decoration banner */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-800 p-6 text-white flex items-center justify-between border-b/10 shrink-0">
          <div className="flex items-center gap-3">
            <Sparkles size={18} className="text-yellow-300 animate-pulse" />
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Create Jira Bug Ticket</h3>
              <p className="text-[10px] text-indigo-200 font-bold uppercase tracking-widest mt-0.5">Publish incident to engineer dashboard</p>
            </div>
          </div>
          <button onClick={onClose} className="text-indigo-200 hover:text-white p-1 hover:bg-white/10 rounded-full transition-all cursor-pointer"><X size={18} /></button>
        </div>

        {/* Modal Form */}
        <div className="p-8 space-y-5 bg-white overflow-y-auto custom-scrollbar flex-1">
          {!isConfigured ? (
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto border border-rose-100"><AlertCircle size={24} /></div>
              <h4 className="text-xs font-black uppercase tracking-wider text-rose-800">Jira Integration Missing</h4>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed">This project is not linked to Atlassian Jira. Head to Settings &gt; Jira Integration to connect credentials first.</p>
            </div>
          ) : result && result.success ? (
            <div className="p-6 text-center space-y-4 animate-in zoom-in-95 duration-200">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto border border-emerald-100"><CheckCircle2 size={30} /></div>
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-800">Incident Reported!</h4>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed">Jira Bug Ticket <strong>{result.key}</strong> has been logged inside project {jiraConfig.projectKey} successfully with all evidences attached.</p>
              
              {result.bugUrl && (
                <a 
                  href={result.bugUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-md transition-all pt-3.5"
                >
                  <Link2 size={14} /> View Bug Issue in Jira
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {result && !result.error && (
                <div className="p-4 bg-rose-50 border border-rose-100 text-rose-800 rounded-2xl flex gap-2">
                  <AlertCircle size={18} className="text-rose-500 mt-0.5 shrink-0" />
                  <div>
                    <h5 className="text-[10px] font-black uppercase tracking-wider text-rose-800">API Post Error</h5>
                    <p className="text-[11px] font-semibold leading-relaxed mt-0.5">{result.error}</p>
                  </div>
                </div>
              )}

              {/* Status parameters */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Jira Workspace</p>
                  <p className="text-xs font-bold text-slate-800 truncate mt-0.5">{jiraConfig.jiraUrl.replace(/^https?:\/\//i, '')}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Project Key</p>
                  <p className="text-xs font-bold text-slate-800 truncate mt-0.5">{jiraConfig.projectKey}</p>
                </div>
              </div>

              {/* Ticket title input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Bug Summary Title</label>
                <input
                  type="text"
                  value={issueTitle || ''}
                  onChange={(e) => setIssueTitle(e.target.value)}
                  placeholder="e.g. Fail to login under staging"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              {/* Priority Select */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Bug Priority</label>
                  <select
                    value={priority || ''}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Bug Severity</label>
                  <select
                    value={severity || ''}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
                  >
                    <option value="Critical">Critical</option>
                    <option value="Major">Major</option>
                    <option value="Minor">Minor</option>
                    <option value="Trivial">Trivial</option>
                  </select>
                </div>
              </div>

              {/* Description input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Reproduction Steps & Description</label>
                <textarea
                  value={issueDescription || ''}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  rows={4}
                  placeholder="Steps..."
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white resize-none font-mono"
                />
              </div>

              {/* Evidences & Proof Preview Section */}
              {(tcAttachments.length > 0 || tcLinks.length > 0 || tcComments) && (
                <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-indigo-700">
                    <Paperclip size={14} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Attached Execution Evidences ({tcAttachments.length} files, {tcLinks.length} links)</span>
                  </div>

                  {tcComments && (
                    <div className="p-3 bg-white border border-indigo-100 rounded-xl text-xs text-slate-700 font-medium">
                      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                        <MessageSquare size={12} />
                        <span className="text-[9px] font-black uppercase tracking-widest">Execution Comments</span>
                      </div>
                      <p className="whitespace-pre-wrap">{tcComments}</p>
                    </div>
                  )}

                  {tcLinks.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Reference Links</p>
                      <div className="flex flex-wrap gap-2">
                        {tcLinks.map((link, lidx) => (
                          <a
                            key={lidx}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-indigo-100 rounded-lg text-[11px] font-bold text-indigo-600 hover:underline"
                          >
                            <Link2 size={12} />
                            <span className="max-w-[200px] truncate">{link}</span>
                            <ExternalLink size={10} />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {tcAttachments.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Evidence Screenshots / Proofs</p>
                      <div className="grid grid-cols-3 gap-2">
                        {tcAttachments.map((att, aidx) => (
                          <div
                            key={aidx}
                            onClick={() => !isVideo(att) && setPreviewImage(att)}
                            className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden border border-indigo-100 cursor-pointer group shadow-sm"
                          >
                            {isVideo(att) ? (
                              <div className="w-full h-full flex items-center justify-center text-white/50 bg-slate-900">
                                <FileVideo size={20} />
                              </div>
                            ) : (
                              <img
                                src={att}
                                alt={`Evidence ${aidx + 1}`}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                              />
                            )}
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[9px] font-black uppercase">
                              Zoom
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex gap-3 pt-4 border-t border-slate-100 justify-end shrink-0">
            <button 
              onClick={onClose}
              className="px-5 py-3 border border-slate-200 text-slate-500 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all cursor-pointer"
            >
              {result?.success ? 'Dismiss' : 'Cancel'}
            </button>
            {isConfigured && (!result || !result.success) && (
              <button 
                onClick={handlePostBug}
                disabled={posting || !issueTitle || !issueDescription}
                className="px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md shadow-rose-100 flex items-center justify-center gap-2 cursor-pointer"
              >
                {posting ? <Loader2 size={14} className="animate-spin" /> : null}
                {posting ? 'Logging Bug...' : 'Create Jira Bug'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

