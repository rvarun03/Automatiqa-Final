export enum TestStatus {
  PASS = 'PASS',
  FAIL = 'FAIL',
  BLOCKED = 'BLOCKED',
  DEFERRED = 'DEFERRED',
  PENDING = 'NOT EXECUTED',
  NOT_EXECUTED = 'NOT EXECUTED',
  NOT_STARTED = 'NOT STARTED',
  DELETED = 'DELETED'
}

export enum TestType {
  FUNCTIONAL = 'Functional',
  NON_FUNCTIONAL = 'Non-Functional',
  UI = 'UI'
}

export enum TestIntent {
  POSITIVE = 'Positive',
  NEGATIVE = 'Negative'
}

export enum TestPriority {
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low'
}

export enum UserRole {
  SUPER_ADMIN = 'Super Admin',
  ADMIN = 'Admin',
  DELIVERY_MANAGER = 'Delivery Manager',
  SPOC = 'Spoc',
  TEAM_MEMBER = 'Team Member'
}

export enum NotificationType {
  USER_SIGNUP = 'USER_SIGNUP',
  PROJECT_ASSIGNMENT = 'PROJECT_ASSIGNMENT',
  ROLE_UPDATE = 'ROLE_UPDATE',
  PROJECT_CREATION = 'PROJECT_CREATION',
  SYSTEM = 'SYSTEM',
  SUBSCRIPTION_REQUEST = 'SUBSCRIPTION_REQUEST',
  SUBSCRIPTION_APPROVED = 'SUBSCRIPTION_APPROVED'
}

export interface SubscriptionRequest {
  id: string;
  userEmail: string;
  userName: string;
  requestedAt: number;
  requestedDateFormatted: string;
  requestedAtFormatted?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  creditsRequested?: number;
  requestedCredits?: number;
  currentUsedCredits: number;
  planName?: string;
  approvedAt?: number;
  approvedBy?: string;
  notes?: string;
}

export interface AppNotification {
  id: string;
  recipientEmail: string;
  senderName: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  timestamp: string;
  projectId?: string;
}

export interface User {
  email: string;
  name: string;
  token?: string;
  role?: UserRole;
  assignedProjectIds?: string[];
}

export interface ActivityLog {
  id: string;
  userName: string;
  userEmail: string;
  action: string;
  projectId: string;
  projectName: string;
  timestamp: string; // ISO format
}

export interface TestCase {
  id: string;
  testCaseId?: string; // Automatically generated unique ID
  userStoryId?: string; // Inherited parent User Story Number
  title: string;
  description?: string;
  steps: string[];
  expectedResult: string;
  actualResult?: string;
  comments?: string;
  status: TestStatus;
  notes?: string;
  executedAt?: string;
  isApproved?: boolean;
  evidence?: string;
  videoEvidence?: string;
  testType?: TestType;
  testIntent?: TestIntent;
  priority?: TestPriority;
  testData?: string;
  testDataSets?: string[]; // Added to support multiple structured sets
  attachments?: string[]; // Multiple base64 strings/URLs (Images/Videos)
  links?: string[]; // Multiple reference URLs
}

export interface TestScenario {
  id: string;
  scenarioId: string; // TS-001, etc.
  title: string;
  type: 'Functional' | 'Non-functional';
  description: string;
  expectedResults: string;
  isApproved: boolean;
  testCases: TestCase[];
  moduleName: string;
  batchId?: string;
  createdAt?: string;
  memberScenarioIds?: string[];
  appUrl?: string;
  username?: string;
  password?: string;
  isRemovedFromIndividual?: boolean; // Flag to hide from individual list while keeping in folders
  folderId?: string;
  saved?: boolean;
  priority?: 'High' | 'Medium' | 'Low' | string;
  tags?: string[];
  userStoryNumber?: string;
  userStorySummary?: string;
  userStoryId?: string;
  isApiScenario?: boolean;
  attachments?: string[];
  docContent?: string;
  docFileName?: string;
}

export interface AutomationScriptFile {
  path: string;
  content: string;
}

export interface AutomationScript {
  id: string;
  content: string;
  files?: AutomationScriptFile[];
  tool: AutomationTool;
  language: ProgrammingLanguage;
  testCaseTitles?: string[];
  createdAt: string;
  lastExecutionStatus?: 'SUCCESS' | 'FAILURE' | 'RUNNING' | TestStatus;
  lastExecutedAt?: string;
  executionLogs?: string[];
  evidence?: string;
  evidenceUrl?: string;
  isApproved?: boolean;
  appPackage?: string;
  appUrl?: string;
  title?: string;
  description?: string;
  folderId?: string;
  scenarioId?: string;
  lastExecutionNotes?: string;
  contextImages?: string[];
  source?: 'record_play' | 'script_generator';
  platform?: 'web' | 'mobile';
}

export interface PerformanceScript {
  id: string;
  name: string;
  scenarios: any[];
  jmxContent: string;
  csvData?: string;
  analysisReport?: string;
  trendData?: string; // Stores stringified graph telemetry
  createdAt: string;
  itemResults?: Record<string, TestStatus>; // Restored for granular tracking
  statusUpdateTimestamps?: Record<string, string>; // Tracks when each item status was last updated
}

export interface ApiRequestHeader {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  time: number;
  size: number;
  data: any;
  headers: Record<string, string>;
  testResults?: { name: string; passed: boolean; error?: string }[];
}

export interface ApiAuth {
  type: 'noauth' | 'bearer' | 'basic' | 'apikey' | 'oauth1' | 'oauth2';
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyKey?: string;
  apiKeyValue?: string;
  apiKeyLocation?: 'header' | 'query';
  oauth1ConsumerKey?: string;
  oauth1ConsumerSecret?: string;
  oauth1Token?: string;
  oauth1TokenSecret?: string;
  oauth2AccessToken?: string;
  oauth2HeaderPrefix?: string;
  oauth2AddTokenTo?: 'header' | 'query';
}

export interface ApiRequest {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers: ApiRequestHeader[];
  params: ApiRequestHeader[];
  bodyType: 'none' | 'form-data' | 'raw';
  body: string;
  formData?: ApiRequestHeader[];
  rawLanguage?: 'JSON' | 'Text' | 'HTML' | 'XML' | 'JavaScript';
  auth?: ApiAuth;
  preRequestScript?: string;
  postResponseScript?: string;
  name?: string;
  description?: string;
  expectedResults?: string;
  refineInstructions?: string;
  savedResponse?: ApiResponse;
  createdAt?: string;
}

export interface ApiFolder {
  id: string;
  name: string;
  requests: ApiRequest[];
  isOpen?: boolean;
}

export interface ApiCollection {
  id: string;
  name: string;
  requests: ApiRequest[];
  folders?: ApiFolder[];
  isOpen?: boolean;
}

export interface ApiWorkspace {
  id: string;
  name: string;
  requests: ApiRequest[];
  collections: ApiCollection[];
  createdAt: string;
  isOpen?: boolean;
}

export interface ApiTestSuiteEvidence {
  comment?: string;
  links?: string[]; // Renamed from link to links for consistency and array support
  attachments?: string[];
}

export interface ApiTestSuite {
  id: string;
  name: string;
  targetFolderId: string;
  targetFolderName: string;
  status: 'In Progress' | 'Completed' | 'Blocked' | 'Not Started';
  lastRun?: string;
  evidence?: ApiTestSuiteEvidence;
  scenarioResults?: Record<string, { status: string, evidence?: ApiTestSuiteEvidence }>;
}

export interface Locator {
  id: string;
  name: string;
  strategy: 'getByRole' | 'getByText' | 'getByLabel' | 'getByTestId' | 'id' | 'css' | 'xpath';
  value: string;
  description?: string;
}

export type RequirementFormatType = 'text' | 'document' | 'screenshot' | 'video';

export interface StandardRequirementData {
  type: RequirementFormatType;
  text: string;
  document?: {
    name: string;
    size: string;
    content: string;
    type?: string;
  } | null;
  image?: {
    name: string;
    size: string;
    dataUrl: string;
    type?: string;
  } | null;
  video?: {
    name: string;
    size: string;
    url?: string;
    frames: { timestamp: string; image: string }[];
  } | null;
}

export interface UITestingInput {
  id: string;
  appName?: string;
  name: string;
  screenshots: string[];
  appUrl: string;
  designLink: string;
  promptInputs?: string;
  companyStandards?: string;
  standardRequirement?: StandardRequirementData;
  timestamp: string;
  folderId?: string;
  docs?: { name: string; content: string }[];
  videos?: { id: string; name: string; url?: string; blob?: any; dataUrl?: string; size?: string; type?: string; frames: { timestamp: string; image: string }[] }[];
}

export interface UITestingReport {
  id: string;
  appName?: string;
  name: string;
  report: string;
  highlightedScreenshots: string[];
  visualDefectsScreenshots?: string[];
  correctedReport: string | null;
  correctedImage?: string | null;
  correctedScreenshots?: Array<{ id: string; pageTitle: string; originalImage: string; correctedImage: string }>;
  screenshots?: string[];
  appUrl?: string;
  companyStandards?: string;
  standardRequirement?: StandardRequirementData;
  docs?: { name: string; content: string }[];
  videos?: { id: string; name: string; url?: string; blob?: any; dataUrl?: string; size?: string; type?: string; frames: { timestamp: string; image: string }[] }[];
  category?: 'APP UI REVIEW' | 'FIGMA DESIGN REVIEW' | 'FIGMA VS COMPARISON' | string;
  timestamp: string;
  folderId?: string;
  inputId?: string;
}

export interface UITestingFolder {
  id: string;
  name: string;
  createdAt: string;
}

export interface FigmaDesignReview {
  id: string;
  appName?: string;
  name: string;
  images?: string[];
  docs?: { name: string; content: string }[];
  figmaUrl?: string;
  companyStandards?: string;
  standardRequirement?: StandardRequirementData;
  analysisReport: string;
  highlightedScreenshots?: string[];
  visualDefectsScreenshots?: string[];
  correctedReport?: string | null;
  correctedImage?: string | null;
  timestamp: string;
  folderId?: string;
}

export interface UIComparisonReport {
  id: string;
  appName?: string;
  name: string;
  appScreenshots?: string[];
  appUrl?: string;
  appVideos?: { id: string; name: string; url?: string; blob?: any; dataUrl?: string; size?: string; type?: string; frames: { timestamp: string; image: string }[] }[];
  figmaImages?: string[];
  figmaDocs?: { name: string; content: string }[];
  figmaUrl?: string;
  companyStandards?: string;
  standardRequirement?: StandardRequirementData;
  comparisonReport: string;
  highlightedScreenshots?: string[];
  visualDefectsScreenshots?: string[];
  resolutionGuide?: string | null;
  correctedImage?: string | null;
  timestamp: string;
  folderId?: string;
}

export type LaunchDiagnosticCode =
  | 'NETWORK_ERROR'
  | 'DNS_ERROR'
  | 'TIMEOUT'
  | 'SSL_CERTIFICATE_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'BROWSER_PERMISSION_REQUIRED'
  | 'POPUP_BLOCKED'
  | 'NEW_WINDOW_BLOCKED'
  | 'REDIRECT_FAILURE'
  | 'IFRAME_CONTENT'
  | 'MIXED_CONTENT'
  | 'PAGE_CRASH'
  | 'UNSUPPORTED_BROWSER_FEATURE'
  | 'UNKNOWN_ERROR';

export interface LaunchDiagnostic {
  code: LaunchDiagnosticCode;
  title: string;
  message: string;
  details?: string;
  suggestedAction?: string;
  targetUrl?: string;
  timestamp: number;
  recoverable?: boolean;
  permissions?: string[];
}

export interface BrowserPermissionRequest {
  sessionId: string;
  permissions: Array<'camera' | 'microphone' | 'geolocation' | 'notifications' | 'clipboard' | 'downloads' | 'popups' | string>;
  origin: string;
  reason?: string;
  timestamp: number;
}

export interface FrameInfo {
  frameId?: string;
  frameName?: string;
  frameUrl?: string;
  frameSelector?: string;
  isIframe?: boolean;
}

export interface StepLocator {
  type: 'id' | 'name' | 'role' | 'text' | 'css' | 'xpath' | 'accessibility-id' | 'resource-id' | 'content-desc' | 'data-testid' | 'placeholder' | 'url' | 'shadow-pierce';
  value: string;
  playwright?: string;
}

export interface UniversalLocator {
  primary: StepLocator;
  alternatives: StepLocator[];
}

export interface RecordedStep {
  id: string;
  action: 'click' | 'dblclick' | 'type' | 'fill' | 'select' | 'selectOption' | 'check' | 'uncheck' | 'hover' | 'scroll' | 'drag' | 'drop' | 'assertion' | 'navigate' | 'wait' | 'press' | 'upload' | 'focus' | 'blur' | 'visibility' | 'submit' | 'dialog' | 'open_tab' | 'close_tab' | 'switch_tab' | 'shortcut';
  locator: UniversalLocator;
  elementName?: string;
  value?: string;
  url?: string;
  screen: string;
  platform: 'web' | 'mobile';
  timestamp: number;
  /** Server-assigned order within a recording session. Playback must use this, never wall-clock time. */
  sequenceNumber?: number;
  /** Audit metadata only; it is deliberately not used as a playback delay. */
  recordedAt?: string;
  relativeTime?: number;
  sessionId?: string;
  skipped?: boolean;
  screenshot?: string;
  state?: string;
  masked?: boolean;
  placeholder?: string;
  originalValue?: string;
  x?: number;
  y?: number;
  coordinates?: { x: number; y: number };
  targetBox?: { x: number; y: number; width: number; height: number };
  frameInfo?: FrameInfo;
  pageIndex?: number;
  tabTitle?: string;
  deltaX?: number;
  deltaY?: number;
  scrollX?: number;
  scrollY?: number;
  keyCombo?: string;
  /** Android bounds string of the resolved node, e.g. "[90,810][990,930]". */
  bounds?: string;
  /** Class of the resolved Android node, e.g. "android.widget.Button". */
  className?: string;
  /**
   * True when this step targets a node that was found in the app's live
   * UIAutomator hierarchy. False/absent means it fell back to screen
   * coordinates, which will not survive a different device or resolution.
   */
  resolvedFromHierarchy?: boolean;
  /** Recorder bookkeeping: when this interaction was last seen repeated. */
  lastSeenAt?: number;
}

export interface RecordedFlow {
  id: string;
  name: string;
  description?: string;
  refineInstructions?: string;
  steps: RecordedStep[];
  createdAt: string;
  isApproved: boolean;
  folderId?: string;
  platform: 'web' | 'mobile';
  recordingMode?: 'manual' | 'extension' | 'codegen' | 'in-app';
  videoUrl?: string;
  initialUrl?: string;
  screenshots?: string[];
  mobilePackageName?: string;
  mobileAppName?: string;
  stepScreenshots?: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'Active' | 'Inactive';
  ownerEmail: string;
  ownerName?: string;
  allocatedUserEmails?: string[];
  projectRoles?: Record<string, 'Admin' | 'Team Member'>;
  scenarios: TestScenario[];
  manualTestCases?: TestCase[];
  automationScripts: AutomationScript[];
  performanceScripts?: PerformanceScript[];
  apiHistory?: ApiRequest[];
  apiWorkspaces?: ApiWorkspace[];
  apiTestSuites?: ApiTestSuite[];
  automationExecutionIds?: string[];
  automationFolders?: { id: string; name: string; description?: string; isImported?: boolean; type?: 'flow' | 'script' | 'script_generator'; platform?: 'web' | 'mobile' }[];
  importedPerformanceArtifactIds?: string[]; // Restored for execution hub persistence
  excludedFromExecutionIds?: string[]; // Tracks items hidden ONLY in Manual Test Case Execution
  activeExecutionFolderIds?: string[]; // Tracks folders added to execution hub via "Run Folder"
  scenarioModuleMapping?: Record<string, string>; // Tracks AI scenario to Base Module mapping
  locators?: Locator[];
  uiTestingInputs?: UITestingInput[];
  uiTestingReports?: UITestingReport[];
  uiTestingFolders?: UITestingFolder[];
  figmaDesignReviews?: FigmaDesignReview[];
  uiComparisonReports?: UIComparisonReport[];
  recordedFlows?: RecordedFlow[];
  syntheticUsers?: SyntheticUser[];
  userStories?: UserStory[];
  lastUserStoryIdSeq?: number;
  createdAt: string;
  appUrl?: string;
  jiraConfig?: {
    jiraUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
  };
  githubConfig?: {
    repositoryOwner: string;
    repositoryName: string;
    personalAccessToken: string;
    branchName: string;
  };
  slackConfig?: {
    workspaceName: string;
    channelName: string;
    webhookUrl?: string;
    botToken?: string;
    enabled: boolean;
  };
}

export interface SyntheticUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: string;
  status: 'Active' | 'Inactive' | 'Pending';
  credentials?: {
    username?: string;
    password?: string;
    apiToken?: string;
  };
  notes?: string;
  createdAt: string;
  customAttributes?: { key: string; value: string }[];
}

export type AutomationTool = 'Playwright' | 'Selenium' | 'Cypress' | 'Appium';
export type ProgrammingLanguage = 'TypeScript' | 'JavaScript' | 'Python' | 'Java';

export interface ScriptConfig {
  tool: AutomationTool;
  language: ProgrammingLanguage;
}

export interface UserStory {
  id: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  createdAt: string;
  storyId?: string; // US-001, USERSTORY_FOLDER, INPUT_SOURCE, etc.
  folderId?: string;
  parentFolderId?: string;
  memberStoryIds?: string[];
  isRemovedFromIndividual?: boolean;
  userStoryId?: string;
}

export type VectorDistanceMetric = 'cosine' | 'euclidean' | 'dotProduct';

export interface RagChunk {
  id: string;
  projectId?: string;
  projectName?: string;
  title: string;
  content: string;
  chunkIndex?: number;
  embedding: number[];
  vectorDimension: number;
  metadata: {
    type: 'scenario' | 'testcase' | 'userstory' | 'requirement' | 'doc' | 'bug' | 'custom';
    source?: string;
    tags?: string[];
    author?: string;
    targetUrl?: string;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface VectorSearchResult {
  chunk: RagChunk;
  similarityScore: number; // 0.0 to 1.0 (or percentage)
  distance: number;
  metricUsed: VectorDistanceMetric;
}

export interface RagFeasibilityStatus {
  isImplemented: boolean;
  firestoreConnected: boolean;
  databaseId: string;
  vectorIndexCollection: string;
  indexedCount: number;
  vectorDimension: number;
  embeddingModel: string;
  embeddingApiStatus: 'active' | 'fallback' | 'offline';
  averageSearchLatencyMs: number;
  lastDiagnosticTimestamp: string;
  diagnosticChecks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    latencyMs: number;
  }[];
}

export interface TokenLog {
  id: string;
  date: string;
  timestamp: number;
  user: string;
  userEmail?: string;
  workspace?: string;
  project: string;
  projectId?: string;
  userStoryId?: string;
  feature: string;
  inputModality?: 'Text' | 'Screenshot' | 'Video' | 'Document' | 'URL' | 'Multimodal';
  inputModalityDetails?: string;
  inputCount?: number;
  tier?: 'Small' | 'Medium' | 'High';
  outputType?: string;
  itemsGenerated?: number;
  creditsConsumed?: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  responseTimeSeconds: number;
  cached: boolean;
}

export interface FeaturePricingRate {
  feature: string;
  model: string;
  inputCostPer1K: number;
  outputCostPer1K: number;
  cachedInputCostPer1K: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostPerCallUsd: number;
  inputTypes?: string[];
  outputType?: string;
  description: string;
}
