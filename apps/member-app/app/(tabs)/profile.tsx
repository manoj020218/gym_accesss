import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Avatar } from '../../src/components/Avatar';
import { StatusBadge } from '../../src/components/StatusBadge';
import { ProgressBar } from '../../src/components/ProgressBar';
import { useAuthStore } from '../../src/store/auth';
import { useNotifStore } from '../../src/store/notifications';
import { memberApi } from '../../src/api/member';
import { C, GRAD, S } from '../../src/theme';
import { fmtDate, daysLeft, membershipPercent } from '../../src/utils/format';
import { logout as firebaseLogout } from '../../src/api/auth';

function SettingRow({ label, sub, value, onToggle }: { label: string; sub?: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <View style={s.settingRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.settingLabel}>{label}</Text>
        {sub && <Text style={s.settingSub}>{sub}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: C.border, true: C.primary + 'CC' }}
        thumbColor={value ? '#fff' : C.muted}
        ios_backgroundColor={C.surface}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, memberId, logout } = useAuthStore();
  const clearNotifs = useNotifStore((s) => s.clear);
  const name = user?.displayName ?? '';

  const [notifRenewal, setNotifRenewal]   = useState(true);
  const [notifEntry,   setNotifEntry]     = useState(true);
  const [notifPromo,   setNotifPromo]     = useState(false);

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
    queryKey: ['member-history-profile', memberId],
    queryFn:  () => memberApi.getAccessHistory(memberId!, 100),
    enabled:  !!memberId,
  });

  const activeMembership  = memberships?.find((m) => m.status === 'active');
  const dLeft             = activeMembership ? daysLeft(activeMembership.endDate) : 0;
  const pct               = activeMembership ? membershipPercent(activeMembership.startDate, activeMembership.endDate) : 0;
  const totalCheckins     = history?.data?.filter((e) => e.decision === 'ALLOW').length ?? 0;

  const thisMonth = new Date();
  const monthCheckins = history?.data?.filter((e) => {
    const d = new Date(e.eventTime);
    return e.decision === 'ALLOW' && d.getMonth() === thisMonth.getMonth() && d.getFullYear() === thisMonth.getFullYear();
  }).length ?? 0;

  function handleSignOut() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await firebaseLogout();
            logout();
            clearNotifs();
            router.replace('/login');
          },
        },
      ]
    );
  }

  return (
    <Screen refreshing={isRefetching} onRefresh={refetchMember}>
      {/* Hero */}
      <LinearGradient colors={['rgba(124,58,237,0.2)', 'transparent']} style={s.hero}>
        <View style={s.heroContent}>
          <Avatar name={name} size={72} borderRadius={22} fontSize={28} />
          <View style={s.heroInfo}>
            <Text style={s.heroName}>{member?.name ?? name}</Text>
            <Text style={s.heroEmail}>{user?.email ?? ''}</Text>
            {member && (
              <View style={{ marginTop: 6 }}>
                <StatusBadge status={member.status} />
              </View>
            )}
          </View>
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          {[
            { label: 'Total Visits',   value: totalCheckins,  color: C.primary },
            { label: 'This Month',     value: monthCheckins,  color: C.accent },
            { label: 'Days Left',      value: dLeft,          color: C.success },
            { label: 'Renewals',       value: activeMembership?.renewalCount ?? 0, color: '#F59E0B' },
          ].map(({ label, value, color }) => (
            <View key={label} style={s.statBox}>
              <Text style={[s.statValue, { color }]}>{value}</Text>
              <Text style={s.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      {/* Active Membership Card */}
      {activeMembership && (
        <View style={s.section}>
          <Text style={S.sectionTitle}>Current Membership</Text>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.memCard}>
            <View style={s.memBubble} />
            <View style={s.memRow}>
              <View>
                <Text style={s.memPlan}>{activeMembership.planType.toUpperCase()}</Text>
                <Text style={s.memLabel}>MEMBERSHIP PLAN</Text>
              </View>
              <View style={s.memPill}>
                <Text style={s.memPillText}>{dLeft}d left</Text>
              </View>
            </View>
            <View style={s.memDates}>
              <Text style={s.memDateText}>From {fmtDate(activeMembership.startDate)}</Text>
              <Text style={s.memDateText}>To {fmtDate(activeMembership.endDate)}</Text>
            </View>
            <View style={{ marginTop: 10 }}>
              <View style={s.memBarRow}>
                <Text style={s.memBarLabel}>{pct}% used</Text>
                <Text style={s.memBarLabel}>{activeMembership.renewalCount} renewals</Text>
              </View>
              <ProgressBar percent={pct} height={5} color={['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.95)']} />
            </View>
          </LinearGradient>
        </View>
      )}

      {/* Membership history */}
      {(memberships?.length ?? 0) > 1 && (
        <View style={s.section}>
          <Text style={S.sectionTitle}>Membership History</Text>
          <View style={S.card}>
            {memberships!.slice(0, 4).map((m, i) => (
              <View key={m._id} style={[s.memHistRow, i > 0 && s.rowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.memHistPlan}>{m.planType}</Text>
                  <Text style={s.memHistDates}>{fmtDate(m.startDate)} – {fmtDate(m.endDate)}</Text>
                </View>
                <StatusBadge status={m.status} />
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Trainer */}
      {(member as any)?.assignedTrainer && (
        <View style={s.section}>
          <Text style={S.sectionTitle}>My Trainer</Text>
          <View style={[S.card, s.trainerCard]}>
            <Avatar name={(member as any).assignedTrainer.name} size={48} borderRadius={14} />
            <View style={{ flex: 1 }}>
              <Text style={s.trainerName}>{(member as any).assignedTrainer.name}</Text>
              <Text style={s.trainerRole}>Personal Trainer</Text>
              {(member as any).assignedTrainer.specialties?.length > 0 && (
                <Text style={s.trainerSpec}>{(member as any).assignedTrainer.specialties.join(' · ')}</Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Notification preferences */}
      <View style={s.section}>
        <Text style={S.sectionTitle}>Notifications</Text>
        <View style={S.card}>
          <SettingRow
            label="Renewal Reminders"
            sub="Get reminded before your membership expires"
            value={notifRenewal}
            onToggle={setNotifRenewal}
          />
          <View style={s.rowBorder}>
            <SettingRow
              label="Entry Alerts"
              sub="Confirm every gym entry with a notification"
              value={notifEntry}
              onToggle={setNotifEntry}
            />
          </View>
          <View style={s.rowBorder}>
            <SettingRow
              label="Promotions"
              sub="Special offers and class announcements"
              value={notifPromo}
              onToggle={setNotifPromo}
            />
          </View>
        </View>
      </View>

      {/* Account section */}
      <View style={s.section}>
        <Text style={S.sectionTitle}>Account</Text>
        <View style={S.card}>
          <TouchableOpacity style={s.menuRow} activeOpacity={0.7}>
            <Text style={s.menuLabel}>📋  Terms & Privacy</Text>
            <Text style={s.menuArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.menuRow, s.rowBorder]} activeOpacity={0.7}>
            <Text style={s.menuLabel}>💬  Contact Support</Text>
            <Text style={s.menuArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.menuRow, s.rowBorder]} activeOpacity={0.7}>
            <Text style={s.menuLabel}>ℹ️  About Edge Gym</Text>
            <Text style={s.menuArrow}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sign out */}
      <View style={s.section}>
        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>
        <Text style={s.versionText}>Edge Gym Member App v1.0.0</Text>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero:          { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 20, marginBottom: 4 },
  heroContent:   { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 20 },
  heroInfo:      { flex: 1 },
  heroName:      { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  heroEmail:     { fontSize: 12, color: C.muted, marginTop: 2 },
  statsRow:      { flexDirection: 'row', gap: 6 },
  statBox:       { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' },
  statValue:     { fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  statLabel:     { fontSize: 9, color: C.muted, fontWeight: '600', marginTop: 3, textAlign: 'center' },

  section:       { paddingHorizontal: 14, marginBottom: 16 },

  memCard:       { borderRadius: 18, padding: 18, overflow: 'hidden' },
  memBubble:     { position: 'absolute', top: -24, right: -24, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.1)' },
  memRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  memPlan:       { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  memLabel:      { fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: '600', letterSpacing: 0.6 },
  memPill:       { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 100, paddingHorizontal: 12, paddingVertical: 5 },
  memPillText:   { fontSize: 12, fontWeight: '700', color: '#fff' },
  memDates:      { flexDirection: 'row', justifyContent: 'space-between' },
  memDateText:   { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  memBarRow:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  memBarLabel:   { fontSize: 11, color: 'rgba(255,255,255,0.7)' },

  memHistRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  memHistPlan:   { fontSize: 13, fontWeight: '700', color: C.text, textTransform: 'capitalize' },
  memHistDates:  { fontSize: 11, color: C.muted, marginTop: 2 },

  trainerCard:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  trainerName:   { fontSize: 15, fontWeight: '700', color: C.text },
  trainerRole:   { fontSize: 12, color: C.primary, marginTop: 1, fontWeight: '600' },
  trainerSpec:   { fontSize: 11, color: C.muted, marginTop: 2 },

  settingRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  settingLabel:  { fontSize: 14, fontWeight: '600', color: C.text },
  settingSub:    { fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 16 },

  rowBorder:     { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },

  menuRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  menuLabel:     { fontSize: 14, fontWeight: '600', color: C.text },
  menuArrow:     { fontSize: 18, color: C.muted },

  signOutBtn:    { backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  signOutText:   { fontSize: 15, fontWeight: '700', color: C.danger },
  versionText:   { textAlign: 'center', fontSize: 11, color: C.dimmed, marginBottom: 8 },
});
