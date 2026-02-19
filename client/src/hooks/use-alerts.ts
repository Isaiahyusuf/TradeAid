import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch } from "@/lib/api";

export type Alert = {
  id: string;
  alert_type: string;
  chain: string;
  severity: string;
  title: string;
  message: string;
  contract_address: string;
  is_read: boolean;
  created_at: string;
};

export function useAlerts(params?: { chain?: string; alert_type?: string; severity?: string }) {
  const queryString = new URLSearchParams();
  if (params?.chain) queryString.set("chain", params.chain);
  if (params?.alert_type) queryString.set("alert_type", params.alert_type);
  if (params?.severity) queryString.set("severity", params.severity);
  const qs = queryString.toString();

  return useQuery({
    queryKey: ["alerts", params],
    queryFn: () => apiGet<{ alerts: Alert[]; count: number }>(`/api/alerts${qs ? `?${qs}` : ""}`),
    refetchInterval: 30000,
  });
}

export function useCreateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      alert_type: string;
      chain: string;
      title: string;
      message?: string;
      severity?: string;
      contract_address?: string;
    }) => {
      return apiPost("/api/alerts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      return apiPatch(`/api/alerts/${alertId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}
