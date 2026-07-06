const fs = require('fs');
const path = require('path');

// Need to use ESM imports since the project is ESM
async function main() {
  // Dynamic import for ESM modules
  const { ingestFile } = await import('./server/dist/lib/ingestion.js');
  const { readSettingsFromDb } = await import('./server/dist/lib/settingsReader.js');

  const dbSettings = readSettingsFromDb();
  const embeddingConfig = dbSettings.knowledgeEmbedding ? {
    baseUrl: dbSettings.knowledgeEmbedding.baseUrl.replace(/\/+$/, ""),
    apiKey: dbSettings.knowledgeEmbedding.apiKey,
    modelId: dbSettings.knowledgeEmbedding.modelId,
  } : undefined;

  const files = [
    {
      filePath: '/Users/wukun/Documents/tmp/docStudio/samples/q3-report/Q3-技术架构演进报告.docx',
      fileName: 'Q3-技术架构演进报告.docx',
      sourceType: 'local_file',
    },
    {
      filePath: '/Users/wukun/Documents/tmp/docStudio/samples/q3-report/Q3-GitHub开发活跃度报告.docx',
      fileName: 'Q3-GitHub开发活跃度报告.docx',
      sourceType: 'local_file',
    },
    {
      filePath: '/Users/wukun/Documents/tmp/docStudio/samples/q3-report/Q3-协作效能分析报告.docx',
      fileName: 'Q3-协作效能分析报告.docx',
      sourceType: 'local_file',
    },
  ];

  for (const f of files) {
    const content = fs.readFileSync(f.filePath);
    console.log(`Importing: ${f.fileName} (${content.length} bytes)`);
    const result = await ingestFile({
      content,
      fileName: f.fileName,
      sourceType: f.sourceType,
      filePath: f.filePath,
      embedding: embeddingConfig,
    });
    console.log(`  Result: ${result.status}, chunks=${result.chunkCount}, embedded=${result.embeddedCount}`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
