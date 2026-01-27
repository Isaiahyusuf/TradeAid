import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation } from '@tanstack/react-query';
import { tokenService } from '../services/api';
import type { Token } from '../types';

export function RugShieldScreen() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<Token | null>(null);

  const scanMutation = useMutation({
    mutationFn: (addr: string) => tokenService.scan(addr).then(res => res.data),
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (error) => {
      console.error('Scan error:', error);
    },
  });

  const handleScan = () => {
    if (address.trim()) {
      scanMutation.mutate(address.trim());
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>RugShield</Text>
        <Text style={styles.subtitle}>Scan any token for safety</Text>

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
              <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(result.safetyScore) + '20' }]}>
                <Text style={[styles.scoreValue, { color: getScoreColor(result.safetyScore) }]}>
                  {result.safetyScore}
                </Text>
                <Text style={[styles.scoreLabel, { color: getScoreColor(result.safetyScore) }]}>
                  {getScoreLabel(result.safetyScore)}
                </Text>
              </View>
            </View>

            <View style={styles.checkList}>
              <View style={styles.checkItem}>
                <View style={[styles.checkIcon, result.liquidity >= 10000 ? styles.checkGood : styles.checkBad]} />
                <Text style={styles.checkText}>Liquidity: ${result.liquidity?.toLocaleString()}</Text>
              </View>
              <View style={styles.checkItem}>
                <View style={[styles.checkIcon, !result.isHoneypot ? styles.checkGood : styles.checkBad]} />
                <Text style={styles.checkText}>Honeypot: {result.isHoneypot ? 'Yes' : 'No'}</Text>
              </View>
              <View style={styles.checkItem}>
                <View style={[styles.checkIcon, result.mintAuthorityDisabled ? styles.checkGood : styles.checkNeutral]} />
                <Text style={styles.checkText}>Mint Disabled: {result.mintAuthorityDisabled ? 'Yes' : 'No'}</Text>
              </View>
              <View style={styles.checkItem}>
                <View style={[styles.checkIcon, result.isLiquidityLocked ? styles.checkGood : styles.checkNeutral]} />
                <Text style={styles.checkText}>Liquidity Locked: {result.isLiquidityLocked ? 'Yes' : 'No'}</Text>
              </View>
            </View>

            {result.aiAnalysis && (
              <View style={styles.analysisBox}>
                <Text style={styles.analysisLabel}>AI Analysis</Text>
                <Text style={styles.analysisText}>{result.aiAnalysis}</Text>
              </View>
            )}
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
    marginBottom: 20,
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
