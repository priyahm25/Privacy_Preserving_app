import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
  ScrollView,
  ActivityIndicator,
  Clipboard,
  Linking,
  Share,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth, useUser } from "@clerk/expo";
import { useAuthenticatedApi } from "@/lib/authenticatedApi";
import {
  createInvitation,
  deliveryOutcome,
  InvitationError,
  isPendingInvitationError,
  resendInvitation,
  SESSION_EXPIRED_MESSAGE,
  validateInviteEmail,
  type CreatedInvitation,
} from "@/lib/invitationsApi";
import {
  copyText,
  invitationMailto,
  MANUAL_COPY_HINT,
  nativeShare,
  webShare,
  type ClipboardApis,
} from "@/lib/invitationSharing";

type Feedback = { tone: "success" | "info" | "error"; text: string };

// Status and message only - never the request, link or session token.
function logInvitationFailure(label: string, err: unknown) {
  console.warn(
    label,
    err instanceof InvitationError ? err.status : "unexpected",
    err instanceof Error ? err.message : err,
  );
}

// react-native-web's Clipboard.setString ignores execCommand's result and
// reports success even when nothing was copied, so web uses the async
// Clipboard API with a checked execCommand fallback instead.
function legacyWebCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
  }
}

function clipboardApis(): ClipboardApis {
  if (Platform.OS !== "web") {
    return { writeText: async (text) => Clipboard.setString(text) };
  }
  const clipboard =
    typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return {
    writeText: clipboard?.writeText
      ? (text) => clipboard.writeText(text)
      : undefined,
    legacyCopy:
      typeof document !== "undefined" &&
      typeof document.execCommand === "function"
        ? legacyWebCopy
        : undefined,
  };
}

export default function InviteTeammate() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { isLoaded, isSignedIn } = useAuth();
  const { request } = useAuthenticatedApi();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const feedbackColor = (feedback: Feedback) =>
    feedback.tone === "success"
      ? colors.success
      : feedback.tone === "error"
        ? colors.destructive
        : colors.mutedForeground;

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  // Shown inline: Alert.alert is a no-op on web, which hid API errors there.
  const [inviteError, setInviteError] = useState<string | null>(null);
  // State updates are async, so a fast double tap could pass the `loading` check twice.
  const submittingRef = useRef(false);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<Feedback | null>(null);
  const [shareFeedback, setShareFeedback] = useState<Feedback | null>(null);
  const [showManualCopy, setShowManualCopy] = useState(false);
  const [showShareOptions, setShowShareOptions] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const resendingRef = useRef(false);
  // Email whose invitation is already pending; shows "Resend Invitation".
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [deliveryFeedback, setDeliveryFeedback] = useState<Feedback | null>(null);
  const [matches, setMatches] = useState<
    { clerkId: string; name: string | null; email: string }[]
  >([]);

  // Suggest registered users as the inviter types (debounced). Inviting is
  // still by email, so unregistered addresses keep working.
  // Depends on the stable `request`, not Clerk's getToken (a new function each
  // render): with getToken here, the effect re-ran on every render and its
  // setMatches([]) scheduled another render - "Maximum update depth exceeded".
  useEffect(() => {
    const query = email.trim();
    if (query.length < 2 || !isLoaded || !isSignedIn) {
      setMatches((prev) => (prev.length ? [] : prev));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await request(
          `/api/teammates/search?q=${encodeURIComponent(query)}`,
        );
        if (!cancelled) {
          setMatches(response.ok ? ((await response.json()).users ?? []) : []);
        }
      } catch {
        if (!cancelled) setMatches([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email, isLoaded, isSignedIn, request]);

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setInviteError(null);
    setPendingEmail(null);
  };

  const resetInvitation = () => {
    setInvitationLink(null);
    setInvitedEmail(null);
    setExpiresAt(null);
    setCopyFeedback(null);
    setShareFeedback(null);
    setShowManualCopy(false);
    setShowShareOptions(false);
    setEmailSent(false);
    setEmailError(null);
    setInviteError(null);
    setPendingEmail(null);
    setDeliveryFeedback(null);
  };

  const applyInvitation = (
    invitation: CreatedInvitation,
    kind: "created" | "resent",
  ) => {
    const outcome = deliveryOutcome(invitation, kind);
    setInvitationLink(invitation.invitationLink);
    setInvitedEmail(invitation.invitedEmail);
    setExpiresAt(
      invitation.expiresAt
        ? new Date(invitation.expiresAt).toLocaleString()
        : null,
    );
    setEmailSent(invitation.emailSent);
    setEmailError(invitation.emailError);
    setCopyFeedback(null);
    setShareFeedback(null);
    setDeliveryFeedback({ tone: outcome.tone, text: outcome.text });
    setShowShareOptions(outcome.showFallbacks);
    setPendingEmail(null);
    setInviteError(null);
    setEmail("");
  };

  const handleInvite = async () => {
    if (loading || submittingRef.current) {
      return;
    }
    setInviteError(null);
    setPendingEmail(null);

    const validationError = validateInviteEmail(email);
    if (validationError) {
      setInviteError(validationError);
      return;
    }

    if (!isLoaded || !isSignedIn || !user) {
      setInviteError(SESSION_EXPIRED_MESSAGE);
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const invitation = await createInvitation(request, email);

      applyInvitation(invitation, "created");
    } catch (err) {
      logInvitationFailure("Invitation failed:", err);
      // Already pending: offer to resend that invitation instead of a duplicate.
      setPendingEmail(isPendingInvitationError(err) ? email.trim().toLowerCase() : null);
      setInviteError(
        err instanceof InvitationError
          ? err.message
          : "Failed to create invitation. Please try again.",
      );
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  // Re-sends the caller's existing pending invitation (same link, no new
  // invitation). Used from the "already pending" banner and the link view.
  const handleResend = async (targetEmail: string | null) => {
    if (!targetEmail || resending || resendingRef.current) {
      return;
    }
    resendingRef.current = true;
    setResending(true);
    setInviteError(null);
    setDeliveryFeedback(null);
    try {
      const invitation = await resendInvitation(request, targetEmail);
      applyInvitation(invitation, "resent");
    } catch (err) {
      logInvitationFailure("Resend failed:", err);
      const message =
        err instanceof InvitationError
          ? err.message
          : "Failed to resend the invitation. Please try again.";
      if (invitationLink) {
        setDeliveryFeedback({ tone: "error", text: message });
      } else {
        // Expired/accepted/not found: nothing left to resend, so drop the
        // button; "Generate Invitation" issues a fresh one where allowed.
        setPendingEmail(null);
        setInviteError(message);
      }
    } finally {
      resendingRef.current = false;
      setResending(false);
    }
  };

  // Feedback is inline because Alert.alert does nothing on web.
  const handleCopyLink = async () => {
    if (!invitationLink) {
      return;
    }

    const result = await copyText(invitationLink, clipboardApis());
    if (result.ok) {
      setCopyFeedback({ tone: "success", text: "Link copied to clipboard." });
      setShowManualCopy(false);
    } else {
      console.warn("Copy invitation link failed:", result.reason);
      setCopyFeedback({ tone: "error", text: result.message });
      setShowManualCopy(true);
    }
  };

  const handleShareLink = async () => {
    if (!invitationLink) {
      return;
    }

    const result =
      Platform.OS === "web"
        ? await webShare(
            invitationLink,
            typeof navigator !== "undefined" ? navigator : undefined,
          )
        : await nativeShare(invitationLink, (content) => Share.share(content));

    if (result.outcome === "shared") {
      setShareFeedback({ tone: "success", text: "Invitation link shared." });
      setShowShareOptions(false);
    } else if (result.outcome === "cancelled") {
      setShareFeedback({ tone: "info", text: "Sharing cancelled." });
    } else {
      if (result.outcome === "failed") {
        console.warn("Share invitation link failed");
      }
      setShareFeedback({
        tone: result.outcome === "failed" ? "error" : "info",
        text:
          result.outcome === "failed"
            ? result.message
            : "Sharing isn't supported in this browser. Copy the link or send it from your email app instead.",
      });
      setShowShareOptions(true);
    }
  };

  const handleEmailClient = async () => {
    if (!invitationLink) {
      return;
    }
    try {
      await Linking.openURL(
        invitationMailto(
          invitationLink,
          invitedEmail,
          user?.fullName || user?.firstName,
        ),
      );
    } catch (err) {
      console.warn("Opening email app failed:", err instanceof Error ? err.message : err);
      setShareFeedback({
        tone: "error",
        text: "Couldn't open an email app. Copy the link and paste it into your email instead.",
      });
      setShowManualCopy(true);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.orbTL} />

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { paddingTop: topPad + 16 }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[
              styles.backBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Invite Teammate
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.content}>
          {!invitationLink ? (
            <>
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Ionicons
                  name="person-add-outline"
                  size={48}
                  color={colors.primary}
                  style={{ marginBottom: 16 }}
                />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Invite a Teammate
                </Text>
                <Text
                  style={[
                    styles.cardDescription,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Share secure collaboration with your team members
                </Text>
              </View>

              <View style={styles.form}>
                <Text style={[styles.label, { color: colors.foreground }]}>
                  Email Address
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  placeholder="teammate@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  value={email}
                  onChangeText={handleEmailChange}
                  keyboardType="email-address"
                  editable={!loading}
                  autoCapitalize="none"
                />

                {matches
                  .filter((m) => m.email !== email.trim().toLowerCase())
                  .slice(0, 5)
                  .map((m) => (
                    <TouchableOpacity
                      key={m.clerkId}
                      onPress={() => handleEmailChange(m.email)}
                      style={[
                        styles.suggestion,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                    >
                      <Ionicons name="person-circle" size={20} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontSize: 14 }}>
                          {m.name || m.email.split("@")[0]}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                          {m.email}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}

                <TouchableOpacity
                  onPress={handleInvite}
                  disabled={loading || resending}
                  style={[
                    styles.inviteBtn,
                    {
                      backgroundColor: loading
                        ? `${colors.primary}80`
                        : colors.primary,
                    },
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator
                      color={colors.primaryForeground}
                      size="small"
                    />
                  ) : (
                    <>
                      <Ionicons
                        name="send"
                        size={16}
                        color={colors.primaryForeground}
                      />
                      <Text
                        style={[
                          styles.inviteBtnText,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        Generate Invitation
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {inviteError ? (
                  <View
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.errorRow,
                      {
                        backgroundColor: `${colors.destructive}15`,
                        borderColor: `${colors.destructive}40`,
                      },
                    ]}
                  >
                    <Ionicons
                      name="alert-circle-outline"
                      size={16}
                      color={colors.destructive}
                    />
                    <Text
                      style={[styles.errorText, { color: colors.destructive }]}
                    >
                      {inviteError}
                    </Text>
                  </View>
                ) : null}

                {pendingEmail ? (
                  <TouchableOpacity
                    onPress={() => handleResend(pendingEmail)}
                    disabled={resending}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: `${colors.primary}15`,
                        borderColor: colors.primary,
                        opacity: resending ? 0.6 : 1,
                      },
                    ]}
                  >
                    {resending ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons name="refresh" size={18} color={colors.primary} />
                    )}
                    <Text
                      style={[styles.actionBtnText, { color: colors.primary }]}
                    >
                      {resending ? "Resending..." : "Resend Invitation"}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <Text
                  style={[styles.helperText, { color: colors.mutedForeground }]}
                >
                  We email them a secure invitation link. It expires in 7 days
                  and only works for this address.
                </Text>
              </View>
            </>
          ) : (
            <>
              <View
                style={[
                  styles.successCard,
                  {
                    backgroundColor: `${colors.success}15`,
                    borderColor: `${colors.success}40`,
                  },
                ]}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={48}
                  color={colors.success}
                  style={{ marginBottom: 16 }}
                />
                <Text
                  style={[styles.successTitle, { color: colors.foreground }]}
                >
                  Invitation Created
                </Text>
                <Text
                  style={[
                    styles.successDescription,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Successfully created invitation for
                </Text>
                <Text style={[styles.emailDisplay, { color: colors.primary }]}>
                  {invitedEmail}
                </Text>
                {expiresAt ? (
                  <Text
                    style={[
                      styles.expiresText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Expires: {expiresAt}
                  </Text>
                ) : null}

                {deliveryFeedback ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.deliveryFeedback,
                      { color: feedbackColor(deliveryFeedback) },
                    ]}
                  >
                    {deliveryFeedback.text}
                  </Text>
                ) : null}

                <View
                  style={[
                    styles.deliveryRow,
                    {
                      backgroundColor: emailSent
                        ? `${colors.success}15`
                        : `${colors.warning}15`,
                      borderColor: emailSent
                        ? `${colors.success}40`
                        : `${colors.warning}40`,
                    },
                  ]}
                >
                  <Ionicons
                    name={emailSent ? "mail-open-outline" : "mail-unread-outline"}
                    size={16}
                    color={emailSent ? colors.success : colors.warning}
                  />
                  <Text
                    style={[
                      styles.deliveryText,
                      { color: emailSent ? colors.success : colors.warning },
                    ]}
                  >
                    {emailSent
                      ? "Invitation email delivered"
                      : `Email not sent. ${emailError || "Share the invitation link below instead."}`}
                  </Text>
                </View>
              </View>

              <View style={styles.linksSection}>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Invitation Link
                </Text>

                <View
                  style={[
                    styles.linkBox,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    selectable
                    style={[styles.linkText, { color: colors.foreground }]}
                    numberOfLines={showManualCopy ? undefined : 4}
                  >
                    {invitationLink}
                  </Text>
                </View>

                {showManualCopy ? (
                  <Text
                    style={[styles.helperText, { color: colors.mutedForeground, marginTop: 0 }]}
                  >
                    {MANUAL_COPY_HINT}
                  </Text>
                ) : null}

                <TouchableOpacity
                  onPress={handleCopyLink}
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="copy" size={18} color={colors.primary} />
                  <Text
                    style={[styles.actionBtnText, { color: colors.foreground }]}
                  >
                    Copy Link
                  </Text>
                </TouchableOpacity>

                {copyFeedback ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.copyFeedback,
                      { color: feedbackColor(copyFeedback) },
                    ]}
                  >
                    {copyFeedback.text}
                  </Text>
                ) : null}

                <TouchableOpacity
                  onPress={handleShareLink}
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="share-social"
                    size={18}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.actionBtnText, { color: colors.foreground }]}
                  >
                    Share Link
                  </Text>
                </TouchableOpacity>

                {shareFeedback ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.copyFeedback,
                      { color: feedbackColor(shareFeedback) },
                    ]}
                  >
                    {shareFeedback.text}
                  </Text>
                ) : null}

                {showShareOptions ? (
                  <TouchableOpacity
                    onPress={handleEmailClient}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name="open-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <Text
                      style={[styles.actionBtnText, { color: colors.foreground }]}
                    >
                      Open in Email App
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={() => handleResend(invitedEmail)}
                  disabled={!invitedEmail || resending}
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: !invitedEmail || resending ? 0.6 : 1,
                    },
                  ]}
                >
                  {resending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons
                      name="mail-outline"
                      size={18}
                      color={colors.primary}
                    />
                  )}
                  <Text
                    style={[styles.actionBtnText, { color: colors.foreground }]}
                  >
                    {resending
                      ? "Sending..."
                      : emailSent
                        ? "Resend Email"
                        : "Retry Sending Email"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={resetInvitation}
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: `${colors.primary}15`,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Ionicons
                    name="person-add-outline"
                    size={18}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.actionBtnText, { color: colors.primary }]}
                  >
                    Invite Another
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => router.back()}
                style={[
                  styles.backBtn,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    width: "100%",
                    marginTop: 20,
                  },
                ]}
              >
                <Text
                  style={[styles.backBtnText, { color: colors.foreground }]}
                >
                  Back to Teammates
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  orbTL: {
    position: "absolute",
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(0,102,255,0.05)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    marginBottom: 28,
    marginTop: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  form: {
    gap: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginTop: 8,
  },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 12,
  },
  inviteBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  deliveryFeedback: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: 12,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  helperText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
    textAlign: "center",
  },
  successCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    marginBottom: 28,
    marginTop: 16,
  },
  successTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  successDescription: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 8,
  },
  emailDisplay: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  expiresText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 8,
  },
  deliveryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
  },
  deliveryText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  linksSection: {
    gap: 10,
    marginTop: 24,
  },
  copyFeedback: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    marginTop: -4,
    marginBottom: 2,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  actionBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  linkBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
  },
  linkText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
});
