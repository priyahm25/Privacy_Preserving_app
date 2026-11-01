import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignIn, useClerk } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { formatClerkError } from '@/utils/authErrors';
import { resolvePostAuthRoute } from '@/lib/pendingInvitation';

type Mode = 'totp' | 'backup';

/**
 * Second step of two-step verification. Reached only after the password step
 * reports `needs_second_factor`; no session is active until a factor here is
 * verified, so the step cannot be skipped.
 */
export default function TwoFactor() {
  const { signIn } = useSignIn();
  const { setActive, signOut } = useClerk();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('totp');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const status = signIn?.status;
  // If the flow isn't actually awaiting a second factor (e.g. the page was
  // reloaded and Clerk reset the attempt), there is nothing to verify here.
  const awaitingSecondFactor = status === 'needs_second_factor';
  const secondFactors = signIn?.supportedSecondFactors ?? [];
  const hasBackupCode = secondFactors.some((f) => f.strategy === 'backup_code');
  const hasTotp = secondFactors.some((f) => f.strategy === 'totp');

  const verify = async () => {
    const trimmed = code.trim();
    setErrorMessage(null);

    if (!trimmed) {
      setErrorMessage(mode === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your backup codes.');
      return;
    }

    setLoading(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const result = mode === 'totp'
        ? await signIn.mfa.verifyTOTP({ code: trimmed })
        : await signIn.mfa.verifyBackupCode({ code: trimmed });

      if (result?.error) {
        setErrorMessage(formatClerkError(result.error, 'Verification Failed').message);
        return;
      }

      if (signIn.status !== 'complete') {
        setErrorMessage('Verification did not complete. Please try again.');
        return;
      }

      // Only now, after the second factor is verified, is the session created.
      const finalized = await signIn.finalize();
      if (finalized?.error) {
        setErrorMessage(formatClerkError(finalized.error, 'Verification Failed').message);
        return;
      }
      if (signIn.createdSessionId) {
        await setActive({ session: signIn.createdSessionId });
      }
      router.replace((await resolvePostAuthRoute()) as any);
    } catch (err) {
      setErrorMessage(formatClerkError(err, 'Verification Failed').message);
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = async () => {
    try {
      await signIn?.reset();
    } catch {}
    try {
      await signOut();
    } catch {}
    router.replace('/auth/login' as any);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setCode('');
    setErrorMessage(null);
  };

  return (
    <LinearGradient colors={['#050B18', '#0A1628', '#050B18']} style={styles.bg}>
      <View style={styles.orbTL} />
      <View style={styles.orbBR} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: topPad + 24, paddingBottom: botPad + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoRow}>
            <Ionicons name="shield-checkmark" size={28} color="#00D4FF" />
            <Text style={styles.logoText}>SecureSphere</Text>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.title}>Two-step verification</Text>
            <Text style={styles.subtitle}>
              {mode === 'totp'
                ? 'Enter the code from your authenticator app to finish signing in.'
                : 'Enter one of your saved backup codes to finish signing in.'}
            </Text>
          </View>

          {!awaitingSecondFactor ? (
            <View style={styles.form}>
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={18} color="#FF3B5C" />
                <Text style={styles.errorBannerText}>
                  Your sign-in session expired before verification. Please sign in again.
                </Text>
              </View>
              <TouchableOpacity onPress={backToLogin} activeOpacity={0.8} style={styles.loginBtnContainer}>
                <LinearGradient colors={['#00D4FF', '#0066FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.loginBtn}>
                  <Text style={styles.loginBtnText}>Back to Sign In</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.form}>
              {errorMessage && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={18} color="#FF3B5C" />
                  <Text style={styles.errorBannerText}>{errorMessage}</Text>
                </View>
              )}

              {mode === 'totp' && !hasTotp && secondFactors.length > 0 && (
                <Text style={styles.noteText}>
                  This account has no authenticator app configured. Use a backup code instead.
                </Text>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{mode === 'totp' ? 'Authenticator code' : 'Backup code'}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons
                    name={mode === 'totp' ? 'keypad-outline' : 'key-outline'}
                    size={18}
                    color="#7A9BB5"
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    value={code}
                    onChangeText={(val) => {
                      setCode(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    keyboardType={mode === 'totp' ? 'number-pad' : 'default'}
                    autoCapitalize="none"
                    autoComplete={mode === 'totp' ? 'one-time-code' : 'off'}
                    textContentType={mode === 'totp' ? 'oneTimeCode' : 'none'}
                    placeholderTextColor="#7A9BB5"
                    placeholder={mode === 'totp' ? '123456' : 'xxxxx-xxxxx'}
                    editable={!loading}
                    onSubmitEditing={() => void verify()}
                    returnKeyType="done"
                  />
                </View>
              </View>

              <TouchableOpacity
                onPress={verify}
                activeOpacity={0.8}
                disabled={loading}
                style={[styles.loginBtnContainer, loading && styles.disabledBtn]}
              >
                <LinearGradient colors={['#00D4FF', '#0066FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.loginBtn}>
                  {loading ? (
                    <ActivityIndicator size="small" color="#050B18" />
                  ) : (
                    <Text style={styles.loginBtnText}>Verify &amp; Continue</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {/* Recovery: switch between authenticator and backup codes. */}
              {(mode === 'backup' || hasBackupCode || secondFactors.length === 0) && (
                <TouchableOpacity
                  style={styles.switchRow}
                  onPress={() => switchMode(mode === 'totp' ? 'backup' : 'totp')}
                  disabled={loading}
                >
                  <Ionicons name="help-circle-outline" size={16} color="#00D4FF" />
                  <Text style={styles.switchText}>
                    {mode === 'totp' ? "Can't access your authenticator? Use a backup code" : 'Use your authenticator app instead'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.backRow} onPress={backToLogin} disabled={loading}>
                <Text style={styles.backText}>Cancel and return to sign in</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#050B18' },
  orbTL: { position: 'absolute', top: -80, left: -80, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(0,212,255,0.06)' },
  orbBR: { position: 'absolute', bottom: -60, right: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(0,102,255,0.07)' },
  scroll: { paddingHorizontal: 24, flexGrow: 1 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 36 },
  logoText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#E8F4FD' },
  titleBlock: { marginBottom: 28, gap: 8 },
  title: { fontSize: 30, fontFamily: 'Inter_700Bold', color: '#E8F4FD' },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#7A9BB5', lineHeight: 22 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255, 59, 92, 0.12)', borderRadius: 12, borderWidth: 1,
    borderColor: 'rgba(255, 59, 92, 0.3)', padding: 12,
  },
  errorBannerText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#FF3B5C', flex: 1 },
  noteText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#A8C4DC', lineHeight: 20 },
  form: { gap: 16 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#A8C4DC' },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A2D4A',
    borderRadius: 14, borderWidth: 1, borderColor: '#1A3050', paddingHorizontal: 14, height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: '#E8F4FD', letterSpacing: 2 },
  loginBtnContainer: { marginTop: 4 },
  disabledBtn: { opacity: 0.5 },
  loginBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  loginBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#050B18' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 },
  switchText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#00D4FF', textAlign: 'center' },
  backRow: { alignItems: 'center', marginTop: 8 },
  backText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#7A9BB5' },
});
