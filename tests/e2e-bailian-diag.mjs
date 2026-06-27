/**
 * E2E 诊断测试：百炼 provider 在不同输入规模下的响应时间
 *
 * 目的：定位 kimi-k2.7-code 在评估场景下 timeout 的根因
 *
 * 遵守 claude.md：
 * - 使用 startIsolatedServer() 启动隔离服务器
 * - API key 从 .env 读取，通过请求体传递
 * - 不直接打用户的 dev server
 * - 测试结束后清理资源
 */
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const BAILIAN_KEY = process.env.bailian_key;
const BAILIAN_BASEURL = process.env.bailian_baseurl;

if (!BAILIAN_KEY) {
  console.error("❌ bailian_key not found in .env");
  process.exit(1);
}

let server;

async function callChat(label, model, message, timeoutMs = 180_000) {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  console.log(`\n[${label}] model=${model}, message.length=${message.length}, timeout=${timeoutMs}ms`);
  try {
    const res = await fetch(`${server.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        modelId: model,
        providerPreference: ["bailian"],
        apiKey: BAILIAN_KEY,
        providerBaseUrls: BAILIAN_BASEURL ? { bailian: BAILIAN_BASEURL } : undefined,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Date.now() - start;
    let data = null;
    try { data = JSON.parse(text); } catch {}
    const content = data?.content || "";
    const err = data?.error || "";
    console.log(`[${label}] HTTP ${res.status} ${ms}ms ok=${data?.ok} content.length=${content.length}${err ? ` error="${err}"` : ""}`);
    console.log(`[${label}] preview: ${content.slice(0, 200)}`);
    return { ms, ok: res.ok, content };
  } catch (e) {
    const ms = Date.now() - start;
    console.log(`[${label}] ❌ 失败 ${ms}ms: ${e.message}`);
    return { ms, ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

// 走隔离 server 的 chat API，附加 maxTokens 和 temperature 控制以还原评估场景
async function callChatAdvanced(label, model, message, options = {}) {
  const { maxTokens = 8000, timeoutMs = 180_000 } = options;
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  console.log(`\n[${label}] ADVANCED model=${model}, message.length=${message.length}, maxTokens=${maxTokens}, timeout=${timeoutMs}ms`);
  try {
    const res = await fetch(`${server.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        modelId: model,
        providerPreference: ["bailian"],
        apiKey: BAILIAN_KEY,
        providerBaseUrls: BAILIAN_BASEURL ? { bailian: BAILIAN_BASEURL } : undefined,
        maxTokens,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Date.now() - start;
    let data = null;
    try { data = JSON.parse(text); } catch {}
    const content = data?.content || "";
    const err = data?.error || "";
    console.log(`[${label}] HTTP ${res.status} ${ms}ms ok=${data?.ok} content.length=${content.length}${err ? ` error="${String(err).slice(0, 200)}"` : ""}`);
    console.log(`[${label}] preview: ${content.slice(0, 300)}`);
    return { ms, ok: res.ok && !err, content };
  } catch (e) {
    const ms = Date.now() - start;
    console.log(`[${label}] ❌ 失败 ${ms}ms: ${e.message}`);
    return { ms, ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

// 1:1 还原评估场景 prompt（参数：temperature=0, maxTokens 推理 4x）
async function callEvalStyle(label, model, longText, timeoutMs) {
  const isReasoning = /kimi-k2|r1\b|deepseek-v[34]|thinking/i.test(model);
  const maxTokens = isReasoning ? 8000 * 4 : 8000;

  const systemPrompt = `You are a strict relevance evaluator. Determine whether each sentence in the generated document is relevant to the user's requirement. OUTPUT FORMAT (strict JSON): {"verdicts":[{"text":"...","relevant":true,"reason":"..."}],"irrelevant_sentences":[],"relevance_ratio":0.85}`;

  const userPrompt = `${systemPrompt}\n\n## 用户原始需求\n请写一篇关于人工智能的文章。\n\n## 生成的文档内容\n${longText}\n\n请逐句判断每个声明是否与用户需求相关。输出 JSON。`;

  return callChatAdvanced(label, model, userPrompt, { maxTokens, timeoutMs });
}

async function run() {
  console.log("🧪 Bailian 诊断测试\n");

  server = await startIsolatedServer();
  console.log(`📦 隔离服务器地址: ${server.baseUrl}\n`);

  // 构造长文本（约 25K 字符 ≈ 12K tokens）
  const longText = "这是一段关于人工智能技术应用的测试内容。人工智能正在改变世界。".repeat(800);
  console.log(`长文本长度: ${longText.length} 字符`);

  const results = [];

  // T1: 小输入 sanity check
  results.push({ label: "T1-small-kimi", ...(await callChat("T1-small-kimi", "kimi-k2.7-code", "你好，请用一句话介绍自己", 30_000)) });

  // T2: kimi-k2.7-code + 大输入（模拟评估场景）
  results.push({ label: "T2-large-kimi", ...(await callChat("T2-large-kimi", "kimi-k2.7-code", `请判断以下文本是否与"AI"相关：${longText}`, 180_000)) });

  // T3: qwen-plus 对照
  results.push({ label: "T3-large-qwen-plus", ...(await callChat("T3-large-qwen-plus", "qwen-plus", `请判断以下文本是否与"AI"相关：${longText}`, 180_000)) });

  // T4: qwen-turbo 对照（最快）
  results.push({ label: "T4-large-qwen-turbo", ...(await callChat("T4-large-qwen-turbo", "qwen-turbo", `请判断以下文本是否与"AI"相关：${longText}`, 180_000)) });

  // T5: 1:1 还原评估场景 — 直接调用 registry.runWithFallback + json_schema + temperature=0
  results.push({ label: "T5-eval-repro-kimi", ...(await callEvalStyle("T5-eval-repro-kimi", "kimi-k2.7-code", longText, 180_000)) });
  results.push({ label: "T6-eval-repro-qwen", ...(await callEvalStyle("T6-eval-repro-qwen", "qwen-plus", longText, 180_000)) });

  // 汇总
  console.log("\n\n=== 汇总 ===");
  for (const r of results) {
    const status = r.ok ? "✅" : "❌";
    console.log(`${status} ${r.label}: ${r.ms}ms`);
  }

  await server.cleanup();
  console.log("\n🏁 诊断完成");
}

run().catch(async (e) => {
  console.error("💥 测试失败:", e);
  dumpServerLog();
  if (server) await server.cleanup();
  process.exit(1);
});
