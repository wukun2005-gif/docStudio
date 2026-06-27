#!/bin/bash
# Bailian 诊断脚本：通过本地 server /api/chat 接口测试不同模型和输入规模
# 优点：credentials 始终在 server 内部，不暴露给脚本

SERVER="http://localhost:3000"

# 检查 server 是否在跑
if ! curl -sS "$SERVER/api/chat/templates" > /dev/null 2>&1; then
  echo "ERROR: server 未运行在 $SERVER"
  exit 1
fi

call_chat() {
  local label="$1"
  local model="$2"
  local message="$3"
  local timeout_ms="$4"

  echo ""
  echo "[$label] model=$model, message.length=${#message}, timeout=${timeout_ms}ms"
  local start=$(date +%s)

  # 转义 JSON 特殊字符
  local escaped=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$message")

  local result
  result=$(curl -sS --max-time $((timeout_ms/1000)) -X POST "$SERVER/api/chat" \
    -H "Content-Type: application/json" \
    -d "{\"message\":$escaped,\"modelId\":\"$model\",\"providerPreference\":[\"bailian\"]}" 2>&1)
  local status=$?
  local end=$(date +%s)
  local duration=$(( (end - start) * 1000 ))

  if [ $status -eq 28 ]; then
    echo "[$label] CURL TIMEOUT after ${duration}ms"
    return
  fi
  if [ $status -ne 0 ]; then
    echo "[$label] CURL ERROR (status=$status) after ${duration}ms: $result"
    return
  fi

  echo "[$label] 完成 ${duration}ms"
  # 提取响应内容长度
  echo "$result" | python3 -c "
import json,sys
try:
  data = json.load(sys.stdin)
  msg = data.get('content', '') or data.get('message', '') or ''
  err = data.get('error', '')
  ok = data.get('ok', False)
  if err: print(f'[$label] ERROR: {err}')
  print(f'[$label] ok={ok} response.length={len(msg)}, preview: {msg[:300]}')
except Exception as e:
  print(f'[$label] parse failed: {e}')
" 2>&1 | sed "s/\[$label\]/[$label]/g"
}

# 长文本（约 25K 字符 ≈ 12K tokens）
LONG_TEXT=$(python3 -c "print('这是一段关于人工智能技术应用的测试内容。人工智能正在改变世界。' * 800)")
echo "长文本长度: ${#LONG_TEXT} 字符"

# T1: 小输入 sanity check
call_chat "T1-small-kimi" "kimi-k2.7-code" "你好，请用一句话介绍自己" 30000

# T2: 中等输入（评估场景）
call_chat "T2-medium-kimi" "kimi-k2.7-code" "请判断以下文本是否与'AI'相关：$LONG_TEXT" 180000

# T3: qwen-plus 对照
call_chat "T3-medium-qwen-plus" "qwen-plus" "请判断以下文本是否与'AI'相关：$LONG_TEXT" 180000

# T4: qwen-turbo 对照（最快）
call_chat "T4-medium-qwen-turbo" "qwen-turbo" "请判断以下文本是否与'AI'相关：$LONG_TEXT" 180000

echo ""
echo "诊断完成"
