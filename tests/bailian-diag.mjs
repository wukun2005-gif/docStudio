// Bailian 诊断脚本：测试 kimi-k2.7-code 在不同输入规模下的响应时间
const API_KEY = process.env.bailian_key;
const BASE_URL = (process.env.bailian_baseurl || "https://ws-3vv2b1h4akmem3xz.cn-beijing.maas.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
if (!API_KEY) { console.error("ERROR: 请先 source .env"); process.exit(1); }

async function callLLM(label, model, messages, maxTokens = 500, timeoutMs = 180_000) {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  console.log(`\n[${label}] 开始 model=${model}, timeoutMs=${timeoutMs}`);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Date.now() - start;
    console.log(`[${label}] HTTP ${res.status} ${ms}ms, body length=${text.length}`);
    if (res.ok) {
      try {
        const data = JSON.parse(text);
        const msg = data.choices?.[0]?.message || {};
        console.log(`[${label}] content.length=${(msg.content||"").length}, reasoning_content.length=${(msg.reasoning_content||"").length}, usage=${JSON.stringify(data.usage||{})}`);
        console.log(`[${label}] content snippet: ${(msg.content||"").slice(0, 200)}`);
      } catch { console.log(`[${label}] body: ${text.slice(0, 300)}`); }
    } else {
      console.log(`[${label}] error body: ${text.slice(0, 500)}`);
    }
  } catch (e) {
    console.log(`[${label}] 失败 ${Date.now() - start}ms: ${e.message}`);
  } finally {
    clearTimeout(t);
  }
}

// 构造长文本
const longText = "这是一段关于人工智能技术应用的测试内容。人工智能正在改变世界。".repeat(400);
console.log(`长文本长度: ${longText.length} 字符 ≈ ${Math.floor(longText.length/2)} tokens`);

// 测试序列
await callLLM("T1-small", "kimi-k2.7-code", [{role:"user", content:"你好"}], 100, 30_000);
await callLLM("T2-medium-5k", "kimi-k2.7-code", [
  {role:"system", content:"你是评估专家，输出 JSON"},
  {role:"user", content:`判断以下文本是否与"AI"相关。输出 JSON: {"score": 0-1}\n\n${longText.slice(0, 10000)}`},
], 500, 180_000);
await callLLM("T3-large-25k", "kimi-k2.7-code", [
  {role:"system", content:"你是评估专家，输出 JSON"},
  {role:"user", content:`判断以下文本是否与"AI"相关。输出 JSON: {"score": 0-1}\n\n${longText}`},
], 800, 180_000);
await callLLM("T4-qwen-plus-control", "qwen-plus", [
  {role:"system", content:"你是评估专家，输出 JSON"},
  {role:"user", content:`判断以下文本是否与"AI"相关。输出 JSON: {"score": 0-1}\n\n${longText}`},
], 800, 180_000);

console.log("\n诊断完成");
