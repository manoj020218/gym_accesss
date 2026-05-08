import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '../../src/components/Screen';
import { StatusBadge } from '../../src/components/StatusBadge';
import { useAuthStore } from '../../src/store/auth';
import { memberApi } from '../../src/api/member';
import { C, S } from '../../src/theme';
import { fmtDatetime, fmtRelative } from '../../src/utils/format';

const ZONE_LABELS: Record<string, string> = {
  MAIN_FLOOR:   'Main Floor',
  CARDIO_AREA:  'Cardio Area',
  WEIGHTS_ROOM: 'Weights Room',
  POOL:         'Pool',
  SAUNA:        'Sauna',
  CROSSFIT_BOX: 'CrossFit Box',
  YOGA_STUDIO:  'Yoga Studio',
  SPIN_CLASS:   'Spin Class',
  BASKETBALL:   'Basketball',
  RECEPTION:    'Reception',
};

const LIMITS = [20, 50, 100];

function groupByDate(events: any[]): { label: string; items: any[] }[] {
  const map = new Map<string, any[]>();
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();

  for (const ev of events) {
    const d = new Date(ev.eventTime).toDateString();
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(ev.eventTime).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(ev);
  }

  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

export default function HistoryScreen() {
  const { memberId } = useAuthStore();
  const [filter, setFilter] = useState<'all' | 'allow' | 'deny'>('all');
  const [limit, setLimit]   = useState(20);

  const { data: history, refetch, isRefetching } = useQuery({
    queryKey: ['member-history-full', memberId, limit],
    queryFn:  () => memberApi.getAccessHistory(memberId!, limit),
    enabled:  !!memberId,
    refetchInterval: 60_000,
  });

  const events = history?.data ?? [];
  const filtered = filter === 'all' ? events : events.filter((e) => e.decision === (filter === 'allow' ? 'ALLOW' : 'DENY'));
  const groups   = groupByDate(filtered);

  const allowCount = events.filter((e) => e.decision === 'ALLOW').length;
  const denyCount  = events.filter((e) => e.decision === 'DENY').length;

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Access History</Text>
        <Text style={s.subtitle}>Last {limit} events</Text>
      </View>

      {/* Summary chips */}
      <View style={s.summaryRow}>
        <View style={[s.summaryChip, { borderColor: C.success + '44' }]}>
          <Text style={[s.summaryVal, { color: C.success }]}>{allowCount}</Text>
          <Text style={s.summaryLbl}>Allowed</Text>
        </View>
        <View style={[s.summaryChip, { borderColor: C.danger + '44' }]}>
          <Text style={[s.summaryVal, { color: C.danger }]}>{denyCount}</Text>
          <Text style={s.summaryLbl}>Denied</Text>
        </View>
        <View style={[s.summaryChip, { borderColor: C.primary + '44' }]}>
          <Text style={[s.summaryVal, { color: C.primary }]}>{events.length}</Text>
          <Text style={s.summaryLbl}>Total</Text>
        </View>
      </View>

      {/* Filter tabs */}
      <View style={s.filterRow}>
        {(['all', 'allow', 'deny'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[s.filterBtn, filter === f && s.filterBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[s.filterText, filter === f && s.filterTextActive]}>
              {f === 'all' ? 'All' : f === 'allow' ? '✓ Allowed' : '✕ Denied'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Events grouped by date */}
      <View style={s.section}>
        {groups.length === 0 ? (
          <View style={S.card}>
            <Text style={s.emptyText}>No access events found</Text>
          </View>
        ) : (
          groups.map(({ label, items }) => (
            <View key={label} style={s.group}>
              <Text style={s.groupLabel}>{label}</Text>
              <View style={S.card}>
                {items.map((ev, i) => (
                  <View key={ev._id} style={[s.row, i > 0 && s.rowBorder]}>
                    {/* Left dot */}
                    <View style={[s.dot, { backgroundColor: ev.decision === 'ALLOW' ? C.success : C.danger }]} />
                    {/* Details */}
                    <View style={{ flex: 1 }}>
                      <Text style={s.zone}>{ZONE_LABELS[ev.zone] ?? ev.zone.replace(/_/g, ' ')}</Text>
                      <Text style={s.time}>{fmtDatetime(ev.eventTime)}</Text>
                      {ev.decision === 'DENY' && ev.reason && (
                        <Text style={s.reason}>{ev.reason}</Text>
                      )}
                    </View>
                    {/* Badge */}
                    <StatusBadge status={ev.decision === 'ALLOW' ? 'allow' : 'deny'} />
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </View>

      {/* Load more */}
      {events.length >= limit && (
        <TouchableOpacity
          style={s.loadMore}
          onPress={() => setLimit((l) => Math.min(l + 20, 100))}
        >
          <Text style={s.loadMoreText}>Load more</Text>
        </TouchableOpacity>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  header:       { paddingHorizontal: 18, paddingVertical: 14 },
  title:        { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  subtitle:     { fontSize: 12, color: C.muted, marginTop: 2 },

  summaryRow:   { flexDirection: 'row', gap: 10, paddingHorizontal: 14, marginBottom: 14 },
  summaryChip:  { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderRadius: 14, padding: 12, alignItems: 'center' },
  summaryVal:   { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  summaryLbl:   { fontSize: 10, color: C.muted, fontWeight: '600', marginTop: 2 },

  filterRow:    { flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 16 },
  filterBtn:    { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  filterBtnActive: { backgroundColor: 'rgba(124,58,237,0.15)', borderColor: C.primary },
  filterText:   { fontSize: 12, fontWeight: '600', color: C.muted },
  filterTextActive: { color: C.primary },

  section:      { paddingHorizontal: 14, marginBottom: 16 },
  group:        { marginBottom: 14 },
  groupLabel:   { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.6, marginBottom: 8, textTransform: 'uppercase' },

  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  rowBorder:    { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  dot:          { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  zone:         { fontSize: 13, fontWeight: '600', color: C.text },
  time:         { fontSize: 11, color: C.muted, marginTop: 1 },
  reason:       { fontSize: 11, color: C.danger, marginTop: 2 },

  emptyText:    { textAlign: 'center', color: C.muted, fontSize: 13, paddingVertical: 24 },
  loadMore:     { marginHorizontal: 14, marginBottom: 24, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  loadMoreText: { fontSize: 13, fontWeight: '700', color: C.primary },
});
