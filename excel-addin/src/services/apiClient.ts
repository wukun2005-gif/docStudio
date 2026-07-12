/**
 * apiClient.ts — HTTP API 客户端
 *
 * 封装 axios，统一错误处理。
 * API 调用走 i-Write Server (localhost:3000)。
 */
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// 统一错误处理：API 错误在 Chat 中以 AI 回复形式展示
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error ??
      error.response?.data?.message ??
      error.message ??
      '未知错误';

    return Promise.reject(new Error(message));
  }
);

/**
 * 调用 /api/chat
 */
export async function postChat(message: string, context?: string) {
  const { data } = await apiClient.post('/chat', {
    message,
    context: { documentContent: context ?? '' },
  });
  return data;
}
