/**
 * 测试知识库文件预览 API
 */
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";

const TEST_SOURCE_ID = "cba04966-ccbe-421a-807e-d81df604f322";

let server;
try {
  console.log("启动隔离服务器...");
  server = await startIsolatedServer({ copyProductionDb: true });
  console.log(`服务器已启动: ${server.baseUrl}`);

  // 直接测试文件预览 API
  const fileUrl = `${server.baseUrl}/api/knowledge/sources/${TEST_SOURCE_ID}/file`;
  console.log(`\n请求: ${fileUrl}`);

  const fileRes = await fetch(fileUrl);
  console.log(`状态: ${fileRes.status} ${fileRes.statusText}`);
  console.log(`Content-Type: ${fileRes.headers.get("content-type")}`);
  console.log(`Content-Disposition: ${fileRes.headers.get("content-disposition")}`);

  const body = await fileRes.text();
  console.log(`响应长度: ${body.length} 字节`);

  if (fileRes.status !== 200) {
    console.log(`\n❌ 失败，响应内容:`);
    console.log(body);
    dumpServerLog();
  } else {
    console.log(`\n✅ API 返回 200，前 200 字符:`);
    console.log(body.substring(0, 200));
  }
} catch (err) {
  console.error("测试异常:", err.message);
  if (server) dumpServerLog();
} finally {
  if (server) {
    console.log("\n清理服务器...");
    await server.cleanup();
  }
}
