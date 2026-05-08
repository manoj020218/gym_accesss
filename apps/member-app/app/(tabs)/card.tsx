import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../../src/components/Screen';
import { ProgressBar } from '../../src/components/ProgressBar';
import { useAuthStore } from '../../src/store/auth';
import { memberApi } from '../../src/api/member';
import { C, GRAD, S } from '../../src/theme';
import { fmtDate, daysLeft, membershipPercent } from '../../src/utils/format';

function PulseRing({ active }: { active: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0,    useNativeDriver: true }),
      ])
    ).start();
  }, [active]);

  const scale  = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const opacity = anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.45, 0.1, 0] });

  return (
    <Animated.View
      style={[
        s.pulseRing,
        { transform: [{ scale }], opacity },
      ]}
    />
  );
}

const ZONE_LABELS: Record<string, string> = {
  MAIN_FLOOR:    'Main Floor',
  CARDIO_AREA:   'Cardio Area',
  WEIGHTS_ROOM:  'Weights Room',
  POOL:          'Pool',
  SAUNA:         'Sauna',
  CROSSFIT_BOX:  'CrossFit Box',
  YOGA_STUDIO:   'Yoga Studio',
  SPIN_CLASS:    'Spin Class',
  BASKETBALL:    'Basketball',
  RECEPTION:     'Reception',
};

export default function CardScreen() {
  const { memberId } = useAuthStore();
  const qc = useQueryClient();

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
    queryKey: ['member-history-card', memberId],
    queryFn:  () => memberApi.getAccessHistory(memberId!, 30),
    enabled:  !!memberId,
  });

  const regenMut = useMutation({
    mutationFn: () => memberApi.regenerateQr(memberId!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['member-profile', memberId] }); },
    onError:   (e: Error) => Alert.alert('Error', e.message),
  });

  const activeMembership = memberships?.find((m) => m.status === 'active');
  const dLeft   = activeMembership ? daysLeft(activeMembership.endDate) : 0;
  const pct     = activeMembership ? membershipPercent(activeMembership.startDate, activeMembership.endDate) : 0;
  const isValid = member?.status === 'active' && (dLeft > 0);

  const todayStr = new Date().toDateString();
  const todayCheckins = history?.data?.filter(
    (e) => e.decision === 'ALLOW' && new Date(e.eventTime).toDateString() === todayStr
  ).length ?? 0;

  const allowedZones: string[] = (activeMembership as any)?.allowedZones ?? [];
  const qrValue = member?.qrToken ?? memberId ?? 'NO_TOKEN';

  return (
    <Screen refreshing={isRefetching} onRefresh={refetchMember}>
      {/* Title */}
      <View style={s.titleRow}>
        <Text style={s.title}>My Access Card</Text>
        {member?.status === 'active' && (
          <View style={s.activePill}>
            <View style={s.activeDot} />
            <Text style={s.activePillText}>Active</Text>
          </View>
        )}
      </View>

      {/* QR Card */}
      <LinearGradient
        colors={['#12122A', '#1a1a3a']}
        style={s.qrCard}
      >
        {/* Card Header */}
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cardHeader}>
          <Text style={s.cardHeaderText}>⚡ EDGE GYM</Text>
          <Text style={s.cardHeaderSub}>{activeMembership?.planType?.toUpperCase() ?? 'MEMBER'}</Text>
        </LinearGradient>

        {/* QR Code with pulse */}
        <View style={s.qrWrapper}>
          <PulseRing active={isValid} />
          <View style={[s.qrBox, !isValid && s.qrBoxInvalid]}>
            {member ? (
              <QRCode
                value={qrValue}
                size={180}
                color="#fff"
                backgroundColor="transparent"
                logo={{ uri: '' }}
              />
            ) : (
              <View style={s.qrPlaceholder}>
                <Text style={s.qrPlaceholderText}>Loading…</Text>
              </View>
            )}
          </View>
          {!isValid && (
            <View style={s.invalidOverlay}>
              <Text style={s.invalidText}>EXPIRED</Text>
            </View>
          )}
        </View>

        {/* Member name + hint */}
        <Text style={s.memberName}>{member?.name ?? '—'}</Text>
        <Text style={s.qrHint}>Hold QR code in front of scanner</Text>

        {/* Validity bar */}
        {activeMembership && (
          <View style={s.validityBlock}>
            <View style={s.validityRow}>
              <Text style={s.validityLabel}>Valid until {fmtDate(activeMembership.endDate)}</Text>
              <Text style={s.validityLabel}>{dLeft} days left</Text>
            </View>
            <ProgressBar percent={pct} height={5} color={['rgba(124,58,237,0.7)', 'rgba(34,211,238,0.9)']} />
          </View>
        )}

        {/* Regen button */}
        <TouchableOpacity
          style={s.regenBtn}
          onPress={() => {
            Alert.alert(
              'Regenerate QR',
              'This will invalidate your current QR code and generate a new one.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Regenerate', style: 'destructive', onPress: () => regenMut.mutate() },
              ]
            );
          }}
          disabled={regenMut.isPending}
        >
          <Text style={s.regenText}>{regenMut.isPending ? 'Regenerating…' : '↺  Regenerate QR'}</Text>
        </TouchableOpacity>
      </LinearGradient>

      {/* Allowed Zones */}
      {allowedZones.length > 0 && (
        <View style={s.section}>
          <Text style={S.sectionTitle}>Allowed Zones</Text>
          <View style={s.zonesWrap}>
            {allowedZones.map((z) => (
              <View key={z} style={s.zoneChip}>
                <Text style={s.zoneChipText}>{ZONE_LABELS[z] ?? z.replace(/_/g, ' ')}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Today's stats */}
      <View style={s.section}>
        <Text style={S.sectionTitle}>Today</Text>
        <View style={s.todayRow}>
          <View style={[S.card, s.todayStat]}>
            <Text style={[s.todayValue, { color: C.primary }]}>{todayCheckins}</Text>
            <Text style={s.todayLabel}>Check-ins</Text>
          </View>
          <View style={[S.card, s.todayStat]}>
            <Text style={[s.todayValue, { color: C.accent }]}>{dLeft}</Text>
            <Text style={s.todayLabel}>Days Left</Text>
          </View>
          <View style={[S.card, s.todayStat]}>
            <Text style={[s.todayValue, { color: C.success }]}>{pct}%</Text>
            <Text style={s.todayLabel}>Plan Used</Text>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  titleRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  title:           { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  activePill:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(16,185,129,0.12)', borderRadius: 100, paddingHorizontal: 12, paddingVertical: 5 },
  activeDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: C.success },
  activePillText:  { fontSize: 12, fontWeight: '700', color: C.success },

  qrCard:          { marginHorizontal: 14, borderRadius: 24, overflow: 'hidden', marginBottom: 18, borderWidth: 1, borderColor: 'rgba(124,58,237,0.3)' },
  cardHeader:      { paddingVertical: 10, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderText:  { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: -0.3 },
  cardHeaderSub:   { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },

  qrWrapper:       { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, position: 'relative' },
  pulseRing:       { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 2, borderColor: C.primary },
  qrBox:           { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  qrBoxInvalid:    { opacity: 0.3 },
  qrPlaceholder:   { width: 180, height: 180, alignItems: 'center', justifyContent: 'center' },
  qrPlaceholderText: { color: C.muted, fontSize: 14 },
  invalidOverlay:  { position: 'absolute', backgroundColor: 'rgba(239,68,68,0.85)', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 8 },
  invalidText:     { color: '#fff', fontWeight: '900', fontSize: 18, letterSpacing: 2 },

  memberName:      { textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 4 },
  qrHint:          { textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 18, letterSpacing: 0.3 },

  validityBlock:   { marginHorizontal: 20, marginBottom: 16 },
  validityRow:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  validityLabel:   { fontSize: 11, color: 'rgba(255,255,255,0.6)' },

  regenBtn:        { marginHorizontal: 20, marginBottom: 20, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)', alignItems: 'center' },
  regenText:       { fontSize: 13, fontWeight: '700', color: C.primary },

  section:         { paddingHorizontal: 14, marginBottom: 16 },
  zonesWrap:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  zoneChip:        { backgroundColor: 'rgba(124,58,237,0.12)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.25)', borderRadius: 100, paddingHorizontal: 14, paddingVertical: 7 },
  zoneChipText:    { fontSize: 12, fontWeight: '600', color: C.primary },

  todayRow:        { flexDirection: 'row', gap: 10, marginTop: 4 },
  todayStat:       { flex: 1, alignItems: 'center', paddingVertical: 16 },
  todayValue:      { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  todayLabel:      { fontSize: 10, color: C.muted, fontWeight: '600', marginTop: 4 },
});
