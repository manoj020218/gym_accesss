import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Variant = 'active' | 'expired' | 'frozen' | 'pending' | 'blocked' | 'allow' | 'deny';

const STYLES: Record<Variant, { bg: string; text: string; border: string }> = {
  active:  { bg: 'rgba(16,185,129,0.15)', text: '#34D399', border: 'rgba(16,185,129,0.25)' },
  expired: { bg: 'rgba(248,113,113,0.15)', text: '#F87171', border: 'rgba(248,113,113,0.25)' },
  frozen:  { bg: 'rgba(34,211,238,0.15)',  text: '#22D3EE', border: 'rgba(34,211,238,0.25)' },
  pending: { bg: 'rgba(245,158,11,0.15)', text: '#FBBF24', border: 'rgba(245,158,11,0.25)' },
  blocked: { bg: 'rgba(239,68,68,0.12)',  text: '#EF4444', border: 'rgba(239,68,68,0.25)' },
  allow:   { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'transparent' },
  deny:    { bg: 'rgba(248,113,113,0.12)', text: '#F87171', border: 'transparent' },
};

export function StatusBadge({ status, dot = false }: { status: string; dot?: boolean }) {
  const v = STYLES[status as Variant] ?? STYLES.pending;
  return (
    <View style={[s.badge, { backgroundColor: v.bg, borderColor: v.border }]}>
      {dot && <View style={[s.dot, { backgroundColor: v.text }]} />}
      <Text style={[s.text, { color: v.text }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100, borderWidth: 1 },
  dot:   { width: 6, height: 6, borderRadius: 3 },
  text:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
});
