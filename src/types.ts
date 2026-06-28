export interface Env {
  SESSIONS: KVNamespace;
  MEMORY: KVNamespace;
  CONFIG: KVNamespace;
  STORAGE?: R2Bucket;

  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  POOLSIDE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;

  DEFAULT_PROVIDER?: string;
  DEFAULT_MODEL?: string;
  DEFAULT_SYSTEM_PROMPT?: string;
  ALLOWED_USERS?: string;
  API_KEY?: string;
  APP_URL?: string;
  MUSCLE_API_KEY?: string;
  MUSCLE: Fetcher;
  WALLET_ENCRYPTION_KEY?: string;
  MANTLE_WALLET?: string;
  
  // Cloudflare API token for cron management
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKER_NAME?: string;
  DB: D1Database;

  // Mantle Network RPC endpoints
  MANTLE_RPC_MAINNET?: string;
  MANTLE_RPC_TESTNET?: string;
  MANTLE_PRIVATE_RPC?: string;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  media?: UserMedia[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  thoughtSignature?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolContext {
  channel?: string;
  sessionId?: string;
  userId?: string;
  network?: "mainnet" | "testnet";
  requestUrl?: string;
}

export interface ToolResult {
  content: string;
  error?: boolean;
}

export interface UserMedia {
  type: "image" | "document";
  url: string;
  caption?: string;
  mime_type?: string;
}

export interface Skill {
  id: string;
  title: string;
  description: string;
  instructions: string;
  builtin?: boolean;
}

export interface SessionState {
  sessionId: string;
  owner_id?: string;  // Owner of this session (channel-prefixed)
  messages: Message[];
  model?: string;
  provider?: string;
  systemPrompt?: string;
  network?: "mainnet" | "testnet";
  tradingMode?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ScanTarget {
  target: string;
  userId: string;
  chatId: string;
  channel: string;
  createdAt: number;
}

export interface AgentRequest {
  message: string;
  session_id?: string;
  chatId?: number;
  model?: string;
  provider?: string;
  max_tokens?: number;
  temperature?: number;
  system_prompt?: string;
  channel?: string;
  userId?: string;
  username?: string;
  media?: UserMedia[];
  onStatusUpdate?: (status: {
    type: "model_start" | "tool_start" | "tool_end" | "complete";
    round?: number;
    model?: string;
    toolName?: string;
    arguments?: string;
    result?: string;
    content?: string;
  }) => void | Promise<void>;
  isContinuation?: boolean;
  requestUrl?: string;
}

export interface AgentResponse {
  content: string;
  session_id: string;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  continuationNeeded?: boolean;
}

export interface ProviderRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  userId?: string;
  apiKey?: string; // Added to allow per-user API keys
}

export interface ProviderResponse {
  content: string | null;
  toolCalls?: ToolCall[];
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  finishReason?: string;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  default_model: string;
  type: "openai" | "anthropic";
}

export interface UserWalletConfig {
  address: string;
  encrypted_key: string;
  created_at: number;
  last_used: number;
  network: "mainnet" | "testnet";
}

export interface RiskLimits {
  max_trade_value_usd: number;
  max_slippage_pct: number;
  max_portfolio_exposure_pct: number;
  allowed_protocols: string[];
}

export interface SessionGrant {
  sessionKey: string; // Encrypted session key
  expiresAt: number;
  maxVolumeUsd: number;
  currentVolumeUsd: number;
  whitelistedContracts: string[];
  ownerAddress: string;
}

export interface TradingPlan {
  strategy: string;
  action: string;
  expectedOutcome: string;
  riskAssessment: string;
  params: Record<string, any>;
}

export interface UserPolicy {
  maxTradeValueUSD: number;
  maxSlippageBps: number;
  tradingEnabled: boolean;
  allowedProtocols: string[];
}

export interface TradeAudit {
  verdict: "EXCELLENT" | "SATISFACTORY" | "POOR" | "CATASTROPHIC";
  reasoning: string;
  lessonLearned: string;
  score: number; // 0-100
}

export interface AuditPacket {
  tradeId: string;
  userId: string;
  timestamp: number;
  plan: TradingPlan;
  signal: any;
  guardAudit: string;
  outcome: string;
  evidenceHash?: string;
}

export interface Position {
  protocol: string;
  token: string;
  tokenAddress: string;
  balance: string;          // raw wei string
  balanceFormatted: string; // human-readable (e.g. "1234.56")
  valueUsd: number;
  apy: number;
  network: "mainnet" | "testnet";
  lastUpdated: number;      // epoch ms
}

export interface PortfolioSnapshot {
  wallet: string;
  network: "mainnet" | "testnet";
  positions: Position[];
  totalValueUsd: number;
  nativeMnt: number;
  nativeMntUsd: number;
  timestamp: number;         // epoch ms
}

export interface ProtocolMetrics {
  protocol: string;
  symbol: string;
  pool: string;
  chain: string;

  apy: number;
  apyBase: number;
  apyReward: number;
  apyMean30d: number;
  apyChange1d: number;
  apyChange7d: number;
  apyChange30d: number;
  apySigma: number;
  apyCoeffVariation: number;
  stabilityScore: number;

  tvl: number;
  tvlChange1d: number;
  tvlChange7d: number;
  liquidityDepthScore: string;

  rewardEmissionRatio: number;
  isStablecoin: boolean;
  ilRisk: string;
  exposure: string;

  predictedTrend: string;
  predictedConfidence: number;

  protocolTvl: number;
  protocolTvlChange1d: number;
  protocolTvlChange7d: number;

  compositeScore?: number;
}

export interface DiscoveryResult {
  timestamp: number;
  chain?: string;
  totalPools?: number;
  poolCount: number;
  metrics: ProtocolMetrics[];
}

export interface ProviderConfig {
  name: string;
  keyEnv: keyof Env;
  baseUrl: string;
  defaultModel: string;
  buildHeaders: (key: string) => Record<string, string>;
  transformRequest?: (req: ProviderRequest, model: string) => unknown;
  transformResponse?: (data: any) => ProviderResponse;
  getEndpointUrl?: (model: string, apiKey: string) => string;
}

export const MAX_HISTORY_LIMIT = 50;
export const ACTIVE_WINDOW_SIZE = 20;
export const REFLECTION_THRESHOLD = 10;
