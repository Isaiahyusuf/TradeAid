import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation } from '@tanstack/react-query';
import { tokenService } from '../services/api';

type ScanResult = {
  contract_address: string;
  chain: string;
  symbol: string;
  name: string;
  eligible: boolean;
  eligibility_reason?: string | null;
  scores: {
    rug_probability: number;
    liquidity_stability: number;
    holder_distribution: number;
    smart_wallet_signal: number;
    trade_confidence_index: number;
  };
  market_data?: {
    market_cap_usd?: number;
    liquidity_usd?: number;
    holder_count?: number;
  };
};

export function RugShieldScreen() {
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState('solana');
  const [result, setResult] = useState<ScanResult | null>(null);

  const scanMutation = useMutation<ScanResult, Error, { chain: string; addr: string }>({
    mutationFn: ({ chain, addr }: { chain: string; addr: string }) => 
      tokenService.scan(chain, addr).then((res) => res.data as ScanResult),
    onSuccess: (data: ScanResult) => {
      setResult(data);
    },
    onError: (error) => {
      console.error('Scan error:', error);
    },
  });

  const handleScan = () => {
    if (address.trim()) {
      scanMutation.mutate({ chain, addr: address.trim() });
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return '#22c55e';
    if (score >= 40) return '#eab308';
    return '#ef4444';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 70) return 'SAFE';
    if (score >= 40) return 'CAUTION';
    return 'HIGH RISK';
  };

  // Calculate safety score from token data
  const calculateSafetyScore = (scan: ScanResult): number => {
    const confidence = Number(scan.scores?.trade_confidence_index || 0);
    return Math.max(0, Math.min(100, Math.round(confidence)));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>RugShield</Text>
        <Text style={styles.subtitle}>Scan any token for safety</Text>

        <View style={styles.chainSelector}>
          <TouchableOpacity 
            style={[styles.chainButton, chain === 'solana' && styles.chainButtonActive]}
            onPress={() => setChain('solana')}
          >
            <Text style={[styles.chainButtonText, chain === 'solana' && styles.chainButtonTextActive]}>
              Solana
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.chainButton, chain === 'ethereum' && styles.chainButtonActive]}
            onPress={() => setChain('ethereum')}
          >
            <Text style={[styles.chainButtonText, chain === 'ethereum' && styles.chainButtonTextActive]}>
              Ethereum
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchBox}>
          <TextInput
            style={styles.input}
            placeholder="Enter token address..."
            placeholderTextColor="#6b7280"
            value={address}
            onChangeText={setAddress}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.scanButton, !address.trim() && styles.scanButtonDisabled]}
            onPress={handleScan}
            disabled={!address.trim() || scanMutation.isPending}
          >
            {scanMutation.isPending ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.scanButtonText}>Scan</Text>
            )}
          </TouchableOpacity>
        </View>

        {result && (
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <View>
                <Text style={styles.tokenSymbol}>{result.symbol}</Text>
                <Text style={styles.tokenName}>{result.name}</Text>
              </View>
              <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(calculateSafetyScore(result)) + '20' }]}>
                <Text style={[styles.scoreValue, { color: getScoreColor(calculateSafetyScore(result)) }]}>
                  {calculateSafetyScore(result)}
                </Text>
                <Text style={[styles.scoreLabel, { color: getScoreColor(calculateSafetyScore(result)) }]}>
                  {getScoreLabel(calculateSafetyScore(result))}
                </Text>
              </View>
            </View>

            <View style={styles.checkList}>
              <View style={styles.checkItem}>
                <View style={[styles.checkIcon, (result.market_data?.liquidity_usd || 0) >= 10000 ? styles.checkGood : styles.checkBad]} />
                <Text style={styles.checkText}>Liquidity: ${result.market_data?.liquidity_usd?.toLocaleString() || '0'}</Text>
              </View>
              <View style={styles.checkItem}>
                <View style={[styles.checkIcon, result.scores.rug_probability <= 35 ? styles.checkGood : styles.checkBad]} />
                <Text style={styles.checkText}>Rug Probability: {Math.round(result.scores.rug_probability)}%</Text>
              </View>
              <View style={styles.checkItem}>
                <View style={[styles.checkIcon, result.scores.liquidity_stability >= 60 ? styles.checkGood : styles.checkNeutral]} />
                <Text style={styles.checkText}>Liquidity Stability: {Math.round(result.scores.liquidity_stability)}%</Text>
              </View>
              <View style={styles.checkItem}>
                <View style={[styles.checkIcon, result.eligible ? styles.checkGood : styles.checkNeutral]} />
                <Text style={styles.checkText}>Eligible: {result.eligible ? 'Yes' : 'No'}</Text>
              </View>
            </View>

            <View style={styles.analysisBox}>
              <Text style={styles.analysisLabel}>Token Details</Text>
              <Text style={styles.analysisText}>
                Chain: {result.chain}{'\n'}
                Market Cap: ${result.market_data?.market_cap_usd?.toLocaleString() || 'N/A'}{'\n'}
                Holders: {result.market_data?.holder_count || 'N/A'}{'\n'}
                Confidence: {Math.round(result.scores.trade_confidence_index)}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0a',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  chainSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  chainButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a3f2a',
    backgroundColor: '#1a1f1a',
    alignItems: 'center',
  },
  chainButtonActive: {
    backgroundColor: '#22c55e20',
    borderColor: '#22c55e',
  },
  chainButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  chainButtonTextActive: {
    color: '#22c55e',
  },
  searchBox: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1f1a',
    borderRadius: 12,
    padding: 14,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#2a3f2a',
  },
  scanButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButtonDisabled: {
    opacity: 0.5,
  },
  scanButtonText: {
    color: '#000000',
    fontWeight: '700',
  },
  resultCard: {
    backgroundColor: '#1a1f1a',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a3f2a',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  tokenSymbol: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  tokenName: {
    fontSize: 14,
    color: '#6b7280',
  },
  scoreBadge: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  scoreValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  scoreLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  checkList: {
    gap: 12,
    marginBottom: 20,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkIcon: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  checkGood: {
    backgroundColor: '#22c55e',
  },
  checkBad: {
    backgroundColor: '#ef4444',
  },
  checkNeutral: {
    backgroundColor: '#eab308',
  },
  checkText: {
    fontSize: 14,
    color: '#ffffff',
  },
  analysisBox: {
    backgroundColor: '#0a0f0a',
    borderRadius: 12,
    padding: 16,
  },
  analysisLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#22c55e',
    marginBottom: 8,
  },
  analysisText: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
  },
});
