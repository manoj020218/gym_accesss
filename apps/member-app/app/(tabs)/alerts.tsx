import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNotifStore } from '../../src/store/notifications';
import { Screen } from '../../src/components/Screen';
import { C, S } from '../../src/theme';
import { fmtRelative } from '../../src/utils/format';

const TYPE_META: Record<string, { icon: string; color: string; bg: string }> = {
  renewal:   { icon: '🔄', color: C.primary,  bg: 'rgba(124,58,237,0.12)' },
  entry:     { icon: '🚪', color: C.success,  bg: 'rgba(16,185,129,0.12)' },
  payment:   { icon: '💳', color: C.accent,   bg: 'rgba(34,211,238,0.12)' },
  promotion: { icon: '🎉', color: '#F59E0B',  bg: 'rgba(245,158,11,0.12)' },
  system:    { icon: '⚙️', color: C.muted,    bg: 'rgba(100,116,139,0.12)' },
};

function groupByDay(notifications: any[]): { label: string; items: any[] }[] {
  const map = new Map<string, any[]>();
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();

  for (const n of notifications) {
    const d = new Date(n.createdAt).toDateString();
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(n.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(n);
  }

  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

export default function AlertsScreen() {
  const { notifications, unreadCount, markRead, markAllRead, clear } = useNotifStore();
  const groups = groupByDay(notifications);

  return (
    <Screen>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Notifications</Text>
          {unreadCount > 0 && (
            <Text style={s.subtitle}>{unreadCount} unread</Text>
          )}
        </View>
        <View style={s.headerActions}>
          {unreadCount > 0 && (
            <TouchableOpacity style={s.actionBtn} onPress={markAllRead}>
              <Text style={s.actionBtnText}>Mark all read</Text>
            </TouchableOpacity>
          )}
          {notifications.length > 0 && (
            <TouchableOpacity style={[s.actionBtn, s.clearBtn]} onPress={clear}>
              <Text style={[s.actionBtnText, { color: C.danger }]}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Notifications */}
      <View style={s.section}>
        {notifications.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyIcon}>🔔</Text>
            <Text style={s.emptyTitle}>All caught up</Text>
            <Text style={s.emptyDesc}>You have no notifications yet. We'll alert you about membership renewals, entry confirmations, and more.</Text>
          </View>
        ) : (
          groups.map(({ label, items }) => (
            <View key={label} style={s.group}>
              <Text style={s.groupLabel}>{label}</Text>
              <View style={S.card}>
                {items.map((n, i) => {
                  const meta = TYPE_META[n.type] ?? TYPE_META.system;
                  return (
                    <TouchableOpacity
                      key={n.id}
                      style={[s.row, i > 0 && s.rowBorder, !n.read && s.rowUnread]}
                      onPress={() => markRead(n.id)}
                      activeOpacity={0.7}
                    >
                      {/* Icon */}
                      <View style={[s.iconBox, { backgroundColor: meta.bg }]}>
                        <Text style={s.iconText}>{meta.icon}</Text>
                      </View>
                      {/* Content */}
                      <View style={{ flex: 1 }}>
                        <View style={s.rowTop}>
                          <Text style={s.notifTitle} numberOfLines={1}>{n.title}</Text>
                          {!n.read && <View style={s.unreadDot} />}
                        </View>
                        <Text style={s.notifBody} numberOfLines={2}>{n.body}</Text>
                        <Text style={s.notifTime}>{fmtRelative(n.createdAt)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </View>

      {/* Type legend */}
      {notifications.length > 0 && (
        <View style={s.legend}>
          {Object.entries(TYPE_META).map(([type, meta]) => (
            <View key={type} style={s.legendItem}>
              <Text style={s.legendIcon}>{meta.icon}</Text>
              <Text style={s.legendLabel}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  title:         { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  subtitle:      { fontSize: 12, color: C.primary, marginTop: 2, fontWeight: '600' },

  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 4 },
  actionBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(124,58,237,0.12)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.2)' },
  clearBtn:      { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: C.primary },

  section:       { paddingHorizontal: 14, marginBottom: 16 },
  group:         { marginBottom: 14 },
  groupLabel:    { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.6, marginBottom: 8, textTransform: 'uppercase' },

  row:           { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  rowBorder:     { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  rowUnread:     { backgroundColor: 'rgba(124,58,237,0.04)' },
  rowTop:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },

  iconBox:       { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconText:      { fontSize: 18 },

  notifTitle:    { fontSize: 13, fontWeight: '700', color: C.text, flex: 1 },
  notifBody:     { fontSize: 12, color: C.textSub, lineHeight: 17 },
  notifTime:     { fontSize: 11, color: C.muted, marginTop: 4 },
  unreadDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary, flexShrink: 0 },

  emptyBox:      { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  emptyIcon:     { fontSize: 48, marginBottom: 16 },
  emptyTitle:    { fontSize: 18, fontWeight: '800', color: C.text, marginBottom: 8 },
  emptyDesc:     { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20 },

  legend:        { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14, paddingBottom: 24, justifyContent: 'center' },
  legendItem:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendIcon:    { fontSize: 13 },
  legendLabel:   { fontSize: 11, color: C.muted },
});
