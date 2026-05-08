import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useGoogleAuth, loginWithGoogleToken } from '../src/api/auth';
import { C, GRAD } from '../src/theme';

export default function LoginScreen() {
  const router   = useRouter();
  const [loading, setLoading] = useState(false);
  const [request, response, promptAsync] = useGoogleAuth();

  useEffect(() => {
    if (response?.type === 'success') {
      const token = response.authentication?.accessToken;
      if (!token) return;
      setLoading(true);
      loginWithGoogleToken(token)
        .then(() => router.replace('/(tabs)/'))
        .catch((e: Error) => Alert.alert('Login failed', e.message))
        .finally(() => setLoading(false));
    }
    if (response?.type === 'error') {
      Alert.alert('Google Sign-In failed', response.error?.message ?? 'Unknown error');
    }
  }, [response]);

  return (
    <LinearGradient
      colors={['rgba(124,58,237,0.25)', '#05050A', '#05050A']}
      locations={[0, 0.5, 1]}
      style={s.container}
    >
      {/* Logo */}
      <View style={s.logoArea}>
        <LinearGradient colors={GRAD} style={s.logoBox}>
          <Text style={s.logoEmoji}>⚡</Text>
        </LinearGradient>
        <Text style={s.logoText}>EDGE GYM</Text>
        <Text style={s.tagline}>Access Beyond Limits</Text>
      </View>

      {/* Card */}
      <View style={s.card}>
        {/* Google Button */}
        <TouchableOpacity
          style={s.googleBtn}
          onPress={() => promptAsync()}
          disabled={!request || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#374151" size="small" />
          ) : (
            <Text style={s.googleIcon}>G</Text>
          )}
          <Text style={s.googleText}>Continue with Google</Text>
        </TouchableOpacity>

        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>members only</Text>
          <View style={s.dividerLine} />
        </View>

        <Text style={s.foot}>
          Only registered gym members may sign in. Contact reception to get access.
        </Text>
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, backgroundColor: C.bg },
  logoArea:  { alignItems: 'center', marginBottom: 36 },
  logoBox:   { width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 16, shadowColor: C.primary, shadowOpacity: 0.6, shadowRadius: 24 },
  logoEmoji: { fontSize: 36 },
  logoText:  { fontSize: 28, fontWeight: '900', letterSpacing: -1, color: '#fff', marginBottom: 4 },
  tagline:   { fontSize: 14, color: C.dimmed },
  card:      { width: '100%', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: C.border, borderRadius: 24, padding: 24 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 15, marginBottom: 20 },
  googleIcon: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  googleText: { fontSize: 15, fontWeight: '700', color: '#111827' },
  divider:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontSize: 11, color: C.dimmed },
  foot:      { fontSize: 12, color: C.dimmed, textAlign: 'center', lineHeight: 18 },
});
