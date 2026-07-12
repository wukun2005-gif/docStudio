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
