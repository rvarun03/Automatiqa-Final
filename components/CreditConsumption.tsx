import React, { useState, useMemo, useEffect } from 'react';
import { 
  Coins, 
  Search, 
  Download, 
  RefreshCw, 
  Zap, 
  ShieldCheck, 
  Cpu, 
  CheckCircle2, 
  Sparkles, 
  Layers, 
  Sliders, 
  Plus, 
  Trash2, 
  UserCheck, 
  ArrowUpDown, 
  FileText, 
  Image as ImageIcon, 
  Video, 
  Globe, 
  AlertTriangle, 
  Terminal, 
  Smartphone, 
  Activity, 
  Calendar, 
  Award,
  Eye,
  CheckSquare,
  Crown,
  Send,
  UserPlus
} from 'lucide-react';
import { User, UserRole, TokenLog, Project, SubscriptionRequest } from '../types';
import { 
  getTokenLogs, 
  addTokenLog, 
  deleteTokenLog,
  deleteTokenLogs,
  resetDefaultTokenLogs, 
  clearAllTokenLogs,
  subscribeToFirestoreTokenLogs, 
  AUTOMATIQA_MODULES,
  calculateCreditsConsumed,
  calculateInputTier,
  formatToIST,
  TOTAL_CREDIT_POOL,
  BASIC_PLAN_CONFIG,
  getBasicPlanValidity,
  getUserCreditSummary,
  topUpCredits,
  resetBasicPlanStartDate
} from '../services/tokenConsumptionService';
import {
  getSubscriptionRequests,
  getLocalSubscriptionRequests,
  reEnableUserSubscription,
  grantDirectSubscription,
  createSubscriptionRequest
} from '../services/subscriptionService';

interface CreditConsumptionProps {
  currentUser: User;
  activeProject?: Project | null;
  projects?: Project[];
}

export const CreditConsumption: React.FC<CreditConsumptionProps> = ({ currentUser, activeProject, projects = [] }) => {
  const [logs, setLogs] = useState<TokenLog[]>(() => getTokenLogs());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('All');
  const [selectedFeature, setSelectedFeature] = useState<string>('All');
  const [selectedTier, setSelectedTier] = useState<string>('All');
  const [selectedCacheStatus, setSelectedCacheStatus] = useState<string>('All');
  const [sortField, setSortField] = useState<'timestamp' | 'creditsConsumed' | 'itemsGenerated'>('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isSimulateModalOpen, setIsSimulateModalOpen] = useState(false);
  const [inspectLog, setInspectLog] = useState<TokenLog | null>(null);
  
  // Navigation Tabs: Overview, Subscription Management, Logs, Rate Card (Calculator removed per user request)
  const [activeTab, setActiveTab] = useState<'credits_overview' | 'subscription_management' | 'consumption_table' | 'rate_card'>('credits_overview');

  // Subscription Management state
  const [subscriptionRequests, setSubscriptionRequests] = useState<SubscriptionRequest[]>(() => getLocalSubscriptionRequests());
  const [isApproving, setIsApproving] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Plan validity state
  const [validityInfo, setValidityInfo] = useState(() => getBasicPlanValidity());

  // Multi-select and delete state
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    open: boolean;
    ids: string[];
    title: string;
    message: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Simulation form states
  const [simFeature, setSimFeature] = useState<string>(AUTOMATIQA_MODULES[0].name);
  const [simProject, setSimProject] = useState<string>(activeProject?.name || projects[0]?.name || 'Global Retail Banking App');
  const [simUserStoryId, setSimUserStoryId] = useState('US-101');
  const [simModality, setSimModality] = useState<'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal'>('Multimodal');
  const [simModalityDetails, setSimModalityDetails] = useState('2 Wireframe Screenshots + PRD Document');
  const [simItemsGenerated, setSimItemsGenerated] = useState<number>(5);
  const [simCached, setSimCached] = useState<boolean>(false);

  // Sync with Firestore & localStorage
  useEffect(() => {
    const unsubscribe = subscribeToFirestoreTokenLogs((firestoreLogs) => {
      setLogs(firestoreLogs);
      setValidityInfo(getBasicPlanValidity());
    });

    const refreshSubs = async () => {
      const subs = await getSubscriptionRequests();
      setSubscriptionRequests(subs);
    };
    refreshSubs();

    const handleSubUpdate = () => {
      setSubscriptionRequests(getLocalSubscriptionRequests());
      setLogs(getTokenLogs());
      setValidityInfo(getBasicPlanValidity());
    };

    window.addEventListener('subscription-request-updated', handleSubUpdate);
    window.addEventListener('token-consumption-updated', handleSubUpdate);

    return () => {
      unsubscribe();
      window.removeEventListener('subscription-request-updated', handleSubUpdate);
      window.removeEventListener('token-consumption-updated', handleSubUpdate);
    };
  }, []);

  const refreshValidity = () => {
    setValidityInfo(getBasicPlanValidity());
  };

  // Helper icons for modules
  const getModuleIcon = (featureName: string) => {
    const lower = featureName.toLowerCase();
    if (lower.includes('user story') || lower.includes('requirement')) return <Sparkles size={16} className="text-amber-500" />;
    if (lower.includes('scenario')) return <Layers size={16} className="text-blue-500" />;
    if (lower.includes('manual') || lower.includes('case')) return <FileText size={16} className="text-emerald-500" />;
    if (lower.includes('script') || lower.includes('cypress') || lower.includes('playwright')) return <Terminal size={16} className="text-purple-500" />;
    if (lower.includes('performance') || lower.includes('load')) return <Activity size={16} className="text-rose-500" />;
    if (lower.includes('api')) return <Globe size={16} className="text-cyan-500" />;
    if (lower.includes('ui') || lower.includes('visual')) return <ImageIcon size={16} className="text-indigo-500" />;
    if (lower.includes('record') || lower.includes('play')) return <Video size={16} className="text-orange-500" />;
    if (lower.includes('mobile')) return <Smartphone size={16} className="text-teal-500" />;
    return <Cpu size={16} className="text-slate-500" />;
  };

  // Distinct projects and features
  const uniqueProjects = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(l => { if (l.project) set.add(l.project); });
    return ['All', ...Array.from(set)];
  }, [logs]);

  const uniqueFeatures = useMemo(() => {
    return ['All', ...AUTOMATIQA_MODULES.map(m => m.name)];
  }, []);

  // Filtered & Sorted logs
  const filteredLogs = useMemo(() => {
    return logs
      .filter(log => {
        const matchesSearch = 
          searchTerm === '' ||
          log.feature.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (log.userEmail && log.userEmail.toLowerCase().includes(searchTerm.toLowerCase())) ||
          log.project.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (log.userStoryId && log.userStoryId.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (log.inputModality && log.inputModality.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (log.inputModalityDetails && log.inputModalityDetails.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (log.outputType && log.outputType.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (log.workspace && log.workspace.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesProject = selectedProject === 'All' || log.project === selectedProject;
        const matchesFeature = selectedFeature === 'All' || log.feature === selectedFeature;
        const tier = log.tier || calculateInputTier(log).tier;
        const matchesTier = selectedTier === 'All' || tier === selectedTier;
        const matchesCache = selectedCacheStatus === 'All' || 
          (selectedCacheStatus === 'Cached' && log.cached) || 
          (selectedCacheStatus === 'Standard' && !log.cached);

        return matchesSearch && matchesProject && matchesFeature && matchesTier && matchesCache;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'timestamp') {
          diff = a.timestamp - b.timestamp;
        } else if (sortField === 'creditsConsumed') {
          const aCredits = a.creditsConsumed ?? calculateCreditsConsumed(a.feature, a.itemsGenerated || 1, a.cached);
          const bCredits = b.creditsConsumed ?? calculateCreditsConsumed(b.feature, b.itemsGenerated || 1, b.cached);
          diff = aCredits - bCredits;
        } else if (sortField === 'itemsGenerated') {
          diff = (a.itemsGenerated || 1) - (b.itemsGenerated || 1);
        }
        return sortDirection === 'asc' ? diff : -diff;
      });
  }, [logs, searchTerm, selectedProject, selectedFeature, selectedTier, selectedCacheStatus, sortField, sortDirection]);

  // Normalization helper to map any variation to the official 10 AUTOMATIQA_MODULES names
  const normalizeModuleName = (feat: string): string => {
    if (!feat) return 'AI Test Cases generation';
    const lower = feat.toLowerCase().trim();
    if (lower.includes('mobile') || lower.includes('appium')) {
      return 'Automation - Record and play - Mobile app';
    }
    if (lower.includes('test case') || lower.includes('test cases') || lower.includes('generatetestcases') || lower.includes('case')) {
      return 'AI Test Cases generation';
    }
    if (lower.includes('user stor')) {
      return 'AI User stories generation';
    }
    if (lower.includes('scenario')) {
      return 'AI Test Scenario generation';
    }
    if (lower.includes('script generator') || lower.includes('generatescript') || lower.includes('generateautomationscript')) {
      return 'Automation - script generator';
    }
    if (lower.includes('web app') && !lower.includes('mobile')) {
      return 'Automation - Record and play - Web app';
    }
    if (lower.includes('ui testing') || lower.includes('figma') || lower.includes('visual')) {
      return 'UI testing';
    }
    if (lower.includes('api testing') || lower.includes('apisuit')) {
      return 'API testing';
    }
    if (lower.includes('api performance') || lower.includes('jmeter')) {
      return 'API performance testing';
    }
    if (lower.includes('web performance') || lower.includes('lighthouse')) {
      return 'Web performance testing';
    }
    const matched = AUTOMATIQA_MODULES.find(m => m.name.toLowerCase() === lower);
    return matched ? matched.name : feat;
  };

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    let totalCreditsUsed = 0;
    let totalGenerations = logs.length;
    let cachedGenerationsCount = 0;

    const moduleDistribution: Record<string, { count: number; credits: number; items: number }> = {};
    const userDistribution: Record<string, { count: number; credits: number; email: string }> = {};

    logs.forEach(log => {
      const credits = log.creditsConsumed ?? calculateCreditsConsumed(log.feature, log.itemsGenerated || 1, log.cached);
      totalCreditsUsed += credits;
      if (log.cached) cachedGenerationsCount++;

      // Normalized module breakdown
      const normalizedMod = normalizeModuleName(log.feature);
      if (!moduleDistribution[normalizedMod]) {
        moduleDistribution[normalizedMod] = { count: 0, credits: 0, items: 0 };
      }
      moduleDistribution[normalizedMod].count++;
      moduleDistribution[normalizedMod].credits += credits;
      moduleDistribution[normalizedMod].items += (log.itemsGenerated || 1);

      // User breakdown
      const userKey = log.user || 'Unknown User';
      if (!userDistribution[userKey]) {
        userDistribution[userKey] = { count: 0, credits: 0, email: log.userEmail || `${userKey.toLowerCase().replace(/\s+/g, '')}@qaoncloud.com` };
      }
      userDistribution[userKey].count++;
      userDistribution[userKey].credits += credits;
    });

    const remainingCredits = Math.max(0, TOTAL_CREDIT_POOL - totalCreditsUsed);
    const percentageUsed = Math.min(100, Math.round((totalCreditsUsed / TOTAL_CREDIT_POOL) * 100));

    return {
      totalCreditsPool: TOTAL_CREDIT_POOL,
      totalCreditsUsed,
      remainingCredits,
      percentageUsed,
      totalGenerations,
      cachedGenerationsCount,
      moduleDistribution,
      userDistribution
    };
  }, [logs]);

  // Current user's credit status
  const currentUserEmail = currentUser?.email || 'sowbarnya@qaoncloud.com';
  const currentUserCreditSummary = useMemo(() => {
    return getUserCreditSummary(currentUserEmail);
  }, [currentUserEmail, logs]);

  const isQuotaExceeded = currentUserCreditSummary.isExceeded || summaryMetrics.totalCreditsUsed >= TOTAL_CREDIT_POOL;

  // Sorting helper
  const handleSort = (field: 'timestamp' | 'creditsConsumed' | 'itemsGenerated') => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Selection helpers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedLogIds(filteredLogs.map(l => l.id));
    } else {
      setSelectedLogIds([]);
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedLogIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Delete Handlers
  const handleDeleteSelected = async () => {
    if (selectedLogIds.length === 0) return;
    setIsDeleting(true);
    try {
      await deleteTokenLogs(selectedLogIds);
      setSelectedLogIds([]);
      setDeleteConfirmModal(null);
      refreshValidity();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteSingle = async (id: string) => {
    setIsDeleting(true);
    try {
      await deleteTokenLog(id);
      setSelectedLogIds(prev => prev.filter(x => x !== id));
      setDeleteConfirmModal(null);
      refreshValidity();
    } finally {
      setIsDeleting(false);
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    const headers = [
      'Transaction ID',
      'Date (IST)',
      'Workspace',
      'Project',
      'User Name',
      'User Email',
      'User Story ID',
      'AutomatiQA Module',
      'Input Modality',
      'Modality Details',
      'Output Type',
      'Items Generated',
      'Credits Consumed',
      'Generation Tier',
      'Context Cached'
    ];

    const rows = filteredLogs.map(log => {
      const credits = log.creditsConsumed ?? calculateCreditsConsumed(log.feature, log.itemsGenerated || 1, log.cached);
      const tierInfo = log.tier ? { tier: log.tier } : calculateInputTier(log);

      return [
        `"${log.id}"`,
        `"${log.date || formatToIST(log.timestamp)}"`,
        `"${log.workspace || 'AutomatiQA Global'}"`,
        `"${log.project || 'Default Project'}"`,
        `"${log.user || 'Unknown'}"`,
        `"${log.userEmail || ''}"`,
        `"${log.userStoryId || 'US-GENERAL'}"`,
        `"${log.feature}"`,
        `"${log.inputModality || 'Text'}"`,
        `"${(log.inputModalityDetails || '').replace(/"/g, '""')}"`,
        `"${(log.outputType || '').replace(/"/g, '""')}"`,
        log.itemsGenerated || 1,
        credits,
        `"${tierInfo.tier}"`,
        log.cached ? 'Yes' : 'No'
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `automatiqa_credit_consumption_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Simulation Submission
  const handleSimulateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const credits = calculateCreditsConsumed(simFeature, simItemsGenerated, simCached);
    const tierInfo = calculateInputTier(simItemsGenerated);

    const newLog: Omit<TokenLog, 'id'> = {
      timestamp: Date.now(),
      date: formatToIST(Date.now()),
      user: currentUser?.name || 'Sowbarnya S',
      userEmail: currentUser?.email || 'sowbarnya@qaoncloud.com',
      project: simProject,
      userStoryId: simUserStoryId,
      feature: simFeature,
      model: 'AutomatiQA AI Engine',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      responseTimeSeconds: 1.2,
      cached: simCached,
      inputModality: simModality,
      inputModalityDetails: simModalityDetails,
      outputType: `${simItemsGenerated} ${simFeature} Artifacts`,
      itemsGenerated: simItemsGenerated,
      tier: tierInfo.tier,
      creditsConsumed: credits,
      workspace: 'AutomatiQA Global Workspace'
    };

    await addTokenLog(newLog);
    setIsSimulateModalOpen(false);
    refreshValidity();
  };

  // Super Admin Action Handlers for Subscriptions
  const handleApproveSubscription = async (requestId: string, userEmail: string, userName: string) => {
    setIsApproving(requestId);
    try {
      await reEnableUserSubscription(
        requestId,
        userEmail,
        userName,
        currentUser.email || 'automatiqa@qaoncloud.com',
        1000,
        32
      );
      setActionSuccessMessage(`Successfully re-enabled subscription for ${userName} (${userEmail}) with 1,000 Credits and 32 Days validity.`);
      setSubscriptionRequests(getLocalSubscriptionRequests());
      setLogs(getTokenLogs());
      setValidityInfo(getBasicPlanValidity());
      setTimeout(() => setActionSuccessMessage(null), 6000);
    } catch (err: any) {
      console.error("Failed to approve subscription:", err);
    } finally {
      setIsApproving(null);
    }
  };

  const handleDirectGrant = async (userEmail: string, userName: string) => {
    setIsApproving(userEmail);
    try {
      await grantDirectSubscription(
        userEmail,
        userName,
        currentUser.email || 'automatiqa@qaoncloud.com',
        1000,
        32
      );
      setActionSuccessMessage(`Directly granted and re-enabled 1,000 Credits & 32-day validity to ${userName} (${userEmail}).`);
      setSubscriptionRequests(getLocalSubscriptionRequests());
      setLogs(getTokenLogs());
      setValidityInfo(getBasicPlanValidity());
      setTimeout(() => setActionSuccessMessage(null), 6000);
    } catch (err: any) {
      console.error("Failed to grant subscription:", err);
    } finally {
      setIsApproving(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-16">
      {/* HEADER HERO BANNER */}
      <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden border border-slate-800 shadow-xl">
        <div className="absolute -right-16 -top-16 w-80 h-80 bg-gradient-to-br from-[#00E1C5]/20 to-teal-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute right-32 -bottom-20 w-60 h-60 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-[11px] font-black tracking-widest uppercase text-[#00E1C5] border border-white/10">
              <Award size={14} className="text-[#00E1C5]" />
              AutomatiQA AI Credit Allocation & Usage Analytics
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
              Credit Consumption & Analytics
            </h1>
            <p className="text-sm text-slate-300 font-medium max-w-3xl leading-relaxed">
              Real-time credit allocation, consumption tracking, and plan validity for all 10 AI generation modules in AutomatiQA. The Standard Basic Plan includes 1,000 credit points with a total validity of 32 days, comprising an initial 2-day exploration period followed by a 30-day active plan period. Credits will be deducted for any AI generation performed during both the 2-day exploration period and the subsequent 30-day plan period.
            </p>

            {/* Quick Plan Validity Sub-Badge */}
            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 rounded-xl border border-slate-700 font-bold text-slate-200">
                <Calendar size={14} className="text-[#00E1C5]" />
                <span>Validity: <strong className="text-white">{validityInfo.daysRemaining} Days Left</strong> (32 Days Pack)</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 rounded-xl border border-slate-700 font-bold text-slate-200">
                <Coins size={14} className="text-amber-400" />
                <span>Balance: <strong className="text-[#00E1C5] font-mono">{summaryMetrics.remainingCredits}</strong> / {summaryMetrics.totalCreditsPool} Credits</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 rounded-xl border border-slate-700 font-bold text-slate-200">
                <ShieldCheck size={14} className="text-emerald-400" />
                <span>Non-AI Features: <strong className="text-emerald-400">100% Free & Unlimited</strong></span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start lg:self-center">
            <button
              onClick={() => setActiveTab('subscription_management')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all ${
                activeTab === 'subscription_management'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
              }`}
            >
              <Crown size={14} className="text-amber-400" /> Subscription Requests
              {subscriptionRequests.filter(r => r.status === 'PENDING').length > 0 && (
                <span className="px-1.5 py-0.5 bg-rose-500 text-white rounded-full text-[10px] font-black">
                  {subscriptionRequests.filter(r => r.status === 'PENDING').length}
                </span>
              )}
            </button>

            <button
              onClick={() => setIsSimulateModalOpen(true)}
              className="flex items-center gap-2 bg-[#00E1C5] text-slate-950 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider hover:bg-[#00cbb2] shadow-lg shadow-[#00E1C5]/20 active:scale-95 transition-all"
            >
              <Plus size={16} /> Simulate Usage
            </button>

            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider border border-white/10 active:scale-95 transition-all"
              title="Export all credit records as CSV"
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* NAVIGATION TABS */}
      <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm w-fit max-w-full overflow-x-auto">
        <button
          onClick={() => setActiveTab('credits_overview')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
            activeTab === 'credits_overview'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Award size={14} className={activeTab === 'credits_overview' ? 'text-[#00E1C5]' : 'text-slate-400'} />
          Overview & Module Credits
        </button>

        <button
          onClick={() => setActiveTab('subscription_management')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
            activeTab === 'subscription_management'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Crown size={14} className={activeTab === 'subscription_management' ? 'text-amber-400' : 'text-slate-400'} />
          Subscription Requests & Super Admin Controls
          {subscriptionRequests.filter(r => r.status === 'PENDING').length > 0 && (
            <span className="px-2 py-0.5 bg-rose-500 text-white rounded-full text-[10px] font-black animate-pulse">
              {subscriptionRequests.filter(r => r.status === 'PENDING').length} Pending
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('consumption_table')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
            activeTab === 'consumption_table'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Coins size={14} className={activeTab === 'consumption_table' ? 'text-teal-400' : 'text-slate-400'} />
          Detailed Consumption Logs ({logs.length})
        </button>

        <button
          onClick={() => setActiveTab('rate_card')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
            activeTab === 'rate_card'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Zap size={14} className={activeTab === 'rate_card' ? 'text-amber-400' : 'text-slate-400'} />
          Module Credit Rate Card
        </button>
      </div>

      {/* TAB 1: OVERVIEW & MODULE CREDITS */}
      {activeTab === 'credits_overview' && (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* BASIC PLAN HERO STATUS CARD */}
          <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-900 rounded-[2.5rem] p-8 text-white border border-indigo-800/40 shadow-2xl relative overflow-hidden">
            <div className="relative z-10 space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-indigo-900/60">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gradient-to-tr from-[#00E1C5] to-teal-500 rounded-2xl flex items-center justify-center text-slate-950 shadow-lg font-black text-xl">
                    <Coins size={28} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 rounded-full text-[10px] font-black uppercase tracking-widest">
                        {BASIC_PLAN_CONFIG.planName}
                      </span>
                      <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                        <CheckCircle2 size={10} /> Active
                      </span>
                    </div>
                    <h2 className="text-2xl font-black text-white mt-1">
                      1,000 Credit Points Standard Pool
                    </h2>
                    <p className="text-xs text-slate-300 font-medium mt-0.5">
                      Includes 32 Days Full Validity ({BASIC_PLAN_CONFIG.trialDays}-day initial trial + {BASIC_PLAN_CONFIG.activePackDays}-day validity pack)
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => {
                      if (window.confirm('Reset the 32-day validity period from today?')) {
                        resetBasicPlanStartDate();
                        refreshValidity();
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all border border-white/10"
                  >
                    <RefreshCw size={12} /> Reset 32-Day Period
                  </button>

                  <button
                    onClick={() => {
                      const added = prompt('Enter credit amount to add (e.g. 500):', '500');
                      if (added && !isNaN(Number(added))) {
                        topUpCredits(Number(added), currentUserEmail);
                        refreshValidity();
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-[#00E1C5] text-slate-950 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-[#00cbb2] transition-all shadow-md"
                  >
                    <Plus size={14} /> Top-Up Credits (+500)
                  </button>
                </div>
              </div>

              {/* Quota Progress Bar & Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 block">Total Credit Pool</span>
                  <div className="text-2xl font-black text-white font-mono flex items-baseline gap-1">
                    {TOTAL_CREDIT_POOL.toLocaleString()} <span className="text-xs text-[#00E1C5] font-normal">pts</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">Standard quota for workspace</span>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 block">Credits Consumed</span>
                  <div className="text-2xl font-black text-amber-400 font-mono flex items-baseline gap-1">
                    {summaryMetrics.totalCreditsUsed.toLocaleString()} <span className="text-xs text-amber-300 font-normal">pts ({summaryMetrics.percentageUsed}%)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">Across all 10 AI generator modules</span>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 block">Remaining Balance</span>
                  <div className="text-2xl font-black text-[#00E1C5] font-mono flex items-baseline gap-1">
                    {summaryMetrics.remainingCredits.toLocaleString()} <span className="text-xs text-teal-300 font-normal">pts left</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">Ready for immediate generation</span>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 block">Plan Validity Countdown</span>
                  <div className="text-2xl font-black text-indigo-300 font-mono flex items-baseline gap-1">
                    {validityInfo.daysRemaining} <span className="text-xs text-indigo-200 font-normal">of 32 Days</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">Valid until {validityInfo.packEndDateFormatted}</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-300">Workspace Credit Utilization</span>
                  <span className={summaryMetrics.percentageUsed >= 90 ? 'text-rose-400 font-black' : summaryMetrics.percentageUsed >= 75 ? 'text-amber-400 font-black' : 'text-[#00E1C5] font-black'}>
                    {summaryMetrics.percentageUsed}% Utilized ({summaryMetrics.totalCreditsUsed} / {TOTAL_CREDIT_POOL} Credits)
                  </span>
                </div>
                <div className="w-full bg-slate-800/80 h-3 rounded-full overflow-hidden p-0.5 border border-slate-700">
                  <div 
                    className={`h-full rounded-full transition-all duration-700 ${
                      summaryMetrics.percentageUsed >= 90 
                        ? 'bg-gradient-to-r from-amber-500 to-rose-500' 
                        : summaryMetrics.percentageUsed >= 75 
                        ? 'bg-gradient-to-r from-teal-400 to-amber-400' 
                        : 'bg-gradient-to-r from-teal-400 to-[#00E1C5]'
                    }`}
                    style={{ width: `${Math.max(2, summaryMetrics.percentageUsed)}%` }}
                  />
                </div>
              </div>

              {/* OVER-QUOTA NOTICE BANNER */}
              {isQuotaExceeded && (
                <div className="p-4 bg-rose-500/20 border border-rose-500/40 rounded-2xl flex items-start gap-4">
                  <AlertTriangle size={20} className="text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-black text-rose-200">1,000 Credit Limit Reached</h4>
                    <p className="text-xs text-rose-300 leading-relaxed font-medium">
                      AI generation features are temporarily paused until top-up. 
                      <strong className="text-white"> All manual test cases, manual executions, test script runs, record & play, and reports remain 100% functional and unlimited.</strong>
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 5 OVERVIEW METRIC CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-3">
                <span className="text-[10px] font-black uppercase tracking-wider">Total Credit Pool</span>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl"><Coins size={16} /></div>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900 font-mono">1,000</p>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">Standard Basic Quota</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-3">
                <span className="text-[10px] font-black uppercase tracking-wider">Used Credits</span>
                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl"><Zap size={16} /></div>
              </div>
              <div>
                <p className="text-2xl font-black text-amber-600 font-mono">{summaryMetrics.totalCreditsUsed}</p>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">{summaryMetrics.percentageUsed}% of total allocation</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-3">
                <span className="text-[10px] font-black uppercase tracking-wider">Remaining Credits</span>
                <div className="p-2 bg-teal-50 text-[#00a693] rounded-xl"><CheckCircle2 size={16} /></div>
              </div>
              <div>
                <p className="text-2xl font-black text-[#00a693] font-mono">{summaryMetrics.remainingCredits}</p>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">Available for generation</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-3">
                <span className="text-[10px] font-black uppercase tracking-wider">Total AI Generations</span>
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl"><Layers size={16} /></div>
              </div>
              <div>
                <p className="text-2xl font-black text-blue-600 font-mono">{summaryMetrics.totalGenerations}</p>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">Across all 10 modules</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-3">
                <span className="text-[10px] font-black uppercase tracking-wider">Plan Validity</span>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl"><Calendar size={16} /></div>
              </div>
              <div>
                <p className="text-2xl font-black text-purple-600 font-mono">{validityInfo.daysRemaining}d Left</p>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">Expires {validityInfo.packEndDateFormatted}</p>
              </div>
            </div>
          </div>

          {/* USER CREDIT ALLOCATION & CONSUMPTION TABLE */}
          <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200/80 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <UserCheck size={18} className="text-indigo-600" />
                  User Account Credit Allocations & Alert Thresholds
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  AutomatiQA sends real-time email & in-app alerts at 25%, 50%, 75%, and 100% credit consumption thresholds.
                </p>
              </div>
              <span className="text-xs font-bold text-slate-400">
                {Object.keys(summaryMetrics.userDistribution).length} Active Account(s)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200">
                    <th className="py-3.5 px-4">User Account</th>
                    <th className="py-3.5 px-4 text-center">Allocated Quota</th>
                    <th className="py-3.5 px-4 text-center">Used Credits</th>
                    <th className="py-3.5 px-4 text-center">Remaining Balance</th>
                    <th className="py-3.5 px-4">Usage %</th>
                    <th className="py-3.5 px-4 text-center">Alert Threshold</th>
                    <th className="py-3.5 px-4 text-center">AI Generations</th>
                    <th className="py-3.5 px-4 text-center">Super Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {Object.entries(summaryMetrics.userDistribution).map(([name, data], idx) => {
                    const pool = TOTAL_CREDIT_POOL;
                    const used = data.credits;
                    const remaining = Math.max(0, pool - used);
                    const pct = Math.min(100, Math.round((used / pool) * 100));

                    return (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0">
                              {name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 text-xs">{name}</p>
                              <p className="text-[10px] text-slate-400 font-medium font-mono">{data.email}</p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-700">
                          {pool} pts
                        </td>

                        <td className="py-3.5 px-4 text-center font-mono font-bold text-amber-600">
                          {used} pts
                        </td>

                        <td className="py-3.5 px-4 text-center font-mono font-bold text-[#00a693]">
                          {remaining} pts
                        </td>

                        <td className="py-3.5 px-4 min-w-[160px]">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px] font-bold text-slate-600">
                              <span>{pct}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${
                                  pct >= 90 ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-500' : 'bg-[#00E1C5]'
                                }`} 
                                style={{ width: `${pct}%` }} 
                              />
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          {pct >= 100 ? (
                            <span className="px-2 py-0.5 bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-black rounded-md">
                              100% Gated
                            </span>
                          ) : pct >= 75 ? (
                            <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-black rounded-md">
                              75% Warning
                            </span>
                          ) : pct >= 50 ? (
                            <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-black rounded-md">
                              50% Milestone
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black rounded-md">
                              25% Normal
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-800">
                          {data.count}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleDirectGrant(data.email, name)}
                            disabled={isApproving === data.email}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl font-bold text-[11px] transition-all shadow-sm active:scale-95 disabled:opacity-50"
                            title="Re-enable subscription with 1,000 fresh credits and 32 days validity"
                          >
                            <Crown size={12} className="text-amber-500" />
                            {isApproving === data.email ? 'Enabling...' : 'Re-Enable / Grant (+1,000)'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ALL 10 AUTOMATIQA MODULES CREDIT CONSUMPTION GRID */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  <Zap size={20} className="text-[#00E1C5]" />
                  AutomatiQA 10 AI Generator Modules & Credit Consumption
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Pre-configured credit rates per generation across all 10 specialized testing and generation features
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {AUTOMATIQA_MODULES.map((mod) => {
                const stats = summaryMetrics.moduleDistribution[mod.name] || { count: 0, credits: 0, items: 0 };
                const creditCost = calculateCreditsConsumed(mod.name, 1, false);

                return (
                  <div 
                    key={mod.id} 
                    className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all flex flex-col justify-between group"
                  >
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                            {getModuleIcon(mod.name)}
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors leading-tight">
                              {mod.name}
                            </h4>
                            <p className="text-[10px] text-slate-400 font-mono font-bold mt-0.5">
                              {creditCost} {creditCost === 1 ? 'Credit' : 'Credits'} / Button Click
                            </p>
                          </div>
                        </div>

                        <span className="px-2.5 py-1 bg-teal-50 border border-teal-200 text-[#008f7d] text-xs font-black rounded-xl shrink-0">
                          {creditCost} {creditCost === 1 ? 'Credit' : 'Credits'}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 font-medium leading-relaxed">
                        {mod.description}
                      </p>

                      <div className="space-y-1.5 pt-2 border-t border-slate-100 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-medium">Input Modalities:</span>
                          <span className="text-slate-800 font-bold max-w-[180px] truncate text-right">{mod.inputTypes.join(', ')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-medium">Output Artifacts:</span>
                          <span className="text-slate-800 font-bold max-w-[180px] truncate text-right">{mod.outputType}</span>
                        </div>
                      </div>
                    </div>

                    {/* Module Usage Footer */}
                    <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs bg-slate-50/60 -mx-6 -mb-6 p-4 rounded-b-3xl">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">Executions</span>
                        <span className="font-bold text-slate-900 font-mono">{stats.count} Runs</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Credits Used</span>
                        <span className="font-black text-[#00a693] font-mono">{stats.credits} Credits</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AUTOMATIQA AI GENERATION CREDIT STANDARDS */}
          <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200/80 shadow-sm space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-600" />
                AutomatiQA AI Generation Button-Click Credit Rules
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Credits are strictly deducted only when you click an AI Generation button. Input tokens, document pages, and output counts do not alter credit consumption.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex items-center gap-2 text-indigo-600 font-bold">
                  <Sparkles size={14} /> AI User Stories & Scenarios
                </div>
                <p className="text-slate-600 leading-relaxed font-medium">
                  <strong>1 Credit</strong> per click on <em>Generate AI user stories</em>. <strong>5 Credits</strong> per click on <em>Generate AI Scenarios</em>.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex items-center gap-2 text-purple-600 font-bold">
                  <CheckSquare size={14} /> AI Test Cases Generator
                </div>
                <p className="text-slate-600 leading-relaxed font-medium">
                  <strong>10 Credits</strong> per click on <em>GENERATE AI TEST CASES</em> or <em>AI GENERATE SELECTED</em> (1 click = 10 credits).
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex items-center gap-2 text-blue-600 font-bold">
                  <FileText size={14} /> Automation & Testing Suites
                </div>
                <p className="text-slate-600 leading-relaxed font-medium">
                  <strong>50 Credits</strong> for Script Generator & Record/Play. <strong>100 Credits</strong> for API & Web Performance Testing.
                </p>
              </div>

              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 font-bold">
                  <CheckCircle2 size={14} /> Cache Optimization
                </div>
                <p className="text-emerald-800 leading-relaxed font-medium">
                  Identical prompt re-runs are automatically retrieved from the intelligent cache at <strong>0 Credits</strong> (Free).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SUBSCRIPTION REQUESTS & SUPER ADMIN RE-ENABLEMENT CONTROLS */}
      {activeTab === 'subscription_management' && (
        <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200/80 shadow-sm space-y-8 animate-in fade-in duration-200">
          <div className="border-b border-slate-100 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-indigo-600 text-xs font-black uppercase tracking-widest mb-1">
                <Crown size={16} className="text-amber-500" /> Super Admin Subscription & Credit Re-Enablement
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                User Subscription Approval & Credit Allocation
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                When a user exceeds their 1,000 credit limit, they click "Subscribe" in the credit alert popup. As Super Admin, review pending requests and re-enable subscriptions with 1,000 new credits and 32 days validity.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-700 text-xs font-bold flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-indigo-600" />
                Super Admin Role Active
              </span>
            </div>
          </div>

          {actionSuccessMessage && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-xs font-bold animate-in fade-in">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              <span>{actionSuccessMessage}</span>
            </div>
          )}

          {/* QUICK SUMMARY CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">Pending Requests</span>
              <div className="text-2xl font-black text-amber-600 font-mono">
                {subscriptionRequests.filter(r => r.status === 'PENDING').length}
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-0.5">Awaiting Super Admin approval</p>
            </div>

            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">Approved & Active</span>
              <div className="text-2xl font-black text-emerald-600 font-mono">
                {subscriptionRequests.filter(r => r.status === 'APPROVED').length}
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-0.5">Subscriptions enabled</p>
            </div>

            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">Standard Pack Refill</span>
              <div className="text-2xl font-black text-indigo-600 font-mono">+1,000 pts / 32d</div>
              <p className="text-[11px] text-slate-400 font-medium mt-0.5">2d exploration + 30d active plan</p>
            </div>
          </div>

          {/* PENDING SUBSCRIPTION REQUESTS TABLE */}
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Crown size={16} className="text-amber-500" />
              Incoming Subscription Requests from Gated Users
            </h3>

            {subscriptionRequests.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
                <Crown size={32} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm font-bold text-slate-700">No Subscription Requests Yet</p>
                <p className="text-xs text-slate-400 mt-1">
                  When a user clicks "Subscribe" after hitting 1,000 credits, their request appears here for approval. You can also directly re-enable any user in the table below.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200">
                      <th className="py-3.5 px-4">User</th>
                      <th className="py-3.5 px-4">Requested At</th>
                      <th className="py-3.5 px-4 text-center">Status</th>
                      <th className="py-3.5 px-4 text-center">Credits Requested</th>
                      <th className="py-3.5 px-4">Notes</th>
                      <th className="py-3.5 px-4 text-center">Super Admin Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {subscriptionRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3.5 px-4">
                          <p className="font-bold text-slate-900">{req.userName}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{req.userEmail}</p>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                          {req.requestedAtFormatted || new Date(req.requestedAt).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {req.status === 'PENDING' ? (
                            <span className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 font-bold rounded-lg text-[10px] inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></span>
                              Pending Approval
                            </span>
                          ) : req.status === 'APPROVED' ? (
                            <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold rounded-lg text-[10px]">
                              Approved & Active
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-600 font-bold rounded-lg text-[10px]">
                              {req.status}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono font-bold text-indigo-600">
                          {req.requestedCredits || 1000} pts
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 text-[11px] max-w-[200px] truncate">
                          {req.notes || '1000 credits limit reached. Requesting re-enablement.'}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {req.status === 'PENDING' ? (
                            <button
                              onClick={() => handleApproveSubscription(req.id, req.userEmail, req.userName)}
                              disabled={isApproving === req.id}
                              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#00E1C5] hover:bg-[#00cbb2] text-slate-950 font-black rounded-xl text-xs shadow-md transition-all active:scale-95 disabled:opacity-50"
                            >
                              <CheckCircle2 size={14} />
                              {isApproving === req.id ? 'Approving...' : 'Approve & Re-Enable (+1,000)'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDirectGrant(req.userEmail, req.userName)}
                              disabled={isApproving === req.userEmail}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-[11px] transition-all disabled:opacity-50"
                            >
                              <RefreshCw size={12} />
                              {isApproving === req.userEmail ? 'Re-granting...' : 'Re-grant Plan'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* DIRECT USER RE-ENABLEMENT PANEL */}
          <div className="p-6 bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-3xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white/10 rounded-xl text-[#00E1C5]">
                <UserPlus size={20} />
              </div>
              <div>
                <h4 className="text-base font-black text-white">Direct User Subscription Grant</h4>
                <p className="text-xs text-slate-300 font-medium">
                  Select any user account to immediately re-enable their subscription with a fresh 1,000 credit allocation and 32 days validity.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              {Object.entries(summaryMetrics.userDistribution).map(([name, data], i) => (
                <div key={i} className="bg-white/10 backdrop-blur-md p-3.5 rounded-2xl border border-white/10 flex flex-col justify-between space-y-2">
                  <div>
                    <p className="font-bold text-white text-xs">{name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{data.email}</p>
                    <p className="text-[10px] text-amber-300 font-mono mt-1 font-bold">Used: {data.credits} / 1000 pts</p>
                  </div>

                  <button
                    onClick={() => handleDirectGrant(data.email, name)}
                    disabled={isApproving === data.email}
                    className="w-full py-1.5 bg-[#00E1C5] hover:bg-[#00cbb2] text-slate-950 font-black rounded-lg text-[11px] transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    <Crown size={12} />
                    {isApproving === data.email ? 'Granting...' : 'Re-Enable (+1000)'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DETAILED CONSUMPTION LOGS TABLE */}
      {activeTab === 'consumption_table' && (
        <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200/80 shadow-sm space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <Coins size={20} className="text-[#00E1C5]" />
                Detailed Credit Consumption Logs
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Every AI generation transaction with workspace, project, user, module, and exact credit points consumed.
              </p>
            </div>

            {selectedLogIds.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500">
                  {selectedLogIds.length} Selected
                </span>
                <button
                  onClick={() => {
                    setDeleteConfirmModal({
                      open: true,
                      ids: selectedLogIds,
                      title: `Delete ${selectedLogIds.length} Log(s)`,
                      message: `Are you sure you want to delete ${selectedLogIds.length} selected consumption record(s)?`
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold hover:bg-rose-100 transition-all"
                >
                  <Trash2 size={14} /> Delete Selected
                </button>
              </div>
            )}
          </div>

          {/* FILTER BAR */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search user, project, story ID, module..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 ring-indigo-500/20"
              />
            </div>

            <div>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
              >
                {uniqueProjects.map(p => (
                  <option key={p} value={p}>Project: {p}</option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={selectedFeature}
                onChange={(e) => setSelectedFeature(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
              >
                {uniqueFeatures.map(f => (
                  <option key={f} value={f}>Module: {f}</option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={selectedCacheStatus}
                onChange={(e) => setSelectedCacheStatus(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
              >
                <option value="All">Cache: All Statuses</option>
                <option value="Standard">Standard Execution</option>
                <option value="Cached">Cached (0 Credits)</option>
              </select>
            </div>
          </div>

          {/* CONSUMPTION LOGS TABLE */}
          <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200 select-none">
                  <th className="py-3.5 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={filteredLogs.length > 0 && selectedLogIds.length === filteredLogs.length}
                      onChange={handleSelectAll}
                      className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
                    />
                  </th>
                  <th className="py-3.5 px-4 cursor-pointer" onClick={() => handleSort('timestamp')}>
                    <div className="flex items-center gap-1">
                      <span>Date & Time (IST)</span>
                      <ArrowUpDown size={12} className={sortField === 'timestamp' ? 'text-indigo-600' : 'text-slate-400'} />
                    </div>
                  </th>
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Project</th>
                  <th className="py-3.5 px-4">User Story</th>
                  <th className="py-3.5 px-4">AutomatiQA Module</th>
                  <th className="py-3.5 px-4">Input Modality</th>
                  <th className="py-3.5 px-4">Tier</th>
                  <th className="py-3.5 px-4 cursor-pointer" onClick={() => handleSort('itemsGenerated')}>
                    <div className="flex items-center gap-1">
                      <span>Output Produced</span>
                      <ArrowUpDown size={12} className={sortField === 'itemsGenerated' ? 'text-indigo-600' : 'text-slate-400'} />
                    </div>
                  </th>
                  <th className="py-3.5 px-4 text-center cursor-pointer bg-teal-50/50" onClick={() => handleSort('creditsConsumed')}>
                    <div className="flex items-center justify-center gap-1 text-[#008f7d]">
                      <span>Credits Consumed</span>
                      <ArrowUpDown size={12} className={sortField === 'creditsConsumed' ? 'text-[#008f7d]' : 'text-teal-400'} />
                    </div>
                  </th>
                  <th className="py-3.5 px-4 text-center">Cache Status</th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-slate-400">
                      <Coins size={36} className="mx-auto mb-2 opacity-30" />
                      <p className="font-bold">No consumption logs match the filter criteria</p>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => {
                    const isSelected = selectedLogIds.includes(log.id);
                    const credits = log.creditsConsumed ?? calculateCreditsConsumed(log.feature, log.itemsGenerated || 1, log.cached);
                    const tierInfo = log.tier ? { tier: log.tier } : calculateInputTier(log);

                    return (
                      <tr 
                        key={log.id} 
                        className={`hover:bg-slate-50/70 transition-colors ${isSelected ? 'bg-indigo-50/30' : ''}`}
                      >
                        <td className="py-3.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectOne(log.id)}
                            className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
                          />
                        </td>

                        <td className="py-3.5 px-4 font-mono font-medium text-slate-600 whitespace-nowrap">
                          {log.date || formatToIST(log.timestamp)}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{log.user || 'Unknown'}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-medium text-slate-700 whitespace-nowrap">
                          <span className="px-2.5 py-1 bg-slate-100 rounded-md font-bold text-slate-800 text-[11px]">
                            {log.project || 'Default Project'}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200/80 rounded-md text-[11px] font-mono font-bold">
                            {log.userStoryId || 'US-GENERAL'}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 font-bold text-slate-900 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="p-1 bg-slate-50 border border-slate-200 rounded-lg shrink-0">
                              {getModuleIcon(log.feature)}
                            </div>
                            <span className="text-xs text-slate-900 font-bold">{log.feature}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 w-max">
                              {log.inputModality || 'Text'}
                            </span>
                            {log.inputModalityDetails && (
                              <span className="text-[10px] text-slate-500 font-medium max-w-[200px] truncate block" title={log.inputModalityDetails}>
                                {log.inputModalityDetails}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                            {tierInfo.tier}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-slate-800 text-xs">
                              {log.itemsGenerated || 1} Artifacts
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium max-w-[180px] truncate block" title={log.outputType}>
                              {log.outputType || 'AI Output Artifacts'}
                            </span>
                          </div>
                        </td>

                        {/* CREDITS CONSUMED COLUMN */}
                        <td className="py-3.5 px-4 text-center font-mono font-black text-[#00a693] bg-teal-50/40 whitespace-nowrap">
                          <span className="px-2.5 py-1 rounded-lg bg-teal-100/70 text-teal-800 text-xs font-black shadow-xs">
                            {credits} {credits === 1 ? 'Credit' : 'Credits'}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {log.cached ? (
                            <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                              <CheckCircle2 size={10} /> Cached (0 Credits)
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
                              Standard
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setInspectLog(log)}
                              className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-all"
                              title="Inspect Credit Details"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => {
                                setDeleteConfirmModal({
                                  open: true,
                                  ids: [log.id],
                                  title: 'Delete Log',
                                  message: 'Are you sure you want to delete this credit consumption entry?'
                                });
                              }}
                              className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-all"
                              title="Delete Log"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* TABLE FOOTER */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100 text-xs text-slate-500 font-semibold">
            <div>
              Showing <strong className="text-slate-900">{filteredLogs.length}</strong> of <strong className="text-slate-900">{logs.length}</strong> entries
            </div>
            <div className="flex items-center gap-6">
              <span>Total Credits Used: <strong className="text-indigo-600 font-bold">{summaryMetrics.totalCreditsUsed} Credits</strong></span>
              <span>Available Pool: <strong className="text-teal-600 font-bold">{summaryMetrics.remainingCredits} Credits</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: MODULE CREDIT RATE CARD */}
      {activeTab === 'rate_card' && (
        <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200/80 shadow-sm space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 pb-6">
            <div>
              <div className="flex items-center gap-2 text-indigo-600 text-xs font-black uppercase tracking-widest mb-1">
                <Zap size={14} /> AutomatiQA Module Credit Rate Card
              </div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Credit Point Consumption Rates Across All 10 AI Modules
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Fixed credit deduction model per AI generation button click. Input/output volume is not charged.
              </p>
            </div>

            <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div className="text-center px-3 border-r border-slate-200">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Pool</p>
                <p className="text-sm font-black text-slate-900">1,000 Credits</p>
              </div>
              <div className="text-center px-3 border-r border-slate-200">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Plan Validity</p>
                <p className="text-sm font-black text-slate-900">32 Days (2 + 30)</p>
              </div>
              <div className="text-center px-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cached Re-runs</p>
                <p className="text-sm font-black text-emerald-600">0 Credits (Free)</p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200">
                  <th className="py-4 px-6">Feature Module</th>
                  <th className="py-4 px-4">Action / Button Trigger</th>
                  <th className="py-4 px-4 text-center">Credit Cost / Click</th>
                  <th className="py-4 px-4">Supported Inputs</th>
                  <th className="py-4 px-4">Output Artifacts</th>
                  <th className="py-4 px-4 text-center">Cache Benefit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {AUTOMATIQA_MODULES.map((mod, idx) => {
                  const creditCost = calculateCreditsConsumed(mod.name, 1, false);

                  // Button trigger labels
                  let buttonTrigger = 'AI GENERATE BUTTON';
                  const lowerName = mod.name.toLowerCase();
                  if (lowerName.includes('user stor')) {
                    buttonTrigger = "'Generate AI user stories'";
                  } else if (lowerName.includes('scenario')) {
                    buttonTrigger = "'Generate AI Scenarios'";
                  } else if (lowerName.includes('test case')) {
                    buttonTrigger = "'GENERATE AI TEST CASES' / 'AI GENERATE SELECTED'";
                  } else if (lowerName.includes('script generator')) {
                    buttonTrigger = "'GENERATE POM SCRIPT'";
                  } else if (lowerName.includes('record and play - web')) {
                    buttonTrigger = "'START RECORDING' & 'GENERATE SCRIPTS'";
                  } else if (lowerName.includes('record and play - mobile')) {
                    buttonTrigger = "'START RECORDING' & 'GENERATE SCRIPTS'";
                  } else if (lowerName.includes('ui testing')) {
                    buttonTrigger = "'RUN UI TESTING' / 'START AUDIT'";
                  } else if (lowerName.includes('api testing')) {
                    buttonTrigger = "'GENERATE API TEST SUITE'";
                  } else if (lowerName.includes('api performance')) {
                    buttonTrigger = "'GENERATE JMX SCRIPT' & 'GENERATE REPORT'";
                  } else if (lowerName.includes('web performance')) {
                    buttonTrigger = "'RUN CHECKOUT'";
                  }

                  return (
                    <tr key={idx} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="py-4 px-6 font-bold text-slate-900">
                        <div className="flex items-center gap-2.5">
                          {getModuleIcon(mod.name)}
                          <span>{mod.name}</span>
                        </div>
                      </td>

                      <td className="py-4 px-4 font-mono font-semibold text-indigo-700 bg-indigo-50/30">
                        {buttonTrigger}
                      </td>

                      <td className="py-4 px-4 text-center">
                        <span className="bg-teal-50 border border-teal-200 text-[#008f7d] text-xs font-black px-3 py-1 rounded-lg inline-block">
                          {creditCost} {creditCost === 1 ? 'Credit' : 'Credits'}
                        </span>
                      </td>

                      <td className="py-4 px-4">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {mod.inputTypes.map((t, i) => (
                            <span key={i} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-bold">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td className="py-4 px-4 font-medium text-slate-800">
                        {mod.outputType}
                      </td>

                      <td className="py-4 px-4 text-center">
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[10px] font-bold">
                          0 Credits
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* INSPECT LOG MODAL */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-lg w-full shadow-2xl border border-slate-200 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                  {getModuleIcon(inspectLog.feature)}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">{inspectLog.feature}</h3>
                  <p className="text-xs text-slate-500 font-medium">Transaction ID: {inspectLog.id}</p>
                </div>
              </div>
              <button
                onClick={() => setInspectLog(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-black p-2"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex justify-between"><span className="text-slate-500 font-semibold">Date & Time:</span><span className="font-bold text-slate-800">{inspectLog.date}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 font-semibold">User:</span><span className="font-bold text-slate-800">{inspectLog.user} ({inspectLog.userEmail || 'user@qaoncloud.com'})</span></div>
                <div className="flex justify-between"><span className="text-slate-500 font-semibold">Project:</span><span className="font-bold text-slate-800">{inspectLog.project}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 font-semibold">User Story:</span><span className="font-bold text-slate-800">{inspectLog.userStoryId || 'US-GENERAL'}</span></div>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex justify-between"><span className="text-slate-500 font-semibold">Input Modality:</span><span className="font-bold text-slate-800">{inspectLog.inputModality || 'Text'}</span></div>
                {inspectLog.inputModalityDetails && (
                  <div className="flex justify-between"><span className="text-slate-500 font-semibold">Modality Details:</span><span className="font-bold text-slate-800 text-right max-w-[240px]">{inspectLog.inputModalityDetails}</span></div>
                )}
                {inspectLog.outputType && (
                  <div className="flex justify-between"><span className="text-slate-500 font-semibold">Output Type:</span><span className="font-bold text-slate-800 text-right max-w-[240px]">{inspectLog.outputType}</span></div>
                )}
                <div className="flex justify-between"><span className="text-slate-500 font-semibold">Items Produced:</span><span className="font-bold text-slate-800">{inspectLog.itemsGenerated || 1} Artifacts</span></div>
              </div>

              <div className="bg-teal-50 p-4 rounded-2xl border border-teal-200 flex items-center justify-between">
                <div>
                  <span className="text-xs font-black text-teal-900">Total Credits Consumed:</span>
                  <p className="text-[10px] text-teal-700 font-medium">Billed to AutomatiQA workspace pool</p>
                </div>
                <span className="text-xl font-black text-teal-800 font-mono">
                  {inspectLog.creditsConsumed ?? calculateCreditsConsumed(inspectLog.feature, inspectLog.itemsGenerated || 1, inspectLog.cached)} Credits
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                onClick={() => setInspectLog(null)}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SIMULATE CONSUMPTION LOG MODAL */}
      {isSimulateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-lg w-full shadow-2xl border border-slate-200 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-[#00E1C5]/10 text-[#00E1C5] rounded-2xl">
                  <Coins size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Simulate AI Credit Consumption</h3>
                  <p className="text-xs text-slate-500 font-medium">Record simulated usage for any of the 10 AutomatiQA modules</p>
                </div>
              </div>
              <button
                onClick={() => setIsSimulateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-black p-2"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSimulateSubmit} className="space-y-4 text-xs font-semibold text-slate-700">
              <div>
                <label className="block mb-1 font-bold text-slate-800">Module / Feature</label>
                <select
                  value={simFeature}
                  onChange={(e) => setSimFeature(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500/20"
                >
                  {AUTOMATIQA_MODULES.map(m => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-bold text-slate-800">Project Name</label>
                  <input
                    type="text"
                    value={simProject}
                    onChange={(e) => setSimProject(e.target.value)}
                    placeholder="e.g. Global Retail Banking App"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block mb-1 font-bold text-slate-800">User Story ID</label>
                  <input
                    type="text"
                    value={simUserStoryId}
                    onChange={(e) => setSimUserStoryId(e.target.value)}
                    placeholder="e.g. US-102 (Funds Transfer)"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-bold text-slate-800">Input Modality</label>
                  <select
                    value={simModality}
                    onChange={(e) => setSimModality(e.target.value as any)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                  >
                    <option value="Text">Text</option>
                    <option value="Screenshot">Screenshot</option>
                    <option value="Video">Video</option>
                    <option value="Document">Document</option>
                    <option value="URL">URL</option>
                    <option value="Multimodal">Multimodal</option>
                  </select>
                </div>

                <div>
                  <label className="block mb-1 font-bold text-slate-800">Items Generated</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={simItemsGenerated}
                    onChange={(e) => setSimItemsGenerated(Number(e.target.value))}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-bold text-slate-800">Modality Details</label>
                <input
                  type="text"
                  value={simModalityDetails}
                  onChange={(e) => setSimModalityDetails(e.target.value)}
                  placeholder="e.g. 2 Screenshots + 1 BRD Document (4 pages)"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simCached}
                    onChange={(e) => setSimCached(e.target.checked)}
                    className="w-4 h-4 accent-[#00E1C5] rounded"
                  />
                  <span className="text-xs font-bold text-slate-800">Context Cache Hit (0 credits billed)</span>
                </label>
              </div>

              <div className="p-3 bg-teal-50 rounded-xl border border-teal-200 flex items-center justify-between text-xs">
                <span className="text-teal-900 font-bold">Estimated Credits to Deduct:</span>
                <span className="font-mono font-black text-teal-800 text-sm">
                  {calculateCreditsConsumed(simFeature, simItemsGenerated, simCached)} Credits
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsSimulateModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-[#00E1C5] text-slate-950 font-black hover:bg-[#00cbb2] shadow-md uppercase tracking-wider"
                >
                  Simulate & Add Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {deleteConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-3 bg-rose-50 rounded-2xl"><AlertTriangle size={24} /></div>
              <h3 className="text-lg font-black text-slate-900">{deleteConfirmModal.title}</h3>
            </div>
            <p className="text-xs text-slate-600 font-medium leading-relaxed">
              {deleteConfirmModal.message}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteConfirmModal(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteConfirmModal.ids.length === 1) {
                    handleDeleteSingle(deleteConfirmModal.ids[0]);
                  } else {
                    handleDeleteSelected();
                  }
                }}
                disabled={isDeleting}
                className="px-5 py-2 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700 transition-all shadow-md"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
