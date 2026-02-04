import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
const LOG_DIR = join(homedir(), ".config", "opencode", "logs", "token-tracker");
const LOG_FILE = join(LOG_DIR, "tokens.jsonl");
// Prices as of 2026-02 (update as needed)
const PRICING = {
    // Anthropic Claude
    "claude-opus-4.5": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    "claude-sonnet-4.5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-haiku-4.5": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    "claude-haiku-4": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    // OpenAI GPT
    "gpt-5.2": { input: 2.5, output: 10 },
    "gpt-5.2-codex": { input: 3, output: 12 },
    "gpt-5.1": { input: 2, output: 8 },
    "gpt-5": { input: 5, output: 15 },
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "o3": { input: 10, output: 40 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "o1": { input: 15, output: 60 },
    "o1-mini": { input: 1.1, output: 4.4 },
    // DeepSeek
    "deepseek-chat": { input: 0.14, output: 0.28, cacheRead: 0.014 },
    "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.055 },
    // Google Gemini
    "gemini-3-pro": { input: 1.25, output: 5 },
    "gemini-3-pro-preview": { input: 1.25, output: 5 },
    "gemini-3-flash": { input: 0.1, output: 0.4 },
    "gemini-2.5-pro": { input: 1.25, output: 5 },
    "gemini-2.5-flash": { input: 0.075, output: 0.3 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    // Fallback for unknown models
    "_default": { input: 1, output: 4 },
};
function getModelPricing(model) {
    // Try exact match first
    if (PRICING[model])
        return PRICING[model];
    // Try partial match (e.g., "claude-opus-4.5" matches "claude-opus-4.5-xxx")
    const modelLower = model.toLowerCase();
    for (const [key, pricing] of Object.entries(PRICING)) {
        if (key !== "_default" && modelLower.includes(key.toLowerCase())) {
            return pricing;
        }
    }
    return PRICING["_default"];
}
function calculateCost(model, input, output, cacheRead = 0, cacheWrite = 0) {
    const pricing = getModelPricing(model);
    // Billable input = total input - cache read (cached tokens are charged at cache rate)
    const billableInput = Math.max(0, input - cacheRead);
    const inputCost = (billableInput / 1_000_000) * pricing.input;
    const outputCost = (output / 1_000_000) * pricing.output;
    const cacheReadCost = (cacheRead / 1_000_000) * (pricing.cacheRead ?? pricing.input * 0.1);
    const cacheWriteCost = (cacheWrite / 1_000_000) * (pricing.cacheWrite ?? pricing.input * 1.25);
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
const sessionStats = new Map();
function getOrCreateSessionStats(sessionId) {
    if (!sessionStats.has(sessionId)) {
        sessionStats.set(sessionId, {
            totalInput: 0,
            totalOutput: 0,
            totalReasoning: 0,
            totalCacheRead: 0,
            totalCacheWrite: 0,
            totalCost: 0,
            messageCount: 0,
            startTime: Date.now(),
        });
    }
    return sessionStats.get(sessionId);
}
function formatCost(cost) {
    if (cost < 0.01)
        return `$${cost.toFixed(4)}`;
    if (cost < 1)
        return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
}
function formatTokens(tokens) {
    if (tokens >= 1_000_000)
        return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000)
        return `${(tokens / 1_000).toFixed(1)}K`;
    return tokens.toString();
}
// ============================================================================
// Deduplication
// ============================================================================
const seen = new Set();
function isDuplicate(key) {
    if (seen.has(key))
        return true;
    seen.add(key);
    // Cleanup old entries to prevent memory leak
    if (seen.size > 10000) {
        const entries = Array.from(seen);
        entries.slice(0, 5000).forEach(k => seen.delete(k));
    }
    return false;
}
// ============================================================================
// Logging
// ============================================================================
function ensureLogDir() {
    if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
    }
}
function logJson(data) {
    ensureLogDir();
    const entry = JSON.stringify({ ...data, _ts: Date.now() }) + "\n";
    appendFileSync(LOG_FILE, entry);
}
export const TokenTrackerPlugin = async ({ directory, client }) => {
    logJson({ type: "init", directory });
    return {
        event: async ({ event }) => {
            try {
                // Handle message updates (token tracking)
                if (event.type === "message.updated") {
                    const props = event.properties;
                    const info = props?.info;
                    if (!info?.tokens)
                        return;
                    const messageId = info.id;
                    const sessionId = info.sessionID;
                    if (!messageId || !sessionId)
                        return;
                    const input = info.tokens.input ?? 0;
                    const output = info.tokens.output ?? 0;
                    const reasoning = info.tokens.reasoning ?? 0;
                    const cacheRead = info.tokens.cache?.read ?? 0;
                    const cacheWrite = info.tokens.cache?.write ?? 0;
                    const hasTokens = input > 0 || output > 0;
                    if (!hasTokens)
                        return;
                    const dedupeKey = `${messageId}-${input}-${output}`;
                    if (isDuplicate(dedupeKey))
                        return;
                    const model = info.model?.modelID ?? info.modelID ?? "unknown";
                    const provider = info.model?.providerID ?? info.providerID ?? "unknown";
                    const cost = calculateCost(model, input, output, cacheRead, cacheWrite);
                    // Update session stats
                    const stats = getOrCreateSessionStats(sessionId);
                    stats.totalInput += input;
                    stats.totalOutput += output;
                    stats.totalReasoning += reasoning;
                    stats.totalCacheRead += cacheRead;
                    stats.totalCacheWrite += cacheWrite;
                    stats.totalCost += cost;
                    stats.messageCount += 1;
                    // Log to file
                    logJson({
                        type: "tokens",
                        sessionId,
                        messageId,
                        role: info.role,
                        agent: info.agent,
                        model,
                        provider,
                        input,
                        output,
                        reasoning,
                        cacheRead,
                        cacheWrite,
                        cost,
                    });
                    // Show toast for this message
                    const totalTokens = input + output;
                    try {
                        await client.tui.showToast({
                            body: {
                                title: `${formatTokens(totalTokens)} tokens`,
                                message: `${formatCost(cost)} | Session: ${formatCost(stats.totalCost)}`,
                                variant: "info",
                                duration: 3000,
                            },
                        });
                    }
                    catch { }
                }
                // Handle session idle (show summary)
                if (event.type === "session.idle") {
                    const props = event.properties;
                    const sessionId = props?.sessionID;
                    if (!sessionId)
                        return;
                    const stats = sessionStats.get(sessionId);
                    if (!stats || stats.messageCount === 0)
                        return;
                    const duration = Math.round((Date.now() - stats.startTime) / 1000 / 60);
                    const totalTokens = stats.totalInput + stats.totalOutput;
                    try {
                        await client.tui.showToast({
                            body: {
                                title: `Session: ${formatTokens(totalTokens)} tokens`,
                                message: `${formatCost(stats.totalCost)} | ${stats.messageCount} msgs | ${duration}min`,
                                variant: "info",
                                duration: 5000,
                            },
                        });
                    }
                    catch { }
                }
            }
            catch { }
        },
    };
};
export default TokenTrackerPlugin;
