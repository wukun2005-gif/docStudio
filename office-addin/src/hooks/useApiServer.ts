/**
 * useApiServer.ts — API 服务连通性 Hook
 *
 * 检测 i-Write Server 是否可达。
 */
import { useState, useEffect } from 'react';
import { apiClient } from '../services/apiClient';

export function useApiServer(): { reachable: boolean; checking: boolean } {
  const [reachable, setReachable] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    apiClient
      .get('/settings')
      .then(() => setReachable(true))
      .catch(() => setReachable(false))
      .finally(() => setChecking(false));
  }, []);

  return { reachable, checking };
}
