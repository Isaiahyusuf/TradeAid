import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertTrackedWallet } from "@shared/schema";

export function useTrackedWallets() {
  return useQuery({
    queryKey: [api.whalewatch.wallets.list.path],
    queryFn: async () => {
      const res = await fetch(api.whalewatch.wallets.list.path);
      if (!res.ok) throw new Error('Failed to fetch wallets');
      return api.whalewatch.wallets.list.responses[200].parse(await res.json());
    },
  });
}

export function useAddWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertTrackedWallet) => {
      const res = await fetch(api.whalewatch.wallets.create.path, {
        method: api.whalewatch.wallets.create.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.whalewatch.wallets.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error('Failed to add wallet');
      }
      return api.whalewatch.wallets.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.whalewatch.wallets.list.path] });
    },
  });
}

export function useDeleteWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.whalewatch.wallets.delete.path, { id });
      const res = await fetch(url, { method: api.whalewatch.wallets.delete.method });
      if (!res.ok) throw new Error('Failed to delete wallet');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.whalewatch.wallets.list.path] });
    },
  });
}

export function useWalletAlerts() {
  return useQuery({
    queryKey: [api.whalewatch.alerts.list.path],
    queryFn: async () => {
      const res = await fetch(api.whalewatch.alerts.list.path);
      if (!res.ok) throw new Error('Failed to fetch alerts');
      return api.whalewatch.alerts.list.responses[200].parse(await res.json());
    },
  });
}
