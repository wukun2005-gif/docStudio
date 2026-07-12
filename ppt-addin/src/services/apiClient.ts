import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

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

export async function postChat(message: string, context?: string, format?: string) {
  const { data } = await apiClient.post('/chat', {
    message,
    context: { documentContent: context ?? '' },
    format,
  });
  return data;
}
