import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useNotifStore } from '../../src/store/notifications';
import { C } from '../../src/theme';

function TabIcon({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  return (
    <View style={[s.icon, focused && s.iconActive]}>
      {children}
    </View>
  );
}

function UnreadDot() {
  const count = useNotifStore((s) => s.unreadCount);
  if (count === 0) return null;
  return (
    <View style={s.dot}>
      <Text style={s.dotText}>{count > 9 ? '9+' : count}</Text>
    </View>
  );
}

// SVG icons as RN components
function IconHome({ color }: { color: string }) {
  const Svg = require('react-native-svg').Svg;
  const { Rect } = require('react-native-svg');
  return (
    <Svg width="22" height="22" fill="none" stroke={color} strokeWidth="1.8" viewBox="0 0 24 24">
      <Rect x="3" y="3" width="7" height="7" rx="1"/>
      <Rect x="14" y="3" width="7" height="7" rx="1"/>
      <Rect x="14" y="14" width="7" height="7" rx="1"/>
      <Rect x="3" y="14" width="7" height="7" rx="1"/>
    </Svg>
  );
}

function IconCard({ color }: { color: string }) {
  const Svg = require('react-native-svg').Svg;
  const { Rect, Path } = require('react-native-svg');
  return (
    <Svg width="22" height="22" fill="none" stroke={color} strokeWidth="1.8" viewBox="0 0 24 24">
      <Rect x="3" y="3" width="18" height="18" rx="3"/>
      <Path d="M3 9h18M9 21V9"/>
    </Svg>
  );
}

function IconHistory({ color }: { color: string }) {
  const Svg = require('react-native-svg').Svg;
  const { Polyline } = require('react-native-svg');
  return (
    <Svg width="22" height="22" fill="none" stroke={color} strokeWidth="1.8" viewBox="0 0 24 24">
      <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </Svg>
  );
}

function IconAlerts({ color }: { color: string }) {
  const Svg = require('react-native-svg').Svg;
  const { Path } = require('react-native-svg');
  return (
    <Svg width="22" height="22" fill="none" stroke={color} strokeWidth="1.8" viewBox="0 0 24 24">
      <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <Path d="M13.73 21a2 2 0 01-3.46 0"/>
    </Svg>
  );
}

function IconProfile({ color }: { color: string }) {
  const Svg = require('react-native-svg').Svg;
  const { Path, Circle } = require('react-native-svg');
  return (
    <Svg width="22" height="22" fill="none" stroke={color} strokeWidth="1.8" viewBox="0 0 24 24">
      <Path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <Circle cx="12" cy="7" r="4"/>
    </Svg>
  );
}

const TABS = [
  { name: 'index',   label: 'Home',    Icon: IconHome },
  { name: 'card',    label: 'My Card', Icon: IconCard },
  { name: 'history', label: 'History', Icon: IconHistory },
  { name: 'alerts',  label: 'Alerts',  Icon: IconAlerts, badge: true },
  { name: 'profile', label: 'Profile', Icon: IconProfile },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: s.tabBar,
        tabBarActiveTintColor:   C.primary,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginBottom: 2 },
        tabBarBackground: () => null,
      }}
    >
      {TABS.map(({ name, label, Icon, badge }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarIcon: ({ color, focused }) => (
              <View style={{ position: 'relative' }}>
                <TabIcon focused={focused}>
                  <Icon color={focused ? C.primary : C.muted} />
                </TabIcon>
                {badge && <UnreadDot />}
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const s = StyleSheet.create({
  tabBar: {
    backgroundColor: 'rgba(8,8,20,0.97)',
    borderTopColor:  'rgba(255,255,255,0.07)',
    borderTopWidth:  1,
    height:          64,
    paddingBottom:   8,
    paddingTop:      6,
  },
  icon:       { alignItems: 'center', justifyContent: 'center', padding: 4, borderRadius: 10 },
  iconActive: { backgroundColor: 'rgba(124,58,237,0.12)' },
  dot: {
    position: 'absolute', top: -2, right: -6,
    backgroundColor: C.danger, borderRadius: 8,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 2, borderColor: '#05050A',
  },
  dotText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
