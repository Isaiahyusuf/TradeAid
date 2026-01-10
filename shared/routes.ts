import { z } from 'zod';
import { 
  insertScannedTokenSchema, 
  insertTrackedWalletSchema, 
  scannedTokens, 
  trackedWallets, 
  walletAlerts,
  trendingCoins
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  rugcheck: {
    scan: {
      method: 'POST' as const,
      path: '/api/rugcheck/scan',
      input: z.object({ address: z.string() }),
      responses: {
        200: z.custom<typeof scannedTokens.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    history: {
      method: 'GET' as const,
      path: '/api/rugcheck/history',
      responses: {
        200: z.array(z.custom<typeof scannedTokens.$inferSelect>()),
      },
    },
  },
  whalewatch: {
    wallets: {
      list: {
        method: 'GET' as const,
        path: '/api/whalewatch/wallets',
        responses: {
          200: z.array(z.custom<typeof trackedWallets.$inferSelect>()),
        },
      },
      create: {
        method: 'POST' as const,
        path: '/api/whalewatch/wallets',
        input: insertTrackedWalletSchema,
        responses: {
          201: z.custom<typeof trackedWallets.$inferSelect>(),
          400: errorSchemas.validation,
        },
      },
      delete: {
        method: 'DELETE' as const,
        path: '/api/whalewatch/wallets/:id',
        responses: {
          204: z.void(),
          404: errorSchemas.notFound,
        },
      },
    },
    alerts: {
      list: {
        method: 'GET' as const,
        path: '/api/whalewatch/alerts',
        responses: {
          200: z.array(z.custom<typeof walletAlerts.$inferSelect & { walletLabel: string }>()),
        },
      },
    },
  },
  memetrend: {
    list: {
      method: 'GET' as const,
      path: '/api/memetrend/list',
      responses: {
        200: z.array(z.custom<typeof trendingCoins.$inferSelect>()),
      },
    },
    analyze: {
      method: 'POST' as const,
      path: '/api/memetrend/analyze',
      input: z.object({ symbol: z.string() }),
      responses: {
        200: z.object({
          sentiment: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
          score: z.number(),
          summary: z.string(),
        }),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
