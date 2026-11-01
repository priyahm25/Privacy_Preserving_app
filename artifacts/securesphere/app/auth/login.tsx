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
  Alert,
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

export default function Login() {
  const { signIn } = useSignIn();
  const { setActive, signOut } = useClerk();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleLogin = async () => {
    setErrorMessage(null);

    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (!password.trim()) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Step 1: verify the password. Result objects can carry session data, so
      // they are not logged.
      const result = await signIn.password({
        identifier: email.trim(),
        password,
      });

      if (result?.error) {
        const parsed = formatClerkError(result.error, 'Sign In Failed');
        setErrorMessage(parsed.message);

        // If stale or corrupted session, prompt recovery
        if (parsed.isSessionError) {
          try {
            await signOut();
            await signIn.reset();
          } catch (resetErr) {
            console.warn('Session reset error:', resetErr);
          }
        }
        return;
      }

      // Step 2: when the account has two-step verification enabled, Clerk
      // returns `needs_second_factor`. Hand off to the verification screen
      // WITHOUT finalizing - no session exists until the second factor passes,
      // so this step cannot be skipped.
      if (signIn.status === 'needs_second_factor') {
        router.push('/auth/two-factor' as any);
        return;
      }

      // A forced password reset is routed to the existing recovery flow.
      if (signIn.status === 'needs_new_password') {
        setErrorMessage('Your password needs to be reset before you can sign in. Use “Forgot password?” to continue.');
        return;
      }

      if (signIn.status !== 'complete') {
        setErrorMessage('Additional verification is required to sign in. Please try again.');
        return;
      }

      // No second factor required: finalize and start the session.
      const finalized = await signIn.finalize();

      if (finalized?.error) {
        const parsed = formatClerkError(finalized.error, 'Sign In Failed');
        setErrorMessage(parsed.message);
        return;
      }

      if (signIn.createdSessionId) {
        await setActive({ session: signIn.createdSessionId });
      }

      // Resumes a pending invitation if the user got here from an email link.
      router.replace((await resolvePostAuthRoute()) as any);
    } catch (err: any) {
      console.error('LOGIN UNHANDLED ERROR:', err);
      const parsed = formatClerkError(err, 'Sign In Failed');
      setErrorMessage(parsed.message);

      if (parsed.isSessionError) {
        try {
          await signOut();
        } catch {}
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricAuth = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Biometric Sign In',
      'Biometric authentication is configured inside your Vault Settings after initial sign in.'
    );
  };

  return (
    <LinearGradient colors={['#050B18', '#0A1628', '#050B18']} style={styles.bg}>
      <View style={styles.orbTL} />
      <View style={styles.orbBR} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: topPad + 24, paddingBottom: botPad + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo Header */}
          <View style={styles.logoRow}>
            <Ionicons name="shield-checkmark" size={28} color="#00D4FF" />
            <Text style={styles.logoText}>SecureSphere</Text>
          </View>

          {/* Title Block */}
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your encrypted vault</Text>
          </View>

          {/* Inline Error Banner */}
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color="#FF3B5C" />
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          )}

          {/* Form */}
          <View style={styles.form}>
            {/* Email Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="mail-outline"
                  size={18}
                  color="#7A9BB5"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={(val) => {
                    setEmail(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#7A9BB5"
                  placeholder="your@email.com"
                  editable={!loading}
                />
              </View>
            </View>

            {/* Password Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color="#7A9BB5"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={password}
                  onChangeText={(val) => {
                    setPassword(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  secureTextEntry={!showPassword}
                  placeholderTextColor="#7A9BB5"
                  placeholder="••••••••"
                  editable={!loading}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={18}
                    color="#7A9BB5"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Forgot Password Link */}
            <TouchableOpacity
              style={styles.forgotRow}
              onPress={() => router.push('/auth/forgot-password' as any)}
              disabled={loading}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            {/* Submit Button */}
            <TouchableOpacity
              onPress={handleLogin}
              activeOpacity={0.8}
              disabled={loading}
              style={[styles.loginBtnContainer, loading && styles.disabledBtn]}
            >
              <LinearGradient
                colors={['#00D4FF', '#0066FF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginBtn}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#050B18" />
                ) : (
                  <Text style={styles.loginBtnText}>Sign In Securely</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.divText}>or</Text>
              <View style={styles.divLine} />
            </View>

            {/* Biometric Option */}
            <TouchableOpacity
              style={styles.biometricBtn}
              activeOpacity={0.8}
              onPress={handleBiometricAuth}
              disabled={loading}
            >
              <Ionicons name="finger-print" size={20} color="#00D4FF" />
              <Text style={styles.biometricText}>Sign in with Biometrics</Text>
            </TouchableOpacity>
          </View>

          {/* Register Link */}
          <TouchableOpacity
            style={styles.registerRow}
            onPress={() => router.push('/auth/register')}
            disabled={loading}
          >
            <Text style={styles.registerText}>Don&apos;t have an account? </Text>
            <Text style={styles.registerLink}>Create one</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#050B18' },
  orbTL: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(0,212,255,0.06)',
  },
  orbBR: {
    position: 'absolute',
    bottom: -60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(0,102,255,0.07)',
  },
  scroll: { paddingHorizontal: 24, flexGrow: 1 },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 36,
  },
  logoText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#E8F4FD' },
  titleBlock: { marginBottom: 28, gap: 8 },
  title: { fontSize: 32, fontFamily: 'Inter_700Bold', color: '#E8F4FD' },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#7A9BB5' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255, 59, 92, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 92, 0.3)',
    padding: 12,
    marginBottom: 16,
  },
  errorBannerText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#FF3B5C',
    flex: 1,
  },
  form: { gap: 16 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#A8C4DC' },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A2D4A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A3050',
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#E8F4FD',
  },
  forgotRow: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#00D4FF' },
  loginBtnContainer: { marginTop: 4 },
  disabledBtn: { opacity: 0.5 },
  loginBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#050B18' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  divLine: { flex: 1, height: 1, backgroundColor: '#1A3050' },
  divText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#7A9BB5' },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A3050',
    paddingVertical: 15,
    backgroundColor: '#0D1B2A',
  },
  biometricText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#00D4FF',
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  registerText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#7A9BB5',
  },
  registerLink: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#00D4FF',
  },
});
