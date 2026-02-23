import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Circle } from 'react-native-svg';

type TradeAidLogoProps = {
  size?: number;
  withText?: boolean;
};

export function TradeAidLogo({ size = 34, withText = true }: TradeAidLogoProps) {
  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <LinearGradient id="taGradientMobile" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#22c55e" />
            <Stop offset="0.58" stopColor="#14b8a6" />
            <Stop offset="1" stopColor="#9945FF" />
          </LinearGradient>
        </Defs>
        <Rect x="4" y="4" width="56" height="56" rx="16" fill="#0b1110" stroke="url(#taGradientMobile)" strokeWidth="3" />
        <Path d="M16 40L26 30L34 36L48 20" fill="none" stroke="url(#taGradientMobile)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx="16" cy="40" r="2.5" fill="#22c55e" />
        <Circle cx="26" cy="30" r="2.5" fill="#14b8a6" />
        <Circle cx="34" cy="36" r="2.5" fill="#22c55e" />
        <Circle cx="48" cy="20" r="2.5" fill="#9945FF" />
      </Svg>

      {withText && (
        <Text style={styles.wordmark}>
          <Text style={styles.trade}>Trade</Text> Aid
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  wordmark: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  trade: {
    color: '#22c55e',
  },
});
