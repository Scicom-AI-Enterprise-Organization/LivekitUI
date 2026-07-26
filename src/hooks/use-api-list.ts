"use client";

import { useCallback, useEffect, useState } from "react";

interface ServiceNotice {
  message: string;
  reason: string;
}

/**
 * Fetches a list endpoint and unpacks the three states these routes can return:
 * data, a plain error, or a 503 saying the LiveKit service behind it isn't
 * running (egress / ingress / SIP each need Redis and their own process).
 */
export function useApiList<T>(url: string, key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ServiceNotice | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setItems(Array.isArray(data[key]) ? data[key] : []);
        return;
      }
      setItems([]);
      if (data.serviceAvailable === false) {
        setNotice({ message: data.error || "Service unavailable", reason: data.reason || "" });
      } else {
        setError(data.error || `Request failed (${res.status})`);
      }
    } catch {
      setItems([]);
      setError("Could not reach the dashboard API");
    } finally {
      setLoading(false);
    }
  }, [url, key]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, loading, error, notice, reload };
}
