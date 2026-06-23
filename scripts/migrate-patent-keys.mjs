#!/usr/bin/env node
/**
 * 从 patentExaminator 数据库迁移 API key 到 i-Write
 *
 * patentExaminator 格式: sync_data 表 (store_name='settings', record_id='app')
 * i-Write 格式: user_settings 表 (key='provider_all')
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_DB = path.resolve("/Users/wukun/Documents/tmp/patentExaminator/server/data/patent-examiner.db");
const DST_DB = path.resolve(__dirname, "../server/data/docstudio.db");

console.log("=== 迁移 patentExaminator API Keys ===");
console.log(`源数据库: ${SRC_DB}`);
console.log(`目标数据库: ${DST_DB}`);

// 读取源数据库
const srcDb = new Database(SRC_DB, { readonly: true });
const srcRow = srcDb.prepare("SELECT data FROM sync_data WHERE store_name = 'settings' AND record_id = 'app'").get();
srcDb.close();

if (!srcRow) {
  console.error("源数据库中未找到 settings/app 数据");
  process.exit(1);
}

const srcData = JSON.parse(srcRow.data);
console.log("\n=== 源数据 ===");
console.log("providers:", Object.keys(srcData.providers || {}));
console.log("searchProviders:", (srcData.searchProviders || []).map(p => `${p.providerId}(enabled=${p.enabled})`));
console.log("knowledgeProviders:", (srcData.knowledgeProviders || []).map(p => `${p.providerType}/${p.providerId}(enabled=${p.enabled})`));
console.log("knowledge:", srcData.knowledge);
console.log("enableProviderFallback:", srcData.enableProviderFallback);

// 读取目标数据库
const dstDb = new Database(DST_DB);
const dstRow = dstDb.prepare("SELECT value FROM user_settings WHERE key = 'provider_all'").get();

let dstData;
if (dstRow) {
  dstData = JSON.parse(dstRow.value);
  console.log("\n=== 目标现有数据 ===");
  console.log("providers:", (dstData.providers || []).map(p => `${p.providerId}`));
  console.log("searchProviders:", (dstData.searchProviders || []).length, "个");
  console.log("knowledgeProviders:", (dstData.knowledgeProviders || []).length, "个");
} else {
  dstData = { providers: [], enableProviderFallback: true, searchProviders: [], knowledgeProviders: [], knowledge: { enabled: false } };
  console.log("\n目标数据库中无 provider_all，将创建新记录");
}

// 合并 LLM providers: 保留目标已有的，从源补充 key
const srcProviders = srcData.providers || {};
const dstProviders = dstData.providers || [];

for (const [, srcProv] of Object.entries(srcProviders)) {
  const pid = srcProv.providerId || srcProv.id;
  const srcKey = srcProv.apiKeyRef || srcProv.apiKey || "";
  const existing = dstProviders.find(p => p.providerId === pid);
  if (existing) {
    // 如果目标没有 key，从源复制
    if (!existing.apiKey && !existing.apiKeyRef && srcKey) {
      existing.apiKey = srcKey;
      existing.apiKeyRef = srcKey;
      console.log(`  LLM ${pid}: 复制 key`);
    }
    if (srcProv.baseUrl && !existing.baseUrl) {
      existing.baseUrl = srcProv.baseUrl;
    }
    if (srcProv.models?.length && !existing.modelIds?.length) {
      existing.modelIds = srcProv.models;
      existing.defaultModelId = srcProv.defaultModelId || srcProv.models[0];
    }
    if (srcProv.enabled !== undefined) {
      existing.enabled = srcProv.enabled;
    }
  } else {
    // 新增
    dstProviders.push({
      providerId: pid,
      apiKey: srcKey,
      apiKeyRef: srcKey,
      baseUrl: srcProv.baseUrl || "",
      enabled: srcProv.enabled ?? false,
      modelIds: srcProv.modelIds || srcProv.models || [],
      defaultModelId: srcProv.defaultModelId || srcProv.models?.[0] || "",
      modelFallbacks: srcProv.modelFallbacks || [],
      enableModelFallback: srcProv.enableModelFallback ?? false,
    });
    console.log(`  LLM ${pid}: 新增 (hasKey=${!!srcKey})`);
  }
}

// 合并 search providers
const srcSearch = srcData.searchProviders || [];
const dstSearch = dstData.searchProviders || [];

for (const srcSp of srcSearch) {
  const srcKey = srcSp.apiKeyRef || srcSp.apiKey || "";
  const existing = dstSearch.find(s => s.providerId === srcSp.providerId);
  if (existing) {
    if (!existing.apiKeyRef && srcKey) {
      existing.apiKeyRef = srcKey;
      console.log(`  Search ${srcSp.providerId}: 复制 key`);
    }
    if (srcSp.baseUrl && !existing.baseUrl) {
      existing.baseUrl = srcSp.baseUrl;
    }
    existing.enabled = srcSp.enabled ?? existing.enabled;
  } else {
    dstSearch.push({
      providerId: srcSp.providerId,
      name: srcSp.name || srcSp.providerId,
      apiKeyRef: srcKey,
      apiKey2Ref: srcSp.apiKey2Ref || "",
      baseUrl: srcSp.baseUrl || "",
      enabled: srcSp.enabled ?? false,
    });
    console.log(`  Search ${srcSp.providerId}: 新增 (hasKey=${!!srcKey})`);
  }
}

// 合并 knowledge providers
const srcKnowledge = srcData.knowledgeProviders || [];
const dstKnowledge = dstData.knowledgeProviders || [];

for (const srcKp of srcKnowledge) {
  const key = `${srcKp.providerType}-${srcKp.providerId}`;
  const srcKey = srcKp.apiKeyRef || srcKp.apiKey || "";
  const existing = dstKnowledge.find(k => k.providerType === srcKp.providerType && k.providerId === srcKp.providerId);
  if (existing) {
    if (!existing.apiKeyRef && srcKey) {
      existing.apiKeyRef = srcKey;
      console.log(`  Knowledge ${key}: 复制 key`);
    }
    if (srcKp.baseUrl && !existing.baseUrl) existing.baseUrl = srcKp.baseUrl;
    if (srcKp.modelId && !existing.modelId) existing.modelId = srcKp.modelId;
    existing.enabled = srcKp.enabled ?? existing.enabled;
  } else {
    dstKnowledge.push({
      providerType: srcKp.providerType,
      providerId: srcKp.providerId,
      displayName: srcKp.displayName || `${srcKp.providerType}/${srcKp.providerId}`,
      baseUrl: srcKp.baseUrl || "",
      apiKeyRef: srcKey,
      modelId: srcKp.modelId || "",
      availableModels: srcKp.availableModels || [],
      enabled: srcKp.enabled ?? false,
    });
    console.log(`  Knowledge ${key}: 新增 (hasKey=${!!srcKey})`);
  }
}

// knowledge 配置
if (srcData.knowledge) {
  dstData.knowledge = { ...dstData.knowledge, ...srcData.knowledge };
}

// enableProviderFallback
if (srcData.enableProviderFallback !== undefined) {
  dstData.enableProviderFallback = srcData.enableProviderFallback;
}

// 写入目标数据库
dstData.providers = dstProviders;
dstData.searchProviders = dstSearch;
dstData.knowledgeProviders = dstKnowledge;

dstDb.prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES ('provider_all', ?, datetime('now'))").run(JSON.stringify(dstData));
dstDb.close();

console.log("\n=== 迁移完成 ===");
console.log("providers:", dstProviders.length);
console.log("searchProviders:", dstSearch.length);
console.log("knowledgeProviders:", dstKnowledge.length);
