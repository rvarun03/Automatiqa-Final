import { TokenLog, FeaturePricingRate } from '../types';
import { collection, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { syncSetDoc, syncDeleteDoc } from './firestoreSync';

// ============================================================================
// GEMINI 3.7 FLASH OFFICIAL PRICING CONSTANTS (Paid Tier)
// ============================================================================
export const GEMINI_37_FLASH_MODEL = 'Gemini 3.7 Flash';
export const GEMINI_36_FLASH_MODEL = GEMINI_37_FLASH_MODEL;

// Paid Tier pricing per 1,000 tokens (per 1M tokens: $1.50 Input, $7.50 Output, $0.15 Context Cache)
export const GEMINI_37_FLASH_INPUT_RATE_PER_1K = 0.0015; // $1.50 per 1,000,000 tokens ($0.0015 / 1K)
export const GEMINI_37_FLASH_OUTPUT_RATE_PER_1K = 0.0075; // $7.50 per 1,000,000 tokens ($0.0075 / 1K)
export const GEMINI_37_FLASH_CACHED_INPUT_RATE_PER_1K = 0.00015; // $0.15 per 1,000,000 tokens ($0.00015 / 1K)

export const GEMINI_36_FLASH_INPUT_RATE_PER_1K = GEMINI_37_FLASH_INPUT_RATE_PER_1K;
export const GEMINI_36_FLASH_OUTPUT_RATE_PER_1K = GEMINI_37_FLASH_OUTPUT_RATE_PER_1K;
export const GEMINI_36_FLASH_CACHED_INPUT_RATE_PER_1K = GEMINI_37_FLASH_CACHED_INPUT_RATE_PER_1K;

// Multimodal Token Constants for Gemini 3.7 Flash
export const TOKENS_PER_IMAGE_SCREENSHOT = 258; // Standard vision tokens per screenshot
export const TOKENS_PER_VIDEO_SECOND = 258; // 1 frame per second @ 258 tokens/frame
export const TOKENS_PER_DOC_PAGE = 650; // Average tokens per standard document page (approx. 400-500 words per page)
export const CHARS_PER_TOKEN = 4; // Standard text token ratio (1 token ~ 4 chars)

export type InputTier = 'Small' | 'Medium' | 'High';

export interface TierInfo {
  tier: InputTier;
  count: number;
  label: string;
  badgeClass: string;
  dotClass: string;
  description: string;
  unit: string;
  rule: string;
}

/**
 * Extracts input count from details string, modality, or token usage.
 * Strictly handles:
 * - Documents / BRD: Page count (e.g. "30 pages", "30 pages BRD", "1 BRD Doc (30 pages)")
 * - Screenshots: Screenshot count (e.g. "12 Screenshots")
 * - Videos: Duration in seconds/steps (e.g. "15 steps", "60 seconds")
 * - URLs: URL endpoints / sub-pages count
 * - JSON / API: Endpoints / Schema models count
 * - User Stories / Scenarios: Count of stories / scenarios
 */
export const extractInputCountFromDetails = (details?: string, modality?: string, log?: Partial<TokenLog>): number => {
  if (log && typeof log.inputCount === 'number' && log.inputCount > 0) {
    return log.inputCount;
  }

  if (!details) {
    // If inputTokens is provided in log, derive estimated count
    if (log && typeof log.inputTokens === 'number' && log.inputTokens > 0) {
      if (log.inputTokens >= 7000) return Math.round(log.inputTokens / TOKENS_PER_DOC_PAGE) || 12;
      if (log.inputTokens >= 3500) return 8;
      return 4;
    }
    return 5;
  }

  const str = details.trim();

  // 1. Explicit document page patterns:
  // e.g. "30 pages", "30 BRD Spec Doc Pages", "30p", "pages: 30", "Page Count: 30", "1 BRD Doc (30 pages)"
  const pageMatch1 = str.match(/(\d+)\s*(?:brd|doc|document|spec|requirements?|pdf|docx|word)?\s*pages?\b/i);
  if (pageMatch1) {
    return parseInt(pageMatch1[1], 10);
  }

  const pageMatch2 = str.match(/pages?[:\s]+(\d+)\b/i);
  if (pageMatch2) {
    return parseInt(pageMatch2[1], 10);
  }

  const pageMatch3 = str.match(/\((\d+)\s*pages?\)/i);
  if (pageMatch3) {
    return parseInt(pageMatch3[1], 10);
  }

  const pageMatch4 = str.match(/(\d+)\s*p\b/i);
  if (pageMatch4 && !str.includes('px') && !str.includes('pm') && !str.includes('playwright')) {
    return parseInt(pageMatch4[1], 10);
  }

  // 2. Screenshots / Images patterns:
  // e.g. "12 Screenshots", "8 UI Screenshots (Vision)", "Screenshots: 15"
  const screenshotMatch = str.match(/(\d+)\s*(?:screenshots?|wireframes?|mockups?|images?|screens?|frames?)\b/i);
  if (screenshotMatch) {
    return parseInt(screenshotMatch[1], 10);
  }

  // 3. User stories / Scenarios / Test Cases patterns:
  // e.g. "25 User Stories", "14 Test Scenarios", "30 Detailed Test Cases"
  const itemMatch = str.match(/(\d+)\s*(?:user\s*stories|stories|scenarios|test\s*cases|cases|scripts|steps|endpoints|routes|profiles|users|items|fields)\b/i);
  if (itemMatch) {
    return parseInt(itemMatch[1], 10);
  }

  // 4. Video duration / steps:
  // e.g. "45 seconds", "2 mins", "15 Video Steps"
  const videoMatch = str.match(/(\d+)\s*(?:sec|seconds?|mins?|minutes?|steps?)\b/i);
  if (videoMatch) {
    return parseInt(videoMatch[1], 10);
  }

  // 5. URL count:
  // e.g. "3 URLs", "5 Target Web URLs"
  const urlMatch = str.match(/(\d+)\s*(?:urls?|sub-pages?|web\s*pages?)\b/i);
  if (urlMatch) {
    return parseInt(urlMatch[1], 10);
  }

  // 6. If numbers exist, find the primary non-wrapper number
  // Avoid taking leading '1' if there is another number like "1 Document (30 pages)"
  const allNums = str.match(/\b\d+\b/g);
  if (allNums && allNums.length > 0) {
    const parsedNums = allNums.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
    // If there's a number > 1 (e.g. 30 in "1 BRD (30 pages)"), choose that
    const largerNums = parsedNums.filter(n => n > 1);
    if (largerNums.length > 0) {
      return largerNums[0];
    }
    return parsedNums[0] > 0 ? parsedNums[0] : 5;
  }

  // 7. Fallback based on log input tokens if available
  if (log && typeof log.inputTokens === 'number' && log.inputTokens > 0) {
    if (log.inputTokens >= 7000) return 15;
    if (log.inputTokens >= 3500) return 8;
    return 4;
  }

  return 5;
};

/**
 * Calculates input Tier (Small, Medium, High) based on Given Input count / Document Page count:
 * - Small: count <= 5 (e.g. 5 pages / 5 inputs: Small - 5 pages / ≤5)
 * - Medium: count 6..10 (e.g. 10 pages / 10 inputs: Medium - 10 pages / 6-10)
 * - High: count > 10 (above 10 pages / above 10 inputs: High - above 10 pages / >10)
 */
export const calculateInputTier = (inputCountOrLog?: number | Partial<TokenLog> | null): TierInfo => {
  let count = 5;
  let unit = 'inputs';
  let isDoc = false;
  let isScreenshot = false;
  let isVideo = false;
  let isUrl = false;
  let isApi = false;

  if (typeof inputCountOrLog === 'number') {
    count = inputCountOrLog;
  } else if (inputCountOrLog) {
    if (typeof inputCountOrLog.inputCount === 'number' && inputCountOrLog.inputCount > 0) {
      count = inputCountOrLog.inputCount;
    } else {
      count = extractInputCountFromDetails(inputCountOrLog.inputModalityDetails, inputCountOrLog.inputModality, inputCountOrLog);
    }

    const mod = (inputCountOrLog.inputModality || '').toLowerCase();
    const details = (inputCountOrLog.inputModalityDetails || '').toLowerCase();
    const feat = (inputCountOrLog.feature || '').toLowerCase();

    if (mod === 'document' || feat.includes('user stories') || details.includes('page') || details.includes('brd') || details.includes('spec') || details.includes('doc')) {
      isDoc = true;
    } else if (mod === 'screenshot' || details.includes('screenshot') || details.includes('image') || feat.includes('ui test') || feat.includes('figma')) {
      isScreenshot = true;
    } else if (mod === 'video' || details.includes('video') || details.includes('frame') || feat.includes('record')) {
      isVideo = true;
    } else if (mod === 'url' || details.includes('url') || feat.includes('performance')) {
      isUrl = true;
    } else if (details.includes('api') || details.includes('endpoint') || details.includes('swagger') || details.includes('json') || feat.includes('api')) {
      isApi = true;
    }
  }

  if (isDoc) {
    unit = count === 1 ? 'page' : 'pages';
  } else if (isScreenshot) {
    unit = count === 1 ? 'screenshot' : 'screenshots';
  } else if (isVideo) {
    unit = count === 1 ? 'step' : 'steps';
  } else if (isUrl) {
    unit = count === 1 ? 'url' : 'urls';
  } else if (isApi) {
    unit = count === 1 ? 'endpoint' : 'endpoints';
  } else {
    unit = count === 1 ? 'input' : 'inputs';
  }

  let tier: InputTier = 'Small';
  let badgeClass = 'bg-teal-50 text-teal-700 border-teal-200/80';
  let dotClass = 'bg-teal-500';
  let rule = '≤ 5';
  let description = `Small standard (${unit} ≤ 5)`;

  if (count > 10) {
    tier = 'High';
    badgeClass = 'bg-purple-50 text-purple-700 border-purple-200/80';
    dotClass = 'bg-purple-500';
    rule = '> 10';
    description = isDoc ? 'High volume (>10 pages)' : `High standard (${unit} > 10)`;
  } else if (count > 5) {
    tier = 'Medium';
    badgeClass = 'bg-amber-50 text-amber-700 border-amber-200/80';
    dotClass = 'bg-amber-500';
    rule = '6 - 10';
    description = isDoc ? 'Medium standard (6-10 pages)' : `Medium standard (${unit} 6-10)`;
  } else {
    tier = 'Small';
    badgeClass = 'bg-teal-50 text-teal-700 border-teal-200/80';
    dotClass = 'bg-teal-500';
    rule = '≤ 5';
    description = isDoc ? 'Small standard (≤5 pages)' : `Small standard (${unit} ≤ 5)`;
  }

  return {
    tier,
    count,
    label: `${tier} (${count} ${unit})`,
    badgeClass,
    dotClass,
    description,
    unit,
    rule
  };
};

/**
 * Calculates estimated generation capacity, tokens, and cost range for any feature & input count
 */
export const calculateCapacityAndEstimates = (
  featureName: string,
  inputCount: number,
  modality: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal' = 'Document'
) => {
  const tierInfo = calculateInputTier(inputCount);
  let estimatedInputTokens = 2450;
  let estimatedOutputTokens = 1200;
  let estimatedOutputItems = 4;
  let outputUnit = 'User Stories';

  switch (modality) {
    case 'Document':
      estimatedInputTokens = Math.max(1200, inputCount * TOKENS_PER_DOC_PAGE + 850);
      break;
    case 'Screenshot':
      estimatedInputTokens = Math.max(1200, inputCount * TOKENS_PER_IMAGE_SCREENSHOT + 850);
      break;
    case 'Video':
      estimatedInputTokens = Math.max(1500, inputCount * TOKENS_PER_VIDEO_SECOND + 1000);
      break;
    case 'URL':
      estimatedInputTokens = Math.max(1500, inputCount * 1200 + 750);
      break;
    case 'Multimodal':
      estimatedInputTokens = Math.max(2500, inputCount * 500 + 1200);
      break;
    default:
      estimatedInputTokens = Math.max(1000, inputCount * 300 + 600);
      break;
  }

  // Adjust output capacity based on tier
  if (tierInfo.tier === 'High') {
    estimatedOutputItems = Math.min(35, Math.max(15, Math.round(inputCount * 0.8)));
    estimatedOutputTokens = estimatedOutputItems * 400;
  } else if (tierInfo.tier === 'Medium') {
    estimatedOutputItems = Math.min(12, Math.max(7, Math.round(inputCount * 0.9)));
    estimatedOutputTokens = estimatedOutputItems * 380;
  } else {
    estimatedOutputItems = Math.min(5, Math.max(3, inputCount));
    estimatedOutputTokens = estimatedOutputItems * 350;
  }

  if (featureName.includes('Scenario')) {
    outputUnit = 'BDD Scenarios';
  } else if (featureName.includes('Test Case') || featureName.includes('test cases')) {
    outputUnit = 'Test Cases';
  } else if (featureName.includes('Automation') || featureName.includes('Script')) {
    outputUnit = 'Automation Scripts';
  } else if (featureName.includes('UI testing') || featureName.includes('Figma')) {
    outputUnit = 'UI Inspection Audits';
  } else if (featureName.includes('Synthetic')) {
    outputUnit = 'Synthetic User Personas';
  } else if (featureName.includes('API')) {
    outputUnit = 'API Test Suites';
  } else if (featureName.includes('Performance')) {
    outputUnit = 'Performance JMX Plans';
  }

  const costUsd = calculateTokenCostUsd(estimatedInputTokens, estimatedOutputTokens, false);
  const costFormatted = formatDollarCost(costUsd);

  return {
    tierInfo,
    estimatedInputTokens,
    estimatedOutputTokens,
    totalEstimatedTokens: estimatedInputTokens + estimatedOutputTokens,
    estimatedOutputItems,
    outputUnit,
    costUsd,
    costFormatted
  };
};

/**
 * Calculates dollar cost for Gemini 3.7 Flash token usage based on Paid Tier pricing
 */
export const calculateTokenCostUsd = (inputTokens: number, outputTokens: number, cached: boolean = false): number => {
  const inputRate = cached ? GEMINI_37_FLASH_CACHED_INPUT_RATE_PER_1K : GEMINI_37_FLASH_INPUT_RATE_PER_1K;
  const inputCost = (inputTokens / 1000) * inputRate;
  const outputCost = (outputTokens / 1000) * GEMINI_37_FLASH_OUTPUT_RATE_PER_1K;
  
  const totalCost = inputCost + outputCost;
  return Number(totalCost.toFixed(6));
};

/**
 * Formats dollar amounts nicely for UI display
 */
export const formatDollarCost = (cost: number): string => {
  if (cost === 0 || isNaN(cost)) return '$0.000000';
  if (cost < 1) {
    return `$${cost.toFixed(6)}`;
  }
  return `$${cost.toFixed(4)}`;
};

/**
 * Multimodal input tokens calculator for Gemini 3.7 Flash
 */
export interface MultimodalInputParams {
  textChars?: number;
  screenshotCount?: number;
  videoDurationSeconds?: number;
  documentPages?: number;
  urlScrapedChars?: number;
  systemPromptTokens?: number;
}

export const calculateMultimodalInputTokens = (params: MultimodalInputParams): number => {
  const textTokens = params.textChars ? Math.ceil(params.textChars / CHARS_PER_TOKEN) : 0;
  const screenshotTokens = (params.screenshotCount || 0) * TOKENS_PER_IMAGE_SCREENSHOT;
  const videoTokens = (params.videoDurationSeconds || 0) * TOKENS_PER_VIDEO_SECOND;
  const docTokens = (params.documentPages || 0) * TOKENS_PER_DOC_PAGE;
  const urlTokens = params.urlScrapedChars ? Math.ceil(params.urlScrapedChars / CHARS_PER_TOKEN) + 200 : 0;
  const basePromptTokens = params.systemPromptTokens || 600;

  return textTokens + screenshotTokens + videoTokens + docTokens + urlTokens + basePromptTokens;
};

/**
 * Output tokens calculator based on generated character count or items
 */
export const calculateOutputTokens = (outputCharsOrCount: number, isItemCount: boolean = false, tokensPerItem: number = 350): number => {
  if (isItemCount) {
    return Math.max(1, outputCharsOrCount) * tokensPerItem;
  }
  return Math.ceil(outputCharsOrCount / CHARS_PER_TOKEN);
};

// ============================================================================
// ALL 10 AUTOMATIQA MODULES & SPECIFICATIONS
// ============================================================================
export const AUTOMATIQA_MODULES = [
  {
    id: 'ai-user-stories',
    name: 'AI User stories generation',
    shortName: 'User Stories',
    inputTypes: ['Text', 'Document (DOCX/PDF)', 'Screenshot', 'Prompt'],
    outputType: 'Jira User Stories & Acceptance Criteria',
    baseSystemPrompt: 850,
    avgInputTokens: 2450,
    avgOutputTokens: 980,
    defaultItems: 4,
    description: 'Parses requirements docs, text prompts, and wireframe screenshots to generate structured Jira user stories with acceptance criteria.'
  },
  {
    id: 'ai-test-scenarios',
    name: 'AI Test Scenario generation',
    shortName: 'Test Scenarios',
    inputTypes: ['User Story', 'BRD Document', 'Text', 'Target URL'],
    outputType: 'Gherkin / BDD Test Scenarios',
    baseSystemPrompt: 750,
    avgInputTokens: 2150,
    avgOutputTokens: 820,
    defaultItems: 5,
    description: 'Generates end-to-end positive, negative, and edge-case BDD/Gherkin scenarios from stories, documents, and web URLs.'
  },
  {
    id: 'ai-test-cases',
    name: 'AI Test Cases generation',
    shortName: 'Test Cases',
    inputTypes: ['Test Scenarios', 'User Stories', 'Requirements Doc'],
    outputType: 'Detailed Manual & Automated Test Cases',
    baseSystemPrompt: 1200,
    avgInputTokens: 3800,
    avgOutputTokens: 2400,
    defaultItems: 8,
    description: 'Generates step-by-step test cases with preconditions, action steps, test data, expected results, and automated locator tags.'
  },
  {
    id: 'automation-script-generator',
    name: 'Automation - script generator',
    shortName: 'Script Generator',
    inputTypes: ['Test Cases', 'Natural Language', 'DOM Snippet'],
    outputType: 'Playwright / Selenium / Cypress / Appium Code',
    baseSystemPrompt: 1400,
    avgInputTokens: 3600,
    avgOutputTokens: 1650,
    defaultItems: 1,
    description: 'Synthesizes clean Page Object Model (POM) automation code across Playwright, Selenium, Cypress, and Appium in TypeScript, Python, and Java.'
  },
  {
    id: 'automation-record-play-web',
    name: 'Automation - Record and play - Web app',
    shortName: 'Record & Play (Web)',
    inputTypes: ['Live Web Interactions', 'DOM Events', 'Selectors', 'Browser Screenshots'],
    outputType: 'Executable Web Playback Suites & Test Scripts',
    baseSystemPrompt: 1500,
    avgInputTokens: 4200,
    avgOutputTokens: 1850,
    defaultItems: 1,
    description: 'Analyzes live browser recordings, UI clicks, typing, assertions, and DOM hierarchy to generate robust web playback scripts.'
  },
  {
    id: 'automation-record-play-mobile',
    name: 'Automation - Record and play - Mobile app',
    shortName: 'Record & Play (Mobile)',
    inputTypes: ['Recorded Touch Gestures', 'ADB Logs', 'Appium XML', 'Device Screenshots'],
    outputType: 'Executable Mobile Playback Suites & Appium Scripts',
    baseSystemPrompt: 1500,
    avgInputTokens: 4200,
    avgOutputTokens: 1850,
    defaultItems: 1,
    description: 'Analyzes mobile app touch gestures, ADB logcat, Appium UI hierarchy, and device screens to generate robust mobile test scripts.'
  },
  {
    id: 'ui-testing',
    name: 'UI testing',
    shortName: 'UI Testing & Review',
    inputTypes: ['Screenshot', 'Video Recording', 'Document (BRD/Specs)', 'Target URL'],
    outputType: 'Page-by-Page Compliance Analysis & Diff Reports',
    baseSystemPrompt: 1800,
    avgInputTokens: 5800,
    avgOutputTokens: 2600,
    defaultItems: 3,
    description: 'Performs deep multimodal inspection of screenshots, videos, documents, and live URLs against Standard Requirements, reporting matched/unmatched screens.'
  },
  {
    id: 'api-testing',
    name: 'API testing',
    shortName: 'API Testing',
    inputTypes: ['OpenAPI / Swagger Spec', 'cURL Commands', 'JSON Payloads', 'Endpoints'],
    outputType: 'API Test Collections & Assertion Suites',
    baseSystemPrompt: 950,
    avgInputTokens: 2600,
    avgOutputTokens: 1200,
    defaultItems: 6,
    description: 'Creates REST and GraphQL API test suites with schema validation, auth token workflows, status code assertions, and edge-case payloads.'
  },
  {
    id: 'api-performance-testing',
    name: 'API performance testing',
    shortName: 'API Performance',
    inputTypes: ['API Endpoints', 'Target RPS / Concurrency', 'SLA Thresholds', 'Auth Headers'],
    outputType: 'API Load Profiles, JMeter JMX & k6 Scripts',
    baseSystemPrompt: 1100,
    avgInputTokens: 2900,
    avgOutputTokens: 1450,
    defaultItems: 1,
    description: 'Generates high-throughput API load testing configurations, parameterized concurrency profiles, and latency SLA threshold validations.'
  },
  {
    id: 'web-performance-testing',
    name: 'Web performance testing',
    shortName: 'Web Performance',
    inputTypes: ['Target Web URL', 'User Load Profile', 'Ramp-up / Loop Config', 'Throttling'],
    outputType: 'Apache JMeter JMX Plans & Bottleneck Audits',
    baseSystemPrompt: 1350,
    avgInputTokens: 3400,
    avgOutputTokens: 1750,
    defaultItems: 1,
    description: 'Generates Apache JMeter JMX test plans, Thread Groups, HTTP Cookie/Header Managers, Summary Report listeners, and core web vitals diagnostics.'
  }
];

/**
 * Feature-level Per-Token Rates & Pricing Breakdown for Gemini 3.7 Flash across ALL 10 modules
 */
export const FEATURE_PRICING_RATES: FeaturePricingRate[] = AUTOMATIQA_MODULES.map(mod => ({
  feature: mod.name,
  model: GEMINI_37_FLASH_MODEL,
  inputCostPer1K: GEMINI_37_FLASH_INPUT_RATE_PER_1K,
  outputCostPer1K: GEMINI_37_FLASH_OUTPUT_RATE_PER_1K,
  cachedInputCostPer1K: GEMINI_37_FLASH_CACHED_INPUT_RATE_PER_1K,
  avgInputTokens: mod.avgInputTokens,
  avgOutputTokens: mod.avgOutputTokens,
  avgCostPerCallUsd: calculateTokenCostUsd(mod.avgInputTokens, mod.avgOutputTokens, false),
  inputTypes: mod.inputTypes,
  outputType: mod.outputType,
  description: mod.description
}));

// Total Credit Pool Configuration (1000 credit points per user)
export const TOTAL_CREDIT_POOL = 1000;

// Basic Plan Configuration
export const BASIC_PLAN_CONFIG = {
  planId: 'basic-1000',
  planName: 'Basic Plan',
  creditPoints: 1000,
  trialDays: 2,
  activePackDays: 30,
  totalValidityDays: 32, // Starting 2 Days + 30 Days (starts from today)
  monthlyPriceUsd: 0, // Basic pack
  features: {
    aiGeneration: '1,000 Credit Points',
    nonAiFeatures: 'Unlimited (Always Active even when credits exceed)',
    manualTesting: 'Unlimited',
    testExecution: 'Unlimited',
    recordAndPlayManual: 'Unlimited',
    jiraIntegration: 'Unlimited',
    reportsAndAnalytics: 'Unlimited'
  },
  policyDescription: 'If credit points exceed 1,000, all non-AI features continue working without interruption. Only AI generation features are gated until credits are topped up or renewed.'
};

/**
 * Maps feature names to their required exact credit points cost per generation / button click:
 * - AI User stories generation: 1 (per click on 'Generate AI User Stories')
 * - AI Test Scenario generation: 5 (per click on 'Generate AI Scenarios')
 * - AI Test Cases generation: 10 (per click on 'GENERATE AI TEST CASES' / 'AI GENERATE SELECTED')
 * - Automation - script generator: 50 (per click on 'GENERATE POM SCRIPT')
 * - Automation - Record and play - Web app: 50 (per click on 'START RECORDING' & 'GENERATE SCRIPTS')
 * - Automation - Record and play - Mobile app: 50 (per click on 'START RECORDING' & 'GENERATE SCRIPTS')
 * - Automation - Record and play: 50 (per click on 'START RECORDING' & 'GENERATE SCRIPTS')
 * - UI testing: 50
 * - API testing: 100
 * - API performance testing: 50 (per click on 'GENERATE JMX SCRIPT' & 'GENERATE REPORT')
 * - Web performance testing: 100 (per click on 'RUN CHECKOUT')
 */
export const FEATURE_CREDIT_COSTS: Record<string, number> = {
  'AI User stories generation': 1,
  'AI User Stories generation': 1,
  'AI User Stories Generation': 1,
  'AI Test Scenario generation': 5,
  'AI Test Scenarios generation': 5,
  'AI Test Scenario Generation': 5,
  'AI Test Cases generation': 10,
  'AI test cases generation': 10,
  'AI Test cases generation': 10,
  'AI Test Cases Generation': 10,
  'Automation - script generator': 50,
  'Automation - Script Generator': 50,
  'Automation - Script generator': 50,
  'Script Generator': 50,
  'Automation - Record and play - Web app': 50,
  'Automation - Record and play - WEb app': 50,
  'Automation - Record and play - Web App': 50,
  'Automation - Record and play - Mobile app': 50,
  'Automation - Record and play - Mobile App': 50,
  'Automation - Record and play': 50,
  'Automation - Record and play - Web app and Mobile app': 50,
  'UI testing': 50,
  'UI Testing': 50,
  'API testing': 100,
  'API Testing': 100,
  'API performance testing': 50,
  'API Performance Testing': 50,
  'Web performance testing': 100,
  'Web Performance Testing': 100
};

/**
 * Calculates credits consumed based strictly on feature and cache status (fixed credits per button click).
 * Does not depend on input/output token volume or counts:
 * - AI User stories generation: 1
 * - AI Test Scenario generation: 5
 * - AI Test Cases generation: 10
 * - Automation - script generator: 50 ('GENERATE POM SCRIPT')
 * - Automation - Record and play - Web app: 50 ('START RECORDING' & 'GENERATE SCRIPTS')
 * - Automation - Record and play - Mobile app: 50 ('START RECORDING' & 'GENERATE SCRIPTS')
 * - UI testing: 50
 * - API testing: 100
 * - API performance testing: 50 ('GENERATE JMX SCRIPT' & 'GENERATE REPORT')
 * - Web performance testing: 100 ('RUN CHECKOUT')
 */
export const calculateCreditsConsumed = (feature: string, itemsCount: number = 1, cached: boolean = false): number => {
  if (cached) return 0;
  
  // Look up direct or normalized feature name
  if (FEATURE_CREDIT_COSTS[feature] !== undefined) {
    return FEATURE_CREDIT_COSTS[feature];
  }

  const fLower = (feature || '').toLowerCase();
  if (fLower.includes('user stor')) return 1;
  if (fLower.includes('scenario')) return 5;
  if (fLower.includes('test case') || fLower.includes('cases')) return 10;
  if (fLower.includes('script') && !fLower.includes('record')) return 50; // Script Generator: 50
  if (fLower.includes('record') || fLower.includes('play')) return 50; // Record & Play: 50
  if (fLower.includes('ui test') || fLower.includes('figma')) return 50;
  if (fLower.includes('api perf')) return 50; // API Performance: 50
  if (fLower.includes('web perf') || fLower.includes('jmeter')) return 100; // Web Performance: 100
  if (fLower.includes('api')) return 100;

  return 10; // Default fallback
};

/**
 * Estimate Tokens & Cost for Any Module with Specific Input Modalities
 */
export interface ModuleEstimationInput {
  moduleName: string;
  textChars?: number;
  screenshotCount?: number;
  videoDurationSeconds?: number;
  documentPages?: number;
  urlProvided?: boolean;
  urlScrapedChars?: number;
  estimatedOutputItems?: number;
  cached?: boolean;
}

export interface ModuleEstimationResult {
  moduleName: string;
  model: string;
  inputTokens: number;
  inputTokensBreakdown: {
    textTokens: number;
    screenshotTokens: number;
    videoTokens: number;
    documentTokens: number;
    urlTokens: number;
    systemPromptTokens: number;
  };
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  cachedSavingsUsd: number;
  credits: number;
}

export const estimateModuleTokensAndCost = (input: ModuleEstimationInput): ModuleEstimationResult => {
  const mod = AUTOMATIQA_MODULES.find(m => m.name === input.moduleName) || AUTOMATIQA_MODULES[0];
  
  const textTokens = input.textChars ? Math.ceil(input.textChars / CHARS_PER_TOKEN) : 400;
  const screenshotTokens = (input.screenshotCount || 0) * TOKENS_PER_IMAGE_SCREENSHOT;
  const videoTokens = (input.videoDurationSeconds || 0) * TOKENS_PER_VIDEO_SECOND;
  const documentTokens = (input.documentPages || 0) * TOKENS_PER_DOC_PAGE;
  const urlTokens = input.urlProvided ? (input.urlScrapedChars ? Math.ceil(input.urlScrapedChars / CHARS_PER_TOKEN) : 950) : 0;
  const systemPromptTokens = mod.baseSystemPrompt;

  const totalInputTokens = textTokens + screenshotTokens + videoTokens + documentTokens + urlTokens + systemPromptTokens;
  
  const items = input.estimatedOutputItems || mod.defaultItems;
  const outputTokens = Math.round(items * (mod.avgOutputTokens / mod.defaultItems));
  const totalTokens = totalInputTokens + outputTokens;

  const isCached = Boolean(input.cached);
  const inputRate = isCached ? GEMINI_37_FLASH_CACHED_INPUT_RATE_PER_1K : GEMINI_37_FLASH_INPUT_RATE_PER_1K;
  
  const inputCostUsd = Number(((totalInputTokens / 1000) * inputRate).toFixed(6));
  const outputCostUsd = Number(((outputTokens / 1000) * GEMINI_37_FLASH_OUTPUT_RATE_PER_1K).toFixed(6));
  const totalCostUsd = Number((inputCostUsd + outputCostUsd).toFixed(6));

  const standardInputCost = (totalInputTokens / 1000) * GEMINI_37_FLASH_INPUT_RATE_PER_1K;
  const cachedSavingsUsd = Number((standardInputCost - ((totalInputTokens / 1000) * GEMINI_37_FLASH_CACHED_INPUT_RATE_PER_1K)).toFixed(6));
  const credits = calculateCreditsConsumed(input.moduleName, items, isCached);

  return {
    moduleName: mod.name,
    model: GEMINI_37_FLASH_MODEL,
    inputTokens: totalInputTokens,
    inputTokensBreakdown: {
      textTokens,
      screenshotTokens,
      videoTokens,
      documentTokens,
      urlTokens,
      systemPromptTokens
    },
    outputTokens,
    totalTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
    cachedSavingsUsd,
    credits
  };
};

/**
 * Formats any timestamp, date string, or Date object to Indian Standard Time (IST - Asia/Kolkata)
 * Example output: "20-Aug-2026 02:41 PM IST"
 */
export const formatToIST = (dateOrTimestamp?: string | number | Date | null): string => {
  if (!dateOrTimestamp) return '';
  let dateObj: Date;
  if (typeof dateOrTimestamp === 'number') {
    dateObj = new Date(dateOrTimestamp);
  } else if (typeof dateOrTimestamp === 'string') {
    const num = Number(dateOrTimestamp);
    if (!isNaN(num) && num > 100000000000) {
      dateObj = new Date(num);
    } else {
      dateObj = new Date(dateOrTimestamp);
    }
  } else {
    dateObj = dateOrTimestamp;
  }

  if (isNaN(dateObj.getTime())) {
    const str = String(dateOrTimestamp);
    return str.includes('IST') ? str : `${str} IST`;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const parts = formatter.formatToParts(dateObj);
  const day = parts.find(p => p.type === 'day')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const year = parts.find(p => p.type === 'year')?.value || '';
  const hour = parts.find(p => p.type === 'hour')?.value || '';
  const minute = parts.find(p => p.type === 'minute')?.value || '';
  const dayPeriod = (parts.find(p => p.type === 'dayPeriod')?.value || 'AM').toUpperCase();

  return `${day}-${month}-${year} ${hour}:${minute} ${dayPeriod} IST`;
};

/**
 * Returns current timestamp formatted in IST
 */
export const getCurrentISTDateFormatted = (timestamp: number = Date.now()): string => {
  return formatToIST(timestamp);
};

// ============================================================================
// CLEAN SLATE - FRESH CREDIT CONSUMPTION (0 Consumed, 1,000 Balance Pool)
// ============================================================================
export const SEED_TOKEN_LOGS: TokenLog[] = [];

const LOCAL_STORAGE_KEY = 'automatiqa_token_consumption_logs';
const LOCAL_STORAGE_INITIALIZED_KEY = 'automatiqa_token_logs_initialized';
const FRESH_START_FLAG_KEY = 'automatiqa_clean_slate_fresh_v6';

/**
 * Helper to purge legacy mock seed data (tok-300..tok-309)
 */
const isLegacySeedLog = (log: any): boolean => {
  if (!log) return false;
  const id = String(log.id || '');
  return id.startsWith('tok-30') || id.startsWith('tok-seed-') || id === 'tok-default-1';
};

/**
 * Save a single log entry to Firestore database
 */
export const saveLogToFirestore = async (log: TokenLog) => {
  try {
    const docRef = doc(db, 'token_consumption_logs', log.id);
    await syncSetDoc(docRef, log, { merge: true });
  } catch (err: any) {
    if (err?.code !== 'permission-denied') {
      console.warn("Token log save fallback to localStorage:", err?.message || err);
    }
  }
};

/**
 * Subscribe to live Firestore updates for token consumption logs
 */
export const subscribeToFirestoreTokenLogs = (callback: (logs: TokenLog[]) => void) => {
  try {
    const logsRef = collection(db, 'token_consumption_logs');
    const q = query(logsRef, orderBy('timestamp', 'desc'));

    return onSnapshot(q, async (snapshot) => {
      // Auto-cleanup legacy mock seed records from Firestore
      const legacyDocsToDelete: string[] = [];
      const realLogs: TokenLog[] = [];

      snapshot.forEach((docSnap) => {
        const id = docSnap.id;
        const data = docSnap.data() as TokenLog;
        if (isLegacySeedLog(data) || isLegacySeedLog({ id })) {
          legacyDocsToDelete.push(id);
        } else {
          realLogs.push({
            ...data,
            costUsd: calculateTokenCostUsd(data.inputTokens, data.outputTokens, data.cached)
          });
        }
      });

      if (legacyDocsToDelete.length > 0) {
        // Clean legacy mock docs in background
        legacyDocsToDelete.forEach(id => {
          try {
            syncDeleteDoc(doc(db, 'token_consumption_logs', id));
          } catch (e) {}
        });
      }

      if (realLogs.length === 0) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
        }
        callback([]);
        return;
      }

      const cleanLogs = deduplicateTokenLogs(realLogs);

      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleanLogs));
        }
      } catch (e) {
        // ignore storage errors
      }

      callback(cleanLogs);
    }, (err) => {
      console.warn("Firestore token_consumption_logs listener error, falling back to local storage logs:", err);
      callback(getTokenLogs());
    });
  } catch (err) {
    console.warn("Failed to subscribe to Firestore token logs:", err);
    callback(getTokenLogs());
    return () => {};
  }
};

// Project Name normalizer mapping to replace generic names with exact project names
const SEED_PROJECT_MAP: Record<string, string> = {
  'tok-301': 'Global Retail Banking App',
  'tok-302': 'OmniPay Mobile Wallet',
  'tok-303': 'Enterprise Identity & SSO',
  'tok-304': 'ShopWave Direct Checkout',
  'tok-305': 'SmartCart E-Commerce Platform',
  'tok-306': 'HRMS Cloud Portal',
  'tok-307': 'Core Banking Gateway API',
  'tok-308': 'Cloud Payment Microservice',
  'tok-309': 'OmniChannel Storefront Web'
};

const FEATURE_PROJECT_FALLBACK_MAP: Record<string, string> = {
  'UI testing': 'Global Retail Banking App',
  'Automation - Record and play - Web app and Mobile app': 'OmniPay Mobile Wallet',
  'AI Test Scenario generation': 'Enterprise Identity & SSO',
  'AI test cases generation': 'ShopWave Direct Checkout',
  'Automation - script generator': 'SmartCart E-Commerce Platform',
  'AI User stories generation': 'HRMS Cloud Portal',
  'API testing': 'Core Banking Gateway API',
  'API performance testing': 'Cloud Payment Microservice',
  'Web performance testing': 'OmniChannel Storefront Web'
};

/**
 * Helper to get currently active project name from window or localStorage
 */
export const getActiveProjectName = (): string => {
  if (typeof window !== 'undefined') {
    const active = (window as any).__automatiqa_active_project_name || localStorage.getItem('automatiqa_active_project_name');
    if (active && active !== 'Banking App' && active !== 'AutomatiQA Project') {
      return active;
    }
  }
  return '27/07';
};

/**
 * Deduplicate token logs by ID and by near-simultaneous duplicate generation events
 */
export const deduplicateTokenLogs = (rawLogs: TokenLog[]): TokenLog[] => {
  if (!Array.isArray(rawLogs) || rawLogs.length === 0) return [];
  
  const seenIds = new Set<string>();
  const uniqueLogs: TokenLog[] = [];

  for (const log of rawLogs) {
    if (!log || !log.id) continue;
    if (seenIds.has(log.id)) continue;

    // Check if there is already a nearly identical log generated within 8 seconds for the same feature/user
    const isDuplicateEvent = uniqueLogs.some(existing => {
      const timeDiff = Math.abs((existing.timestamp || 0) - (log.timestamp || 0));
      const sameUser = existing.user === log.user || existing.userEmail === log.userEmail;
      const sameFeature = existing.feature === log.feature;
      const sameStory = Boolean(existing.userStoryId && log.userStoryId && existing.userStoryId === log.userStoryId);
      const sameItems = existing.itemsGenerated === log.itemsGenerated;

      return (
        timeDiff < 8000 &&
        sameUser &&
        (sameFeature || sameStory) &&
        (sameItems || (existing.totalTokens === log.totalTokens))
      );
    });

    if (!isDuplicateEvent) {
      seenIds.add(log.id);
      uniqueLogs.push(log);
    }
  }

  return uniqueLogs;
};

/**
 * Get all token consumption logs
 */
export const getTokenLogs = (): TokenLog[] => {
  try {
    if (typeof window !== 'undefined') {
      // Check if one-time clean slate migration has run
      const freshSlateDone = localStorage.getItem(FRESH_START_FLAG_KEY) === 'true';
      if (!freshSlateDone) {
        localStorage.setItem(FRESH_START_FLAG_KEY, 'true');
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
        localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
        resetBasicPlanStartDate();
        return [];
      }
    }

    const saved = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_STORAGE_KEY) : null;
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        // Filter out any legacy seed logs
        const filtered = parsed.filter(l => !isLegacySeedLog(l));
        if (filtered.length !== parsed.length && typeof window !== 'undefined') {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(filtered));
        }

        if (filtered.length === 0) {
          return [];
        }

        const currentActiveProject = getActiveProjectName();
        const mappedLogs = filtered.map((item: TokenLog) => {
          let resolvedProject = item.project;
          
          if (SEED_PROJECT_MAP[item.id]) {
            resolvedProject = SEED_PROJECT_MAP[item.id];
          } else if (!resolvedProject || resolvedProject === 'Banking App' || resolvedProject === 'AutomatiQA Project' || resolvedProject === 'SmartCart E-Commerce Platform') {
            resolvedProject = currentActiveProject;
          }

          return {
            ...item,
            project: resolvedProject || currentActiveProject,
            costUsd: calculateTokenCostUsd(item.inputTokens, item.outputTokens, item.cached)
          };
        });

        return deduplicateTokenLogs(mappedLogs);
      }
    }
  } catch (err) {
    console.warn("Failed to read token logs from local storage:", err);
  }

  // If local storage was marked as explicitly initialized or cleared, return empty array
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
  }

  return [];
};

/**
 * Add a new token log entry and sync to Firestore
 */
export const addTokenLog = (logData: Partial<TokenLog> & { feature: string }): TokenLog => {
  const currentLogs = getTokenLogs();
  const currentActiveProject = getActiveProjectName();
  
  const now = new Date();
  const timestamp = logData.timestamp || Date.now();
  const dateFormatted = logData.date || formatToIST(timestamp);
  const inTokens = logData.inputTokens || 1500;
  const outTokens = logData.outputTokens || 600;
  const totalTokens = inTokens + outTokens;
  const costUsd = logData.costUsd !== undefined ? logData.costUsd : calculateTokenCostUsd(inTokens, outTokens, logData.cached || false);

  const exactProject = logData.project && logData.project !== 'Banking App' && logData.project !== 'AutomatiQA Project'
    ? logData.project 
    : currentActiveProject;

  const exactProjectId = logData.projectId || `proj-${exactProject.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  const exactInputCount = logData.inputCount !== undefined && logData.inputCount > 0
    ? logData.inputCount
    : extractInputCountFromDetails(logData.inputModalityDetails, logData.inputModality);

  const tierInfo = calculateInputTier(exactInputCount);

  const newLog: TokenLog = {
    id: logData.id || `tok-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    date: dateFormatted,
    timestamp: logData.timestamp || Date.now(),
    user: logData.user || (typeof window !== 'undefined' ? ((window as any).__automatiqa_user_name || localStorage.getItem('automatiqa_user_name')) : 'Shanmugapriya') || 'Shanmugapriya',
    userEmail: logData.userEmail || (typeof window !== 'undefined' ? ((window as any).__automatiqa_user_email || localStorage.getItem('automatiqa_user_email')) : 'shanmugapriya@qaoncloud.com') || 'shanmugapriya@qaoncloud.com',
    workspace: logData.workspace || 'QAOnCloud Workspace',
    project: exactProject,
    projectId: exactProjectId,
    userStoryId: logData.userStoryId || 'US-102',
    feature: logData.feature,
    inputModality: logData.inputModality || 'Text',
    inputModalityDetails: logData.inputModalityDetails,
    inputCount: exactInputCount,
    tier: logData.tier || tierInfo.tier,
    outputType: logData.outputType,
    itemsGenerated: logData.itemsGenerated || 1,
    creditsConsumed: logData.creditsConsumed !== undefined ? logData.creditsConsumed : calculateCreditsConsumed(logData.feature, logData.itemsGenerated || 1, logData.cached || false),
    model: logData.model || GEMINI_37_FLASH_MODEL,
    inputTokens: inTokens,
    outputTokens: outTokens,
    totalTokens,
    costUsd,
    responseTimeSeconds: logData.responseTimeSeconds || 1.8,
    cached: logData.cached || false
  };

  // Prevent duplicate log entry if identical or near-simultaneous log for the same feature/user exists
  const existingIndex = currentLogs.findIndex(l => {
    if (l.id === newLog.id) return true;
    const timeDiff = Math.abs((l.timestamp || 0) - (newLog.timestamp || 0));
    return (
      timeDiff < 8000 &&
      (l.user === newLog.user || l.userEmail === newLog.userEmail) &&
      (l.feature === newLog.feature || l.userStoryId === newLog.userStoryId) &&
      (l.itemsGenerated === newLog.itemsGenerated || l.totalTokens === newLog.totalTokens)
    );
  });

  let updatedLogs: TokenLog[];
  if (existingIndex >= 0) {
    // Merge / update in-place if incoming has richer modality info
    const existing = currentLogs[existingIndex];
    const merged: TokenLog = {
      ...existing,
      ...newLog,
      inputModality: newLog.inputModality || existing.inputModality,
      inputModalityDetails: newLog.inputModalityDetails || existing.inputModalityDetails,
      outputType: newLog.outputType || existing.outputType
    };
    updatedLogs = [...currentLogs];
    updatedLogs[existingIndex] = merged;
  } else {
    updatedLogs = deduplicateTokenLogs([newLog, ...currentLogs]);
  }
  
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedLogs));
    }
  } catch (e) {
    console.error("Failed to persist new token log:", e);
  }

  // Save to Firestore DB
  saveLogToFirestore(newLog);

  // Notify UI listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('token-consumption-updated', { detail: newLog }));
  }

  return newLog;
};

/**
 * Log token consumption helper for feature APIs
 */
export const recordFeatureConsumption = (
  userName: string,
  userEmail: string,
  projectName: string,
  featureName: string,
  inputTokens: number,
  outputTokens: number,
  responseTimeSeconds: number,
  cached: boolean = false,
  itemsGenerated: number = 1,
  userStoryId?: string,
  workspace: string = 'QAOnCloud Workspace',
  inputModality?: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal',
  inputModalityDetails?: string,
  outputType?: string,
  inputCount?: number
) => {
  const creditsConsumed = calculateCreditsConsumed(featureName, itemsGenerated, cached);
  const resolvedProject = projectName && projectName !== 'Banking App' && projectName !== 'AutomatiQA Project'
    ? projectName
    : getActiveProjectName();

  return addTokenLog({
    user: userName || 'Admin User',
    userEmail: userEmail || 'admin@qaoncloud.com',
    workspace,
    project: resolvedProject,
    userStoryId: userStoryId || 'US-GENERAL',
    feature: featureName,
    inputModality,
    inputModalityDetails,
    inputCount,
    outputType,
    itemsGenerated,
    creditsConsumed,
    model: GEMINI_37_FLASH_MODEL,
    inputTokens,
    outputTokens,
    responseTimeSeconds,
    cached
  });
};

/**
 * Delete a single token log by ID from both local storage and Firestore
 */
export const deleteTokenLog = async (id: string): Promise<void> => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
  }
  const currentLogs = getTokenLogs();
  const updatedLogs = currentLogs.filter(l => l.id !== id);
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedLogs));
    }
  } catch (e) {
    console.error("Failed to update localStorage after token log deletion:", e);
  }

  try {
    const docRef = doc(db, 'token_consumption_logs', id);
    await syncDeleteDoc(docRef);
  } catch (err: any) {
    console.warn("Firestore delete failed, fallback to local removal:", err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('token-consumption-updated', { detail: { deletedId: id, remainingLogs: updatedLogs } }));
  }
};

/**
 * Delete multiple token logs by ID list from both local storage and Firestore
 */
export const deleteTokenLogs = async (ids: string[]): Promise<void> => {
  if (!ids || ids.length === 0) return;
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
  }
  const idSet = new Set(ids);
  const currentLogs = getTokenLogs();
  const updatedLogs = currentLogs.filter(l => !idSet.has(l.id));
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedLogs));
    }
  } catch (e) {
    console.error("Failed to update localStorage after batch token log deletion:", e);
  }

  await Promise.all(
    ids.map(async (id) => {
      try {
        const docRef = doc(db, 'token_consumption_logs', id);
        await syncDeleteDoc(docRef);
      } catch (err) {
        console.warn(`Firestore batch delete failed for ${id}:`, err);
      }
    })
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('token-consumption-updated', { detail: { deletedIds: ids, remainingLogs: updatedLogs } }));
  }
};

/**
 * Reset logs and restart fresh credit consumption
 */
export const resetDefaultTokenLogs = (): TokenLog[] => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(FRESH_START_FLAG_KEY, 'true');
    localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
  }
  resetBasicPlanStartDate();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('token-consumption-updated', { detail: { reset: true, cleared: true, remainingLogs: [] } }));
  }
  return [];
};

/**
 * Clear all token logs permanently and start fresh credit consumption
 */
export const clearAllTokenLogs = async (): Promise<void> => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(FRESH_START_FLAG_KEY, 'true');
    localStorage.setItem(LOCAL_STORAGE_INITIALIZED_KEY, 'true');
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
  }
  resetBasicPlanStartDate();
  const currentLogs = getTokenLogs();
  const allIds = currentLogs.map(l => l.id);

  await Promise.all(
    allIds.map(async (id) => {
      try {
        const docRef = doc(db, 'token_consumption_logs', id);
        await syncDeleteDoc(docRef);
      } catch (err) {
        console.warn(`Firestore delete failed for ${id}:`, err);
      }
    })
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('token-consumption-updated', { detail: { cleared: true, remainingLogs: [] } }));
  }
};

const PLAN_START_TIMESTAMP_KEY = 'automatiqa_basic_plan_start_timestamp';

/**
 * Retrieves the starting timestamp of the Basic Plan (starts from today, 2 days trial + 30 days active pack = 32 days total)
 */
export const getBasicPlanStartTimestamp = (): number => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(PLAN_START_TIMESTAMP_KEY);
    if (saved) {
      const num = Number(saved);
      if (!isNaN(num) && num > 0) return num;
    }
    // Default to start from today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const defaultStart = startOfToday.getTime();
    localStorage.setItem(PLAN_START_TIMESTAMP_KEY, String(defaultStart));
    return defaultStart;
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return startOfToday.getTime();
};

/**
 * Resets or updates the plan start date
 */
export const resetBasicPlanStartDate = (timestamp?: number): number => {
  const startTimestamp = timestamp !== undefined ? timestamp : (() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return startOfToday.getTime();
  })();
  if (typeof window !== 'undefined') {
    localStorage.setItem(PLAN_START_TIMESTAMP_KEY, String(startTimestamp));
    window.dispatchEvent(new CustomEvent('token-consumption-updated', { detail: { planReset: true } }));
  }
  return startTimestamp;
};

export interface PlanValidityInfo {
  planName: string;
  creditPoints: number;
  trialDays: number;
  activePackDays: number;
  totalValidityDays: number;
  startTimestamp: number;
  startDateFormatted: string;
  trialEndTimestamp: number;
  trialEndDateFormatted: string;
  packEndTimestamp: number;
  packEndDateFormatted: string;
  daysElapsed: number;
  daysRemaining: number;
  isTrialPhase: boolean;
  isActivePackPhase: boolean;
  isExpired: boolean;
  phaseLabel: string;
  validityBadgeClass: string;
}

/**
 * Calculates current Basic Plan validity status (2 Days Trial + 30 Days Monthly Pack = 32 Days Total)
 */
export const getBasicPlanValidity = (): PlanValidityInfo => {
  const startTimestamp = getBasicPlanStartTimestamp();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  
  const trialEndTimestamp = startTimestamp + (BASIC_PLAN_CONFIG.trialDays * ONE_DAY_MS);
  const packEndTimestamp = startTimestamp + (BASIC_PLAN_CONFIG.totalValidityDays * ONE_DAY_MS);
  
  const now = Date.now();
  const msElapsed = Math.max(0, now - startTimestamp);
  const daysElapsed = Math.floor(msElapsed / ONE_DAY_MS) + 1;
  const msRemaining = Math.max(0, packEndTimestamp - now);
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / ONE_DAY_MS));
  
  const isTrialPhase = now < trialEndTimestamp;
  const isExpired = now >= packEndTimestamp;
  const isActivePackPhase = !isTrialPhase && !isExpired;

  let phaseLabel = 'Active (30 Days Pack)';
  let validityBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';

  if (isTrialPhase) {
    phaseLabel = 'Evaluation Phase (2 Days Trial)';
    validityBadgeClass = 'bg-teal-50 text-teal-700 border-teal-200';
  } else if (isExpired) {
    phaseLabel = 'Plan Expired (Renewal Required)';
    validityBadgeClass = 'bg-rose-50 text-rose-700 border-rose-200';
  }

  return {
    planName: BASIC_PLAN_CONFIG.planName,
    creditPoints: BASIC_PLAN_CONFIG.creditPoints,
    trialDays: BASIC_PLAN_CONFIG.trialDays,
    activePackDays: BASIC_PLAN_CONFIG.activePackDays,
    totalValidityDays: BASIC_PLAN_CONFIG.totalValidityDays,
    startTimestamp,
    startDateFormatted: formatToIST(startTimestamp),
    trialEndTimestamp,
    trialEndDateFormatted: formatToIST(trialEndTimestamp),
    packEndTimestamp,
    packEndDateFormatted: formatToIST(packEndTimestamp),
    daysElapsed,
    daysRemaining,
    isTrialPhase,
    isActivePackPhase,
    isExpired,
    phaseLabel,
    validityBadgeClass
  };
};

export interface UserCreditSummary {
  userEmail: string;
  userName: string;
  planName: string;
  totalPool: number;
  usedCredits: number;
  remainingCredits: number;
  percentageUsed: number;
  isExceeded: boolean;
  canUseAi: boolean;
  nonAiFeaturesStatus: 'Unlimited & Operational';
  validity: PlanValidityInfo;
}

/**
 * Calculates current user's credit usage and verification status
 */
export const getUserCreditSummary = (userEmail?: string): UserCreditSummary => {
  const logs = getTokenLogs();
  const resolvedEmail = (userEmail || (typeof window !== 'undefined' ? (window as any).__automatiqa_user_email || localStorage.getItem('automatiqa_user_email') : '') || 'shanmugapriya@qaoncloud.com').toLowerCase();
  
  // Calculate credits used by user (or global workspace if user has specific logs)
  const userLogs = logs.filter(l => (l.userEmail || '').toLowerCase() === resolvedEmail || (l.user || '').toLowerCase().includes(resolvedEmail.split('@')[0]));
  
  // If specific logs exist, sum them; otherwise use total workspace logs
  const targetLogs = userLogs.length > 0 ? userLogs : logs;
  const usedCredits = targetLogs.reduce((acc, log) => acc + (log.creditsConsumed ?? 0), 0);
  const remainingCredits = Math.max(0, TOTAL_CREDIT_POOL - usedCredits);
  const percentageUsed = Math.min(100, Number(((usedCredits / TOTAL_CREDIT_POOL) * 100).toFixed(1)));
  const isExceeded = usedCredits >= TOTAL_CREDIT_POOL || remainingCredits <= 0;
  
  const validity = getBasicPlanValidity();
  const userName = (typeof window !== 'undefined' ? (window as any).__automatiqa_user_name || localStorage.getItem('automatiqa_user_name') : '') || 'Shanmugapriya';

  return {
    userEmail: resolvedEmail,
    userName,
    planName: BASIC_PLAN_CONFIG.planName,
    totalPool: TOTAL_CREDIT_POOL,
    usedCredits,
    remainingCredits,
    percentageUsed,
    isExceeded,
    canUseAi: !isExceeded && !validity.isExpired,
    nonAiFeaturesStatus: 'Unlimited & Operational',
    validity
  };
};

/**
 * Quick check if user's credits are exceeded
 */
export const isUserCreditExceeded = (userEmail?: string): boolean => {
  const summary = getUserCreditSummary(userEmail);
  return summary.isExceeded;
};

/**
 * Verifies if an AI generation feature is permitted to execute
 */
export const checkAiGenerationPermission = (userEmail?: string, featureName?: string): {
  allowed: boolean;
  reason?: string;
  usedCredits: number;
  remainingCredits: number;
  planName: string;
} => {
  const summary = getUserCreditSummary(userEmail);
  if (summary.isExceeded) {
    return {
      allowed: false,
      reason: `Basic Plan credit limit exceeded: You have utilized ${summary.usedCredits} of ${summary.totalPool} credit points. All non-AI features (manual test creation, execution, manual recording, and reports) remain 100% functional. AI generation is paused until credits are topped up.`,
      usedCredits: summary.usedCredits,
      remainingCredits: summary.remainingCredits,
      planName: summary.planName
    };
  }

  if (summary.validity.isExpired) {
    return {
      allowed: false,
      reason: `Basic Plan validity expired (${summary.validity.totalValidityDays} days: 2 days trial + 30 days active pack). All non-AI features remain functional. Please renew your plan to resume AI generations.`,
      usedCredits: summary.usedCredits,
      remainingCredits: summary.remainingCredits,
      planName: summary.planName
    };
  }

  return {
    allowed: true,
    usedCredits: summary.usedCredits,
    remainingCredits: summary.remainingCredits,
    planName: summary.planName
  };
};

/**
 * Tops up credit pool or adds test credits
 */
export const topUpCredits = async (points: number = 1000, userEmail?: string): Promise<void> => {
  // Clear or adjust logs to grant credits
  const currentLogs = getTokenLogs();
  if (currentLogs.length > 0) {
    // Delete enough logs to restore credits
    const logsToDelete = currentLogs.slice(0, Math.ceil(points / 50));
    await deleteTokenLogs(logsToDelete.map(l => l.id));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('token-consumption-updated', { detail: { topUp: points } }));
  }
};

