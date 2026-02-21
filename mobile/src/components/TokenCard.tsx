import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { Token } from '../types';

interface TokenCardProps {
  token: Token;
  onPress?: () => void;
}

export function TokenCard({ token, onPress }: TokenCardProps) {
  const getRiskColor = (level?: string) => {
    if (!level) return '#6b7280';
    switch (level.toLowerCase()) {
      case 'low': return '#22c55e';
      case 'medium': return '#eab308';
      case 'high': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const formatNumber = (num?: number) => {
    if (!num) return 'N/A';
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  };

  const getSafetyScore = () => {
    if (token.safety_score) return token.safety_score;
    // Calculate from liquidity if not available
    if (token.liquidity_usd && token.liquidity_usd > 50000) return 75;
    if (token.liquidity_usd && token.liquidity_usd > 10000) return 50;
    return 25;
  };

  const safetyScore = getSafetyScore();

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={styles.tokenInfo}>
          <Text style={styles.symbol}>{token.symbol}</Text>
          <Text style={styles.name} numberOfLines={1}>{token.name}</Text>
        </View>
        <View style={[styles.scoreBadge, { backgroundColor: getRiskColor(token.risk_level) + '20' }]}>
          <Text style={[styles.scoreText, { color: getRiskColor(token.risk_level) }]}>
            {safetyScore}
          </Text>
        </View>
      </View>

      <View style={styles.priceRow}>
        <Text style={styles.price}>{token.price_usd ? `$${parseFloat(token.price_usd).toFixed(8)}` : 'N/A'}</Text>
        {token.price_change_24h !== undefined && (
          <Text style={[styles.change, { color: token.price_change_24h >= 0 ? '#22c55e' : '#ef4444' }]}>
            {token.price_change_24h >= 0 ? '+' : ''}{token.price_change_24h.toFixed(2)}%
          </Text>
        )}
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Liquidity</Text>
          <Text style={styles.statValue}>{formatNumber(token.liquidity_usd)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Market Cap</Text>
          <Text style={styles.statValue}>{formatNumber(token.market_cap_usd)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Holders</Text>
          <Text style={styles.statValue}>{token.holder_count || 'N/A'}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.chainBadge}>
          <Text style={styles.chainText}>{token.chain}</Text>
        </View>
        {token.is_honeypot && (
          <View style={styles.warningBadge}>
            <Text style={styles.warningText}>⚠️ HONEYPOT</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1f1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a3f2a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  tokenInfo: {
    flex: 1,
  },
  symbol: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  name: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
  },
  scoreBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  scoreText: {
    fontSize: 16,
    fontWeight: '700',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  price: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  change: {
    fontSize: 14,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  stat: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 2,
  },
  signal: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chainBadge: {
    backgroundColor: '#22c55e20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chainText: {
    fontSize: 12,
    color: '#22c55e',
    textTransform: 'capitalize',
  },
  warningBadge: {
    backgroundColor: '#ef444420',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  warningText: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '700',
  },
});
