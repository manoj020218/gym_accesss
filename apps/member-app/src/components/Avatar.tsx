import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { initials } from '../utils/format';

const GRADIENTS: [string, string][] = [
  ['#7C3AED', '#9333EA'],
  ['#0891B2', '#22D3EE'],
  ['#059669', '#10B981'],
  ['#D97706', '#F59E0B'],
  ['#DC2626', '#EF4444'],
  ['#4F46E5', '#6366F1'],
];

function pickGrad(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length]!;
}

interface Props { name: string; size?: number; fontSize?: number; borderRadius?: number; }

export function Avatar({ name, size = 44, fontSize = 16, borderRadius = 12 }: Props) {
  const [from, to] = pickGrad(name);
  return (
    <LinearGradient
      colors={[from, to]}
      style={[s.avatar, { width: size, height: size, borderRadius }]}
    >
      <Text style={[s.text, { fontSize }]}>{initials(name)}</Text>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  text:   { color: '#fff', fontWeight: '800' },
});
