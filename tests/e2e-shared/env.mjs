/**
 * E2E 测试环境变量加载
 * 照搬 patentExaminator env.mjs，简化适配 i-Write
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

/** .env 文件解析 */
function parseEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
}

/** 加载 .env 文件到 process.env（仅设置未存在的变量） */
export function loadEnvFile() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  const envVars = parseEnvFile(envPath);

  for (const [key, value] of Object.entries(envVars)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/** API key 环境变量名称映射 */
const API_KEY_NAMES = {
  mimo: "MiMo_KEY",
  gemini: "GEMINI_KEY",
  openrouter: "Openrouter_KEY",
  siliconflow: "siliconflow_Key",
};

/** 获取 API key */
export function getApiKey(provider) {
  const envKey = API_KEY_NAMES[provider];
  if (!envKey) {
    console.warn(`[env.mjs] Unknown provider: ${provider}`);
    return "";
  }
  return process.env[envKey] || "";
}
