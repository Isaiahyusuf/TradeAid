import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type ScanTokenRequest } from "@shared/routes";

export function useScanToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: ScanTokenRequest) => {
      const res = await fetch(api.rugcheck.scan.path, {
        method: api.rugcheck.scan.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.rugcheck.scan.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error('Failed to scan token');
      }
      return api.rugcheck.scan.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.rugcheck.history.path] });
    },
  });
}

export function useScanHistory() {
  return useQuery({
    queryKey: [api.rugcheck.history.path],
    queryFn: async () => {
      const res = await fetch(api.rugcheck.history.path);
      if (!res.ok) throw new Error('Failed to fetch scan history');
      return api.rugcheck.history.responses[200].parse(await res.json());
    },
  });
}
