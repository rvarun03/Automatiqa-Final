import { AlertTriangle, Activity, Beaker, Braces, CheckSquare, ChevronDown, ChevronRight, Clock, Code, Cpu, Database, Download, Edit2, Eye, FileCode, FileJson, FileText, Fingerprint, Folder as FolderIcon, FolderOpen, FolderPlus, Globe, HelpCircle, Info, Key, Layers, Link2, Loader2, Lock, MessageSquare, MoreHorizontal, MoreVertical, Network, Pencil, Plus, PlusCircle as PlusIcon, PlusCircle, PlusSquare, Save, Send, Shield, ShieldAlert, ShieldCheck, Sparkles, Square, Terminal, Trash2, User as UserIcon, X, Zap, ExternalLink, Check } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { generateScenariosFromApiResponse } from '../geminiService';
import { logActivity } from '../services/activityService';
import { ragEnrichPrompt, indexSingleItem } from '../services/ragService';
import { RAGStatusBadge } from './RAGStatusBadge';
import { VectorSearchResult } from '../types';
import { ApiAuth, ApiCollection, ApiFolder, ApiRequest, ApiRequestHeader, ApiResponse, ApiWorkspace, Project, TestScenario, User } from '../types';

interface ApiTestingProps {
  project: Project;
  user: User;
  onUpdateProject: (p: Project) => void;
}

type ActionType = 'create-collection' | 'create-folder' | 'create-request' | 'rename-workspace' | 'rename-collection' | 'rename-folder' | 'rename-request';

interface ActionConfig {
  type: ActionType;
  workspaceId: string;
  collectionId?: string;
  folderId?: string;
  requestId?: string;
  title: string;
  subtitle: string;
  placeholder: string;
}

const KeyValueTable = ({ items, onUpdate, onDelete, onAdd }: { items: ApiRequestHeader[], onUpdate: (id: string, field: 'key' | 'value' | 'enabled', value: any) => void, onDelete: (id: string) => void, onAdd: () => void }) => (
  <div className="w-full flex flex-col h-full overflow-hidden">
    <div className="grid grid-cols-[40px_1fr_1fr_40px] gap-2 px-2 py-2 text-[9px] font-black text-black uppercase tracking-widest border-b border-slate-100 flex-shrink-0">
      <div className="text-center">Use</div><div>Key</div><div>Value</div><div className="text-right">Action</div>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[40px_1fr_1fr_40px] gap-2 items-center px-1 group mb-1">
          <div className="flex justify-center">
            <button onClick={() => onUpdate(item.id, 'enabled', !item.enabled)} className={`transition-all ${item.enabled ? 'text-indigo-600' : 'text-slate-200'}`}>
              {item.enabled ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
          </div>
          <input value={item.key || ''} onChange={e => onUpdate(item.id, 'key', e.target.value)} placeholder="Key" className="bg-transparent text-xs font-bold border-b border-transparent focus:border-slate-200 outline-none px-2 py-1.5 w-full" />
          <input value={item.value || ''} onChange={e => onUpdate(item.id, 'value', e.target.value)} placeholder="Value" className="bg-transparent text-xs font-medium border-b border-transparent focus:border-slate-200 outline-none px-2 py-1.5 w-full" />
          <button onClick={() => onDelete(item.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 transition-all text-right flex justify-end"><Trash2 size={14}/></button>
        </div>
      ))}
      <div className="px-10 py-3">
        <button onClick={onAdd} className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-500 hover:text-indigo-700 transition-colors"><PlusIcon size={14} strokeWidth={3} /> Add New Row</button>
      </div>
    </div>
  </div>
);

const AuthEditor = ({ auth, setAuth }: { auth: ApiAuth, setAuth: (a: ApiAuth) => void }) => {
  const authOptions = [
    { id: 'noauth', label: 'No Auth', icon: <Shield size={14} /> },
    { id: 'bearer', label: 'Bearer Token', icon: <Key size={14} /> },
    { id: 'apikey', label: 'API Key', icon: <Lock size={14} /> },
    { id: 'basic', label: 'Basic Auth', icon: <UserIcon size={14} /> },
    { id: 'oauth1', label: 'OAuth 1.0', icon: <Fingerprint size={14} /> },
    { id: 'oauth2', label: 'OAuth 2.0', icon: <Braces size={14} /> },
  ];

  const currentAuthType = auth.type || 'noauth';

  return (
    <div className="h-full flex flex-col gap-6 animate-in fade-in duration-300 overflow-hidden">
      <div className="flex flex-col gap-2 flex-shrink-0">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Auth Type</label>
        <div className="relative group max-w-sm">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-500">
            {authOptions.find(o => o.id === currentAuthType)?.icon}
          </div>
          <select 
            value={currentAuthType || ''}
            onChange={(e) => setAuth({ ...auth, type: e.target.value as any })}
            className="w-full pl-12 pr-10 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest outline-none appearance-none cursor-pointer transition-all hover:bg-white shadow-inner"
          >
            {authOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>
      </div>

      <div className="flex-1 bg-slate-50/50 rounded-[2rem] border border-slate-100 p-8 overflow-y-auto custom-scrollbar shadow-inner">
         {currentAuthType === 'noauth' && (
           <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
              <Shield size={48} className="text-slate-300 mb-4" />
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">This request does not use any authorization.</p>
           </div>
         )}

         {currentAuthType === 'bearer' && (
           <div className="space-y-6 max-w-lg animate-in slide-in-from-left-2">
              <div className="flex items-center gap-3 text-indigo-600 mb-2">
                 <Key size={18} />
                 <h4 className="text-xs font-black uppercase tracking-widest">Bearer Token</h4>
              </div>
              <textarea 
                value={auth.bearerToken || ''} 
                onChange={e => setAuth({...auth, bearerToken: e.target.value})} 
                className="w-full h-32 px-5 py-4 bg-white border border-slate-200 rounded-2xl text-sm font-mono focus:ring-2 ring-indigo-500 outline-none transition-all resize-none shadow-inner" 
                placeholder="Enter auth token here..." 
              />
           </div>
         )}

         {currentAuthType === 'apikey' && (
           <div className="space-y-6 max-w-lg animate-in slide-in-from-left-2">
              <div className="flex items-center gap-3 text-indigo-600 mb-2">
                 <Lock size={18} />
                 <h4 className="text-xs font-black uppercase tracking-widest">API Key</h4>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Key Name</label>
                    <input value={auth.apiKeyKey || ''} onChange={e => setAuth({...auth, apiKeyKey: e.target.value})} className="w-full px-5 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold outline-none shadow-sm transition-all focus:ring-2 ring-indigo-50" placeholder="e.g. x-api-key" />
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Value</label>
                    <input value={auth.apiKeyValue || ''} onChange={e => setAuth({...auth, apiKeyValue: e.target.value})} className="w-full px-5 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold outline-none shadow-sm transition-all focus:ring-2 ring-indigo-50" placeholder="Value" />
                 </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Add To</label>
                <div className="flex gap-2">
                  {['header', 'query'].map(loc => (
                    <button key={loc} onClick={() => setAuth({...auth, apiKeyLocation: loc as any})} className={`flex-1 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${auth.apiKeyLocation === loc ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-200'}`}>{loc}</button>
                  ))}
                </div>
              </div>
           </div>
         )}

         {currentAuthType === 'basic' && (
           <div className="space-y-6 max-w-md animate-in slide-in-from-left-2">
              <div className="flex items-center gap-3 text-indigo-600 mb-2">
                 <UserIcon size={18} />
                 <h4 className="text-xs font-black uppercase tracking-widest">Basic Authentication</h4>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Username</label>
                    <input value={auth.basicUsername || ''} onChange={e => setAuth({...auth, basicUsername: e.target.value})} className="w-full px-5 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 ring-indigo-50 transition-all shadow-sm" placeholder="Username" />
                </div>
                <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Password</label>
                    <input type="password" value={auth.basicPassword || ''} onChange={e => setAuth({...auth, basicPassword: e.target.value})} className="w-full px-5 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 ring-indigo-50 transition-all shadow-sm" placeholder="Password" />
                </div>
              </div>
           </div>
         )}

         {currentAuthType === 'oauth1' && (
           <div className="space-y-6 max-w-lg animate-in slide-in-from-left-2">
              <div className="flex items-center gap-3 text-indigo-600 mb-2">
                 <Fingerprint size={18} />
                 <h4 className="text-xs font-black uppercase tracking-widest">OAuth 1.0</h4>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Consumer Key</label>
                  <input value={auth.oauth1ConsumerKey || ''} onChange={e => setAuth({...auth, oauth1ConsumerKey: e.target.value})} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold shadow-sm" placeholder="Consumer Key" />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Consumer Secret</label>
                  <input type="password" value={auth.oauth1ConsumerSecret || ''} onChange={e => setAuth({...auth, oauth1ConsumerSecret: e.target.value})} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold shadow-sm" placeholder="Consumer Secret" />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Access Token</label>
                  <input value={auth.oauth1Token || ''} onChange={e => setAuth({...auth, oauth1Token: e.target.value})} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold shadow-sm" placeholder="Access Token" />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Token Secret</label>
                  <input type="password" value={auth.oauth1TokenSecret || ''} onChange={e => setAuth({...auth, oauth1TokenSecret: e.target.value})} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold shadow-sm" placeholder="Token Secret" />
                </div>
              </div>
           </div>
         )}

         {currentAuthType === 'oauth2' && (
           <div className="space-y-6 max-w-lg animate-in slide-in-from-left-2">
              <div className="flex items-center gap-3 text-indigo-600 mb-2">
                 <Braces size={18} />
                 <h4 className="text-xs font-black uppercase tracking-widest">OAuth 2.0</h4>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Access Token</label>
                <textarea 
                  value={auth.oauth2AccessToken || ''} 
                  onChange={e => setAuth({...auth, oauth2AccessToken: e.target.value})} 
                  className="w-full h-24 px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-mono outline-none shadow-inner" 
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Add Token To</label>
                <div className="flex gap-2">
                  {['header', 'query'].map(loc => (
                    <button key={loc} onClick={() => setAuth({...auth, oauth2AddTokenTo: loc as any})} className={`flex-1 px-4 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${auth.oauth2AddTokenTo === loc ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-200'}`}>{loc}</button>
                  ))}
                </div>
              </div>
           </div>
         )}
      </div>
    </div>
  );
};

const BodyEditor = ({ 
  bodyType, setBodyType, rawLanguage, setRawLanguage, body, setBody, formData, setFormData 
}: { 
  bodyType: 'none' | 'form-data' | 'raw', 
  setBodyType: (t: 'none' | 'form-data' | 'raw') => void, 
  rawLanguage: string, 
  setRawLanguage: (l: any) => void, 
  body: string, 
  setBody: (b: string) => void, 
  formData: ApiRequestHeader[], 
  setFormData: (f: ApiRequestHeader[]) => void 
}) => {
  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden animate-in fade-in duration-300">
      <div className="flex items-center gap-6 px-3 border-b border-slate-100 pb-4 flex-shrink-0">
        <label className="flex items-center gap-2 cursor-pointer group">
          <input type="radio" name="bodyType" checked={bodyType === 'none'} onChange={() => setBodyType('none')} className="hidden" />
          <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${bodyType === 'none' ? 'border-indigo-600' : 'border-slate-300'}`}>
            {bodyType === 'none' && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest ${bodyType === 'none' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`}>None</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer group">
          <input type="radio" name="bodyType" checked={bodyType === 'form-data'} onChange={() => setBodyType('form-data')} className="hidden" />
          <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${bodyType === 'form-data' ? 'border-indigo-600' : 'border-slate-300'}`}>
            {bodyType === 'form-data' && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest ${bodyType === 'form-data' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`}>Form-data</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer group">
          <input type="radio" name="bodyType" checked={bodyType === 'raw'} onChange={() => setBodyType('raw')} className="hidden" />
          <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${bodyType === 'raw' ? 'border-indigo-600' : 'border-slate-300'}`}>
            {bodyType === 'raw' && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest ${bodyType === 'raw' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`}>Raw</span>
        </label>
        
        {bodyType === 'raw' && (
          <div className="ml-auto flex items-center gap-3">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Format</label>
            <select 
              value={rawLanguage || 'JSON'} 
              onChange={(e) => setRawLanguage(e.target.value as any)}
              className="bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer border border-indigo-100"
            >
              <option value="JSON">JSON</option>
              <option value="Text">TEXT</option>
              <option value="HTML">HTML</option>
              <option value="JavaScript">JavaScript</option>
              <option value="XML">XML</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {bodyType === 'none' && (
          <div className="h-full flex flex-col items-center justify-center opacity-30 text-slate-400 text-center space-y-4">
            <ShieldAlert size={48} />
            <p className="text-[11px] font-black uppercase tracking-widest">This request does not send a body payload</p>
          </div>
        )}
        
        {bodyType === 'form-data' && (
          <div className="h-full border rounded-[1.5rem] bg-slate-50/30 overflow-hidden">
            <KeyValueTable 
              items={formData} 
              onUpdate={(id, f, v) => setFormData(formData.map(item => item.id === id ? { ...item, [f]: v } : item))} 
              onDelete={(id) => setFormData(formData.filter(item => item.id !== id))} 
              onAdd={() => setFormData([...formData, { id: Math.random().toString(36).substr(2, 9), key: '', value: '', enabled: true }])} 
            />
          </div>
        )}

        {bodyType === 'raw' && (
          <div className="h-full relative group">
            <div className="absolute top-4 right-6 pointer-events-none flex items-center gap-2 opacity-40 group-hover:opacity-100 transition-opacity">
              <Terminal size={14} className="text-indigo-400" />
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{rawLanguage} Syntax Mode</span>
            </div>
            <textarea 
              value={body || ''} 
              onChange={e => setBody(e.target.value)} 
              className="w-full h-full p-8 bg-slate-900 text-emerald-400 font-mono text-[13px] rounded-[2rem] resize-none outline-none shadow-2xl leading-relaxed border border-slate-800"
              placeholder={rawLanguage === 'JSON' ? '{\n  "key": "value"\n}' : `Enter ${rawLanguage} content here...`}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const ScriptsEditor = ({ 
  activeScriptType, setActiveScriptType, preRequestScript, setPreRequestScript, postResponseScript, setPostResponseScript 
}: { 
  activeScriptType: 'pre' | 'post', 
  setActiveScriptType: (t: 'pre' | 'post') => void, 
  preRequestScript: string, 
  setPreRequestScript: (s: string) => void, 
  postResponseScript: string, 
  setPostResponseScript: (s: string) => void 
}) => {
  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden animate-in fade-in duration-300">
      <div className="flex items-center gap-3 px-3 border-b border-slate-100 pb-4 flex-shrink-0">
        <button 
          onClick={() => setActiveScriptType('pre')}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeScriptType === 'pre' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600 bg-slate-50'}`}
        >
          Pre-request Script
        </button>
        <button 
          onClick={() => setActiveScriptType('post')}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeScriptType === 'post' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600 bg-slate-50'}`}
        >
          Post-response Script
        </button>
        
        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100">
           <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
           <span className="text-[9px] font-black uppercase text-emerald-600 tracking-widest">Sandboxed JS Runtime</span>
        </div>
      </div>

      <div className="flex-1 relative group overflow-hidden">
         <div className="absolute top-4 right-6 pointer-events-none flex items-center gap-2 opacity-40 group-hover:opacity-100 transition-opacity z-10">
            <Code size={14} className="text-indigo-400" />
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
              {activeScriptType === 'pre' ? 'Request Hooks' : 'Validation Hooks'}
            </span>
         </div>
         <textarea 
           value={(activeScriptType === 'pre' ? preRequestScript : postResponseScript) || ''}
           onChange={e => activeScriptType === 'pre' ? setPreRequestScript(e.target.value) : setPostResponseScript(e.target.value)}
           className="w-full h-full p-8 bg-slate-900 text-emerald-400 font-mono text-[13px] rounded-[2rem] resize-none outline-none shadow-2xl leading-relaxed border border-slate-800"
           placeholder={activeScriptType === 'pre' 
             ? "// This script executes BEFORE the request is sent.\n// pm.environment.set('timestamp', new Date().toISOString());" 
             : "// This script executes AFTER the response is received.\n// pm.test('Status code is 200', () => {\n//    pm.response.to.have.status(200);\n// });"
           }
         />
      </div>
    </div>
  );
};

const ApiTesting: React.FC<ApiTestingProps> = ({ project, user, onUpdateProject }) => {
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<ApiRequestHeader[]>([]);
  const [params, setParams] = useState<ApiRequestHeader[]>([]);
  const [body, setBody] = useState('{\n  \n}');
  const [bodyType, setBodyType] = useState<'none' | 'form-data' | 'raw'>('raw');
  const [rawLanguage, setRawLanguage] = useState<'JSON' | 'Text' | 'HTML' | 'XML' | 'JavaScript'>('JSON');
  const [formData, setFormData] = useState<ApiRequestHeader[]>([]);
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [expectedResults, setExpectedResults] = useState('');
  const [refineInstructions, setRefineInstructions] = useState('');
  
  const [preRequestScript, setPreRequestScript] = useState('');
  const [postResponseScript, setPostResponseScript] = useState('');
  const [auth, setAuth] = useState<ApiAuth>({ type: 'noauth' });
  
  const [activeTab, setActiveTab] = useState<'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'scenario' | 'settings'>('params');
  const [activeScriptType, setActiveScriptType] = useState<'pre' | 'post'>('pre');
  const [sidebarView, setSidebarView] = useState<'history' | 'workspace'>('workspace');
  
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingScenarios, setIsGeneratingScenarios] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [responseView, setResponseView] = useState<'pretty' | 'raw' | 'headers' | 'tests'>('pretty');
  const [ragEnabled, setRagEnabled] = useState(true);
  const [retrievedRagChunks, setRetrievedRagChunks] = useState<VectorSearchResult[]>([]);

  // Modals State
  const [isCreateWsModalOpen, setIsCreateWsModalOpen] = useState(false);
  const [newWsName, setNewWsName] = useState('');

  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [actionConfig, setActionConfig] = useState<ActionConfig | null>(null);
  const [actionValue, setActionValue] = useState('');

  // Deletion Confirmation State
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    type: 'workspace' | 'collection' | 'request' | 'folder',
    id: string,
    name: string
  } | null>(null);

  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);
  const lastSavedDataRef = useRef<string>('');

  const methods = {
    GET: 'text-indigo-600',
    POST: 'text-emerald-600',
    PUT: 'text-amber-600',
    DELETE: 'text-red-600',
    PATCH: 'text-purple-600'
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  const findRequest = (workspaces: ApiWorkspace[], id: string) => {
    for (const ws of workspaces) {
      if (ws.requests?.find(r => r.id === id)) return true;
      for (const col of ws.collections) {
        if (col.requests?.find(r => r.id === id)) return true;
        if (col.folders) {
          for (const folder of col.folders) {
            if (folder.requests?.find(r => r.id === id)) return true;
          }
        }
      }
    }
    return false;
  };

  const updateWorkspacesRequest = (workspaces: ApiWorkspace[], requestId: string, updatedFields: Partial<ApiRequest>) => {
    return (workspaces || []).map(ws => ({
      ...ws,
      requests: (ws.requests || []).map(req => req.id === requestId ? { ...req, ...updatedFields } : req),
      collections: (ws.collections || []).map(col => ({
        ...col,
        requests: (col.requests || []).map(req => req.id === requestId ? { ...req, ...updatedFields } : req),
        folders: (col.folders || []).map(fold => ({
          ...fold,
          requests: (fold.requests || []).map(f => f.id === requestId ? { ...f, ...updatedFields } : f)
        }))
      }))
    }));
  };

  useEffect(() => {
    if (!selectedRequestId) return;
    if (!findRequest(projectRef.current.apiWorkspaces || [], selectedRequestId)) return;

    const currentDataString = JSON.stringify({ 
      name, url, method, headers, params, body, bodyType, preRequestScript, postResponseScript, auth, selectedRequestId, description, expectedResults, refineInstructions, formData, rawLanguage
    });
    
    const timeout = setTimeout(() => {
      if (currentDataString === lastSavedDataRef.current) return;

      const currentProj = projectRef.current;
      const updatedWorkspaces = updateWorkspacesRequest(currentProj.apiWorkspaces || [], selectedRequestId, {
        name, url, method, headers, params, body, bodyType, preRequestScript, postResponseScript, auth, description, expectedResults, refineInstructions, formData, rawLanguage, savedResponse: response || undefined
      });
      
      onUpdateProject({ ...currentProj, apiWorkspaces: updatedWorkspaces });
      lastSavedDataRef.current = currentDataString;
    }, 500); 

    return () => clearTimeout(timeout);
  }, [name, url, method, headers, params, body, bodyType, preRequestScript, postResponseScript, auth, selectedRequestId, description, expectedResults, refineInstructions, formData, rawLanguage, response, onUpdateProject]);

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    setResponse(null);
    setUrlError(null);
    
    try {
      const urlObj = new URL(newUrl);
      const searchParams = Array.from(urlObj.searchParams.entries());
      if (searchParams.length > 0) {
        const newParams: ApiRequestHeader[] = searchParams.map(([k, v]) => ({
          id: Math.random().toString(36).substr(2, 9),
          key: k, value: v, enabled: true
        }));
        setParams(newParams);
      }
    } catch (e) {}
  };

  const handleSend = async () => {
    setResponse(null);
    setUrlError(null);
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setUrlError("Malformed URL");
      return;
    }

    let finalUrl: URL;
    try {
      finalUrl = new URL(trimmedUrl);
      params.forEach(p => {
        if (p.enabled && p.key) {
          finalUrl.searchParams.append(p.key, p.value);
        }
      });
    } catch (e) {
      setUrlError("Invalid API URL format");
      return;
    }

    setIsLoading(true);
    const startTime = performance.now();

    try {
      const requestHeaders = new Headers();
      headers.forEach(h => {
        if (h.enabled && h.key) requestHeaders.append(h.key, h.value);
      });

      if (auth.type === 'bearer' && auth.bearerToken) {
        requestHeaders.append('Authorization', `Bearer ${auth.bearerToken}`);
      } else if (auth.type === 'basic' && auth.basicUsername) {
        const creds = btoa(`${auth.basicUsername}:${auth.basicPassword || ''}`);
        requestHeaders.append('Authorization', `Basic ${creds}`);
      } else if (auth.type === 'apikey' && auth.apiKeyKey && auth.apiKeyValue) {
        if (auth.apiKeyLocation === 'header') {
          requestHeaders.append(auth.apiKeyKey, auth.apiKeyValue);
        } else {
          finalUrl.searchParams.append(auth.apiKeyKey, auth.apiKeyValue);
        }
      }

      const requestOptions: RequestInit = {
        method,
        headers: requestHeaders,
      };

      if (method !== 'GET') {
        if (bodyType === 'raw' && body) {
          requestOptions.body = body;
          if (!requestHeaders.has('Content-Type')) {
            const mime = rawLanguage === 'JSON' ? 'application/json' : 
                         rawLanguage === 'XML' ? 'application/xml' : 
                         rawLanguage === 'HTML' ? 'text/html' : 'text/plain';
            requestHeaders.append('Content-Type', mime);
          }
        } else if (bodyType === 'form-data' && formData.length > 0) {
          const fd = new FormData();
          formData.forEach(f => {
            if (f.enabled && f.key) fd.append(f.key, f.value);
          });
          requestOptions.body = fd;
        }
      }

      const proxyUrl = `${window.location.origin}/api/proxy?url=${encodeURIComponent(finalUrl.toString())}`;
      const res = await fetch(proxyUrl, requestOptions);
      const endTime = performance.now();
      
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });

      const contentType = res.headers.get('Content-Type') || '';
      let resData: any;
      const rawText = await res.text();

      if (contentType.includes('application/json')) {
        try {
          resData = JSON.parse(rawText);
        } catch (e) {
          resData = rawText;
        }
      } else {
        resData = rawText;
      }

      const finalResponse: ApiResponse = {
        status: res.status,
        statusText: res.statusText || (res.status === 200 ? 'OK' : ''),
        time: Math.round(endTime - startTime),
        size: rawText.length,
        data: resData,
        headers: resHeaders,
        testResults: []
      };

      // RUN POST-RESPONSE SCRIPTS (TESTS)
      if (postResponseScript.trim()) {
        const results: { name: string, passed: boolean, error?: string }[] = [];
        const pm = {
          test: (name: string, fn: () => void) => {
            try {
              fn();
              results.push({ name, passed: true });
            } catch (e: any) {
              results.push({ name, passed: false, error: e.message });
            }
          },
          response: {
            to: {
              have: {
                status: (code: number) => {
                  if (finalResponse.status !== code) throw new Error(`expected status code ${code} but got ${finalResponse.status}`);
                },
                header: (key: string) => {
                  const val = finalResponse.headers[key.toLowerCase()] || finalResponse.headers[key];
                  if (!val) throw new Error(`expected header '${key}' to be present`);
                }
              }
            },
            json: () => finalResponse.data,
            text: () => rawText,
            status: finalResponse.statusText,
            code: finalResponse.status
          },
          expect: (val: any) => ({
            to: {
              equal: (expected: any) => {
                if (val !== expected) throw new Error(`expected ${val} to equal ${expected}`);
              },
              be: {
                a: (type: string) => {
                   if (typeof val !== type) throw new Error(`expected ${val} to be a ${type}`);
                }
              },
              include: (item: any) => {
                if (!val.includes(item)) throw new Error(`expected ${val} to include ${item}`);
              }
            }
          })
        };

        try {
          const runner = new Function('pm', postResponseScript);
          runner(pm);
          finalResponse.testResults = results;
        } catch (e: any) {
          finalResponse.testResults = [{ name: "Test Logic Execution Failed", passed: false, error: e.message }];
        }
      }

      setResponse(finalResponse);
      if (finalResponse.testResults && finalResponse.testResults.length > 0) {
        setResponseView('tests');
      }

      // Add to history and update workspace request atomically
      const currentProj = projectRef.current;
      const historyItem: ApiRequest = {
        id: Math.random().toString(36).substr(2, 9),
        name,
        method,
        url: url,
        headers,
        params,
        bodyType,
        body,
        formData,
        rawLanguage,
        auth,
        preRequestScript,
        postResponseScript,
        description,
        expectedResults,
        refineInstructions,
        savedResponse: finalResponse,
        createdAt: new Date().toISOString()
      };

      const updatedHistory = [historyItem, ...(currentProj.apiHistory || [])].slice(0, 50);

      let updatedWorkspaces = currentProj.apiWorkspaces || [];
      if (selectedRequestId && findRequest(updatedWorkspaces, selectedRequestId)) {
        updatedWorkspaces = updateWorkspacesRequest(updatedWorkspaces, selectedRequestId, {
          name,
          url,
          method,
          headers,
          params,
          body,
          bodyType,
          preRequestScript,
          postResponseScript,
          auth,
          description,
          expectedResults,
          refineInstructions,
          formData,
          rawLanguage,
          savedResponse: finalResponse
        });
      }

      const currentDataString = JSON.stringify({ 
        name, url, method, headers, params, body, bodyType, preRequestScript, postResponseScript, auth, selectedRequestId, description, expectedResults, refineInstructions, formData, rawLanguage
      });
      lastSavedDataRef.current = currentDataString;

      onUpdateProject({ ...currentProj, apiWorkspaces: updatedWorkspaces, apiHistory: updatedHistory });

    } catch (error: any) {
      console.error("API Request Error:", error);
      setUrlError(error.message || "Network request failed. Please check the URL or CORS settings.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRequest = (req: ApiRequest) => {
    setSelectedRequestId(req.id);
    setName(req.name || '');
    setMethod(req.method);
    setUrl(req.url);
    setUrlError(null);
    setHeaders(req.headers || []);
    setParams(req.params || []);
    setBodyType(req.bodyType || 'raw');
    setBody(req.body || '{\n  \n}');
    setFormData(req.formData || []);
    setRawLanguage(req.rawLanguage || 'JSON');
    setAuth(req.auth || { type: 'noauth' });
    setPreRequestScript(req.preRequestScript || '');
    setPostResponseScript(req.postResponseScript || '');
    setDescription(req.description || '');
    setExpectedResults(req.expectedResults || '');
    setRefineInstructions(req.refineInstructions || '');
    setResponse(req.savedResponse || null);
    
    lastSavedDataRef.current = JSON.stringify({ 
      name: req.name || '', url: req.url, method: req.method, headers: req.headers || [], params: req.params || [], 
      body: req.body || '{\n  \n}', bodyType: req.bodyType || 'raw', preRequestScript: req.preRequestScript || '', 
      postResponseScript: req.postResponseScript || '', auth: req.auth || { type: 'noauth' }, selectedRequestId: req.id,
      description: req.description || '', expectedResults: req.expectedResults || '', refineInstructions: req.refineInstructions || '',
      formData: req.formData || [], rawLanguage: req.rawLanguage || 'JSON'
    });

    if (req.name || req.description || req.expectedResults || req.refineInstructions) {
      setActiveTab('scenario');
    }
  };

  const handleSaveResponse = () => {
    if (!selectedRequestId || !response) return;
    const currentProj = projectRef.current;
    
    const updatedWorkspaces = updateWorkspacesRequest(currentProj.apiWorkspaces || [], selectedRequestId, {
      savedResponse: response
    });
    
    onUpdateProject({ ...currentProj, apiWorkspaces: updatedWorkspaces });
    logActivity(user.email, user.name, `Saved API Response for request: ${selectedRequestId}`, currentProj.id, currentProj.name);
    toast.success('Response saved successfully.');
  };

  const handleGenerateAiScenarios = async () => {
    if (isGeneratingScenarios) return;
    if (!response) {
      alert('No active API response found. Please execute an API request first.');
      return;
    }
    setIsGeneratingScenarios(true);

    try {
      let requestDetails = { method, url, headers, params, body, extraContext: '', refineInstructions };
      if (ragEnabled) {
        const queryText = `API ${method} ${url}\n${JSON.stringify(body)}`;
        const enriched = await ragEnrichPrompt(queryText, project.id, 3);
        requestDetails.extraContext = enriched.prompt;
        setRetrievedRagChunks(enriched.chunks);
      } else {
        setRetrievedRagChunks([]);
      }

      const generatedScenarios = (await generateScenariosFromApiResponse(requestDetails, response.data)) as any[];

      if (!Array.isArray(generatedScenarios) || generatedScenarios.length === 0) {
        throw new Error("No scenarios generated from response.");
      }

      let workspaces = [...(project.apiWorkspaces || [])];
      
      // If no workspace exists, initialize a default workspace with a default collection
      if (workspaces.length === 0) {
        workspaces = [{
          id: Math.random().toString(36).substr(2, 9),
          name: 'Default Workspace',
          requests: [],
          collections: [{
            id: Math.random().toString(36).substr(2, 9),
            name: 'API Collections',
            requests: [],
            folders: [],
            isOpen: true
          }],
          createdAt: new Date().toISOString(),
          isOpen: true
        }];
      }

      let targetWorkspaceId = '';
      let targetCollectionId = '';

      // Locate workspace and collection if selectedRequestId is set
      if (selectedRequestId) {
        for (const ws of workspaces) {
          for (const col of (ws.collections || [])) {
            const inRoot = (col.requests || []).some(r => r.id === selectedRequestId);
            const inFolder = (col.folders || []).some(f => (f.requests || []).some(r => r.id === selectedRequestId));
            if (inRoot || inFolder) {
              targetWorkspaceId = ws.id;
              targetCollectionId = col.id;
              break;
            }
          }
          if (targetWorkspaceId) break;
        }
      }

      // Fallback: Use the first workspace and first collection
      if (!targetWorkspaceId || !targetCollectionId) {
        targetWorkspaceId = workspaces[0].id;
        if (!workspaces[0].collections || workspaces[0].collections.length === 0) {
          workspaces[0] = {
            ...workspaces[0],
            collections: [{
              id: Math.random().toString(36).substr(2, 9),
              name: 'API Collections',
              requests: [],
              folders: [],
              isOpen: true
            }]
          };
        }
        targetCollectionId = workspaces[0].collections[0].id;
      }

      const cleanEndpoint = url ? (url.split('?')[0].split('/').filter(Boolean).pop() || 'Endpoint') : 'Request';
      const folderName = `AI Scenarios - ${method} ${cleanEndpoint}`;
      const newFolderId = Math.random().toString(36).substr(2, 9);

      const newFolder: ApiFolder = {
        id: newFolderId,
        name: folderName,
        requests: generatedScenarios.map((s: any) => ({
          id: Math.random().toString(36).substr(2, 9),
          name: s.title || 'AI Test Scenario',
          method: method || 'GET',
          url: url || '',
          headers: [],
          params: [],
          body: '',
          bodyType: 'none',
          description: s.description || '',
          expectedResults: s.expectedResults || '',
          refineInstructions: refineInstructions || '',
          createdAt: new Date().toISOString()
        })),
        isOpen: true
      };

      const updatedWorkspaces = workspaces.map(ws => {
        if (ws.id !== targetWorkspaceId) return ws;
        return {
          ...ws,
          collections: (ws.collections || []).map(col => 
            col.id === targetCollectionId ? { ...col, folders: [...(col.folders || []), newFolder] } : col
          )
        };
      });

      // Also synchronize into project.scenarios
      const newTestScenarios: TestScenario[] = generatedScenarios.map((s: any, idx: number) => ({
        id: Math.random().toString(36).substr(2, 9),
        scenarioId: `API-${Date.now().toString().slice(-4)}-${idx + 1}`,
        title: s.title || `API Scenario ${idx + 1}`,
        type: 'Functional',
        description: `[${method} ${url}]\n${s.description || ''}`,
        expectedResults: s.expectedResults || 'API responds as expected',
        moduleName: 'API Testing',
        isApproved: true,
        isApiScenario: true,
        testCases: [],
        createdAt: new Date().toISOString(),
        appUrl: url || ''
      }));

      const currentProj = projectRef.current;
      onUpdateProject({
        ...currentProj,
        apiWorkspaces: updatedWorkspaces,
        scenarios: [...newTestScenarios, ...(currentProj.scenarios || [])]
      });

      logActivity(user.email, user.name, `Generated ${generatedScenarios.length} AI Scenarios from API response (${method} ${url})`, currentProj.id, currentProj.name);

      toggleExpand(targetWorkspaceId);
      toggleExpand(targetCollectionId);
      toggleExpand(newFolderId);

      alert(`Successfully generated ${generatedScenarios.length} AI test scenarios!\nSaved to API Workspace folder "${folderName}" and synced to Project Scenarios.`);
    } catch (err: any) {
      console.error('Failed to generate AI scenarios:', err);
      alert(err.message || 'Failed to generate AI scenarios. Please try again.');
    } finally {
      setIsGeneratingScenarios(false);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!newWsName.trim()) return;
    const currentProj = projectRef.current;
    const newWs: ApiWorkspace = {
      id: Math.random().toString(36).substr(2, 9),
      name: newWsName.trim(), requests: [], collections: [],
      createdAt: new Date().toISOString(), isOpen: true
    };
    onUpdateProject({ ...currentProj, apiWorkspaces: [newWs, ...(currentProj.apiWorkspaces || [])] });
    setNewWsName(''); setIsCreateWsModalOpen(false);
    toggleExpand(newWs.id);
    logActivity(user.email, user.name, `Created API Workspace: ${newWs.name}`, currentProj.id, currentProj.name);
  };

  const openActionModal = (config: ActionConfig, initialValue: string = '') => {
    setActionConfig(config);
    setActionValue(initialValue);
    setIsActionModalOpen(true);
  };

  const handleExecuteAction = () => {
    if (!actionConfig || !actionValue.trim()) return;

    const currentProj = projectRef.current;
    const { type, workspaceId, collectionId, folderId, requestId } = actionConfig;
    const name = actionValue.trim();
    let updatedWorkspaces = [...(currentProj.apiWorkspaces || [])];

    switch (type) {
      case 'create-collection':
        const newCol: ApiCollection = { id: Math.random().toString(36).substr(2, 9), name, requests: [], folders: [], isOpen: true };
        updatedWorkspaces = updatedWorkspaces.map(ws => ws.id === workspaceId ? { ...ws, collections: [...ws.collections, newCol] } : ws);
        if (!expandedIds.has(workspaceId)) toggleExpand(workspaceId);
        break;
      case 'create-folder':
        const newFolder: ApiFolder = { id: Math.random().toString(36).substr(2, 9), name, requests: [], isOpen: true };
        updatedWorkspaces = updatedWorkspaces.map(ws => ws.id === workspaceId ? { ...ws, collections: ws.collections.map(col => col.id === collectionId ? { ...col, folders: [...(col.folders || []), newFolder] } : col) } : ws);
        if (collectionId && !expandedIds.has(collectionId)) toggleExpand(collectionId);
        break;
      case 'create-request':
        const newReq: ApiRequest = { id: Math.random().toString(36).substr(2, 9), name, method: 'GET', url: '', headers: [], params: [], body: '{\n  \n}', bodyType: 'raw', createdAt: new Date().toISOString() };
        updatedWorkspaces = updatedWorkspaces.map(ws => {
          if (ws.id !== workspaceId) return ws;
          return {
            ...ws,
            collections: ws.collections.map(col => {
              if (col.id !== collectionId) return col;
              if (folderId) {
                return { ...col, folders: (col.folders || []).map(f => f.id === folderId ? { ...f, requests: [...f.requests, newReq] } : f) };
              }
              return { ...col, requests: [...col.requests, newReq] };
            })
          };
        });
        handleSelectRequest(newReq);
        break;
      case 'rename-workspace':
        updatedWorkspaces = updatedWorkspaces.map(ws => ws.id === workspaceId ? { ...ws, name } : ws);
        break;
      case 'rename-collection':
        updatedWorkspaces = updatedWorkspaces.map(ws => ({ ...ws, collections: ws.collections.map(col => col.id === collectionId ? { ...col, name } : col) }));
        break;
      case 'rename-folder':
        updatedWorkspaces = updatedWorkspaces.map(ws => ({ ...ws, collections: ws.collections.map(col => ({ ...col, folders: (col.folders || []).map(f => f.id === folderId ? { ...f, name } : f) })) }));
        break;
      case 'rename-request':
        updatedWorkspaces = updatedWorkspaces.map(ws => ({ ...ws, requests: (ws.requests || []).map(r => r.id === requestId ? { ...r, name } : r), collections: ws.collections.map(col => ({ ...col, requests: col.requests.map(r => r.id === requestId ? { ...r, name } : r), folders: (col.folders || []).map(f => ({ ...f, requests: f.requests.map(r => r.id === requestId ? { ...r, name } : r) })) })) }));
        if (selectedRequestId === requestId) {
          setName(name);
        }
        break;
    }

    onUpdateProject({ ...currentProj, apiWorkspaces: updatedWorkspaces });
    logActivity(user.email, user.name, `Executed sidebar action: ${type} - ${name}`, currentProj.id, currentProj.name);
    setIsActionModalOpen(false);
    setActionConfig(null);
  };

  const handleDownloadWorkspace = (workspace: ApiWorkspace, e: React.MouseEvent) => {
    e.stopPropagation();
    const dataStr = JSON.stringify(workspace, null, 2);
    const link = document.createElement('a');
    link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    link.download = `${workspace.name.replace(/\s+/g, '_')}_Workspace.json`;
    link.click();
  };

  const handleDownloadCollection = (collection: ApiCollection, e: React.MouseEvent) => {
    e.stopPropagation();
    const dataStr = JSON.stringify(collection, null, 2);
    const link = document.createElement('a');
    link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    link.download = `${collection.name.replace(/\s+/g, '_')}_Collection.json`;
    link.click();
  };

  const handleDownloadFolder = (folder: ApiFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    const dataStr = JSON.stringify(folder, null, 2);
    const link = document.createElement('a');
    link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    link.download = `${folder.name.replace(/\s+/g, '_')}_Folder.json`;
    link.click();
  };

  const triggerDeleteItem = (type: 'workspace' | 'collection' | 'folder' | 'request', id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmation({ type, id, name });
  };

  const executeDeleteItem = () => {
    if (!deleteConfirmation) return;
    const currentProj = projectRef.current;
    const { type, id } = deleteConfirmation;
    let updatedWorkspaces = [...(currentProj.apiWorkspaces || [])];

    if (type === 'workspace') updatedWorkspaces = updatedWorkspaces.filter(ws => ws.id !== id);
    else if (type === 'collection') updatedWorkspaces = updatedWorkspaces.map(ws => ({ ...ws, collections: ws.collections.filter(col => col.id !== id) }));
    else if (type === 'folder') updatedWorkspaces = updatedWorkspaces.map(ws => ({ ...ws, collections: ws.collections.map(col => ({ ...col, folders: (col.folders || []).filter(f => f.id !== id) })) }));
    else if (type === 'request') {
      updatedWorkspaces = updatedWorkspaces.map(ws => ({ ...ws, requests: (ws.requests || []).filter(r => r.id !== id), collections: ws.collections.map(col => ({ ...col, requests: col.requests.filter(r => r.id !== id), folders: (col.folders || []).map(f => ({ ...f, requests: f.requests.filter(r => r.id !== id) })) })) }));
    }

    const updatedHistory = (currentProj.apiHistory || []).filter(h => h.id !== id);

    onUpdateProject({ ...currentProj, apiWorkspaces: updatedWorkspaces, apiHistory: updatedHistory });
    if (selectedRequestId === id) { setSelectedRequestId(null); setResponse(null); }
    logActivity(user.email, user.name, `Deleted API artifact: ${type} - ${id}`, currentProj.id, currentProj.name);
    setDeleteConfirmation(null);
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-10rem)] gap-6 animate-in fade-in duration-500">
      <div className="w-full lg:w-80 shrink-0 bg-white rounded-[2rem] border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[600px] lg:h-auto">
        <div className="p-3 border-b flex gap-2 bg-slate-50/50 m-3 rounded-2xl">
          <button onClick={() => setSidebarView('history')} className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase transition-all ${sidebarView === 'history' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>History</button>
          <button onClick={() => setSidebarView('workspace')} className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase transition-all ${sidebarView === 'workspace' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Workspace</button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 custom-scrollbar pb-10">
          <div className="px-3 mb-4">
             <button onClick={() => setIsCreateWsModalOpen(true)} className="w-full py-3 flex items-center justify-center gap-2 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-white hover:border-indigo-400 hover:text-indigo-600 transition-all"><Plus size={14} /> New Workspace</button>
          </div>
          {sidebarView === 'workspace' ? (project.apiWorkspaces || []).map(ws => (
            <div key={ws.id} className="mb-1">
              <div className={`group flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer ${expandedIds.has(ws.id) ? 'bg-indigo-50/40' : 'hover:bg-slate-50'}`} onClick={() => toggleExpand(ws.id)}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-1 transition-transform ${expandedIds.has(ws.id) ? 'rotate-90' : ''}`}><ChevronRight size={14} className="text-slate-400" /></div>
                  <span className="text-[11px] font-black uppercase text-black truncate">{ws.name}</span>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'create-collection', workspaceId: ws.id, title: 'Add Collection', subtitle: 'Organize related requests', placeholder: 'Collection Name' }); }} title="Add Collection" className="p-1 text-slate-400 hover:text-indigo-600"><PlusSquare size={14} /></button>
                  <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'rename-workspace', workspaceId: ws.id, title: 'Rename Workspace', subtitle: 'Update workspace identity', placeholder: 'New Name' }, ws.name); }} title="Rename Workspace" className="p-1 text-slate-400 hover:text-indigo-600"><Pencil size={12} /></button>
                  <button onClick={e => handleDownloadWorkspace(ws, e)} title="Export" className="p-1 text-slate-400 hover:text-indigo-600"><Download size={12} /></button>
                  <button onClick={e => triggerDeleteItem('workspace', ws.id, ws.name, e)} title="Delete" className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              </div>
              {expandedIds.has(ws.id) && (
                <div className="ml-4 pl-3 border-l border-slate-100 mt-1 space-y-1">
                  {ws.collections.map(col => (
                    <div key={col.id}>
                      <div className="group flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer hover:bg-slate-50" onClick={() => toggleExpand(col.id)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`transition-transform ${expandedIds.has(col.id) ? 'rotate-90' : ''}`}><ChevronRight size={12} className="text-slate-400" /></div>
                          <FolderIcon size={12} className="text-amber-500" />
                          <span className="text-[10px] font-bold text-slate-500 truncate">{col.name}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'create-request', workspaceId: ws.id, collectionId: col.id, title: 'Add Request', subtitle: 'New API endpoint test', placeholder: 'Request Name' }); }} className="p-1 text-slate-400 hover:text-indigo-600"><Plus size={12} /></button>
                          <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'create-folder', workspaceId: ws.id, collectionId: col.id, title: 'Add Folder', subtitle: 'Group related scenarios', placeholder: 'Folder Name' }); }} className="p-1 text-slate-400 hover:text-indigo-600"><FolderPlus size={12} /></button>
                          <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'rename-collection', workspaceId: ws.id, collectionId: col.id, title: 'Rename Collection', subtitle: 'Update collection identity', placeholder: 'New Name' }, col.name); }} className="p-1 text-slate-400 hover:text-indigo-600"><Pencil size={10} /></button>
                          <button onClick={e => handleDownloadCollection(col, e)} className="p-1 text-slate-400 hover:text-indigo-600"><Download size={10} /></button>
                          <button onClick={e => triggerDeleteItem('collection', col.id, col.name, e)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={10} /></button>
                        </div>
                      </div>
                      {expandedIds.has(col.id) && (
                        <div className="ml-4 pl-3 border-l border-slate-100 mt-1 space-y-1">
                          {(col.folders || []).map(folder => (
                            <div key={folder.id}>
                              <div className="group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer hover:bg-slate-50" onClick={() => toggleExpand(folder.id)}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`transition-transform ${expandedIds.has(folder.id) ? 'rotate-90' : ''}`}><ChevronRight size={10} className="text-slate-400" /></div>
                                  <FolderOpen size={10} className="text-amber-400" />
                                  <span className="text-[9px] font-bold text-slate-500 truncate">{folder.name}</span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                  <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'create-request', workspaceId: ws.id, collectionId: col.id, folderId: folder.id, title: 'Add Request', subtitle: 'New scenario step', placeholder: 'Request Name' }); }} className="p-1 text-slate-400 hover:text-indigo-600"><Plus size={10} /></button>
                                  <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'rename-folder', workspaceId: ws.id, collectionId: col.id, folderId: folder.id, title: 'Rename Folder', subtitle: 'Update folder identity', placeholder: 'New Name' }, folder.name); }} className="p-1 text-slate-400 hover:text-indigo-600"><Pencil size={9} /></button>
                                  <button onClick={e => handleDownloadFolder(folder, e)} className="p-1 text-slate-400 hover:text-indigo-600"><Download size={9} /></button>
                                  <button onClick={e => triggerDeleteItem('folder', folder.id, folder.name, e)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={9} /></button>
                                </div>
                              </div>
                              {expandedIds.has(folder.id) && (
                                <div className="ml-4 pl-3 border-l border-slate-100 mt-0.5 space-y-0.5">
                                  {folder.requests.map(r => {
                                    const displayName = (r.name && r.name !== 'New Request' && r.name !== 'Request Name' && r.name !== 'Untitled') ? r.name : (r.url || r.name || 'Untitled');
                                    return (
                                      <div key={r.id} onClick={() => handleSelectRequest(r)} title={r.url || r.name} className={`group/req text-[9px] p-1.5 cursor-pointer rounded-lg truncate flex items-center justify-between transition-all ${selectedRequestId === r.id ? 'bg-indigo-50 text-indigo-600 font-bold shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                                        <div className="min-w-0 truncate flex items-center gap-1.5">
                                          <span className={`font-black text-[8px] w-7 shrink-0 ${methods[r.method]}`}>{r.method}</span>
                                          <span className="truncate">{displayName}</span>
                                        </div>
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover/req:opacity-100 transition-all">
                                          <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'rename-request', workspaceId: ws.id, requestId: r.id, title: 'Rename Request', subtitle: 'Update test identifier', placeholder: 'New Name' }, r.name || ''); }} className="p-0.5 text-slate-400 hover:text-indigo-600"><Pencil size={8} /></button>
                                          <button onClick={e => { e.stopPropagation(); triggerDeleteItem('request', r.id, r.name || r.url, e); }} className="p-0.5 text-slate-400 hover:text-red-500"><Trash2 size={8} /></button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                          {col.requests.map(r => {
                            const displayName = (r.name && r.name !== 'New Request' && r.name !== 'Request Name' && r.name !== 'Untitled') ? r.name : (r.url || r.name || 'Untitled');
                            return (
                              <div key={r.id} onClick={() => handleSelectRequest(r)} title={r.url || r.name} className={`group/req text-[10px] p-2 cursor-pointer rounded-lg truncate flex items-center justify-between transition-all ${selectedRequestId === r.id ? 'bg-indigo-50 text-indigo-600 font-bold shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                                <div className="min-w-0 truncate flex items-center gap-1.5">
                                  <span className={`font-black text-[9px] w-8 shrink-0 ${methods[r.method]}`}>{r.method}</span>
                                  <span className="truncate">{displayName}</span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover/req:opacity-100 transition-all">
                                  <button onClick={e => { e.stopPropagation(); openActionModal({ type: 'rename-request', workspaceId: ws.id, requestId: r.id, title: 'Rename Request', subtitle: 'Update test identifier', placeholder: 'New Name' }, r.name || ''); }} className="p-0.5 text-slate-400 hover:text-indigo-600"><Pencil size={10} /></button>
                                  <button onClick={e => triggerDeleteItem('request', r.id, r.name || r.url, e)} className="p-0.5 text-slate-400 hover:text-red-500"><Trash2 size={10} /></button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )) : (project.apiHistory || []).map(h => (
            <div key={h.id} onClick={() => handleSelectRequest(h)} className="group/hist p-3 text-[10px] cursor-pointer hover:bg-slate-50 rounded-xl mb-1 flex flex-col gap-1 border border-transparent hover:border-slate-100 transition-all relative">
              <span className={`font-black uppercase tracking-tighter text-[9px] ${methods[h.method]}`}>{h.method}</span>
              <span className="text-slate-600 truncate font-medium">{h.url}</span>
              <button onClick={e => triggerDeleteItem('request', h.id, h.name || h.url, e)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover/hist:opacity-100 transition-all"><Trash2 size={12}/></button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col gap-6 overflow-visible">
        <div className="bg-white rounded-[2.5rem] border p-12 flex flex-col gap-12 shadow-sm">
          <div className="flex items-center justify-between border-b pb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black text-black uppercase tracking-tight">API Testing & Suite Generator</h2>
              <RAGStatusBadge
                enabled={ragEnabled}
                onToggle={setRagEnabled}
                retrievedChunks={retrievedRagChunks}
              />
            </div>
          </div>
          <div className="flex flex-col gap-8">
            <div className="flex gap-4">
            <div className="flex-1 min-w-0 flex bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden focus-within:ring-2 ring-indigo-50/20">
               <select value={method || 'GET'} onChange={e => setMethod(e.target.value as any)} className="px-6 bg-white border-r border-slate-200 text-xs font-black uppercase outline-none transition-colors hover:bg-slate-50 cursor-pointer"><option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="DELETE">DELETE</option><option value="PATCH">PATCH</option></select>
               <input value={url || ''} onChange={e => handleUrlChange(e.target.value)} className="flex-1 min-w-0 px-5 py-4 bg-transparent font-mono text-[13px] outline-none text-slate-700 placeholder:text-slate-300" placeholder="Enter request URL" />
            </div>
            <button onClick={handleSend} disabled={isLoading} className="bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-3 shadow-xl active:scale-95 transition-all shrink-0">{isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Send</button>
          </div>
          <div className="flex flex-col flex-1 min-h-0">
             <div className="flex gap-4 sm:gap-8 border-b border-slate-100 px-2 flex-shrink-0 overflow-x-auto custom-scrollbar">
                {['PARAMS', 'AUTH', 'HEADERS', 'BODY', 'SCRIPTS', 'SCENARIO'].map(t => (
                  <button key={t} onClick={() => setActiveTab(t.toLowerCase() as any)} className={`pb-4 text-[14px] font-black tracking-[0.2em] relative transition-all shrink-0 ${activeTab === t.toLowerCase() ? 'text-black' : 'text-black/60 hover:text-black'}`}>
                    {t === 'SCENARIO' ? 'AI SCENARIO' : t}
                    {activeTab === t.toLowerCase() && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full shadow-lg shadow-indigo-500/50" />}
                  </button>
                ))}
             </div>
             <div className="pt-6 h-[450px] overflow-y-auto custom-scrollbar">
                {activeTab === 'params' && <KeyValueTable items={params} onUpdate={(id, f, v) => setParams(params.map(p => p.id === id ? {...p, [f]: v} : p))} onDelete={id => setParams(params.filter(p => p.id !== id))} onAdd={() => setParams([...params, {id: Math.random().toString(36).substr(2, 9), key: '', value: '', enabled: true}])} />}
                {activeTab === 'auth' && <AuthEditor auth={auth} setAuth={setAuth} />}
                {activeTab === 'headers' && <KeyValueTable items={headers} onUpdate={(id, f, v) => setHeaders(headers.map(h => h.id === id ? {...h, [f]: v} : h))} onDelete={id => setHeaders(headers.filter(h => h.id !== id))} onAdd={() => setHeaders([...headers, {id: Math.random().toString(36).substr(2, 9), key: '', value: '', enabled: true}])} />}
                {activeTab === 'body' && <BodyEditor bodyType={bodyType} setBodyType={setBodyType} rawLanguage={rawLanguage} setRawLanguage={setRawLanguage} body={body} setBody={setBody} formData={formData} setFormData={setFormData} />}
                {activeTab === 'scripts' && <ScriptsEditor activeScriptType={activeScriptType} setActiveScriptType={setActiveScriptType} preRequestScript={preRequestScript} setPreRequestScript={setPreRequestScript} postResponseScript={postResponseScript} setPostResponseScript={setPostResponseScript} />}
                 {activeTab === 'scenario' && (
                  <div className="space-y-6 h-full pr-2">
                    <div className="space-y-2">
                      <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1">Scenario Title</label>
                      <input 
                        type="text"
                        value={name || ''} 
                        onChange={e => setName(e.target.value)} 
                        className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-800 outline-none focus:ring-2 ring-indigo-500 transition-all shadow-inner" 
                        placeholder="Scenario title or summary..." 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1">Scenario Description</label>
                      <textarea value={description || ''} onChange={e => setDescription(e.target.value)} className="w-full h-24 px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:ring-2 ring-indigo-500 transition-all resize-none shadow-inner" placeholder="Detailed purpose of this test scenario..." />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[14px] font-black text-black uppercase tracking-widest ml-1">Expected Results</label>
                      <textarea value={expectedResults || ''} onChange={e => setExpectedResults(e.target.value)} className="w-full h-24 px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 ring-indigo-500 transition-all resize-none shadow-inner" placeholder="What should the API return for a PASS verdict?" />
                    </div>
                  </div>
                )}
             </div>
          </div>
        </div>
        </div>
        
        <div className="min-h-[500px] flex-1 bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden flex flex-col shadow-sm">
          <div className="p-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-3 bg-slate-50/50">
            <div className="flex items-center gap-6 flex-wrap">
              <h3 className="text-[14px] font-black uppercase text-black tracking-widest ml-4">Response</h3>
              {response && !isLoading && !urlError && (
                  <div className="flex items-center gap-4">
                    <span className={`text-[10px] font-black px-3 py-1 rounded-full border shadow-sm ${response.status < 400 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>{response.status} {response.statusText}</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{response.time} ms</span>
                  </div>
              )}
            </div>
            {response && !isLoading && !urlError && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex bg-slate-100 rounded-xl p-1 border border-slate-200 flex-wrap">
                    <button onClick={() => setResponseView('pretty')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${responseView === 'pretty' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Pretty</button>
                    <button onClick={() => setResponseView('raw')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${responseView === 'raw' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Raw</button>
                    <button onClick={() => setResponseView('headers')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${responseView === 'headers' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Headers</button>
                    <button onClick={() => setResponseView('tests')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${responseView === 'tests' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Test Results</button>
                </div>
                <button 
                  onClick={handleSaveResponse}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95"
                >
                  <Save size={14} className="text-indigo-600" /> Save Response
                </button>
                <div className="flex items-center gap-2 relative">
                  <Sparkles size={13} className="text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={refineInstructions || ''}
                    maxLength={1000}
                    onChange={e => setRefineInstructions(e.target.value)}
                    placeholder="Refine instructions (optional)..."
                    className="w-48 sm:w-64 pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 transition-all shadow-sm"
                  />
                </div>
                <button 
                  disabled={isGeneratingScenarios}
                  onClick={handleGenerateAiScenarios}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {isGeneratingScenarios ? <Loader2 size={14} className="animate-spin" /> : <Beaker size={14} />}
                  {isGeneratingScenarios ? 'Generating...' : 'AI Test Scenarios'}
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
            {isLoading ? (
               <div className="h-full flex flex-col items-center justify-center gap-6 animate-in fade-in">
                  <div className="relative">
                    <div className="w-16 h-16 bg-indigo-50 rounded-full animate-ping opacity-20 absolute inset-0" />
                    <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 relative z-10 shadow-sm border border-indigo-100">
                        <Loader2 size={32} className="animate-spin" />
                    </div>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Executing Remote Call</p>
               </div>
            ) : urlError ? (
               <div className="h-full flex flex-col items-center justify-center text-rose-500 animate-in fade-in">
                  <AlertTriangle size={48} className="mb-4" />
                  <p className="text-sm font-black uppercase tracking-widest">{urlError}</p>
               </div>
            ) : response ? (
              <div className="h-full">
                {responseView === 'pretty' && (
                  <pre className="text-[13px] font-mono leading-relaxed bg-slate-900 text-emerald-400 p-8 rounded-3xl border border-slate-800 shadow-inner overflow-auto h-full">
                    {typeof response.data === 'object' ? JSON.stringify(response.data, null, 2) : response.data}
                  </pre>
                )}
                {responseView === 'raw' && (
                  <pre className="text-[13px] font-mono leading-relaxed bg-slate-50 text-slate-600 p-8 rounded-3xl border border-slate-100 shadow-inner overflow-auto h-full whitespace-pre-wrap">
                    {typeof response.data === 'object' ? JSON.stringify(response.data) : response.data}
                  </pre>
                )}
                {responseView === 'headers' && (
                  <div className="p-2 space-y-2">
                    {Object.entries(response.headers).map(([k, v]) => (
                      <div key={k} className="flex gap-4 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest min-w-[150px]">{k}:</span>
                        <span className="text-xs font-medium text-slate-600">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                {responseView === 'tests' && (
                  <div className="p-4 space-y-4">
                    {(!response.testResults || response.testResults.length === 0) ? (
                      <div className="py-20 text-center text-slate-400 italic text-sm">No tests were run for this request. Configure tests in the SCRIPTS tab.</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-8 mb-6 px-4 bg-slate-50 py-4 rounded-2xl border border-slate-100">
                            <div className="flex items-center gap-3">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/20" />
                                <span className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">Passed: <span className="text-emerald-600">{response.testResults.filter(r => r.passed).length}</span></span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-lg shadow-red-500/20" />
                                <span className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">Failed: <span className="text-red-600">{response.testResults.filter(r => !r.passed).length}</span></span>
                            </div>
                        </div>
                        {response.testResults.map((res, ridx) => (
                          <div key={ridx} className={`flex items-start gap-4 p-5 rounded-3xl border transition-all animate-in slide-in-from-left-2 ${res.passed ? 'bg-emerald-50/20 border-emerald-100 shadow-sm shadow-emerald-500/5' : 'bg-red-50/20 border-red-100 shadow-sm shadow-red-500/5'}`}>
                            <div className={`mt-0.5 p-1 rounded-full ${res.passed ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white shadow-lg'}`}>
                              {res.passed ? <Check size={14} strokeWidth={4} /> : <X size={14} strokeWidth={4} />}
                            </div>
                            <div className="flex-1 min-w-0">
                               <p className={`text-xs font-black uppercase tracking-tight ${res.passed ? 'text-emerald-800' : 'text-red-800'}`}>{res.name}</p>
                               {!res.passed && res.error && (
                                 <div className="mt-2 p-2 bg-white/50 rounded-xl border border-red-50">
                                   <p className="text-[10px] font-medium text-red-500 italic">{res.error}</p>
                                 </div>
                               )}
                            </div>
                            <div className={`text-[8px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-full border ${res.passed ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                               {res.passed ? 'Pass' : 'Fail'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-20 text-center animate-pulse"><Activity size={64} className="mb-4 text-slate-400" /><p className="text-[12px] font-black uppercase tracking-[0.4em]">Awaiting Execution</p></div>
            )}
          </div>
        </div>
      </div>

      {/* Workspace Creation Modal */}
      {isCreateWsModalOpen && (
        <div className="fixed inset-0 z-[3000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-md rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 border border-white">
             <div className="flex items-center gap-4 mb-8">
               <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg">
                 <Plus size={24} />
               </div>
               <div>
                 <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">New API Workspace</h3>
                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Create a logical grouping for your collections</p>
               </div>
             </div>
             <div className="space-y-6">
               <div className="space-y-3">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 block">Workspace Name</label>
                 <input 
                   autoFocus
                   type="text" 
                   value={newWsName || ''} 
                   onChange={(e) => setNewWsName(e.target.value)} 
                   placeholder="e.g. Identity Services" 
                   className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:bg-white outline-none shadow-inner"
                   onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
                 />
               </div>
               <div className="flex flex-col gap-3">
                 <button onClick={handleCreateWorkspace} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95">Create Workspace</button>
                 <button onClick={() => { setIsCreateWsModalOpen(false); setNewWsName(''); }} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
               </div>
             </div>
          </div>
        </div>
      )}

      {/* Dynamic Action Modal (Collection/Folder/Request Creation & Renaming) */}
      {isActionModalOpen && actionConfig && (
        <div className="fixed inset-0 z-[3000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-md rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 border border-white">
             <div className="flex items-center gap-4 mb-8">
               <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg">
                 {actionConfig.type.includes('collection') ? <FolderIcon size={24} /> : 
                  actionConfig.type.includes('folder') ? <FolderPlus size={24} /> : 
                  actionConfig.type.includes('request') ? <PlusSquare size={24} /> : <Pencil size={24} />}
               </div>
               <div>
                 <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">{actionConfig.title}</h3>
                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{actionConfig.subtitle}</p>
               </div>
             </div>
             <div className="space-y-6">
               <div className="space-y-3">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 block">Identifier Name</label>
                 <input 
                   autoFocus
                   type="text" 
                   value={actionValue || ''} 
                   onChange={(e) => setActionValue(e.target.value)} 
                   placeholder={actionConfig.placeholder} 
                   className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:bg-white outline-none shadow-inner"
                   onKeyDown={(e) => e.key === 'Enter' && handleExecuteAction()}
                 />
               </div>
               <div className="flex flex-col gap-3">
                 <button onClick={handleExecuteAction} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95">Proceed</button>
                 <button onClick={() => { setIsActionModalOpen(false); setActionConfig(null); }} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
               </div>
             </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmation && (
        <div className="fixed inset-0 z-[3000] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-md rounded-[3rem] p-10 text-center shadow-2xl animate-in zoom-in-95 border border-white">
             <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-8 text-red-500"><AlertTriangle size={40} /></div>
             <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-4">Confirm Deletion</h3>
             <p className="text-sm text-slate-500 font-medium leading-relaxed mb-10 px-4">Are you sure you want to proceed with deleting the <span className="font-bold text-slate-800">{deleteConfirmation.type}</span>: <br/><span className="text-indigo-600 font-black">"{deleteConfirmation.name}"</span>? <br/>This action cannot be reversed.</p>
             <div className="flex flex-col gap-3">
               <button onClick={executeDeleteItem} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg shadow-red-100 active:scale-95">Delete / Continue</button>
               <button onClick={() => setDeleteConfirmation(null)} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiTesting;