import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import { scanFile, ScanResult } from "@/lib/scanning/scanner";
import { isUploadScanApproved } from "@/lib/scanning/uploadPolicy";
import { encryptFileData, storeKeySecurely } from "@/lib/encryption";
import { provisionDeviceKey } from "@/lib/deviceKeys";
import { createDocumentSearchTokens, extractSearchableText, prepareDocumentSearchTerms } from "@/lib/searchIndex";
import { extractPdfText, PdfTextExtractionError } from "@/lib/pdfTextExtractor";
import { useAuthenticatedApi } from "@/lib/authenticatedApi";
import { useUser } from "@clerk/expo";

type UploadState =
  | "idle"
  | "selected"
  | "analyzing"
  | "scan_complete"
  | "blocked"
  | "encrypting"
  | "encrypted"
  | "uploading"
  | "uploaded"
  | "error";

export default function Upload() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useAuthenticatedApi();
  const { user } = useUser();

  const [state, setState] = useState<UploadState>("idle");
  const [selectedFile, setSelectedFile] = useState<{
    uri: string;
    name: string;
    size: number;
    mimeType?: string;
  } | null>(null);

  const [scanResult, setScanResult] = useState<{
    verdict: string;
    confidence: number;
    reasonCode?: string;
  } | null>(null);

  const [errorMsg, setErrorMsg] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  const uploadScale = useSharedValue(1);
  const iconRotation = useSharedValue(0);

  const uploadStyle = useAnimatedStyle(() => ({
    transform: [{ scale: uploadScale.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${iconRotation.value}deg` }],
  }));

  useEffect(() => {
    if (
      state === "analyzing" ||
      state === "encrypting" ||
      state === "uploading"
    ) {
      iconRotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      iconRotation.value = withTiming(0, { duration: 300 });
    }
  }, [state]);

  const handleSelectFile = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      uploadScale.value = withSequence(
        withTiming(0.94, { duration: 100 }),
        withTiming(1, { duration: 100 }),
      );

      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const file = result.assets[0];
      if (__DEV__) {
        const leafName = file.name.split(/[\\/]/).pop() || "";
        const dot = leafName.lastIndexOf(".");
        console.info("[SecureSphere scan] file-selected", {
          extension: dot >= 0 ? leafName.slice(dot + 1).toLowerCase() : null,
          reportedMimeType: file.mimeType || null,
          fileSizeBytes: Number.isFinite(file.size) ? file.size : null,
        });
      }
      setSelectedFile({
        uri: file.uri,
        name: file.name,
        size: file.size || 0,
        mimeType: file.mimeType,
      });
      setState("selected");
    } catch (error) {
      console.error("File picker error:", error);
      setState("idle");
    }
  };

  const processFile = async () => {
    if (!selectedFile) return;

    setState("analyzing");

    // 1. Local AI Malware Inference
    const result = await scanFile(
      selectedFile.uri,
      selectedFile.name,
      selectedFile.size,
      selectedFile.mimeType,
    );

    if (result.verdict === "ERROR") {
      setScanResult({ verdict: result.verdict, confidence: result.confidence, reasonCode: result.reasonCode });
      setErrorMsg(result.error || "Failed to scan file");
      setState("error");
      return;
    }

    setScanResult({ verdict: result.verdict, confidence: result.confidence, reasonCode: result.reasonCode });
    setErrorMsg(result.error || "");

    if (!isUploadScanApproved(result.verdict)) {
      setState("blocked");
      if (result.verdict === "MALICIOUS" || result.verdict === "UNCERTAIN" || result.verdict === "CORRUPTED") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return; // Unassessed, malformed, or flagged files are never uploaded.
    }

    setState("scan_complete");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Pass the result directly. State updates are asynchronous, and the
    // delayed callback previously captured the old null scanResult value.
    setTimeout(() => {
      void encryptAndUpload(result);
    }, 1500);
  };

  const encryptAndUpload = async (completedScan: ScanResult) => {
    if (!selectedFile) return;
    if (!isUploadScanApproved(completedScan.verdict)) {
      setErrorMsg("Only files that completed the local scan can be uploaded.");
      setState("error");
      return;
    }

    try {
      setState("encrypting");

      // Read plaintext file
      const response = await fetch(selectedFile.uri);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const plaintext = new Uint8Array(arrayBuffer);

      if (!user?.id) {
        throw new Error("Your authenticated search key is unavailable. Please sign in again before uploading.");
      }

      // Provision synchronously here as well as at sign-in. This removes the
      // first-run race where upload reached token generation before AppContext
      // had finished registering the device public key.
      await provisionDeviceKey(user.id, api.request);

      const isPdf = selectedFile.name.toLowerCase().endsWith(".pdf") || selectedFile.mimeType === "application/pdf";
      let pdfExtraction = null;
      try {
        pdfExtraction = isPdf ? await extractPdfText(plaintext) : null;
      } catch (error) {
        if (error instanceof PdfTextExtractionError) {
          console.warn("PDF indexing unavailable", {
            filename: selectedFile.name,
            mimeType: selectedFile.mimeType ?? "unknown",
            byteLength: plaintext.length,
            extractionMethod: "pdfjs",
            pdfjsSucceeded: false,
          });
          throw new Error("PDF text extraction failed. Please retry or use a different text-based PDF.");
        }
        throw error;
      }
      const searchableText = pdfExtraction
        ? pdfExtraction.text
        : extractSearchableText(plaintext, selectedFile.name, selectedFile.mimeType);
      const normalizedTerms = pdfExtraction
        ? prepareDocumentSearchTerms(searchableText)
        : null;

      // A parser can return font glyph bytes that are non-empty but cannot be
      // tokenized into text. Treat that exactly like an image-only PDF: an
      // empty blind index must never be uploaded as a successful PDF index.
      if (isPdf && (!searchableText || normalizedTerms?.length === 0)) {
        throw new Error("PDF has no extractable text; OCR is required.");
      }

      // Build the blind index from extracted local text, never from raw PDF
      // bytes. Only the opaque HMAC output leaves this device.
      const searchTokens = await createDocumentSearchTokens(
        user.id,
        searchableText,
      );
      if (pdfExtraction) {
        console.info("PDF extraction", {
          filename: selectedFile.name,
          mimeType: selectedFile.mimeType ?? "unknown",
          byteLength: plaintext.length,
          pageCount: pdfExtraction.pageCount,
          generatedTokenCount: searchTokens.length,
          extractedTextLength: searchableText.length,
          normalizedTermCount: normalizedTerms!.length,
          extractionMethod: "pdfjs",
          pdfjsSucceeded: true,
        });
      }

       // Encrypt locally
       const { ciphertext, ivHex, keyHex } = encryptFileData(plaintext);

       // Reserve the database UUID locally and persist its key before any
       // ciphertext leaves this device. If secure storage fails, no upload is
       // attempted and therefore no unrecoverable server record can exist.
       const fileId = Crypto.randomUUID();
       await storeKeySecurely(fileId, keyHex);

      // Free plaintext
      plaintext.fill(0);

      setState("encrypted");

      setTimeout(async () => {
        try {
          setState("uploading");

          // Only ciphertext goes to the backend
           const formData = new FormData();
           formData.append("fileId", fileId);
           formData.append("filename", selectedFile.name);
          formData.append(
            "mimeType",
            selectedFile.mimeType || "application/octet-stream",
          );
          formData.append("iv", ivHex);
          formData.append("malwareScanResult", completedScan.verdict);
          formData.append(
            "malwareScanConfidence",
            completedScan.confidence.toString(),
          );
          formData.append("searchTokens", JSON.stringify(searchTokens));

          // Blob for ciphertext
          const cipherBuffer = ciphertext.slice().buffer as ArrayBuffer;
          const ctBlob = new Blob([cipherBuffer], {
            type: "application/octet-stream",
          });
          formData.append("file", ctBlob as any, "encrypted.bin");

          const res = await api.request("/api/files/upload", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const responseBody = await res.json().catch(() => null);
            const reason =
              responseBody &&
              typeof responseBody === "object" &&
              "error" in responseBody &&
              typeof responseBody.error === "string"
                ? responseBody.error
                : `Upload failed (${res.status}).`;
            throw new Error(reason);
          }

          const data = await res.json() as {
            acceptedTokenCount?: number;
            indexedTokenCount?: number;
            storedTokenCount?: number;
          };
          console.info("Secure upload indexing", {
            submittedTokenCount: searchTokens.length,
            backendAcceptedTokenCount: data.acceptedTokenCount ?? data.indexedTokenCount ?? 0,
            storedTokenCount: data.storedTokenCount ?? data.indexedTokenCount ?? 0,
          });

           setState("uploaded");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e) {
          const message = (e as Error).message;
          setErrorMsg(message);
          setState("error");
        }
      }, 1000);
    } catch (error) {
      setErrorMsg((error as Error).message);
      setState("error");
    }
  };

  const reset = () => {
    setState("idle");
    setSelectedFile(null);
    setScanResult(null);
    setErrorMsg("");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.orbTL} />
      <View style={styles.orbBR} />

      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Secure Upload
        </Text>
      </View>

      <View style={[styles.content, { paddingBottom: botPad + 90 }]}>
        <Animated.View style={uploadStyle}>
          <TouchableOpacity
            onPress={state === "idle" ? handleSelectFile : undefined}
            activeOpacity={state === "idle" ? 0.75 : 1}
            style={[
              styles.dropZone,
              {
                borderColor:
                  state !== "idle" ? colors.primary : `${colors.primary}40`,
                backgroundColor: colors.card,
              },
            ]}
          >
            {state === "idle" && (
              <>
                <View
                  style={[
                    styles.uploadIconBg,
                    { backgroundColor: `${colors.primary}15` },
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark"
                    size={52}
                    color={colors.primary}
                  />
                </View>
                <Text style={[styles.dropTitle, { color: colors.foreground }]}>
                  Select Secure File
                </Text>
                <Text
                  style={[
                    styles.dropSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Local AI Scan → Local Encryption → Secure Upload
                </Text>
              </>
            )}

            {state === "selected" && (
              <>
                <View
                  style={[
                    styles.uploadIconBg,
                    { backgroundColor: `${colors.primary}15` },
                  ]}
                >
                  <Ionicons
                    name="document-text"
                    size={52}
                    color={colors.primary}
                  />
                </View>
                <Text style={[styles.dropTitle, { color: colors.foreground }]}>
                  {selectedFile?.name}
                </Text>
                <TouchableOpacity
                  onPress={processFile}
                  style={[
                    styles.actionBtn,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={styles.actionBtnText}>
                    Begin Secure Analysis
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {(state === "analyzing" ||
              state === "encrypting" ||
              state === "uploading") && (
              <>
                <Animated.View style={iconStyle}>
                  <View
                    style={[
                      styles.uploadIconBg,
                      { backgroundColor: `${colors.primary}15` },
                    ]}
                  >
                    <Ionicons
                      name={
                        state === "analyzing"
                          ? "analytics"
                          : state === "encrypting"
                            ? "lock-closed"
                            : "cloud-upload"
                      }
                      size={52}
                      color={colors.primary}
                    />
                  </View>
                </Animated.View>
                <Text style={[styles.dropTitle, { color: colors.foreground }]}>
                  {state === "analyzing"
                    ? "⟳ AI malware analysis..."
                    : state === "encrypting"
                      ? "○ Local encryption..."
                      : "⟳ Secure upload..."}
                </Text>
                <Text
                  style={[
                    styles.dropSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  File remains on your device for analysis
                </Text>
              </>
            )}

            {(state === "scan_complete" ||
              state === "encrypted" ||
              state === "uploaded") && (
              <>
                <View
                  style={[
                    styles.uploadIconBg,
                    { backgroundColor: "rgba(0,230,118,0.15)" },
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark"
                    size={52}
                    color={colors.success}
                  />
                </View>
                <Text style={[styles.dropTitle, { color: colors.foreground }]}>
                  {state === "scan_complete"
                    ? "✓ AI analysis complete"
                    : state === "encrypted"
                      ? "✓ Encrypted locally"
                      : "✓ Upload Complete"}
                </Text>

                {state === "scan_complete" &&
                  scanResult?.verdict === "SAFE" && (
                    <Text
                      style={[styles.dropSubtitle, { color: colors.success }]}
                    >
                      {scanResult.reasonCode?.endsWith("_RULES_CLEAN")
                        ? "No malicious indicators found by the on-device rule checks."
                        : `No malicious indicators detected. Model malicious score: ${(scanResult.confidence * 100).toFixed(1)}%`}
                    </Text>
                  )}

                {state === "uploaded" && (
                  <TouchableOpacity
                    onPress={reset}
                    style={[styles.resetBtn, { borderColor: colors.border }]}
                  >
                    <Text
                      style={[styles.resetBtnText, { color: colors.primary }]}
                    >
                      Upload another file
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {state === "blocked" && (
              <>
                <View
                  style={[
                    styles.uploadIconBg,
                    { backgroundColor: "rgba(255,59,48,0.15)" },
                  ]}
                >
                  <Ionicons name="warning" size={52} color={"#FF3B30"} />
                </View>
                <Text style={[styles.dropTitle, { color: "#FF3B30" }]}>
                  {scanResult?.verdict === "MALICIOUS" ? "POTENTIAL SECURITY THREAT" : scanResult?.verdict === "UNCERTAIN" ? "NEEDS FURTHER INSPECTION" : scanResult?.verdict === "CORRUPTED" ? "FILE COULD NOT BE VALIDATED" : "FILE TYPE NOT SUPPORTED"}
                </Text>
                <Text
                  style={[styles.dropSubtitle, { color: colors.foreground }]}
                >
                  {scanResult?.verdict === "MALICIOUS" ? errorMsg || "The on-device scan flagged this file as potentially malicious." : scanResult?.verdict === "UNCERTAIN" ? errorMsg || "The scan could not confirm this file is safe, so it was not uploaded." : scanResult?.verdict === "CORRUPTED" ? errorMsg || "The file failed supported format or integrity checks." : errorMsg || "Only TXT, DOCX, PDF and PPTX files can be scanned and uploaded."}
                </Text>
                <Text
                  style={[
                    styles.dropSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {scanResult?.reasonCode ? `Reason: ${scanResult.reasonCode}${scanResult.confidence > 0 ? ` · model score ${(scanResult.confidence * 100).toFixed(1)}%` : ""}` : "No scan verdict was produced."}
                </Text>
                <Text
                  style={[
                    styles.dropSubtitle,
                    { color: "#FF3B30", fontWeight: "bold", marginTop: 10 },
                  ]}
                >
                  UPLOAD BLOCKED. The file was not uploaded.
                </Text>
                <TouchableOpacity
                  onPress={reset}
                  style={[
                    styles.resetBtn,
                    { borderColor: colors.border, marginTop: 15 },
                  ]}
                >
                  <Text
                    style={[styles.resetBtnText, { color: colors.primary }]}
                  >
                    Dismiss
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {state === "error" && (
              <>
                <View
                  style={[
                    styles.uploadIconBg,
                    { backgroundColor: "rgba(255,59,48,0.15)" },
                  ]}
                >
                  <Ionicons name="close-circle" size={52} color={"#FF3B30"} />
                </View>
                <Text style={[styles.dropTitle, { color: "#FF3B30" }]}>
                  {scanResult?.verdict === "ERROR" ? "Scan Failed" : "Upload Failed"}
                </Text>
                <Text
                  style={[styles.dropSubtitle, { color: colors.foreground }]}
                >
                  {errorMsg}
                </Text>
                {scanResult?.verdict === "ERROR" && (
                  <Text style={[styles.dropSubtitle, { color: colors.mutedForeground }]}>The file was not uploaded because its scan did not complete.</Text>
                )}
                <TouchableOpacity
                  onPress={reset}
                  style={[
                    styles.resetBtn,
                    { borderColor: colors.border, marginTop: 15 },
                  ]}
                >
                  <Text
                    style={[styles.resetBtnText, { color: colors.primary }]}
                  >
                    Try Again
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {state === "idle" && (
          <View
            style={[
              styles.infoBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="information-circle"
              size={24}
              color={colors.primary}
            />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              Files never leave your device unencrypted. Malware scanning occurs
              entirely via on-device inference using locally stored JSON AI
              models.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  orbTL: {
    position: "absolute",
    top: -60,
    left: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(0,212,255,0.05)",
  },
  orbBR: {
    position: "absolute",
    bottom: 100,
    right: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(180,79,255,0.05)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  content: { flex: 1, paddingHorizontal: 20, gap: 20 },
  dropZone: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 20,
    minHeight: 350,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 28,
  },
  uploadIconBg: {
    width: 100,
    height: 100,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  dropTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  dropSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  actionBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 10,
  },
  actionBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  resetBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 4,
  },
  resetBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  infoBox: {
    flexDirection: "row",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    alignItems: "center",
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
