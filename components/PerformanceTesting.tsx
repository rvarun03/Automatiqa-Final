import React, { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Project, PerformanceScript, User, TestStatus } from '../types';
import { 
  Zap, 
  Sparkles, 
  FileCode, 
  Download, 
  Upload, 
  Activity, 
  TrendingUp, 
  Terminal, 
  Globe, 
  Cpu, 
  Clock, 
  Loader2,
  ChevronRight,
  ShieldCheck,
  CheckSquare, 
  Square, 
  Timer,
  Repeat,
  Users,
  FileSearch,
  Hash,
  Wand2,
  Save,
  Trash2,
  Database,
  Calendar,
  Eye,
  FileText,
  FileSpreadsheet,
  ShieldAlert,
  Server,
  X,
  Layout,
  Table,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowUpRight,
  BarChart3,
  TrendingUp as GraphIcon,
  AreaChart as AreaChartIcon,
  ChevronDown,
  Settings2,
  ImageIcon,
  FileJson,
  Info,
  CheckCircle,
  Hash as HashIcon,
  FileWarning,
  ListFilter,
  Tag,
  Check as CheckIcon,
  FileSignature,
  FileUp,
  PlayCircle
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  Label,
  LineChart,
  Line
} from 'recharts';
import { generatePerformanceScenarios, generateJMeterArtifacts, analyzePerformanceResults } from '../geminiService';
import { logActivity } from '../services/activityService';
import { ragEnrichPrompt, indexSingleItem } from '../services/ragService';
import { RAGStatusBadge } from './RAGStatusBadge';
import { VectorSearchResult } from '../types';
import { addTokenLog } from '../services/tokenConsumptionService';

interface PerformanceTestingProps {
  project: Project;
  user: User;
  onUpdateProject: (p: Project) => void;
}

type PerformanceMetricType = 'hits' | 'latency' | 'threads' | 'success' | 'tps' | 'codes';

interface AnalyticsDataPoint {
    time: string;
    timestampValue: number;
    hitsPerSecond: number;
    avgLatency: number;
    activeThreads: number;
    successRate: number;
    tps: number;
    errorsPerSecond: number;
}

const PerformanceTesting: React.FC<PerformanceTestingProps> = ({ project, user, onUpdateProject }) => {
  const [inputType, setInputType] = useState<'postman'>('postman');
  const [inputContent, setInputContent] = useState('');
  const [refinementLogic, setRefinementLogic] = useState('');
  const [ragEnabled, setRagEnabled] = useState(true);
  const [retrievedRagChunks, setRetrievedRagChunks] = useState<VectorSearchResult[]>([]);
  
  // Post-generation naming states
  const [isNamingModalOpen, setIsNamingModalOpen] = useState(false);
  const [artifactLabel, setArtifactLabel] = useState('');
  const [pendingArtifacts, setPendingArtifacts] = useState<{scenarios: any[], artifacts: {jmx: string, csv: string, instructions: string}} | null>(null);

  // Post-analysis report naming states
  const [isReportNamingModalOpen, setIsReportNamingModalOpen] = useState(false);
  const [reportArtifactLabel, setReportArtifactLabel] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [jmeterArtifacts, setJmeterArtifacts] = useState<{jmx: string, csv: string, instructions: string} | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [graphData, setGraphData] = useState<AnalyticsDataPoint[]>([]);
  const [activeMetric, setActiveMetric] = useState<PerformanceMetricType>('hits');
  const [modalActiveMetric, setModalActiveMetric] = useState<PerformanceMetricType>('hits');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [viewingReportId, setViewingReportId] = useState<string | null>(null);
  const [modalActiveTab, setModalActiveTab] = useState<'report' | 'trends'>('trends');
  const [insightsTab, setInsightsTab] = useState<'trends' | 'report'>('trends');
  const [isDesignFile, setIsDesignFile] = useState(false);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [granularityLabel, setGranularityLabel] = useState('1s');

  // Multi-file Import States for Analysis
  const [stagedGraphContent, setStagedGraphContent] = useState<string | null>(null);
  const [stagedGraphName, setStagedGraphName] = useState<string | null>(null);
  const [stagedCsvContent, setStagedCsvContent] = useState<string | null>(null);
  const [stagedCsvName, setStagedCsvName] = useState<string | null>(null);

  // Archive Selection States
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<Set<string>>(new Set());

  // Performance Load States
  const [vus, setVus] = useState(50);
  const [rampUp, setRampUp] = useState(300);
  const [duration, setDuration] = useState(1800);
  const [loopCount, setLoopCount] = useState(1);

  const metricConfigs: Record<PerformanceMetricType, { label: string, dataKey: string, color: string, icon: React.ReactNode, yLabel: string }> = {
    hits: { 
      label: isDesignFile ? 'Estimated Hits per Second' : 'Hits per Second', 
      dataKey: 'hitsPerSecond', 
      color: '#8b5cf6', 
      icon: <Zap size={14}/>, 
      yLabel: 'Number of hits / sec' 
    },
    latency: { 
      label: 'Average Response Time (ms)', 
      dataKey: 'avgLatency', 
      color: '#6366f1', 
      icon: <Clock size={14}/>, 
      yLabel: 'Latency (ms)' 
    },
    threads: { 
      label: isDesignFile ? 'Designed Active Threads' : 'Active Threads Over Time', 
      dataKey: 'activeThreads', 
      color: '#10b981', 
      icon: <Users size={14}/>, 
      yLabel: 'Threads / Users' 
    },
    success: { 
      label: 'Transaction Success Rate (%)', 
      dataKey: 'successRate', 
      color: '#ec4899', 
      icon: <ShieldCheck size={14}/>, 
      yLabel: 'Percentage (%)' 
    },
    tps: { 
      label: 'Transactions per Second', 
      dataKey: 'tps', 
      color: '#f59e0b', 
      icon: <TrendingUp size={14}/>, 
      yLabel: 'Trans / sec' 
    },
    codes: { 
      label: 'Response Codes per Second', 
      dataKey: 'errorsPerSecond', 
      color: '#ef4444', 
      icon: <FileWarning size={14}/>, 
      yLabel: 'Samples / sec' 
    }
  };

  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const graphFileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  const getContextualFileName = (extension: string) => {
    let base = project.name || 'performance_test';
    base = base.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const ts = new Date().getTime().toString().slice(-4);
    return `${base}_${ts}.${extension}`;
  };

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const calculateFullAnalytics = (dataPoints: {t: number, ts: number, s: boolean, v: number, l?: string, rc?: string}[]) => {
    if (dataPoints.length === 0) return { results: [], recommended: 'hits' as PerformanceMetricType };
    
    const sorted = [...dataPoints].sort((a, b) => a.ts - b.ts);
    const startTime = sorted[0].ts;
    const endTime = sorted[sorted.length - 1].ts;
    const durationMs = endTime - startTime;

    let bucketSizeMs = 1000;
    if (durationMs > 86400000) bucketSizeMs = 3600000; 
    else if (durationMs > 14400000) bucketSizeMs = 600000; 
    else if (durationMs > 3600000) bucketSizeMs = 60000; 
    else if (durationMs > 600000) bucketSizeMs = 5000; 
    else bucketSizeMs = 1000;

    const label = bucketSizeMs >= 3600000 ? `${bucketSizeMs/3600000}h` : 
                 bucketSizeMs >= 60000 ? `${bucketSizeMs/60000}m` : 
                 `${bucketSizeMs/1000}s`;
    setGranularityLabel(label);
    
    const buckets: Map<number, { count: number, latencySum: number, successCount: number, threadSum: number, labels: Set<string>, errorCount: number }> = new Map();
    let uniqueCodesFound = new Set<string>();

    sorted.forEach(dp => {
      const elapsedMs = Math.max(0, dp.ts - startTime);
      const bucketIndex = Math.floor(elapsedMs / bucketSizeMs);
      
      if (!buckets.has(bucketIndex)) {
          buckets.set(bucketIndex, { count: 0, latencySum: 0, successCount: 0, threadSum: 0, labels: new Set(), errorCount: 0 });
      }
      const b = buckets.get(bucketIndex)!;
      b.count += 1;
      b.latencySum += dp.t;
      b.successCount += dp.s ? 1 : 0;
      b.threadSum += dp.v;
      if (dp.l) b.labels.add(dp.l);
      if (!dp.s || (dp.rc && !['200', '201', 'OK'].includes(dp.rc))) b.errorCount += 1;
      
      if (dp.rc) uniqueCodesFound.add(dp.rc);
    });

    const results: AnalyticsDataPoint[] = [];
    const maxBucket = Math.floor(durationMs / bucketSizeMs);

    for (let i = 0; i <= maxBucket; i++) {
      const b = buckets.get(i) || { count: 0, latencySum: 0, successCount: 0, threadSum: 0, labels: new Set(), errorCount: 0 };
      const currentElapsedMs = i * bucketSizeMs;
      const divisor = bucketSizeMs / 1000;
      
      results.push({
        time: formatDuration(currentElapsedMs),
        timestampValue: currentElapsedMs,
        hitsPerSecond: Number((b.count / divisor).toFixed(2)),
        avgLatency: b.count > 0 ? Number((b.latencySum / b.count).toFixed(2)) : 0,
        activeThreads: b.count > 0 ? Math.round(b.threadSum / b.count) : 0,
        successRate: b.count > 0 ? Number(((b.successCount / b.count) * 100).toFixed(2)) : 0,
        tps: Number((b.successCount / divisor).toFixed(2)),
        errorsPerSecond: Number((b.errorCount / divisor).toFixed(2))
      });
    }

    let recommended: PerformanceMetricType = 'hits';
    if (uniqueCodesFound.size > 2) recommended = 'codes';
    else if (isDesignFile) recommended = 'threads';

    return { results, recommended };
  };

  const parseJtlDataForGraph = (content: string | undefined): AnalyticsDataPoint[] => {
    if (!content) return [];
    const trimmed = content.trim();
    const rawData: {t: number, ts: number, s: boolean, v: number, l?: string, rc?: string}[] = [];

    if (trimmed.toLowerCase().includes('<jmetertestplan')) {
        setIsDesignFile(true);
        const threadGroupRegex = /<ThreadGroup[^>]*>([\s\S]*?)<\/ThreadGroup>/g;
        let match;
        const designProfiles: {threads: number, rampUp: number, duration: number}[] = [];
        while ((match = threadGroupRegex.exec(trimmed)) !== null) {
            const block = match[1];
            const threads = parseInt(block.match(/name="ThreadGroup.num_threads"[^>]*>\s*(\d+)\s*</)?.[1] || "0");
            const ramp = parseInt(block.match(/name="ThreadGroup.ramp_time"[^>]*>\s*(\d+)\s*</)?.[1] || "0");
            const duration = parseInt(block.match(/name="ThreadGroup.duration"[^>]*>\s*(\d+)\s*</)?.[1] || "0");
            if (threads > 0) designProfiles.push({ threads, rampUp: ramp, duration });
        }
        if (designProfiles.length === 0) return [];
        const results: AnalyticsDataPoint[] = [];
        const totalDurationSec = Math.max(...designProfiles.map(p => (p.duration || p.rampUp * 2 || 600)));
        const totalMinutes = Math.max(Math.ceil(totalDurationSec / 60), 10);
        for (let m = 0; m <= totalMinutes; m++) {
            let activeThreads = 0;
            designProfiles.forEach(p => {
                const rampMinutes = p.rampUp / 60;
                const durationMinutes = p.duration / 60;
                if (rampMinutes === 0) {
                   if (m <= durationMinutes || durationMinutes === 0) activeThreads += p.threads;
                } else if (m < rampMinutes) {
                    activeThreads += (m / rampMinutes) * p.threads;
                } else if (durationMinutes === 0 || m <= (rampMinutes + durationMinutes)) {
                    activeThreads += p.threads;
                }
            });
            results.push({
                time: `${m}m`,
                timestampValue: m * 60000,
                hitsPerSecond: Number((activeThreads * 0.1).toFixed(2)), 
                avgLatency: 0,
                activeThreads: Math.round(activeThreads),
                successRate: 100,
                tps: Number((activeThreads * 0.1).toFixed(2)),
                errorsPerSecond: 0
            });
        }
        setActiveMetric('hits'); 
        return results;
    }

    setIsDesignFile(false);
    if (trimmed.toLowerCase().includes('<testresults') || trimmed.toLowerCase().includes('<?xml')) {
      const tagRegex = /<(?:sample|httpSample|sampleResult)\s+([^+]+)>/gi;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(trimmed)) !== null) {
        const attrStr = tagMatch[1];
        const getAttr = (name: string) => {
            const match = attrStr.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
            return match ? match[1] : null;
        };
        const tValue = getAttr('t') || "0";
        let tsValue = getAttr('ts') || "0";
        const sValue = getAttr('s') !== 'false';
        const vValue = getAttr('ng') || getAttr('na') || getAttr('at') || "0";
        const lbValue = getAttr('lb') || "";
        const rcValue = getAttr('rc') || "";

        let ts = parseInt(tsValue);
        if (ts > 0 && ts < 10000000000) ts = ts * 1000;
        if (!isNaN(ts) && ts > 0) {
          rawData.push({ t: parseInt(tValue), ts: ts, s: sValue, v: parseInt(vValue), l: lbValue, rc: rcValue });
        }
      }
    } 
    else {
      const lines = trimmed.split('\n').filter(l => l.trim() !== '');
      if (lines.length < 2) return [];
      const headers = lines[0].split(',').map(h => (h || '').trim().toLowerCase());
      const tsIdx = headers.findIndex(h => h.includes('timestamp') || h === 'ts' || h === 'time');
      const tIdx = headers.findIndex(h => h.includes('elapsed') || h === 't' || h === 'latency');
      const sIdx = headers.findIndex(h => h.includes('success') || h === 's');
      const thIdx = headers.findIndex(h => h.includes('threads') || h.includes('allthreads') || h === 'na' || h === 'ng');
      const lbIdx = headers.findIndex(h => h === 'label' || h === 'lb');
      const rcIdx = headers.findIndex(h => h === 'responsecode' || h === 'rc');

      if (tsIdx !== -1) {
        lines.slice(1).forEach(line => {
          const parts = line.split(',');
          let ts = Number(parts[tsIdx]);
          if (ts > 0 && ts < 10000000000) ts = ts * 1000;
          const t = tIdx !== -1 ? Number(parts[tIdx]) : 0;
          const s = sIdx !== -1 ? (parts[sIdx] || '').toLowerCase() === 'true' : true;
          const v = thIdx !== -1 ? parseInt(parts[thIdx] || "0") : 0;
          const l = lbIdx !== -1 ? parts[lbIdx] : "";
          const rc = rcIdx !== -1 ? parts[rcIdx] : "";
          if (!isNaN(ts) && ts > 0) rawData.push({ ts, t, s, v, l, rc });
        });
      }
    }

    if (rawData.length === 0) {
        setParsingError("Log format mismatch. Ensure standard JMeter JTL headers are present.");
        return [];
    }

    const { results } = calculateFullAnalytics(rawData);
    setActiveMetric('hits'); 
    return results;
  };

  const handleGenerateScript = async () => {
    if (isGenerating) return;
    if (!inputContent.trim()) {
      toast.error("Please provide input before proceeding");
      return;
    }
    if (!vus || vus < 1) {
      toast.error("Virtual Users must be at least 1.");
      return;
    }
    if (rampUp === undefined || rampUp === null || rampUp < 0) {
      toast.error("Ramp-Up time cannot be negative.");
      return;
    }
    if (!duration || duration <= 0) {
      toast.error("Duration must be greater than 0 seconds.");
      return;
    }
    if (!loopCount || loopCount < 1) {
      toast.error("Loop Count must be at least 1.");
      return;
    }
    setIsGenerating(true);
    setJmeterArtifacts(null);
    try {
      let finalInput = refinementLogic.trim() 
        ? `${inputContent}\n\nAI REFINEMENT INSTRUCTIONS:\n${refinementLogic}`
        : inputContent;

      if (ragEnabled) {
        const enriched = await ragEnrichPrompt(inputContent, project.id, 3);
        finalInput = `${enriched.prompt}\n\n${finalInput}`;
        setRetrievedRagChunks(enriched.chunks);
      } else {
        setRetrievedRagChunks([]);
      }

      const currentScenarios = await generatePerformanceScenarios(finalInput, inputType, ['Performance_Run']) as any[];
      setScenarios(currentScenarios);
      
      const profiles: Record<string, any> = {
        'Performance_Run': { vus, rampUp, duration, loopCount }
      };

      const artifacts = await generateJMeterArtifacts(currentScenarios, finalInput, { profiles });
      setJmeterArtifacts(artifacts);

      // Deduct 50 credits on GENERATE JMX SCRIPT click
      addTokenLog({
        user: user.name,
        userEmail: user.email,
        workspace: (user as any).company || 'QAonCloud Workspace',
        project: project.name,
        userStoryId: 'PERF-API-JMX',
        feature: 'API performance testing',
        inputModality: 'Document',
        inputModalityDetails: `${inputType}: ${inputContent.slice(0, 60)}... (${vus} VUs, ${duration}s)`,
        outputType: 'JMeter JMX Performance Plan & Test Data CSV',
        itemsGenerated: 1,
        creditsConsumed: 50,
        cached: false
      });

      // Instead of saving immediately, open the naming modal
      setPendingArtifacts({ scenarios: currentScenarios, artifacts });
      setArtifactLabel('');
      setIsNamingModalOpen(true);
    } catch (err) {
      alert('Generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const confirmSaveArtifact = () => {
    if (!pendingArtifacts) return;
    
    const label = artifactLabel.trim() || 'Script';
    const finalArtifactName = `${project.name} - ${label}`;
    
    const existingScripts = project.performanceScripts || [];
    const isDuplicate = existingScripts.some(
      s => (s.name || '').trim().toLowerCase() === finalArtifactName.trim().toLowerCase()
    );

    if (isDuplicate) {
      toast.error(`An artifact with the identifier "${finalArtifactName}" already exists. Please choose a unique name.`);
      return;
    }
    
    const newScript: PerformanceScript = {
      id: Math.random().toString(36).substr(2, 9), 
      name: finalArtifactName, 
      scenarios: pendingArtifacts.scenarios,
      jmxContent: pendingArtifacts.artifacts.jmx, 
      csvData: pendingArtifacts.artifacts.csv, 
      createdAt: new Date().toISOString()
    };
    
    onUpdateProject({ ...project, performanceScripts: [newScript, ...(project.performanceScripts || [])] });
    logActivity(user.email, user.name, `Synthesized JMeter JMX artifact: ${newScript.name}`, project.id, project.name);
    toast.success(`Artifact "${newScript.name}" saved successfully.`);
    
    setIsNamingModalOpen(false);
    setPendingArtifacts(null);
    setArtifactLabel('');
  };

  const handleSaveAnalysis = () => {
    if (!analysisResult && graphData.length === 0) return;
    const dynamicName = getContextualFileName('analysis').replace('.analysis', '');
    const defaultReportName = `${dynamicName} - ${graphData.length > 0 && !analysisResult ? 'Graph Report' : 'Analysis Report'}`;
    setReportArtifactLabel(defaultReportName);
    setIsReportNamingModalOpen(true);
  };

  const confirmSaveReport = () => {
    if (!analysisResult && graphData.length === 0) return;
    const finalReportName = reportArtifactLabel.trim();
    if (!finalReportName) {
      toast.error('Artifact Identifier cannot be empty.');
      return;
    }

    const existingScripts = project.performanceScripts || [];
    const isDuplicate = existingScripts.some(
      s => (s.name || '').trim().toLowerCase() === finalReportName.trim().toLowerCase()
    );

    if (isDuplicate) {
      toast.error(`An artifact with the identifier "${finalReportName}" already exists. Please choose a unique name.`);
      return;
    }

    const newReport: PerformanceScript = {
      id: Math.random().toString(36).substr(2, 9),
      name: finalReportName,
      scenarios: [], 
      jmxContent: '', 
      analysisReport: analysisResult ? JSON.stringify(analysisResult) : undefined, 
      trendData: graphData.length > 0 ? JSON.stringify(graphData) : undefined,
      createdAt: new Date().toISOString()
    };
    onUpdateProject({ ...project, performanceScripts: [newReport, ...(project.performanceScripts || [])] });
    logActivity(user.email, user.name, `Archived AI Performance report: ${newReport.name}`, project.id, project.name);
    toast.success('Performance report archived successfully.');
    setIsReportNamingModalOpen(false);
    setReportArtifactLabel('');
  };

  const handleImportGraphFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStagedGraphName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => setStagedGraphContent(event.target?.result as string);
    reader.readAsText(file);
  };

  const handleImportCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStagedCsvName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => setStagedCsvContent(event.target?.result as string);
    reader.readAsText(file);
  };

  const parseAggregateCsv = (content: string) => {
    const lines = content.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return null;
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    const samplesIdx = headers.findIndex(h => h.includes('samples') || h === '# samples' || h === 'count');
    const avgIdx = headers.findIndex(h => h === 'average' || h === 'mean');
    const minIdx = headers.findIndex(h => h === 'min');
    const maxIdx = headers.findIndex(h => h === 'max');
    const throughputIdx = headers.findIndex(h => h === 'throughput');
    
    if (samplesIdx !== -1 && avgIdx !== -1 && minIdx !== -1 && maxIdx !== -1 && throughputIdx !== -1) {
      const totalRow = lines.find(l => l.toLowerCase().startsWith('total,'));
      const parts = totalRow ? totalRow.split(',') : lines[lines.length - 1].split(',');
      return {
        totalSamples: parts[samplesIdx],
        average: parts[avgIdx],
        min: parts[minIdx],
        max: parts[maxIdx],
        throughput: parts[throughputIdx]
      };
    }
    
    // Fallback to raw JTL calculation
    const tIdx = headers.findIndex(h => h === 'elapsed' || h === 't' || h === 'latency');
    const tsIdx = headers.findIndex(h => h === 'timestamp' || h === 'ts' || h === 'time');
    
    if (tIdx !== -1 && tsIdx !== -1) {
      let totalSamples = 0;
      let sumElapsed = 0;
      let min = Number.MAX_VALUE;
      let max = Number.MIN_VALUE;
      let minTs = Number.MAX_VALUE;
      let maxTs = Number.MIN_VALUE;
      
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const t = Number(parts[tIdx]);
        let ts = Number(parts[tsIdx]);
        
        if (!isNaN(t) && !isNaN(ts)) {
          if (ts > 0 && ts < 10000000000) ts = ts * 1000;
          totalSamples++;
          sumElapsed += t;
          if (t < min) min = t;
          if (t > max) max = t;
          if (ts < minTs) minTs = ts;
          if (ts > maxTs) maxTs = ts;
        }
      }
      
      if (totalSamples > 0) {
        const average = (sumElapsed / totalSamples).toFixed(2);
        const durationSec = (maxTs - minTs) / 1000;
        const throughput = durationSec > 0 ? (totalSamples / durationSec).toFixed(2) : "0.00";
        
        return {
          totalSamples: totalSamples.toString(),
          average: average.toString(),
          min: min.toString(),
          max: max.toString(),
          throughput: throughput.toString() + "/sec"
        };
      }
    }
    
    return null;
  };

  const handleGenerateFinalReport = async () => {
    if (isAnalyzing) return;
    if (!stagedGraphContent && !stagedCsvContent) {
        toast.error("Please provide input before proceeding");
        return;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);
    setGraphData([]);
    setParsingError(null);
    setActiveMetric('hits');

    try {
        if (stagedGraphContent) {
            const parsedGraph = parseJtlDataForGraph(stagedGraphContent);
            setGraphData(parsedGraph);
            setInsightsTab('trends');
        }

        if (stagedCsvContent) {
            const result = await analyzePerformanceResults(stagedCsvContent);
            
            if (result.technicalReport && result.technicalReport.metrics) {
                const labelsToRemoveGlobally = [
                    'total errors',
                    'successful samples',
                    'average response time',
                    'average bandwidth'
                ];
                result.technicalReport.metrics = result.technicalReport.metrics.filter((m: any) => {
                    const labelLower = (m.label || '').toLowerCase();
                    return !labelsToRemoveGlobally.some(label => labelLower.includes(label));
                });
            }

            // Extract aggregate metrics from CSV and prepend to technical report metrics
            const aggMetrics = parseAggregateCsv(stagedCsvContent);
            if (aggMetrics) {
                if (!result.technicalReport) result.technicalReport = { metrics: [] };
                if (!result.technicalReport.metrics) result.technicalReport.metrics = [];
                
                const labelsToRemove = ['Total Samples', 'Average', 'Min', 'Max', 'Throughput'];
                result.technicalReport.metrics = result.technicalReport.metrics.filter((m: any) => !labelsToRemove.includes(m.label));
                
                result.technicalReport.metrics.unshift(
                    { label: 'Total Samples', value: aggMetrics.totalSamples },
                    { label: 'Average', value: aggMetrics.average },
                    { label: 'Min', value: aggMetrics.min },
                    { label: 'Max', value: aggMetrics.max },
                    { label: 'Throughput', value: aggMetrics.throughput }
                );
            }
            
            setAnalysisResult(result);
            // If we have CSV but no graph, default tab to report
            if (!stagedGraphContent) setInsightsTab('report');
        }

        // Deduct 50 credits on GENERATE REPORT click
        addTokenLog({
          user: user.name,
          userEmail: user.email,
          workspace: (user as any).company || 'QAonCloud Workspace',
          project: project.name,
          userStoryId: 'PERF-API-REPORT',
          feature: 'API performance testing',
          inputModality: 'Document',
          inputModalityDetails: stagedCsvName || stagedGraphName || 'JTL/CSV Telemetry Log',
          outputType: 'Performance Technical Report & Trend Graph Analytics',
          itemsGenerated: 1,
          creditsConsumed: 50,
          cached: false
        });

        // Cleanup staged names/content after generation
        setStagedGraphContent(null);
        setStagedGraphName(null);
        setStagedCsvContent(null);
        setStagedCsvName(null);
        if (graphFileInputRef.current) graphFileInputRef.current.value = '';
        if (csvFileInputRef.current) csvFileInputRef.current.value = '';

    } catch (err) {
        setParsingError("Error processing file contents.");
    } finally {
        setIsAnalyzing(false);
    }
  };

  const handleDownloadJmx = (script: PerformanceScript) => {
    if (!script.jmxContent) return;
    const blob = new Blob([script.jmxContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${script.name.replace(/\s+/g, '_')}.jmx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    logActivity(user.email, user.name, `Downloaded JMX script: ${script.name}`, project.id, project.name);
  };

  const handleSelectAllArchives = () => {
    const archives = project.performanceScripts || [];
    if (selectedArchiveIds.size === archives.length) {
      setSelectedArchiveIds(new Set());
    } else {
      setSelectedArchiveIds(new Set(archives.map(a => a.id)));
    }
  };

  const toggleArchiveSelection = (id: string) => {
    const next = new Set(selectedArchiveIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedArchiveIds(next);
  };

  const handleBulkDeleteArchives = () => {
    const archives = project.performanceScripts || [];
    if (!confirm(`Are you sure you want to delete ${selectedArchiveIds.size} selected artifacts? This action cannot be undone.`)) return;
    
    const updatedArchives = archives.filter(a => !selectedArchiveIds.has(a.id));
    onUpdateProject({ ...project, performanceScripts: updatedArchives });
    logActivity(user.email, user.name, `Bulk deleted ${selectedArchiveIds.size} artifacts from repository`, project.id, project.name);
    setSelectedArchiveIds(new Set());
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Pass': return <div className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 font-black text-[10px] uppercase tracking-widest"><CheckCircle2 size={12}/> Pass</div>;
      case 'Warning': return <div className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-50 text-amber-600 rounded-full border border-amber-100 font-black text-[10px] uppercase tracking-widest"><AlertTriangle size={12}/> Warning</div>;
      case 'Fail': return <div className="flex items-center gap-1.5 px-4 py-1.5 bg-red-50 text-red-600 rounded-full border border-red-100 font-black text-[10px] uppercase tracking-widest"><XCircle size={12}/> Fail</div>;
      default: return null;
    }
  };

  const archives = project.performanceScripts || [];
  const maxValInGraph = graphData.length > 0 ? Math.max(...graphData.map(d => (d as any)[metricConfigs[activeMetric].dataKey])) : 0;

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <div className="bg-white p-12 rounded-[3rem] shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-10">
            <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-black text-black uppercase tracking-tight">Performance API Testing</h2>
                  <RAGStatusBadge
                    enabled={ragEnabled}
                    onToggle={setRagEnabled}
                    retrievedChunks={retrievedRagChunks}
                  />
                </div>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mt-2">Authoritative JMX Script Architect with RAG Grounding</p>
            </div>
            <button onClick={() => sourceFileInputRef.current?.click()} className="flex items-center gap-3 bg-slate-50 text-black px-6 py-3 rounded-2xl font-black text-[14px] uppercase tracking-widest border border-slate-200 hover:bg-slate-100 transition-all">
                <Upload size={14} /> Import Postman JSON
                <input type="file" ref={sourceFileInputRef} className="hidden" accept=".json" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => setInputContent(ev.target?.result as string);
                    reader.readAsText(file);
                  }
                }} />
            </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-10">
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#f8fafc] p-10 rounded-[2.5rem] border border-slate-100 space-y-10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
              
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[14px] font-black text-black uppercase tracking-[0.2em]">Users</label>
                  <span className="text-sm font-black text-indigo-600">{vus}</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="2000" 
                  step="1" 
                  value={vus ?? ''} 
                  onChange={e => setVus(Math.max(1, parseInt(e.target.value) || 1))} 
                  className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-indigo-600" 
                />
              </div>

              <div className="space-y-3">
                <label className="text-[14px] font-black text-black uppercase tracking-[0.2em] px-1">Ramp-Up (s)</label>
                <input 
                  type="number" 
                  min="0"
                  value={rampUp ?? ''} 
                  onChange={e => {
                    const val = parseInt(e.target.value, 10);
                    setRampUp(isNaN(val) ? 0 : Math.max(0, val));
                  }} 
                  className="w-full px-6 py-5 bg-white rounded-2xl border border-slate-100 text-sm font-black text-slate-800 outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-sm" 
                />
              </div>

              <div className="space-y-3">
                <label className="text-[14px] font-black text-black uppercase tracking-[0.2em] px-1">Duration (s)</label>
                <input 
                  type="number" 
                  min="1"
                  value={duration ?? ''} 
                  onChange={e => {
                    const val = parseInt(e.target.value, 10);
                    setDuration(isNaN(val) ? 1 : Math.max(1, val));
                  }} 
                  className="w-full px-6 py-5 bg-white rounded-2xl border border-slate-100 text-sm font-black text-slate-800 outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-sm" 
                />
              </div>

              <div className="space-y-3">
                <label className="inline-block px-3 py-1 bg-indigo-600 text-black rounded-md text-[14px] font-black uppercase tracking-[0.2em] mb-1">Loop Count</label>
                <input 
                  type="number" 
                  min="1"
                  value={loopCount ?? ''} 
                  onChange={e => {
                    const val = parseInt(e.target.value, 10);
                    setLoopCount(isNaN(val) ? 1 : Math.max(1, val));
                  }} 
                  className="w-full px-6 py-5 bg-white rounded-2xl border border-slate-100 text-sm font-black text-slate-800 outline-none focus:ring-4 ring-indigo-50/10 transition-all shadow-sm" 
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-8 flex flex-col">
            <div className="relative group flex-1">
              <div className="absolute top-4 right-6 pointer-events-none flex items-center gap-2 opacity-40 group-hover:opacity-100 transition-opacity">
                <FileJson size={14} className="text-indigo-400" />
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Postman JSON / Test Logic</span>
              </div>
              <textarea
                value={inputContent || ''}
                onChange={(e) => setInputContent(e.target.value)}
                placeholder="Paste Postman collection JSON or specific performance logic requirements..."
                className="w-full h-full min-h-[350px] px-8 py-8 rounded-[2.5rem] border border-slate-200 bg-slate-50 focus:bg-white outline-none text-[13px] font-mono leading-relaxed resize-none transition-all shadow-inner"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2 text-slate-400">
                  <Settings2 size={16} />
                  <span className="text-[10px] font-black uppercase tracking-widest">AI Refinement Logic (Optional)</span>
                </div>
                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{refinementLogic.length} Characters</span>
              </div>
              <textarea
                value={refinementLogic || ''}
                onChange={(e) => setRefinementLogic(e.target.value)}
                placeholder="Specify extra JMX requirements (e.g. 'Add 500ms response time assertion', 'Include basic auth headers in all samplers', 'Add constant throughput timer of 20 tps')"
                className="w-full h-32 px-8 py-6 rounded-[2rem] border border-slate-200 bg-slate-50 focus:bg-white outline-none text-[12px] font-medium leading-relaxed resize-none transition-all shadow-inner italic text-slate-600"
              />
            </div>
            
            <div className="flex justify-end items-center mt-2">
              <button disabled={isGenerating} onClick={handleGenerateScript} className="flex items-center gap-4 bg-indigo-600 text-white px-16 py-5 rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl active:scale-95 whitespace-nowrap">
                {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                {isGenerating ? 'GENERATING JMX SCRIPT...' : 'GENERATE JMX SCRIPT'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Naming Prompt Modal for JMX */}
      {isNamingModalOpen && (() => {
        const finalJmxName = `${project.name} - ${artifactLabel.trim() || 'Script'}`;
        const isJmxDuplicate = (project.performanceScripts || []).some(
          s => (s.name || '').trim().toLowerCase() === finalJmxName.trim().toLowerCase()
        );

        return (
          <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-300">
             <div className="bg-white w-full max-w-md rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] overflow-hidden border border-white animate-in zoom-in-95 duration-200">
               <div className="p-10">
                  <div className="flex items-center gap-6 mb-10">
                     <div className="p-5 bg-indigo-600 rounded-[1.5rem] text-white shadow-xl shadow-indigo-100 flex-shrink-0">
                        <FileSignature size={32} />
                     </div>
                     <div>
                        <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight leading-none">Finalize JMX Artifact</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">Define identifier for repository archive</p>
                     </div>
                  </div>

                  <div className="space-y-8">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 flex items-center gap-2">
                         <Tag size={12} className="text-indigo-500" /> Artifact Custom Label
                      </label>
                      <div className="relative group">
                         <div className="absolute left-6 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase tracking-tight pointer-events-none group-focus-within:text-indigo-400 transition-colors">
                            {project.name} — 
                         </div>
                         <input 
                           autoFocus
                           type="text" 
                           value={artifactLabel || ''} 
                           onChange={e => setArtifactLabel(e.target.value)} 
                           placeholder="e.g. Identity Load Test" 
                           className="w-full pl-[calc(1.5rem+100px)] pr-6 py-5 bg-slate-50 border border-slate-200 rounded-[1.5rem] text-sm font-black text-slate-800 outline-none focus:ring-4 ring-indigo-50/20 transition-all shadow-inner" 
                         />
                      </div>
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest ml-4">The artifact will be saved in the persistent registry as '{project.name} - {artifactLabel || "Label"}'</p>

                      {artifactLabel.trim() && isJmxDuplicate && (
                        <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-600 text-xs font-bold animate-in fade-in">
                          <AlertTriangle size={16} className="flex-shrink-0" />
                          <span>An artifact with this identifier already exists in the repository.</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 pt-6">
                      <button 
                         onClick={confirmSaveArtifact}
                         disabled={!artifactLabel.trim() || isJmxDuplicate}
                         className="w-full py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-2xl shadow-indigo-100 active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                         <Save size={18} /> PERSIST TO REGISTRY
                      </button>
                      <button 
                         onClick={() => { setIsNamingModalOpen(false); setPendingArtifacts(null); }}
                         className="w-full py-5 bg-slate-100 text-slate-500 rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-[0.98]"
                      >
                         DISCARD ARTIFACT
                      </button>
                    </div>
                  </div>
               </div>
             </div>
          </div>
        );
      })()}

      {/* Naming Prompt Modal for Performance Report */}
      {isReportNamingModalOpen && (() => {
        const finalReportName = reportArtifactLabel.trim();
        const isReportDuplicate = (project.performanceScripts || []).some(
          s => (s.name || '').trim().toLowerCase() === finalReportName.trim().toLowerCase()
        );

        return (
          <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-300">
             <div className="bg-white w-full max-w-md rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] overflow-hidden border border-white animate-in zoom-in-95 duration-200">
               <div className="p-10">
                  <div className="flex items-center gap-6 mb-10">
                     <div className="p-5 bg-emerald-600 rounded-[1.5rem] text-white shadow-xl shadow-emerald-100 flex-shrink-0">
                        <Save size={32} />
                     </div>
                     <div>
                        <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight leading-none">Archive Report</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">Define Artifact Identifier for report archive</p>
                     </div>
                  </div>

                  <div className="space-y-8">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 flex items-center gap-2">
                         <Tag size={12} className="text-emerald-500" /> Artifact Identifier
                      </label>
                      <input 
                        autoFocus
                        type="text" 
                        value={reportArtifactLabel || ''} 
                        onChange={e => setReportArtifactLabel(e.target.value)} 
                        placeholder="e.g. Checkout Flow Analysis Report" 
                        className="w-full px-6 py-5 bg-slate-50 border border-slate-200 rounded-[1.5rem] text-sm font-black text-slate-800 outline-none focus:ring-4 ring-emerald-50/20 transition-all shadow-inner" 
                      />
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest ml-4">The report will be archived as '{reportArtifactLabel || "Untitled Report"}'</p>

                      {reportArtifactLabel.trim() && isReportDuplicate && (
                        <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-600 text-xs font-bold animate-in fade-in">
                          <AlertTriangle size={16} className="flex-shrink-0" />
                          <span>An artifact with this identifier already exists in the repository.</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 pt-6">
                      <button 
                         onClick={confirmSaveReport}
                         disabled={!reportArtifactLabel.trim() || isReportDuplicate}
                         className="w-full py-5 bg-emerald-600 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-emerald-700 shadow-2xl shadow-emerald-100 active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                         <Save size={18} /> PERSIST TO REGISTRY
                      </button>
                      <button 
                         onClick={() => { setIsReportNamingModalOpen(false); setReportArtifactLabel(''); }}
                         className="w-full py-5 bg-slate-100 text-slate-500 rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-[0.98]"
                      >
                         DISCARD REPORT
                      </button>
                    </div>
                  </div>
               </div>
             </div>
          </div>
        );
      })()}

      <div className="bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-sm">
         <div className="flex flex-col md:flex-row md:items-center justify-between gap-10 mb-12 px-6">
            <div>
               <h3 className="text-2xl font-black text-slate-800 uppercase tracking-widest flex items-center gap-4">
                 <FileSearch size={32} className="text-indigo-600" /> Performance Analytics & Insights
               </h3>
               <p className="text-[12px] text-slate-400 font-bold uppercase tracking-widest mt-2 ml-12">Automated Bottleneck Detection • Structural JMeter Audit</p>
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex flex-col gap-1">
                <button 
                  onClick={() => graphFileInputRef.current?.click()} 
                  className={`flex items-center gap-3 px-6 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-widest border transition-all active:scale-95 ${stagedGraphName ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  <FileUp size={16} /> {stagedGraphName ? 'Update Graph File' : 'Import Graph Report'}
                </button>
                {stagedGraphName && <p className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter ml-2 truncate max-w-[150px]">{stagedGraphName}</p>}
                <input type="file" ref={graphFileInputRef} className="hidden" accept=".jtl,.csv,.xml" onChange={handleImportGraphFile} />
              </div>

              <div className="flex flex-col gap-1">
                <button 
                  onClick={() => csvFileInputRef.current?.click()} 
                  className={`flex items-center gap-3 px-6 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-widest border transition-all active:scale-95 ${stagedCsvName ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  <FileSpreadsheet size={16} /> {stagedCsvName ? 'Update CSV File' : 'Import CSV Report'}
                </button>
                {stagedCsvName && <p className="text-[9px] font-black text-amber-400 uppercase tracking-tighter ml-2 truncate max-w-[150px]">{stagedCsvName}</p>}
                <input type="file" ref={csvFileInputRef} className="hidden" accept=".csv,.jtl,.xml" onChange={handleImportCsvFile} />
              </div>

              <button 
                onClick={handleGenerateFinalReport} 
                disabled={isAnalyzing}
                className="flex items-center gap-3 bg-indigo-600 text-white px-10 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? <Loader2 className="animate-spin" size={18}/> : <PlayCircle size={18} />}
                {isAnalyzing ? 'Generating Report...' : 'Generate Report'}
              </button>

              {(analysisResult || graphData.length > 0) && (
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => {
                      setInsightsTab('trends');
                      const el = document.getElementById('performance-graph-section');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="flex items-center gap-2.5 bg-indigo-50 border border-indigo-200 text-indigo-600 px-7 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-100 transition-all shadow-md active:scale-95 cursor-pointer"
                    title="View Graph"
                  >
                    <Eye size={18} /> View Graph
                  </button>
                  <button onClick={handleSaveAnalysis} className="flex items-center gap-4 bg-emerald-600 text-white px-10 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl active:scale-95">
                    <Save size={20} /> Save to Archives
                  </button>
                </div>
              )}
            </div>
         </div>

         {(isAnalyzing || analysisResult || graphData.length > 0) && (
           <div id="performance-graph-section" className="space-y-12 animate-in slide-in-from-bottom-6 duration-700">
              <div className="flex gap-10 border-b border-slate-100 mb-10 px-12">
                <button onClick={() => setInsightsTab('trends')} className={`pb-5 text-[11px] font-black uppercase tracking-[0.2em] relative transition-all ${insightsTab === 'trends' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  <span className="flex items-center gap-3"><AreaChartIcon size={18} /> {isDesignFile ? 'Designed Load Topology' : 'Execution Result Streams'}</span>
                  {insightsTab === 'trends' && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-indigo-600 rounded-t-full shadow-lg shadow-indigo-500/50" />}
                </button>
                <button onClick={() => setInsightsTab('report')} className={`pb-5 text-[11px] font-black uppercase tracking-[0.2em] relative transition-all ${insightsTab === 'report' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  <span className="flex items-center gap-3"><FileText size={18} /> {isDesignFile ? 'AI Design Integrity Audit' : 'AI Performance Verdict'}</span>
                  {insightsTab === 'report' && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-indigo-600 rounded-t-full shadow-lg shadow-indigo-500/50" />}
                </button>
              </div>

              {isAnalyzing && !graphData.length && !analysisResult ? (
                <div className="py-48 flex flex-col items-center justify-center gap-10">
                    <Loader2 size={40} className="animate-spin text-indigo-600" />
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Parsing Telemetry Stream...</p>
                </div>
              ) : (
                <>
                {insightsTab === 'trends' ? (
                  <div className="space-y-10 px-6 pb-6">
                    {graphData.length > 0 ? (
                      <div className="bg-[#fcfcfc] p-12 rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden group">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-12 gap-8">
                           <div className="flex items-center gap-6">
                              <div className={`p-5 rounded-3xl transition-transform group-hover:scale-110 shadow-xl ${activeMetric === 'hits' ? 'bg-purple-50 text-purple-600' : activeMetric === 'latency' ? 'bg-indigo-50 text-indigo-600' : activeMetric === 'threads' ? 'bg-emerald-50 text-emerald-600' : activeMetric === 'success' ? 'bg-pink-50 text-pink-600' : activeMetric === 'tps' ? 'bg-orange-50 text-orange-600' : 'bg-rose-50 text-rose-600'}`}>
                                {metricConfigs[activeMetric].icon}
                              </div>
                              <div>
                                 <h4 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-3">
                                     {metricConfigs[activeMetric].label}
                                 </h4>
                                 <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">High-Precision Granularity: {granularityLabel}</p>
                              </div>
                           </div>
                           
                           <div className="flex items-center gap-4">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Telemetry View:</label>
                              <div className="relative">
                                 <select 
                                    value={activeMetric || ''}
                                    onChange={(e) => setActiveMetric(e.target.value as PerformanceMetricType)}
                                    className="pl-5 pr-12 py-3 bg-slate-100 border border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-widest outline-none appearance-none cursor-pointer focus:ring-4 ring-indigo-50/10 transition-all hover:bg-white shadow-sm"
                                 >
                                    {Object.entries(metricConfigs).map(([key, cfg]) => (
                                       <option key={key} value={key}>{cfg.label}</option>
                                    ))}
                                 </select>
                                 <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                              </div>
                           </div>
                        </div>

                        <div className="h-[650px] w-full px-4 pt-10 bg-white border border-slate-100 rounded-[3rem] shadow-inner relative">
                           <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={graphData} margin={{ top: 20, right: 40, left: 60, bottom: 80 }}>
                                 <CartesianGrid strokeDasharray="3 3" vertical={true} stroke="#f1f5f9" />
                                 <XAxis 
                                   dataKey="time" 
                                   axisLine={{ stroke: '#cbd5e1', strokeWidth: 2 }} 
                                   tickLine={false} 
                                   tick={{ fill: '#64748b', fontSize: 11, fontWeight: 800 }} 
                                   minTickGap={50}
                                 >
                                   <Label value="Elapsed Time" offset={-50} position="insideBottom" style={{ fontSize: '13px', fontWeight: '900', fill: '#64748b', textTransform: 'uppercase', letterSpacing: '0.2em' }} />
                                 </XAxis>
                                 <YAxis 
                                   axisLine={{ stroke: '#cbd5e1', strokeWidth: 2 }} 
                                   tickLine={false} 
                                   tick={{ fill: '#64748b', fontSize: 11, fontWeight: 800 }}
                                   domain={[0, activeMetric === 'hits' && maxValInGraph <= 10 ? 10 : 'auto']}
                                   ticks={activeMetric === 'hits' && maxValInGraph <= 10 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : undefined}
                                   allowDecimals={activeMetric !== 'hits' && activeMetric !== 'threads'}
                                 >
                                   <Label value={metricConfigs[activeMetric].yLabel.toUpperCase()} angle={-90} position="insideLeft" offset={-40} style={{ fontSize: '12px', fontWeight: '900', fill: '#64748b', textAnchor: 'middle', letterSpacing: '0.1em' }} />
                                 </YAxis>
                                 <RechartsTooltip 
                                   contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '1.5rem', padding: '20px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.2)' }}
                                   itemStyle={{ fontSize: '14px', fontWeight: '900', textTransform: 'uppercase', color: metricConfigs[activeMetric].color }}
                                   formatter={(value: any) => [value, metricConfigs[activeMetric].label]}
                                 />
                                 <Line 
                                   type="monotone" 
                                   dataKey={metricConfigs[activeMetric].dataKey} 
                                   name={metricConfigs[activeMetric].label} 
                                   stroke={metricConfigs[activeMetric].color} 
                                   strokeWidth={4} 
                                   dot={{ r: 5, fill: metricConfigs[activeMetric].color, strokeWidth: 3, stroke: '#fff' }}
                                   activeDot={{ r: 8, strokeWidth: 3, stroke: '#fff', fill: metricConfigs[activeMetric].color }}
                                   animationDuration={2000}
                                   connectNulls={true}
                                 />
                              </LineChart>
                           </ResponsiveContainer>
                        </div>
                      </div>
                    ) : (
                      <div className="py-48 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-[3.5rem]">
                         <Activity size={64} className="text-slate-200 mx-auto mb-6" />
                         <p className="text-[12px] font-black text-slate-400 uppercase tracking-[0.4em]">Awaiting JMeter Result Archive</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 px-6 pb-6">
                    {analysisResult && (
                        <>
                        <div className="lg:col-span-5 bg-slate-900 rounded-[3rem] p-12 flex flex-col justify-between border border-white/5 shadow-2xl relative overflow-hidden group min-h-[550px]">
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-10">
                                    <span className="text-[12px] font-black uppercase tracking-[0.3em] text-indigo-400">AI Global Verdict</span>
                                    {getStatusBadge(analysisResult.status)}
                                </div>
                                <h4 className="text-4xl font-black text-white uppercase tracking-tighter leading-tight mb-6">{analysisResult.productionReadiness}</h4>
                                <p className="text-sm text-slate-400 font-medium leading-relaxed italic border-l-4 border-indigo-500 pl-6 py-3 bg-white/5 rounded-r-2xl">{analysisResult.loadStatement}</p>
                            </div>
                        </div>
                        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-[3rem] p-12 shadow-sm flex flex-col min-h-[550px]">
                            <h4 className="text-2xl font-black text-slate-800 uppercase tracking-tighter mb-10 flex items-center gap-4"><BarChart3 className="text-indigo-600" size={28} /> AI Structural Audit</h4>
                            <div className="grid grid-cols-2 gap-4">
                                {(analysisResult.technicalReport?.metrics || []).map((m: any, idx: number) => (
                                    <div key={idx} className="p-6 bg-slate-50 border border-slate-100 rounded-3xl">
                                        <p className="text-[14px] font-black text-black uppercase mb-2 tracking-widest">{m.label}</p>
                                        <p className="text-sm font-black text-slate-800 uppercase">{m.value}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        </>
                    )}
                  </div>
                )}
                </>
              )}
           </div>
         )}
      </div>

      {/* Artifact Repository Archives with Bulk Delete */}
      <div className="bg-white rounded-[3.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in slide-in-from-bottom-6 duration-700">
         <div className="p-12 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="flex items-center gap-5">
              <div className="p-4 bg-indigo-600 rounded-[1.5rem] text-white shadow-xl shadow-indigo-100">
                  <Database size={28} />
              </div>
              <div>
                  <h3 className="text-2xl font-black text-black uppercase tracking-tight">Artifact Repository Archives</h3>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Managed Persistent Registry for JMX Scripts and AI Reports</p>
              </div>
            </div>

            {selectedArchiveIds.size > 0 && (
              <div className="flex items-center gap-4 animate-in slide-in-from-right-4 duration-300">
                 <div className="px-6 py-2 bg-slate-900 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-xl border border-white/10">
                    {selectedArchiveIds.size} Items Selected
                 </div>
                 <button 
                   onClick={handleBulkDeleteArchives}
                   className="flex items-center gap-2 bg-rose-600 text-white px-8 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-700 transition-all shadow-xl active:scale-95"
                 >
                    <Trash2 size={18} /> Bulk Delete
                 </button>
                 <button onClick={() => setSelectedArchiveIds(new Set())} className="p-3 text-slate-400 hover:text-slate-600 bg-white border border-slate-200 rounded-xl">
                    <X size={20} />
                 </button>
              </div>
            )}
         </div>

         <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/30 text-[14px] font-black text-black uppercase tracking-[0.2em] border-b border-slate-100">
                  <th className="px-10 py-8 w-16">
                     <button onClick={handleSelectAllArchives} className="p-1 transition-all text-slate-300 hover:text-indigo-600">
                        {selectedArchiveIds.size === archives.length && archives.length > 0 ? <CheckSquare size={20} /> : <Square size={20} />}
                     </button>
                  </th>
                  <th className="px-10 py-8">Classification</th>
                  <th className="px-10 py-8">Artifact Identifier</th>
                  <th className="px-10 py-8">Generation Timestamp</th>
                  <th className="px-10 py-8 text-right">Repository Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {archives.length === 0 ? (
                   <tr><td colSpan={5} className="px-12 py-32 text-center opacity-30 text-slate-500 font-black uppercase tracking-widest">No artifacts archived.</td></tr>
                ) : (
                  archives.map((item) => (
                    <tr key={item.id} className={`hover:bg-slate-50/30 transition-colors group ${selectedArchiveIds.has(item.id) ? 'bg-indigo-50/20' : ''}`}>
                      <td className="px-10 py-8">
                         <button onClick={() => toggleArchiveSelection(item.id)} className={`p-1 transition-all ${selectedArchiveIds.has(item.id) ? 'text-indigo-600' : 'text-slate-200 group-hover:text-slate-300'}`}>
                            {selectedArchiveIds.has(item.id) ? <CheckSquare size={20} /> : <Square size={20} />}
                         </button>
                      </td>
                      <td className="px-10 py-8">
                         <div className="flex items-center gap-5">
                            <div className={`p-4 rounded-2xl inline-flex items-center justify-center shadow-lg border ${
                              item.trendData && !item.analysisReport 
                                ? 'bg-purple-50 text-purple-600 border-purple-100' 
                                : item.analysisReport 
                                ? 'bg-amber-50 text-amber-600 border-amber-100' 
                                : 'bg-indigo-50 text-indigo-600 border-indigo-100'
                            }`}>
                                {item.trendData && !item.analysisReport ? <AreaChartIcon size={24} /> : item.analysisReport ? <FileSearch size={24} /> : <FileCode size={24} />}
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-[0.1em]">
                              {item.trendData && !item.analysisReport ? 'Graph Report' : item.analysisReport ? 'AI Report' : 'JMX Script'}
                            </span>
                         </div>
                      </td>
                      <td className="px-10 py-8">
                         <p className="text-base font-black text-black uppercase tracking-tight truncate max-w-[400px]">{item.name || 'Untitled Artifact'}</p>
                      </td>
                      <td className="px-10 py-8">
                         <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-tight">
                               <Calendar size={14} className="text-slate-300" />
                               {item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-GB') : 'N/A'}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                               <Clock size={14} className="text-slate-200" />
                               {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                            </div>
                         </div>
                      </td>
                      <td className="px-10 py-8 text-right">
                        <div className="flex items-center justify-end gap-3 transition-all">
                           {(item.analysisReport || item.trendData) && (
                             <button 
                               onClick={() => { 
                                 setViewingReportId(item.id); 
                                 setModalActiveTab(item.trendData ? 'trends' : 'report'); 
                                 if (item.trendData) setModalActiveMetric('hits');
                               }} 
                               className="p-3 bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 rounded-2xl shadow-md transition-all hover:scale-105" 
                               title={item.trendData ? "View Graph & Telemetry" : "View AI Verdict"}
                             >
                               <Eye size={22} />
                             </button>
                           )}
                           {!item.analysisReport && item.jmxContent && (
                             <button onClick={() => handleDownloadJmx(item)} className="p-3 bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 rounded-2xl shadow-md" title="Download JMX Script"><Download size={22} /></button>
                           )}
                           <button onClick={() => onUpdateProject({...project, performanceScripts: archives.filter(s => s.id !== item.id)})} className="p-3 bg-white border border-slate-200 text-slate-300 hover:text-rose-500 rounded-2xl shadow-md" title="Delete Artifact"><Trash2 size={22} /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
         </div>
      </div>

      {viewingReportId && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-12">
           <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md" onClick={() => setViewingReportId(null)} />
           <div className="relative bg-white w-full max-6xl h-[90vh] rounded-[3.5rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20">
              <div className="p-10 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 backdrop-blur-sm">
                 <div className="flex items-center gap-5">
                    <div className={`p-4 rounded-3xl text-white shadow-2xl ${
                      archives.find(a => a.id === viewingReportId)?.trendData && !archives.find(a => a.id === viewingReportId)?.analysisReport
                        ? 'bg-purple-600'
                        : archives.find(a => a.id === viewingReportId)?.analysisReport 
                        ? 'bg-amber-500' 
                        : 'bg-indigo-600'
                    }`}>
                       {archives.find(a => a.id === viewingReportId)?.trendData && !archives.find(a => a.id === viewingReportId)?.analysisReport 
                         ? <AreaChartIcon size={32} /> 
                         : archives.find(a => a.id === viewingReportId)?.analysisReport 
                         ? <FileSearch size={32} /> 
                         : <FileCode size={32} />}
                    </div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">{archives.find(a => a.id === viewingReportId)?.name}</h3>
                       <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Archived Telemetry & Intelligence Review</p>
                    </div>
                 </div>
                 <div className="flex gap-4">
                    <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                        {archives.find(a => a.id === viewingReportId)?.trendData && (
                          <button onClick={() => setModalActiveTab('trends')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${modalActiveTab === 'trends' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Trends Graph</button>
                        )}
                        {archives.find(a => a.id === viewingReportId)?.analysisReport && (
                          <button onClick={() => setModalActiveTab('report')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${modalActiveTab === 'report' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Verdict Report</button>
                        )}
                    </div>
                    <button onClick={() => setViewingReportId(null)} className="p-3 bg-white text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all border border-slate-100 shadow-sm">
                        <X size={32} />
                    </button>
                 </div>
              </div>
              <div className="flex-1 overflow-y-auto p-14 bg-slate-50/50 custom-scrollbar shadow-inner">
                  {(() => {
                      const artifact = archives.find(a => a.id === viewingReportId);
                      if (!artifact) return null;

                      if (modalActiveTab === 'trends') {
                          const archivedTrendData: AnalyticsDataPoint[] = artifact.trendData ? JSON.parse(artifact.trendData) : [];
                          const maxValInArchived = archivedTrendData.length > 0 ? Math.max(...archivedTrendData.map((d: any) => d[metricConfigs[modalActiveMetric].dataKey])) : 0;
                          return (
                            <div className="max-w-6xl mx-auto">
                               {archivedTrendData.length > 0 ? (
                                  <div className="bg-white p-12 rounded-[3rem] border border-slate-200 shadow-xl overflow-hidden group">
                                     <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-10 gap-6">
                                         <div className="flex items-center gap-6">
                                             <div className={`p-4 rounded-2xl shadow-lg ${modalActiveMetric === 'hits' ? 'bg-purple-50 text-purple-600' : modalActiveMetric === 'latency' ? 'bg-indigo-50 text-indigo-600' : modalActiveMetric === 'threads' ? 'bg-emerald-50 text-emerald-600' : modalActiveMetric === 'success' ? 'bg-pink-50 text-pink-600' : modalActiveMetric === 'tps' ? 'bg-orange-50 text-orange-600' : 'bg-rose-50 text-rose-600'}`}>
                                                 {metricConfigs[modalActiveMetric].icon}
                                             </div>
                                             <div>
                                                <h4 className="text-2xl font-black text-slate-800 uppercase tracking-tighter leading-none">{metricConfigs[modalActiveMetric].label}</h4>
                                                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1.5">Archived Execution Telemetry</p>
                                             </div>
                                         </div>
                                         <div className="flex flex-wrap gap-2">
                                            {Object.entries(metricConfigs).map(([key, cfg]) => (
                                                <button key={key} onClick={() => setModalActiveMetric(key as any)} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${modalActiveMetric === key ? 'bg-slate-900 text-white shadow-md' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>{key}</button>
                                            ))}
                                         </div>
                                     </div>
                                     <div className="h-[500px] w-full bg-white rounded-3xl p-6 border border-slate-100 shadow-inner relative">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={archivedTrendData} margin={{ bottom: 30, left: 40 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }}>
                                                   <Label value="Elapsed Time" offset={-20} position="insideBottom" style={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }} />
                                                </XAxis>
                                                <YAxis 
                                                  axisLine={false} 
                                                  tickLine={false} 
                                                  tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }}
                                                  domain={[0, modalActiveMetric === 'hits' && maxValInArchived <= 10 ? 10 : 'auto']}
                                                  ticks={modalActiveMetric === 'hits' && maxValInArchived <= 10 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : undefined}
                                                >
                                                   <Label value={metricConfigs[modalActiveMetric].yLabel} angle={-90} position="insideLeft" offset={-30} style={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', textAnchor: 'middle' }} />
                                                </YAxis>
                                                <RechartsTooltip 
                                                  contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 20px 40px -10px rgba(0,0,0,0.1)' }} 
                                                  formatter={(value: any) => [value, metricConfigs[modalActiveMetric].label]}
                                                />
                                                <Line 
                                                  type="monotone" 
                                                  dataKey={metricConfigs[modalActiveMetric].dataKey} 
                                                  stroke={metricConfigs[modalActiveMetric].color} 
                                                  strokeWidth={4} 
                                                  dot={{ r: 5, fill: metricConfigs[modalActiveMetric].color, strokeWidth: 3, stroke: '#fff' }} 
                                                  activeDot={{ r: 8, strokeWidth: 3, stroke: '#fff', fill: metricConfigs[modalActiveMetric].color }} 
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                     </div>
                                  </div>
                               ) : (
                                  <div className="py-32 text-center bg-white border-2 border-dashed border-slate-200 rounded-[3rem] opacity-30 font-black uppercase text-xs tracking-widest">No trend data available for this artifact.</div>
                               )}
                            </div>
                          );
                      }

                      const reportData = artifact.analysisReport;
                      if (!reportData) return null;
                      try {
                          const parsed = JSON.parse(reportData);
                          return (
                            <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in duration-500">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col items-center justify-center group hover:border-indigo-200 transition-all">
                                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Execution Verdict</p>
                                        <div className="scale-[1.5] transition-transform group-hover:scale-[1.6]">{getStatusBadge(parsed.status)}</div>
                                    </div>
                                    <div className="md:col-span-2 bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm group hover:border-indigo-200 transition-all">
                                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                                            <Zap size={14} className="text-indigo-500" /> AI Readiness Indicator
                                        </p>
                                        <h5 className="text-3xl font-black text-slate-800 uppercase tracking-tighter">{parsed.productionReadiness}</h5>
                                        <p className="text-sm text-slate-500 font-medium mt-3 border-t border-slate-50 pt-3 italic border-l-4 border-indigo-400 pl-6 py-2 bg-indigo-50/30 rounded-r-2xl">{parsed.loadStatement}</p>
                                    </div>
                                </div>
                                <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
                                    <h4 className="text-xl font-black text-slate-800 uppercase tracking-tighter mb-10 flex items-center gap-4">
                                        <BarChart3 className="text-indigo-600" size={24} /> AI Structural Technical Report
                                    </h4>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        {(parsed.technicalReport?.metrics || []).map((m: any, idx: number) => (
                                            <div key={idx} className="p-6 bg-slate-50 border border-slate-100 rounded-3xl hover:bg-white hover:shadow-md transition-all">
                                                <p className="text-[14px] font-black text-black uppercase mb-2 tracking-widest">{m.label}</p>
                                                <p className="text-sm font-black text-slate-800 uppercase truncate">{m.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                          );
                      } catch (e) {
                          return <div className="text-sm text-slate-500 italic whitespace-pre-wrap p-12 bg-white rounded-3xl border shadow-inner">{reportData}</div>;
                      }
                  })()}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default PerformanceTesting;
