import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { trendService } from '../services/api';
import type { TrendingCoin } from '../types';

export function MemeTrendScreen() {
  const { data: trends, isLoading, refetch } = useQuery({
    queryKey: ['memetrend'],
    queryFn: () => trendService.getList().then(res => res.data),
  });

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'UP': return '↗';
      case 'DOWN': return '↘';
      default: return '→';
    }
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'UP': return '#22c55e';
      case 'DOWN': return '#ef4444';
      default: return '#eab308';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Meme Trends</Text>
      <Text style={styles.subtitle}>Social sentiment analysis</Text>

      <FlatList
        data={trends}
        keyExtractor={(item: TrendingCoin) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.trendCard}>
            <View style={styles.trendHeader}>
              <View>
                <Text style={styles.symbol}>{item.symbol}</Text>
                <Text style={styles.name}>{item.name}</Text>
              </View>
              <View style={styles.hypeScore}>
                <Text style={styles.hypeLabel}>Hype</Text>
                <Text style={styles.hypeValue}>{item.hypeScore}</Text>
              </View>
            </View>
            
            <View style={styles.trendStats}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Price</Text>
                <Text style={styles.statValue}>${item.price}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Volume 24h</Text>
                <Text style={styles.statValue}>{item.volume24h}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Trend</Text>
                <Text style={[styles.trendValue, { color: getTrendColor(item.trend) }]}>
                  {getTrendIcon(item.trend)} {item.trend}
                </Text>
              </View>
            </View>
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />
        }
        contentContainerStyle={styles.list}
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
  hypeScore: {
    alignItems: 'center',
    backgroundColor: '#22c55e20',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  hypeLabel: {
    fontSize: 10,
    color: '#22c55e',
  },
  hypeValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#22c55e',
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
  trendValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
});
