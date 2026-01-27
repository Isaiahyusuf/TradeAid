import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { Token } from '../types';

interface TokenCardProps {
  token: Token;
  onPress?: () => void;
}

export function TokenCard({ token, onPress }: TokenCardProps) {
  const getRiskColor = (level: string) => {
    switch (level) {
      case 'low': return '#22c55e';
      case 'medium': return '#eab308';
      case 'high': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'buy': return '#22c55e';
      case 'sell': return '#ef4444';
      case 'hold': return '#eab308';
      default: return '#6b7280';
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={styles.tokenInfo}>
          <Text style={styles.symbol}>{token.symbol}</Text>
          <Text style={styles.name} numberOfLines={1}>{token.name}</Text>
        </View>
        <View style={[styles.scoreBadge, { backgroundColor: getRiskColor(token.riskLevel) + '20' }]}>
          <Text style={[styles.scoreText, { color: getRiskColor(token.riskLevel) }]}>
            {token.safetyScore}
          </Text>
        </View>
      </View>

      <View style={styles.priceRow}>
        <Text style={styles.price}>{token.priceUsd ? `$${parseFloat(token.priceUsd).toFixed(8)}` : 'N/A'}</Text>
        <Text style={[styles.change, { color: token.priceChange24h >= 0 ? '#22c55e' : '#ef4444' }]}>
          {token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h?.toFixed(2)}%
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Liquidity</Text>
          <Text style={styles.statValue}>{formatNumber(token.liquidity)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Volume 24h</Text>
          <Text style={styles.statValue}>{formatNumber(token.volume24h)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Signal</Text>
          <Text style={[styles.signal, { color: getSignalColor(token.aiSignal) }]}>
            {token.aiSignal?.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.chainBadge}>
        <Text style={styles.chainText}>{token.chain}</Text>
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
  chainBadge: {
    alignSelf: 'flex-start',
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
});
