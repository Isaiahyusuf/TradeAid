import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { trendService } from '../services/api';

export function MemeTrendScreen() {
  const { data: tokensData, isLoading, refetch } = useQuery({
    queryKey: ['memetrend'],
    queryFn: () => trendService.getList().then((res: any) => res.data?.tokens || []),
  });

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const formatNumber = (num?: number) => {
    if (!num) return 'N/A';
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Token Trends</Text>
      <Text style={styles.subtitle}>Discover trending tokens</Text>

      <FlatList
        data={tokensData}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }) => (
          <View style={styles.trendCard}>
            <View style={styles.trendHeader}>
              <View>
                <Text style={styles.symbol}>{item.symbol}</Text>
                <Text style={styles.name}>{item.name}</Text>
              </View>
              <View style={styles.chainBadge}>
                <Text style={styles.chainText}>{item.chain}</Text>
              </View>
            </View>
            
            <View style={styles.trendStats}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Price</Text>
                <Text style={styles.statValue}>{item.price_usd ? `$${parseFloat(item.price_usd).toFixed(8)}` : 'N/A'}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Market Cap</Text>
                <Text style={styles.statValue}>{formatNumber(item.market_cap_usd)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Liquidity</Text>
                <Text style={styles.statValue}>{formatNumber(item.liquidity_usd)}</Text>
              </View>
            </View>
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No tokens found</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0a',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  trendCard: {
    backgroundColor: '#1a1f1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a3f2a',
  },
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  symbol: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  name: {
    fontSize: 14,
    color: '#6b7280',
  },
  chainBadge: {
    backgroundColor: '#22c55e20',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  chainText: {
    fontSize: 12,
    color: '#22c55e',
    textTransform: 'capitalize',
    fontWeight: '600',
  },
  trendStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
});
