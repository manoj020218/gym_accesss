import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { Screen } from '../../src/components/Screen';
import { Avatar } from '../../src/components/Avatar';
import { StatusBadge } from '../../src/components/StatusBadge';
import { ProgressBar } from '../../src/components/ProgressBar';
import { useAuthStore } from '../../src/store/auth';
import { memberApi } from '../../src/api/member';
import { C, GRAD, S } from '../../src/theme';
import { fmtDate, fmtDatetime, fmtRelative, daysLeft, membershipPercent } from '../../src/utils/format';

export default function HomeScreen() {
  const router   = useRouter();
  const { user, memberId } = useAuthStore();
  const name = user?.displayName ?? '';
  const firstName = name.split(' ')[0] ?? 'there';

  const { data: member, refetch: refetchMember, isRefetching } = useQuery({
    queryKey: ['member-profile', memberId],
    queryFn:  () => memberApi.getProfile(memberId!),
    enabled:  !!memberId,
  });

  const { data: memberships } = useQuery({
    queryKey: ['member-memberships', memberId],
    queryFn:  () => memberApi.getMemberships(memberId!),
    enabled:  !!memberId,
  });

  const { data: history } = useQuery({
    queryKey: ['member-history', memberId],
    queryFn:  () => memberApi.getAccessHistory(memberId!, 5),
    enabled:  !!memberId,
    refetchInterval: 30_000,
  });

  const activeMembership = memberships?.find((m) => m.status === 'active');
  const recentCheckins   = history?.data?.filter((e) => e.decision === 'ALLOW') ?? [];
  const today            = format(new Date(), 'EEEE, d MMMM');
  const dLeft            = activeMembership ? daysLeft(activeMembership.endDate) : 0;
  const pct              = activeMembership ? membershipPercent(activeMembership.startDate, activeMembership.endDate) : 0;
  const thisMonthCheckins = recentCheckins.length;

  return (
    <Screen refreshing={isRefetching} onRefresh={refetchMember}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.dayLabel}>{today.toUpperCase()}</Text>
          <Text style={s.greeting}>Good morning, {firstName} 👋</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/(tabs)/profile')}>
          <Avatar name={name} size={40} borderRadius={12} />
        </TouchableOpacity>
      </View>

      {/* Hero — Active Membership */}
      {activeMembership ? (
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <View style={s.heroBubble1} />
          <View style={s.heroBubble2} />
          <Text style={s.heroLabel}>MEMBERSHIP STATUS</Text>
          <Text style={s.heroValue}>{activeMembership.planType.toUpperCase()}</Text>
          <View style={s.heroPills}>
            <View style={s.pill}><Text style={s.pillText}>{dLeft} days left</Text></View>
            {member && <View style={s.pill}><StatusBadge status={member.status} /></View>}
          </View>
          <View style={{ marginTop: 14 }}>
            <View style={s.heroDateRow}>
              <Text style={s.heroDateLabel}>Expires {fmtDate(activeMembership.endDate)}</Text>
              <Text style={s.heroDateLabel}>{pct}% used</Text>
            </View>
            <ProgressBar percent={pct} height={6} color={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0.9)']} />
          </View>
        </LinearGradient>
      ) : (
        <View style={[s.hero, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
          <Text style={s.heroValue}>No active membership</Text>
          <Text style={s.heroLabel}>Contact reception to renew</Text>
        </View>
      )}

      {/* Stats row */}
      <View style={s.statsRow}>
        {[
          { label: 'This Month', value: thisMonthCheckins, color: C.primary },
          { label: 'Days Left',  value: dLeft,             color: C.accent },
          { label: 'Renewals',   value: activeMembership?.renewalCount ?? 0, color: C.success },
        ].map(({ label, value, color }) => (
          <View key={label} style={s.statCard}>
            <Text style={[s.statValue, { color }]}>{value}</Text>
            <Text style={s.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Quick Actions */}
      <View style={s.section}>
        <Text style={S.sectionTitle}>Quick Actions</Text>
        <View style={s.actionsRow}>
          <TouchableOpacity style={s.actionBtn} onPress={() => router.push('/(tabs)/card')}>
            <LinearGradient colors={GRAD} style={s.actionIcon}>
              <Text style={{ fontSize: 20 }}>📱</Text>
            </LinearGradient>
            <Text style={s.actionLabel}>Show QR</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => router.push('/(tabs)/history')}>
            <View style={[s.actionIcon, { backgroundColor: 'rgba(34,211,238,0.12)' }]}>
              <Text style={{ fontSize: 20 }}>📋</Text>
            </View>
            <Text style={s.actionLabel}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => router.push('/(tabs)/alerts')}>
            <View style={[s.actionIcon, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
              <Text style={{ fontSize: 20 }}>🔔</Text>
            </View>
            <Text style={s.actionLabel}>Alerts</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => router.push('/(tabs)/profile')}>
            <View style={[s.actionIcon, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
              <Text style={{ fontSize: 20 }}>👤</Text>
            </View>
            <Text style={s.actionLabel}>Profile</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Recent Activity */}
      <View style={s.section}>
        <Text style={S.sectionTitle}>Recent Activity</Text>
        <View style={S.card}>
          {recentCheckins.slice(0, 5).map((ev, i) => (
            <View key={ev._id} style={[s.eventRow, i > 0 && s.eventBorder]}>
              <View style={[s.eventDot, { backgroundColor: ev.decision === 'ALLOW' ? C.success : C.danger }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.eventZone}>{ev.zone.replace(/_/g, ' ')}</Text>
                <Text style={s.eventTime}>{fmtRelative(ev.eventTime)}</Text>
              </View>
              <StatusBadge status={ev.decision === 'ALLOW' ? 'allow' : 'deny'} />
            </View>
          ))}
          {recentCheckins.length === 0 && (
            <Text style={s.emptyText}>No recent activity</Text>
          )}
        </View>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  dayLabel:      { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, color: C.muted },
  greeting:      { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: C.text, marginTop: 2 },
  hero:          { marginHorizontal: 14, borderRadius: 20, padding: 18, marginBottom: 14, overflow: 'hidden' },
  heroBubble1:   { position: 'absolute', top: -20, right: -20, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.1)' },
  heroBubble2:   { position: 'absolute', bottom: -30, right: 20,  width: 70,  height: 70,  borderRadius: 35, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroLabel:     { fontSize: 11, fontWeight: '600', opacity: 0.8, letterSpacing: 0.6, color: '#fff', marginBottom: 4 },
  heroValue:     { fontSize: 26, fontWeight: '900', letterSpacing: -0.8, color: '#fff' },
  heroPills:     { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center' },
  pill:          { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 100, paddingHorizontal: 12, paddingVertical: 5 },
  pillText:      { fontSize: 12, fontWeight: '700', color: '#fff' },
  heroDateRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  heroDateLabel: { fontSize: 11, color: 'rgba(255,255,255,0.8)' },
  statsRow:      { flexDirection: 'row', gap: 10, marginHorizontal: 14, marginBottom: 16 },
  statCard:      { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, alignItems: 'center' },
  statValue:     { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  statLabel:     { fontSize: 10, color: C.muted, marginTop: 3, fontWeight: '600' },
  section:       { paddingHorizontal: 14, marginBottom: 16 },
  actionsRow:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  actionBtn:     { alignItems: 'center', gap: 8 },
  actionIcon:    { width: 58, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actionLabel:   { fontSize: 11, fontWeight: '600', color: C.textSub },
  eventRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  eventBorder:   { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  eventDot:      { width: 8, height: 8, borderRadius: 4 },
  eventZone:     { fontSize: 13, fontWeight: '600', color: C.text },
  eventTime:     { fontSize: 11, color: C.muted, marginTop: 1 },
  emptyText:     { textAlign: 'center', color: C.muted, fontSize: 13, paddingVertical: 20 },
});
