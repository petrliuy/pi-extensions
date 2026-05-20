import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");
const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const USAGE_CONFIG_PATH = join(homedir(), ".pi", "agent", "usage.json");
const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const XIAOMI_USAGE_ENDPOINT = "https://platform.xiaomimimo.com/api/v1/tokenPlan/usage";
const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

type AuthSource = "models.json" | "oauth" | "usage.json" | "none";
type ReportStatus = "ok" | "unsupported" | "missing-auth" | "error";

interface ProviderConfig {
	name: string;
	api?: string;
	apiKey?: string;
	baseUrl?: string;
	models?: Array<{ id?: string; name?: string }>;
}

interface ModelsConfig {
	providers: Record<string, ProviderConfig>;
}

interface UsageProviderConfig {
	usageEndpoint?: string;
	cookie?: string;
}

interface UsageConfig {
	providers: Record<string, UsageProviderConfig>;
}

interface SelectedModel {
	provider: string;
	model: string;
}

interface QuotaWindow {
	name: string;
	used?: string;
	remaining?: string;
	limit?: string;
	reset?: string;
}

interface UsageReport {
	provider: string;
	model?: string;
	service: string;
	authSource: AuthSource;
	source: string;
	status: ReportStatus;
	windows?: QuotaWindow[];
	balances?: string[];
	message?: string;
}

interface CodexUsageWindow {
	usedPercent?: number;
	windowSeconds?: number;
	resetAt?: number;
}

interface CodexUsageSnapshot {
	planType?: string;
	email?: string;
	fiveHour?: CodexUsageWindow;
	weekly?: CodexUsageWindow;
}

interface ZhipuMonitorEndpoints {
	platform: "ZAI" | "ZHIPU";
	baseDomain: string;
	modelUsageUrl: string;
	toolUsageUrl: string;
	quotaLimitUrl: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonFile(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function readModelsConfig(): ModelsConfig {
	if (!existsSync(MODELS_PATH)) return { providers: {} };
	const parsed = readJsonFile(MODELS_PATH);
	if (!isObject(parsed) || !isObject(parsed.providers)) {
		throw new Error(`${MODELS_PATH} must contain a providers object`);
	}

	const providers: Record<string, ProviderConfig> = {};
	for (const [name, rawProvider] of Object.entries(parsed.providers)) {
		if (!isObject(rawProvider)) continue;
		const models = Array.isArray(rawProvider.models)
			? rawProvider.models.filter(isObject).map((model) => ({
					id: typeof model.id === "string" ? model.id : undefined,
					name: typeof model.name === "string" ? model.name : undefined,
				}))
			: undefined;
		providers[name] = {
			name,
			api: typeof rawProvider.api === "string" ? rawProvider.api : undefined,
			apiKey: typeof rawProvider.apiKey === "string" ? rawProvider.apiKey : undefined,
			baseUrl: typeof rawProvider.baseUrl === "string" ? rawProvider.baseUrl : undefined,
			models,
		};
	}

	return { providers };
}

function readUsageConfig(): UsageConfig {
	if (!existsSync(USAGE_CONFIG_PATH)) return { providers: {} };
	const parsed = readJsonFile(USAGE_CONFIG_PATH);
	if (!isObject(parsed)) throw new Error(`${USAGE_CONFIG_PATH} must contain an object`);
	const rawProviders = isObject(parsed.providers) ? parsed.providers : {};
	const providers: Record<string, UsageProviderConfig> = {};

	for (const [name, rawProvider] of Object.entries(rawProviders)) {
		if (!isObject(rawProvider)) continue;
		providers[normalizeProviderName(name)] = {
			usageEndpoint: typeof rawProvider.usageEndpoint === "string" ? rawProvider.usageEndpoint : undefined,
			cookie: typeof rawProvider.cookie === "string" ? rawProvider.cookie : undefined,
		};
	}

	return { providers };
}

function readDefaultModel(): SelectedModel | undefined {
	if (!existsSync(SETTINGS_PATH)) return undefined;
	try {
		const settings = readJsonFile(SETTINGS_PATH);
		if (!isObject(settings)) return undefined;
		const provider = settings.defaultProvider;
		const model = settings.defaultModel;
		if (typeof provider !== "string" || typeof model !== "string") return undefined;
		return { provider, model };
	} catch {
		return undefined;
	}
}

function getContextModel(ctx: ExtensionContext): SelectedModel | undefined {
	const model = (ctx as unknown as { model?: { provider?: unknown; id?: unknown; modelId?: unknown; name?: unknown } }).model;
	if (!model || typeof model.provider !== "string") return undefined;
	const modelId = typeof model.id === "string" ? model.id : typeof model.modelId === "string" ? model.modelId : model.name;
	if (typeof modelId !== "string") return undefined;
	return { provider: model.provider, model: modelId };
}

function getSelectedModel(ctx: ExtensionContext): SelectedModel | undefined {
	return getContextModel(ctx) ?? readDefaultModel();
}

function getProviderDisplayModel(provider: ProviderConfig): string | undefined {
	return provider.models?.find((model) => model.id || model.name)?.id ?? provider.models?.find((model) => model.id || model.name)?.name;
}

function normalizeProviderName(value: string): string {
	const lower = value.toLowerCase();
	if (lower === "gpt" || lower === "codex" || lower === "openai") return "openai-codex";
	if (lower === "z.ai" || lower === "zai" || lower === "bigmodel" || lower === "chatglm") return "zhipu";
	if (lower === "moonshot") return "kimi";
	if (lower === "xiaomi" || lower === "mimo") return "xiaomi-token-plan";
	if (lower === "minmax" || lower === "minimax-token-plan") return "minimax";
	if (lower === "opencode") return "opencode-go";
	if (lower === "volcengine" || lower === "volcano" || lower === "ark" || lower === "字节火山" || lower === "火山方舟") return "volcengine";
	if (lower === "tencent" || lower === "tencent-cloud" || lower === "腾讯云") return "tencent-cloud";
	if (lower === "aliyun" || lower === "alibaba-cloud" || lower === "阿里云") return "alibaba-cloud";
	if (lower === "baidu" || lower === "baidu-cloud" || lower === "百度云") return "baidu-cloud";
	if (lower === "jd" || lower === "jd-cloud" || lower === "京东云") return "jd-cloud";
	return lower;
}

function getConfiguredProvider(config: ModelsConfig, name: string): ProviderConfig | undefined {
	const normalized = normalizeProviderName(name);
	return config.providers[normalized] ?? Object.values(config.providers).find((provider) => normalizeProviderName(provider.name) === normalized);
}

function getProvidersForAll(config: ModelsConfig, selected: SelectedModel | undefined): ProviderConfig[] {
	const providers = Object.values(config.providers);
	if (selected && !providers.some((provider) => provider.name === selected.provider)) {
		providers.unshift({ name: selected.provider, models: [{ id: selected.model }] });
	}
	return providers;
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function stripVersionSuffix(baseUrl: string): string {
	return trimTrailingSlash(baseUrl).replace(/\/v\d+$/i, "");
}

async function fetchJson(url: string, apiKey: string, timeoutMs = 15000): Promise<unknown> {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json",
		},
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return response.json();
}

async function fetchZhipuJson(url: string, apiKey: string, timeoutMs = 15000): Promise<unknown> {
	const response = await fetch(url, {
		headers: {
			Authorization: apiKey,
			"Accept-Language": "en-US,en",
			"Content-Type": "application/json",
		},
		signal: AbortSignal.timeout(timeoutMs),
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
	}
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return body;
	}
}

async function fetchCookieJson(url: string, cookie: string, timeoutMs = 15000): Promise<unknown> {
	const response = await fetch(url, {
		headers: {
			Cookie: cookie,
			Accept: "application/json",
		},
		signal: AbortSignal.timeout(timeoutMs),
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
	}
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return body;
	}
}

function missingApiKey(provider: ProviderConfig, service: string): UsageReport {
	return {
		provider: provider.name,
		model: getProviderDisplayModel(provider),
		service,
		authSource: "models.json",
		source: MODELS_PATH,
		status: "missing-auth",
		message: `No apiKey configured for ${provider.name} in models.json.`,
	};
}

function missingUsageConfig(provider: ProviderConfig, service: string, message: string): UsageReport {
	return {
		provider: provider.name,
		model: getProviderDisplayModel(provider),
		service,
		authSource: "usage.json",
		source: USAGE_CONFIG_PATH,
		status: "missing-auth",
		message,
	};
}

function unsupported(provider: ProviderConfig | SelectedModel, service: string, message: string, source = "provider docs"): UsageReport {
	const isSelected = "provider" in provider;
	return {
		provider: isSelected ? provider.provider : provider.name,
		model: isSelected ? provider.model : getProviderDisplayModel(provider),
		service,
		authSource: "none",
		source,
		status: "unsupported",
		message,
	};
}

async function queryDeepSeek(provider: ProviderConfig): Promise<UsageReport> {
	if (!provider.apiKey) return missingApiKey(provider, "DeepSeek balance");
	const baseUrl = stripVersionSuffix(provider.baseUrl ?? "https://api.deepseek.com");
	const data = await fetchJson(`${baseUrl}/user/balance`, provider.apiKey);
	const rawBalances = isObject(data) && Array.isArray(data.balance_infos) ? data.balance_infos : [];
	const balances = rawBalances.filter(isObject).map((balance) => {
		const currency = typeof balance.currency === "string" ? balance.currency : "unknown";
		const total = typeof balance.total_balance === "string" ? balance.total_balance : "?";
		const granted = typeof balance.granted_balance === "string" ? balance.granted_balance : "?";
		const toppedUp = typeof balance.topped_up_balance === "string" ? balance.topped_up_balance : "?";
		return `${currency}: total ${total}, granted ${granted}, topped-up ${toppedUp}`;
	});

	return {
		provider: provider.name,
		model: getProviderDisplayModel(provider),
		service: "DeepSeek balance",
		authSource: "models.json",
		source: `${baseUrl}/user/balance`,
		status: "ok",
		balances,
		message: isObject(data) && data.is_available === false ? "Balance is not available for API calls." : undefined,
	};
}

async function queryKimi(provider: ProviderConfig): Promise<UsageReport> {
	if (!provider.apiKey) return missingApiKey(provider, "Kimi/Moonshot balance");
	const baseUrl = trimTrailingSlash(provider.baseUrl ?? "https://api.moonshot.cn/v1");
	const url = /\/v\d+$/i.test(baseUrl) ? `${baseUrl}/users/me/balance` : `${baseUrl}/v1/users/me/balance`;
	const data = await fetchJson(url, provider.apiKey);
	const payload = isObject(data) && isObject(data.data) ? data.data : {};
	const available = typeof payload.available_balance === "number" ? payload.available_balance : undefined;
	const voucher = typeof payload.voucher_balance === "number" ? payload.voucher_balance : undefined;
	const cash = typeof payload.cash_balance === "number" ? payload.cash_balance : undefined;

	return {
		provider: provider.name,
		model: getProviderDisplayModel(provider),
		service: "Kimi/Moonshot balance",
		authSource: "models.json",
		source: url,
		status: "ok",
		balances: [
			`available: ${available ?? "?"}`,
			`voucher: ${voucher ?? "?"}`,
			`cash: ${cash ?? "?"}`,
		],
	};
}

function getZhipuMonitorEndpoints(provider: ProviderConfig): ZhipuMonitorEndpoints | undefined {
	if (!provider.baseUrl) return undefined;
	const parsed = new URL(provider.baseUrl);
	const baseDomain = `${parsed.protocol}//${parsed.host}`;

	if (provider.baseUrl.includes("api.z.ai")) {
		return {
			platform: "ZAI",
			baseDomain,
			modelUsageUrl: `${baseDomain}/api/monitor/usage/model-usage`,
			toolUsageUrl: `${baseDomain}/api/monitor/usage/tool-usage`,
			quotaLimitUrl: `${baseDomain}/api/monitor/usage/quota/limit`,
		};
	}

	if (provider.baseUrl.includes("open.bigmodel.cn") || provider.baseUrl.includes("dev.bigmodel.cn")) {
		return {
			platform: "ZHIPU",
			baseDomain,
			modelUsageUrl: `${baseDomain}/api/monitor/usage/model-usage`,
			toolUsageUrl: `${baseDomain}/api/monitor/usage/tool-usage`,
			quotaLimitUrl: `${baseDomain}/api/monitor/usage/quota/limit`,
		};
	}

	return undefined;
}

function formatDateTime(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getZhipuUsageQuery(): string {
	const now = new Date();
	const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, now.getHours(), 0, 0, 0);
	const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 59, 59, 999);
	return `?startTime=${encodeURIComponent(formatDateTime(startDate))}&endTime=${encodeURIComponent(formatDateTime(endDate))}`;
}

function unwrapData(value: unknown): unknown {
	if (isObject(value) && "data" in value) return value.data;
	return value;
}

function formatZhipuPercentage(value: unknown): string | undefined {
	if (typeof value === "number") return `${Math.round(value * 100) / 100}%`;
	if (typeof value === "string" && value.trim()) return value.endsWith("%") ? value : `${value}%`;
	return undefined;
}

function formatJsonSummary(value: unknown): string {
	if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 177)}...` : value;
	try {
		const text = JSON.stringify(value);
		return text.length > 180 ? `${text.slice(0, 177)}...` : text;
	} catch {
		return String(value);
	}
}

function formatZhipuUsageDetail(label: string, value: unknown): string {
	const data = unwrapData(value);
	if (Array.isArray(data)) return `${label}: ${data.length} rows ${formatJsonSummary(data.slice(0, 3))}`;
	if (isObject(data)) return `${label}: ${formatJsonSummary(data)}`;
	return `${label}: ${formatJsonSummary(data)}`;
}

function parseZhipuQuotaWindows(value: unknown): QuotaWindow[] {
	const data = unwrapData(value);
	const limits = isObject(data) && Array.isArray(data.limits) ? data.limits : [];
	return limits.filter(isObject).map((item): QuotaWindow => {
		const type = typeof item.type === "string" ? item.type : "unknown";
		const percentage = formatZhipuPercentage(item.percentage);
		if (type === "TOKENS_LIMIT") {
			return {
				name: "Token usage(5 Hour)",
				used: percentage,
				remaining: percentage ? `${Math.max(0, 100 - Number.parseFloat(percentage)).toFixed(2).replace(/\.00$/, "")}%` : undefined,
			};
		}
		if (type === "TIME_LIMIT") {
			return {
				name: "MCP usage(1 Month)",
				used: percentage,
				limit: item.usage === undefined ? undefined : String(item.usage),
				remaining: item.currentValue === undefined ? undefined : String(item.currentValue),
			};
		}
		return {
			name: type,
			used: percentage,
			limit: item.usage === undefined ? undefined : String(item.usage),
			remaining: item.currentValue === undefined ? undefined : String(item.currentValue),
		};
	});
}

function parseZhipuQuotaDetails(value: unknown): string[] {
	const data = unwrapData(value);
	const limits = isObject(data) && Array.isArray(data.limits) ? data.limits : [];
	return limits.filter(isObject).map((item) => {
		const type = typeof item.type === "string" ? item.type : "unknown";
		const label = type === "TOKENS_LIMIT" ? "Token usage(5 Hour)" : type === "TIME_LIMIT" ? "MCP usage(1 Month)" : type;
		const details = [
			item.percentage === undefined ? undefined : `percentage=${item.percentage}`,
			item.currentValue === undefined ? undefined : `currentUsage=${item.currentValue}`,
			item.usage === undefined ? undefined : `totalUsage=${item.usage}`,
			item.usageDetails === undefined ? undefined : `usageDetails=${formatJsonSummary(item.usageDetails)}`,
		].filter((detail): detail is string => detail !== undefined);
		return `${label}: ${details.join(", ")}`;
	});
}

async function queryZhipu(provider: ProviderConfig): Promise<UsageReport> {
	if (!provider.apiKey) return missingApiKey(provider, "Z.ai/GLM usage");
	let endpoints: ZhipuMonitorEndpoints | undefined;
	try {
		endpoints = getZhipuMonitorEndpoints(provider);
	} catch (error) {
		return unsupported(
			provider,
			"Z.ai/GLM usage",
			`Invalid Zhipu baseUrl in models.json: ${error instanceof Error ? error.message : String(error)}`,
			provider.baseUrl ?? MODELS_PATH,
		);
	}
	if (!endpoints) {
		return unsupported(
			provider,
			"Z.ai/GLM usage",
			`Unrecognized Zhipu baseUrl host. Expected api.z.ai, open.bigmodel.cn, or dev.bigmodel.cn.`,
			provider.baseUrl ?? MODELS_PATH,
		);
	}

	const query = getZhipuUsageQuery();
	const [modelUsage, toolUsage, quotaLimit] = await Promise.all([
		fetchZhipuJson(`${endpoints.modelUsageUrl}${query}`, provider.apiKey),
		fetchZhipuJson(`${endpoints.toolUsageUrl}${query}`, provider.apiKey),
		fetchZhipuJson(endpoints.quotaLimitUrl, provider.apiKey),
	]);

	return {
		provider: provider.name,
		model: getProviderDisplayModel(provider),
		service: `${endpoints.platform} usage`,
		authSource: "models.json",
		source: `${endpoints.baseDomain}/api/monitor/usage`,
		status: "ok",
		windows: parseZhipuQuotaWindows(quotaLimit),
		balances: [
			...parseZhipuQuotaDetails(quotaLimit),
			formatZhipuUsageDetail("Model usage", modelUsage),
			formatZhipuUsageDetail("Tool usage", toolUsage),
		],
	};
}

function collectObjectEntries(value: unknown, prefix = ""): Array<[string, unknown]> {
	if (!isObject(value) && !Array.isArray(value)) return [];
	const entries: Array<[string, unknown]> = [];
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			const key = `${prefix}[${index}]`;
			entries.push([key, item]);
			entries.push(...collectObjectEntries(item, key));
		});
		return entries;
	}
	for (const [key, item] of Object.entries(value)) {
		const path = prefix ? `${prefix}.${key}` : key;
		entries.push([path, item]);
		entries.push(...collectObjectEntries(item, path));
	}
	return entries;
}

function findNumberByKeys(value: unknown, keys: string[]): number | undefined {
	const normalizedKeys = keys.map(normalizeMetricKey);
	for (const [path, item] of collectObjectEntries(value)) {
		const key = normalizeMetricKey(path.split(".").pop()?.replace(/\[\d+\]$/, "") ?? "");
		if (!normalizedKeys.includes(key)) continue;
		if (typeof item === "number" && Number.isFinite(item)) return item;
		if (typeof item === "string") {
			const parsed = Number(item.replace(/,/g, ""));
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return undefined;
}

function findStringByKeys(value: unknown, keys: string[]): string | undefined {
	const normalizedKeys = keys.map(normalizeMetricKey);
	for (const [path, item] of collectObjectEntries(value)) {
		const key = normalizeMetricKey(path.split(".").pop()?.replace(/\[\d+\]$/, "") ?? "");
		if (!normalizedKeys.includes(key)) continue;
		if (typeof item === "string" && item.trim()) return item;
		if (typeof item === "number" && Number.isFinite(item)) return String(item);
	}
	return undefined;
}

function normalizeMetricKey(value: string): string {
	return value.toLowerCase().replace(/[_\-\s]/g, "");
}

function formatTokenAmount(value: number): string {
	if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "")}B`;
	if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
	if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2).replace(/\.?0+$/, "")}K`;
	return String(value);
}

function parseXiaomiTokenPlan(data: unknown): { windows: QuotaWindow[]; balances: string[] } {
	const payload = unwrapData(data);
	const total = findNumberByKeys(payload, ["total", "quota", "limit", "totalTokens", "tokenLimit", "totalToken"]);
	let used = findNumberByKeys(payload, ["used", "usage", "usedTokens", "usedToken", "consumed", "consumedTokens"]);
	let remaining = findNumberByKeys(payload, ["remaining", "remain", "balance", "available", "left", "remainTokens", "tokenBalance"]);
	const reset = findStringByKeys(payload, ["reset", "resetAt", "expire", "expireAt", "expireTime", "expiredAt"]);

	if (used === undefined && total !== undefined && remaining !== undefined) used = Math.max(0, total - remaining);
	if (remaining === undefined && total !== undefined && used !== undefined) remaining = Math.max(0, total - used);

	const usedPercent = total !== undefined && used !== undefined && total > 0 ? `${Math.round((used / total) * 100)}%` : undefined;
	const windows: QuotaWindow[] = [
		{
			name: "Token plan",
			used: usedPercent,
			remaining: remaining === undefined ? undefined : formatTokenAmount(remaining),
			limit: total === undefined ? undefined : formatTokenAmount(total),
			reset,
		},
	];

	const balances = [
		remaining === undefined ? undefined : `remaining tokens: ${formatTokenAmount(remaining)} (${remaining})`,
		used === undefined ? undefined : `used tokens: ${formatTokenAmount(used)} (${used})`,
		total === undefined ? undefined : `total tokens: ${formatTokenAmount(total)} (${total})`,
		reset === undefined ? undefined : `reset: ${reset}`,
	].filter((item): item is string => item !== undefined);

	if (balances.length === 0) balances.push(`response: ${formatJsonSummary(payload)}`);
	return { windows, balances };
}

async function queryXiaomiTokenPlan(provider: ProviderConfig): Promise<UsageReport> {
	const config = readUsageConfig().providers["xiaomi-token-plan"];
	if (!config?.cookie) {
		return missingUsageConfig(
			provider,
			"Xiaomi token plan",
			`Missing providers.xiaomi-token-plan.cookie in ${USAGE_CONFIG_PATH}.`,
		);
	}

	const endpoint = config.usageEndpoint ?? XIAOMI_USAGE_ENDPOINT;
	const data = await fetchCookieJson(endpoint, config.cookie);
	const parsed = parseXiaomiTokenPlan(data);

	return {
		provider: provider.name,
		model: getProviderDisplayModel(provider),
		service: "Xiaomi token plan",
		authSource: "usage.json",
		source: endpoint,
		status: "ok",
		windows: parsed.windows,
		balances: parsed.balances,
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isObject(value) ? value : undefined;
}

function nestedRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
	return asRecord(record?.[key]);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
	const parts = token.split(".");
	if (parts.length < 2) return {};
	try {
		return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function getCodexAccountId(token: string): string | undefined {
	const payload = decodeJwtPayload(token);
	const auth = nestedRecord(payload, "https://api.openai.com/auth");
	return (
		(typeof payload["https://api.openai.com/auth.chatgpt_account_id"] === "string"
			? payload["https://api.openai.com/auth.chatgpt_account_id"]
			: undefined) ?? (typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined)
	);
}

function getNumberField(record: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}

function normalizeCodexWindow(value: unknown): CodexUsageWindow | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const windowSeconds = getNumberField(record, ["limit_window_seconds", "window_seconds"]);
	const windowMinutes = getNumberField(record, ["window_minutes"]);
	return {
		usedPercent: getNumberField(record, ["used_percent"]),
		windowSeconds: windowSeconds ?? (windowMinutes === undefined ? undefined : windowMinutes * 60),
		resetAt: getNumberField(record, ["reset_at", "resets_at"]),
	};
}

function parseCodexSnapshot(data: unknown): CodexUsageSnapshot {
	const raw = asRecord(data);
	const rateLimit = nestedRecord(raw, "rate_limit");
	const rateLimits = nestedRecord(raw, "rate_limits");
	const primary = normalizeCodexWindow(rateLimit?.primary_window) ?? normalizeCodexWindow(rateLimits?.primary);
	const secondary = normalizeCodexWindow(rateLimit?.secondary_window) ?? normalizeCodexWindow(rateLimits?.secondary);
	const windows = [primary, secondary].filter(
		(window): window is CodexUsageWindow => Boolean(window),
	);
	return {
		planType: typeof raw?.plan_type === "string" ? raw.plan_type : undefined,
		email: typeof raw?.email === "string" ? raw.email : undefined,
		// Codex reports primary as the 5-hour window and secondary as weekly.
		// Duration fields are inconsistent across endpoints, so use them only as fallback.
		fiveHour: primary ?? windows.find((window) => Math.abs((window.windowSeconds ?? 0) - FIVE_HOUR_SECONDS) <= 120),
		weekly: secondary ?? windows.find((window) => Math.abs((window.windowSeconds ?? 0) - WEEK_SECONDS) <= 120),
	};
}

function formatCodexWindow(name: string, window: CodexUsageWindow | undefined): QuotaWindow {
	const used = typeof window?.usedPercent === "number" ? Math.max(0, Math.min(100, window.usedPercent)) : undefined;
	return {
		name,
		used: used === undefined ? undefined : `${Math.round(used)}%`,
		remaining: used === undefined ? undefined : `${Math.round(100 - used)}%`,
		reset: window?.resetAt ? new Date(window.resetAt * 1000).toLocaleString() : undefined,
	};
}

async function queryCodex(ctx: ExtensionContext, selected: SelectedModel): Promise<UsageReport> {
	const registry = (ctx as unknown as {
		modelRegistry?: {
			find?: (provider: string, model: string) => unknown;
			isUsingOAuth?: (model: unknown) => boolean;
			getApiKeyAndHeaders?: (model: unknown) => Promise<{ ok: boolean; apiKey?: string }>;
		};
	}).modelRegistry;
	const activeModel = (ctx as unknown as { model?: { provider?: unknown } }).model;
	const model = activeModel?.provider === selected.provider ? activeModel : registry?.find?.(selected.provider, selected.model);

	if (!model || registry?.isUsingOAuth?.(model) !== true || !registry.getApiKeyAndHeaders) {
		return {
			provider: selected.provider,
			model: selected.model,
			service: "Codex subscription usage",
			authSource: "oauth",
			source: CODEX_USAGE_ENDPOINT,
			status: "missing-auth",
			message: "Codex subscription usage requires Pi/OpenAI OAuth for the active openai-codex model.",
		};
	}

	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		return {
			provider: selected.provider,
			model: selected.model,
			service: "Codex subscription usage",
			authSource: "oauth",
			source: CODEX_USAGE_ENDPOINT,
			status: "missing-auth",
			message: "Could not read OAuth token for active openai-codex model.",
		};
	}

	const accountId = getCodexAccountId(auth.apiKey);
	const response = await fetch(CODEX_USAGE_ENDPOINT, {
		headers: {
			Authorization: `Bearer ${auth.apiKey}`,
			Accept: "application/json",
			"User-Agent": "pi-usage",
			...(accountId ? { "chatgpt-account-id": accountId } : {}),
		},
		signal: AbortSignal.timeout(15000),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const snapshot = parseCodexSnapshot(await response.json());

	return {
		provider: selected.provider,
		model: selected.model,
		service: "Codex subscription usage",
		authSource: "oauth",
		source: CODEX_USAGE_ENDPOINT,
		status: "ok",
		windows: [formatCodexWindow("5h", snapshot.fiveHour), formatCodexWindow("weekly", snapshot.weekly)],
		message: snapshot.planType ? `plan: ${snapshot.planType}` : undefined,
	};
}

async function queryProvider(ctx: ExtensionContext, config: ModelsConfig, selected: SelectedModel): Promise<UsageReport> {
	const provider = getConfiguredProvider(config, selected.provider) ?? { name: selected.provider, models: [{ id: selected.model }] };
	const name = normalizeProviderName(provider.name);

	try {
		if (name === "openai-codex") return await queryCodex(ctx, selected);
		if (name === "deepseek") return await queryDeepSeek(provider);
		if (name === "kimi") return await queryKimi(provider);
		if (name === "zhipu") return await queryZhipu(provider);
		if (name === "xiaomi-token-plan") return await queryXiaomiTokenPlan(provider);
		if (name === "minimax") {
			return unsupported(
				provider,
				"MiniMax Token Plan quota",
				"Official docs expose token-plan quota via mmx quota, but this implementation cannot depend on provider CLIs.",
				"MiniMax token-plan docs",
			);
		}
		if (name === "claude") {
			return unsupported(provider, "Claude Code usage", "Claude subscription usage requires an OAuth/account surface; no API-key quota endpoint is mapped.");
		}
		if (name === "gemini") {
			return unsupported(provider, "Gemini quota", "Gemini quota is exposed through Google Cloud/AI Studio quota surfaces; no API-key endpoint is mapped.");
		}
		if (name === "opencode-go") {
			return unsupported(provider, "OpenCode Go usage", "No API-key quota endpoint is mapped for OpenCode Go subscription usage.");
		}
		if (["volcengine", "tencent-cloud", "alibaba-cloud", "baidu-cloud", "jd-cloud"].includes(name)) {
			return unsupported(
				provider,
				`${provider.name} cloud billing/quota`,
				"Cloud billing APIs require provider-specific signed requests; this adapter is not mapped yet.",
			);
		}
		return unsupported(provider, `${provider.name} usage`, "No usage adapter is implemented for this provider.");
	} catch (error) {
		return {
			provider: provider.name,
			model: selected.model || getProviderDisplayModel(provider),
			service: `${provider.name} usage`,
			authSource: name === "openai-codex" ? "oauth" : "models.json",
			source: provider.baseUrl ?? MODELS_PATH,
			status: "error",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function formatWindow(window: QuotaWindow): string {
	const parts = [window.name];
	if (window.used) parts.push(`${window.used} used`);
	if (window.remaining) parts.push(`${window.remaining} left`);
	if (window.limit) parts.push(`limit ${window.limit}`);
	if (window.reset) parts.push(`resets ${window.reset}`);
	return parts.join(": ");
}

function formatReport(report: UsageReport): string {
	const lines = [
		`${report.service} (${report.status})`,
		`Provider: ${report.provider}${report.model ? `/${report.model}` : ""}`,
		`Auth: ${report.authSource}`,
		`Source: ${report.source}`,
	];
	if (report.message) lines.push(`Note: ${report.message}`);
	if (report.windows?.length) lines.push(...report.windows.map(formatWindow));
	if (report.balances?.length) lines.push(...report.balances.map((balance) => `Balance: ${balance}`));
	return lines.join("\n");
}

function parsePercent(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const match = value.match(/\d+(?:\.\d+)?/);
	if (!match) return undefined;
	const amount = Number(match[0]);
	if (!Number.isFinite(amount)) return undefined;
	return `${Math.round(amount)}%`;
}

function findWindowPercent(report: UsageReport, match: (name: string) => boolean): string | undefined {
	const window = report.windows?.find((item) => match(item.name.toLowerCase()));
	return parsePercent(window?.used);
}

function getCompactUsageLine(report: UsageReport): string {
	if (report.status !== "ok") return `${report.provider} usage unavailable`;

	const fiveHour = findWindowPercent(report, (name) => name === "5h" || name.includes("5 hour"));
	const weekly = findWindowPercent(report, (name) => name.includes("weekly"));
	const monthly = findWindowPercent(report, (name) => name.includes("month"));

	const parts: string[] = [];
	if (fiveHour) parts.push(`5h ${fiveHour}`);
	if (weekly) parts.push(`weekly ${weekly}`);
	if (monthly) parts.push(`monthly ${monthly}`);
	if (parts.length > 0) return parts.join(" · ");

	const tokenPlan = findWindowPercent(report, (name) => name.includes("token plan"));
	if (tokenPlan) return `${report.provider} token ${tokenPlan}`;

	const balance = report.balances?.find((item) => item.trim().length > 0);
	if (balance) return `${report.provider} ${balance.replace(/^balance:\s*/i, "")}`;

	return `${report.provider} usage available`;
}

function getModelKey(model: SelectedModel | undefined): string | undefined {
	if (!model) return undefined;
	return `${normalizeProviderName(model.provider)}/${model.model}`;
}

function getProviderKey(model: SelectedModel | undefined): string | undefined {
	if (!model) return undefined;
	return normalizeProviderName(model.provider);
}

function showHelp(ctx: ExtensionContext): void {
	ctx.ui.notify(
		[
			"Usage commands:",
			"/usage",
			"/usage all",
			"/usage <provider>",
			"",
			"API-key providers are read from ~/.pi/agent/models.json. OAuth is used only for OAuth-only subscription usage.",
		].join("\n"),
		"info",
	);
}

export default function usageExtension(pi: ExtensionAPI): void {
	let refreshGeneration = 0;
	let currentModelKey: string | undefined;

	function clearStatusLine(ctx: ExtensionContext): void {
		ctx.ui.setWidget("usage-statusline", undefined);
		currentModelKey = undefined;
	}

	function setStatusLineFromReport(ctx: ExtensionContext, selected: SelectedModel, report: UsageReport, generation: number): void {
		if (generation !== refreshGeneration || currentModelKey !== getModelKey(selected)) return;
		const color = report.status === "ok" ? "accent" : "muted";
		ctx.ui.setWidget("usage-statusline", [ctx.ui.theme.fg(color, getCompactUsageLine(report))], { placement: "belowEditor" });
	}

	async function refreshStatusLine(ctx: ExtensionContext, selected: SelectedModel | undefined, options: { showUpdating?: boolean } = {}): Promise<void> {
		const generation = ++refreshGeneration;
		currentModelKey = getModelKey(selected);

		if (!selected) {
			clearStatusLine(ctx);
			return;
		}

		if (options.showUpdating) {
			ctx.ui.setWidget("usage-statusline", [ctx.ui.theme.fg("muted", "usage updating...")], { placement: "belowEditor" });
		}

		let report: UsageReport;
		try {
			report = await queryProvider(ctx, readModelsConfig(), selected);
		} catch (error) {
			report = {
				provider: selected.provider,
				model: selected.model,
				service: `${selected.provider} usage`,
				authSource: "none",
				source: MODELS_PATH,
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}

		setStatusLineFromReport(ctx, selected, report, generation);
	}

	pi.registerCommand("usage", {
		description: "Query selected provider quota or balance",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (input === "help" || input === "-h" || input === "--help") {
				showHelp(ctx);
				return;
			}

			let config: ModelsConfig;
			try {
				config = readModelsConfig();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Invalid models config: ${message}`, "error");
				return;
			}

			const selected = getSelectedModel(ctx);
			if (input === "all") {
				const reports = await Promise.all(
					getProvidersForAll(config, selected).map((provider) =>
						queryProvider(ctx, config, {
							provider: provider.name,
							model: getProviderDisplayModel(provider) ?? "",
						}),
					),
				);
				ctx.ui.notify(reports.map(formatReport).join("\n\n"), "info");
				return;
			}

			const target = input ? (getConfiguredProvider(config, input) ?? { name: normalizeProviderName(input) }) : undefined;
			const queryTarget = target ? { provider: target.name, model: getProviderDisplayModel(target) ?? "" } : selected;

			if (!queryTarget) {
				ctx.ui.notify("No selected model found in this session or settings.", "warning");
				return;
			}

			const shouldUpdateStatusLine = !input || getProviderKey(queryTarget) === getProviderKey(selected);
			const generation = shouldUpdateStatusLine ? ++refreshGeneration : refreshGeneration;
			if (shouldUpdateStatusLine) {
				currentModelKey = getModelKey(queryTarget);
				ctx.ui.setWidget("usage-statusline", [ctx.ui.theme.fg("muted", "usage updating...")], { placement: "belowEditor" });
			}

			const report = await queryProvider(ctx, config, queryTarget);
			if (shouldUpdateStatusLine) setStatusLineFromReport(ctx, queryTarget, report, generation);
			ctx.ui.notify(formatReport(report), report.status === "error" ? "error" : report.status === "unsupported" ? "warning" : "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await refreshStatusLine(ctx, getSelectedModel(ctx));
	});

	pi.on("model_select", async (event, ctx) => {
		const model = event.model as { provider?: unknown; id?: unknown; modelId?: unknown; name?: unknown };
		const provider = typeof model.provider === "string" ? model.provider : undefined;
		const modelId = typeof model.id === "string" ? model.id : typeof model.modelId === "string" ? model.modelId : model.name;
		if (!provider || typeof modelId !== "string") {
			clearStatusLine(ctx);
			return;
		}
		await refreshStatusLine(ctx, { provider, model: modelId });
	});

	pi.on("agent_end", async (_event, ctx) => {
		await refreshStatusLine(ctx, getSelectedModel(ctx));
	});
}
