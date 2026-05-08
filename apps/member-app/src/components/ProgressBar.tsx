import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GRAD } from '../theme';

interface Props { percent: number; height?: number; color?: [string, string]; }

export function ProgressBar({ percent, height = 5, color = GRAD }: Props) {
  return (
    <View style={[s.track, { height }]}>
      <LinearGradient
        colors={color}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[s.fill, { width: `${Math.min(100, Math.max(0, percent))}%` }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  track: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 3 },
});
