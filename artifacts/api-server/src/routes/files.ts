import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import {
  db,
  usersTable,
  teammatesTable,
  filesTable,
  fileSearchTokensTable,
  fileSharesTable,
  userDeviceKeysTable,
  type ScanVerdict,
  type SharePermission,
} from "@workspace/db";
import { eq, and, inArray, desc, isNull, sql } from "drizzle-orm";
import { requireAuth, getClerkId } from "../middlewares/auth";
import {
  buildObjectPath,
  uploadEncryptedObject,
  downloadEncryptedObject,
  deleteEncryptedObject,
  getStorageConfig,
  isStorageConfigured,
  StorageOperationError,
} from "../lib/supabaseStorage";
import { logger } from "../lib/logger";
import {
  MAX_INDEXED_SEARCH_TOKENS,
  MAX_SEARCH_RESULTS,
  parseSearchRequest,
  parseSearchTokens,
} from "../lib/searchValidation";

const router = Router();

router.use(requireAuth);

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Files are held in memory only long enough to scan and encrypt them. The
// plaintext never touches disk and never leaves this process unencrypted.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/**
 * Multer reports failures through `next(err)`, which would otherwise bypass the
 * route handler and fall through to Express' HTML error page. Translate them
 * into the same JSON shape the rest of the API returns.
 */
function acceptUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? `File is too large. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`
          : `Upload failed: ${err.message}`;
      res.status(400).json({ error: message });
      return;
    }

    next(err);
  });
}

/** Map a MIME type onto the file kinds the app knows how to render. */
function resolveFileKind(mimeType: string, fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";

  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (ext === "doc" || ext === "docx" || mimeType.includes("wordprocessingml"))
    return "docx";
  if (ext === "ppt" || ext === "pptx" || mimeType.includes("presentationml"))
    return "pptx";
  if (
    ext === "xls" ||
    ext === "xlsx" ||
    ext === "csv" ||
    mimeType.includes("spreadsheetml")
  )
    return "xlsx";
  return "txt";
}

/**
 * The shape the mobile app consumes.
 *
 * Never includes `supabasePath` or `iv`: those are internal storage details,
 * and handing them to a client would invite attempts to reach the bucket
 * directly instead of going through this API, which is where authorisation and
 * decryption live.
 */
function toFileResponse(row: {
  id: string;
  ownerClerkId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  encrypted: boolean;
  malwareScanResult: ScanVerdict | null;
  malwareScanConfidence: number | null;
  createdAt: Date;
}) {
  const mimeType = row.mimeType ?? "application/octet-stream";

  return {
    id: row.id,
    ownerId: row.ownerClerkId,
    name: row.filename,
    mimeType,
    type: resolveFileKind(mimeType, row.filename),
    sizeBytes: row.sizeBytes ?? 0,
    encrypted: row.encrypted,
    encryptionAlgorithm: "aes-256-gcm",
    scan: {
      verdict: row.malwareScanResult,
      // Stored as 0.0-1.0; the app displays 0-100.
      riskScore: Math.round((row.malwareScanConfidence ?? 0) * 100),
    },
    createdAt: row.createdAt,
    modifiedAt: row.createdAt,
  };
}

const fileColumns = {
  id: filesTable.id,
  ownerClerkId: filesTable.ownerClerkId,
  filename: filesTable.filename,
  mimeType: filesTable.mimeType,
  sizeBytes: filesTable.sizeBytes,
  encrypted: filesTable.encrypted,
  malwareScanResult: filesTable.malwareScanResult,
  malwareScanConfidence: filesTable.malwareScanConfidence,
  createdAt: filesTable.createdAt,
};

/**
 * Express 5 types route params as `string | string[]` (a param can repeat).
 * A file id is always singular, so collapse it to one value.
 */
function paramId(req: Request): string {
  const value = req.params.id;
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const CLIENT_FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Extract driver diagnostics without logging Drizzle's SQL text or parameters. */
function databaseErrorContext(error: unknown) {
  const source = error && typeof error === "object" && "cause" in error
    ? error.cause
    : error;
  if (!source || typeof source !== "object") return undefined;
  return {
    code: "code" in source ? String(source.code) : undefined,
    table: "table" in source ? String(source.table) : undefined,
    column: "column" in source ? String(source.column) : undefined,
    constraint: "constraint" in source ? String(source.constraint) : undefined,
  };
}

router.post(
  "/upload",
  acceptUpload,
  async (req: Request, res: Response): Promise<void> => {
    let uploadedPath: string | null = null;
    let objectPath: string | null = null;
    let failureStage = "request-validation";
    let ciphertextBytes: number | null = null;

    try {
      const clerkId = getClerkId(req);
      const file = req.file;
      const filename =
        typeof req.body?.filename === "string" && req.body.filename.trim()
          ? req.body.filename.trim()
          : file?.originalname || "untitled";
      const mimeType =
        typeof req.body?.mimeType === "string" && req.body.mimeType.trim()
          ? req.body.mimeType.trim()
          : "application/octet-stream";
      const iv = typeof req.body?.iv === "string" ? req.body.iv.trim() : "";
      const scanResult =
        typeof req.body?.malwareScanResult === "string"
          ? req.body.malwareScanResult.trim().toUpperCase()
          : "";
      const confidence = Number(req.body?.malwareScanConfidence ?? 0);
      const searchTokens = parseSearchTokens(req.body?.searchTokens);
      const clientFileId = typeof req.body?.fileId === "string" ? req.body.fileId : undefined;

      if (!file) {
        res.status(400).json({ error: "No file was uploaded." });
        return;
      }

      if (file.size === 0) {
        res.status(400).json({ error: "The encrypted file is empty." });
        return;
      }
      ciphertextBytes = file.buffer.length;

      if (searchTokens === null) {
        res.status(400).json({ error: "Search tokens must be a bounded JSON array of opaque HMAC-SHA-256 values." });
        return;
      }

      if (clientFileId !== undefined && !CLIENT_FILE_ID_PATTERN.test(clientFileId)) {
        res.status(400).json({ error: "A valid client file ID is required when supplied." });
        return;
      }

      if (!/^[0-9a-fA-F]{24}$/.test(iv)) {
        res
          .status(400)
          .json({ error: "A valid 12-byte encryption IV is required." });
        return;
      }

      if (
        scanResult !== "SAFE" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        res
          .status(422)
          .json({ error: "The file did not pass the local security scan." });
        return;
      }

      const user = await requireUserRow(clerkId);
      if (!user) {
        res.status(404).json({
          error: "User profile not found. Sign out and back in to sync it.",
        });
        return;
      }

      failureStage = "storage-config";
      if (!isStorageConfigured()) {
        res.status(503).json({
          error:
            "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        });
        return;
      }

      failureStage = "storage-upload";
      objectPath = buildObjectPath(clerkId);
      logger.info(
        {
          stage: failureStage,
          bucket: getStorageConfig().bucket,
          path: objectPath,
          ciphertextBytes,
          contentType: "application/octet-stream",
        },
        "Uploading encrypted object to Storage",
      );
      await uploadEncryptedObject(objectPath, file.buffer);
      uploadedPath = objectPath;
      const storedObjectPath = objectPath;

      failureStage = "database-transaction";
      const stored = await db.transaction(async (tx) => {
        const [fileRow] = await tx
          .insert(filesTable)
          .values({
            id: clientFileId,
            ownerClerkId: clerkId,
            filename,
            mimeType,
            sizeBytes: file.size,
            supabasePath: storedObjectPath,
            iv: iv.toLowerCase(),
            encrypted: true,
            malwareScanResult: "clean",
            malwareScanConfidence: confidence,
          })
          .returning(fileColumns);

        if (searchTokens.length > 0) {
          await tx.insert(fileSearchTokensTable).values(
            searchTokens.map((token) => ({ fileId: fileRow.id, userId: clerkId, token })),
          );
        }
        return fileRow;
      });

      failureStage = "response";
      uploadedPath = null;
      logger.info(
        {
          fileId: stored.id,
          submittedTokenCount: searchTokens.length,
          acceptedTokenCount: searchTokens.length,
          storedTokenCount: searchTokens.length,
        },
        "Encrypted upload and blind index committed",
      );
      res.status(201).json({
        success: true,
        fileId: stored.id,
        file: toFileResponse(stored),
        // Count only: clients can verify indexing without receiving a
        // plaintext term or a blind-index token back from the server.
        indexedTokenCount: searchTokens.length,
        acceptedTokenCount: searchTokens.length,
        storedTokenCount: searchTokens.length,
      });
    } catch (error) {
      if (uploadedPath) {
        await deleteEncryptedObject(uploadedPath).catch((cleanupError) => {
          logger.error(
            { err: cleanupError, path: uploadedPath },
            "Failed to clean up orphaned encrypted object",
          );
        });
      }

      const storageConfig = (() => {
        try {
          const config = getStorageConfig();
          return { bucket: config.bucket, configured: true };
        } catch (configError) {
          return {
            configured: false,
            configError: configError instanceof Error ? configError.message : String(configError),
          };
        }
      })();
      const storageError = error instanceof StorageOperationError ? error.context : undefined;
      const databaseError = databaseErrorContext(error);
      logger.error(
        {
          errorType: error instanceof Error ? error.name : typeof error,
          stage: failureStage,
          storage: {
            ...storageConfig,
            path: objectPath,
            error: storageError,
          },
          ciphertextBytes,
          database: databaseError,
        },
        "Encrypted upload failed",
      );
      res
        .status(500)
        .json({ error: "Failed to store the encrypted file securely." });
    }
  },
);

/** Look up the caller's user row; every file operation is scoped to it. */
async function requireUserRow(clerkId: string) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return rows[0] ?? null;
}

/** Keep only the ids that are actually accepted teammates of the caller. */
async function filterToTeammates(
  clerkId: string,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({ teammateUserId: teammatesTable.teammateUserId })
    .from(teammatesTable)
    .where(
      and(
        eq(teammatesTable.userId, clerkId),
        inArray(teammatesTable.teammateUserId, candidateIds),
      ),
    );

  return rows.map((row) => row.teammateUserId);
}

/**
 * This legacy endpoint previously accepted plaintext multipart uploads and
 * encrypted them on the API server. It is deliberately retired: use /upload,
 * where the client scans, indexes, encrypts, and uploads ciphertext only.
 */
router.post("/share", (_req: Request, res: Response): void => {
  res.status(410).json({
    error: "This plaintext upload endpoint has been retired. Use /api/files/upload with client-side encryption.",
  });
});

/**
 * GET /api/files
 * Files the caller owns plus files teammates shared with them.
 */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);

    const owned = await db
      .select(fileColumns)
      .from(filesTable)
      .where(eq(filesTable.ownerClerkId, clerkId))
      .orderBy(desc(filesTable.createdAt));

    const ownedShares = await db
      .select({
        fileId: fileSharesTable.fileId,
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        email: usersTable.email,
        permission: fileSharesTable.permission,
        createdAt: fileSharesTable.createdAt,
      })
      .from(fileSharesTable)
      .innerJoin(usersTable, eq(usersTable.clerkId, fileSharesTable.sharedWithUserId))
      .innerJoin(filesTable, eq(filesTable.id, fileSharesTable.fileId))
      .where(eq(filesTable.ownerClerkId, clerkId));

    const sharedWithMe = await db
      .select({
        ...fileColumns,
        sharedById: usersTable.clerkId,
        sharedByName: usersTable.name,
        sharedByEmail: usersTable.email,
        permission: fileSharesTable.permission,
        sharedAt: fileSharesTable.createdAt,
      })
      .from(fileSharesTable)
      .innerJoin(filesTable, eq(filesTable.id, fileSharesTable.fileId))
      .innerJoin(usersTable, eq(usersTable.clerkId, fileSharesTable.sharedByUserId))
      .where(eq(fileSharesTable.sharedWithUserId, clerkId))
      .orderBy(desc(filesTable.createdAt));

    res.json({
      owned: owned.map((file) => ({
        ...toFileResponse(file),
        shares: ownedShares
          .filter((share) => share.fileId === file.id)
          .map(({ fileId: _fileId, ...share }) => share),
      })),
      sharedWithMe: sharedWithMe.map((file) => ({
        ...toFileResponse(file),
        permission: file.permission,
        sharedAt: file.sharedAt,
        sharedBy: {
          clerkId: file.sharedById,
          name: file.sharedByName,
          email: file.sharedByEmail,
        },
      })),
    });
    return;
  } catch (error) {
    logger.error({ err: error }, "Failed to list files");
    res.status(500).json({ error: "Failed to list files." });
    return;
  }
});

/**
 * POST /api/files/search
 * Receives HMAC tokens only. The database compares opaque values and never
 * receives query words, document text, encryption keys, or ciphertext bytes.
 */
router.post("/search", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);
    const searchRequest = parseSearchRequest(req.body);
    if (!searchRequest) {
      res.status(400).json({ error: "Invalid encrypted-search request." });
      return;
    }
    const { tokens, mode, page, pageSize } = searchRequest;
    if (page * pageSize >= MAX_SEARCH_RESULTS) {
      res.json({ files: [], nextPage: null });
      return;
    }
    if (tokens.length === 0) {
      res.json({ files: [], nextPage: null });
      return;
    }

    const matchedFileRows = await db
      .select({ fileId: fileSearchTokensTable.fileId, createdAt: filesTable.createdAt })
      .from(fileSearchTokensTable)
      .innerJoin(filesTable, eq(filesTable.id, fileSearchTokensTable.fileId))
      .where(and(
        eq(fileSearchTokensTable.userId, clerkId),
        eq(filesTable.ownerClerkId, clerkId),
        inArray(fileSearchTokensTable.token, tokens),
      ))
      .groupBy(fileSearchTokensTable.fileId, filesTable.createdAt)
      .having(mode === "AND"
        ? sql`count(distinct ${fileSearchTokensTable.token}) = ${tokens.length}`
        : undefined)
      .orderBy(desc(filesTable.createdAt), desc(fileSearchTokensTable.fileId))
      .limit(Math.min(pageSize + 1, MAX_SEARCH_RESULTS - page * pageSize))
      .offset(page * pageSize);

    const hasMore = matchedFileRows.length > pageSize;
    const fileIds = matchedFileRows.slice(0, pageSize).map((row) => row.fileId);

    if (fileIds.length === 0) {
      logger.info(
        {
          stage: "search-response",
          mode,
          submittedTokenCount: tokens.length,
          matchedFileCount: 0,
          page,
          nextPage: null,
        },
        "Encrypted search completed",
      );
      res.json({ files: [], nextPage: null });
      return;
    }

    const files = await db
      .select(fileColumns)
      .from(filesTable)
      .where(and(eq(filesTable.ownerClerkId, clerkId), inArray(filesTable.id, fileIds)))
      .orderBy(desc(filesTable.createdAt), desc(filesTable.id));
    logger.info(
      {
        stage: "search-response",
        mode,
        submittedTokenCount: tokens.length,
        matchedFileCount: files.length,
        page,
        nextPage: hasMore ? page + 1 : null,
      },
      "Encrypted search completed",
    );
    res.json({
      files: files.map(toFileResponse),
      nextPage: hasMore && (page + 1) * pageSize < MAX_SEARCH_RESULTS ? page + 1 : null,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to search encrypted files");
    res.status(500).json({ error: "Failed to search encrypted files." });
  }
});

/** Resolve a file the caller is allowed to see, or null. */
async function findAccessibleFile(fileId: string, clerkId: string) {
  const rows = await db
    .select()
    .from(filesTable)
    .where(eq(filesTable.id, fileId))
    .limit(1);

  const file = rows[0];
  if (!file) {
    return { file: null, isOwner: false };
  }

  if (file.ownerClerkId === clerkId) {
    return { file, isOwner: true };
  }

  const share = await db
    .select()
    .from(fileSharesTable)
    .where(
      and(
        eq(fileSharesTable.fileId, fileId),
        eq(fileSharesTable.sharedWithUserId, clerkId),
      ),
    )
    .limit(1);

  return { file: share.length > 0 ? file : null, isOwner: false };
}

/**
 * GET /api/files/:id
 * Metadata plus the recipient list. No content, no storage path.
 */
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);
    const { file, isOwner } = await findAccessibleFile(paramId(req), clerkId);

    if (!file) {
      res.status(404).json({ error: "File not found." });
      return;
    }

    const shares = await db
      .select({
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        email: usersTable.email,
        permission: fileSharesTable.permission,
        createdAt: fileSharesTable.createdAt,
      })
      .from(fileSharesTable)
      .innerJoin(
        usersTable,
        eq(usersTable.clerkId, fileSharesTable.sharedWithUserId),
      )
      .where(eq(fileSharesTable.fileId, file.id));

    res.json({
      file: toFileResponse(file),
      isOwner,
      sharedWith: shares,
    });
    return;
  } catch (error) {
    logger.error({ err: error }, "Failed to load file");
    res.status(500).json({ error: "Failed to load the file." });
    return;
  }
});

/**
 * GET /api/files/:id/content
 *
 * Fetch the ciphertext from Storage and decrypt it here, in the API. This is
 * the only place a file exists as plaintext again, and it happens after the
 * caller's access has been checked. No signed Storage URL is ever issued, so
 * there is no path by which a client reads the bucket directly.
 *
 * GCM authenticates as it decrypts: a modified object fails rather than
 * returning corrupted bytes.
 */
router.get(
  "/:id/key-share",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const clerkId = getClerkId(req);
      const [share] = await db.select().from(fileSharesTable).where(and(eq(fileSharesTable.fileId, paramId(req)), eq(fileSharesTable.sharedWithUserId, clerkId))).limit(1);
      if (!share || !share.wrappedFileKey || !share.wrappingIv || !share.ownerDeviceKeyId) { res.status(404).json({ error: "No usable secure share was found." }); return; }
      const [ownerKey] = await db.select({ publicKey: userDeviceKeysTable.publicKey }).from(userDeviceKeysTable).where(eq(userDeviceKeysTable.id, share.ownerDeviceKeyId)).limit(1);
      if (!ownerKey) { res.status(409).json({ error: "Owner device key is unavailable." }); return; }
      const [file] = await db.select({ iv: filesTable.iv }).from(filesTable).where(eq(filesTable.id, share.fileId)).limit(1);
      if (!file?.iv) { res.status(409).json({ error: "File encryption metadata is unavailable." }); return; }
      res.json({ wrappedFileKey: share.wrappedFileKey, wrappingIv: share.wrappingIv, wrappingAlgorithm: share.wrappingAlgorithm, ownerPublicKey: ownerKey.publicKey, ownerDeviceKeyId: share.ownerDeviceKeyId, recipientDeviceKeyId: share.recipientDeviceKeyId, fileIv: file.iv });
    } catch (error) { logger.error({ err: error }, "Failed to load secure share key"); res.status(500).json({ error: "Failed to load secure share key." }); }
  },
);

router.get(
  "/:id/content",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const clerkId = getClerkId(req);
      const { file } = await findAccessibleFile(paramId(req), clerkId);

      if (!file) {
        res.status(404).json({ error: "File not found." });
        return;
      }

      let cipherBlob: Buffer;
      try {
        cipherBlob = await downloadEncryptedObject(file.supabasePath);
      } catch (error) {
        logger.error(
          { err: error, fileId: file.id },
          "Failed to fetch encrypted object from Storage",
        );
        res.status(502).json({ error: "Could not retrieve the stored file." });
        return;
      }

      // The API only authorizes and proxies opaque ciphertext. Decryption is
      // exclusively client-side, using the device-local key material.
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(file.filename)}"`,
      );
      res.send(cipherBlob);
      return;
    } catch (error) {
      logger.error({ err: error }, "Failed to read file content");
      res.status(500).json({ error: "Failed to read the file." });
      return;
    }
  },
);

/**
 * POST /api/files/:id/share
 * Share an already-stored file with more teammates.
 */
router.post(
  "/:id/share",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const clerkId = getClerkId(req);
      const rows = await db
        .select()
        .from(filesTable)
        .where(
          and(
            eq(filesTable.id, paramId(req)),
            eq(filesTable.ownerClerkId, clerkId),
          ),
        )
        .limit(1);

      if (!rows.length) {
        res.status(404).json({ error: "File not found." });
        return;
      }

      const { recipientId, recipientDeviceKeyId, ownerDeviceKeyId, wrappedFileKey, wrappingIv, wrappingAlgorithm } = req.body ?? {};
      const permission: SharePermission =
        req.body?.permission === "editor" ? "editor" : "viewer";

      if (![recipientId, recipientDeviceKeyId, ownerDeviceKeyId, wrappedFileKey, wrappingIv, wrappingAlgorithm].every(v => typeof v === "string" && v.length > 0)) {
        res.status(400).json({ error: "Wrapped-key sharing metadata is required." });
        return;
      }
      const recipientIds = await filterToTeammates(clerkId, [recipientId]);
      if (!recipientIds.length) {
        res.status(403).json({ error: "Recipient is not an authorized teammate." });
        return;
      }
      const [recipientKey] = await db.select().from(userDeviceKeysTable).where(and(eq(userDeviceKeysTable.id, recipientDeviceKeyId), eq(userDeviceKeysTable.userId, recipientId), isNull(userDeviceKeysTable.revokedAt))).limit(1);
      const [ownerKey] = await db.select().from(userDeviceKeysTable).where(and(eq(userDeviceKeysTable.id, ownerDeviceKeyId), eq(userDeviceKeysTable.userId, clerkId), isNull(userDeviceKeysTable.revokedAt))).limit(1);
      if (!recipientKey || !ownerKey) { res.status(409).json({ error: "An active device key is required for both users." }); return; }

      await db
        .insert(fileSharesTable)
        .values(
          [{ fileId: rows[0].id, sharedWithUserId: recipientId,
            sharedByUserId: clerkId,
            permission,
            recipientDeviceKeyId, ownerDeviceKeyId, wrappedFileKey, wrappingIv, wrappingAlgorithm }],
        )
        .onConflictDoUpdate({ target: [fileSharesTable.fileId, fileSharesTable.sharedWithUserId], set: { recipientDeviceKeyId, ownerDeviceKeyId, wrappedFileKey, wrappingIv, wrappingAlgorithm } });

      res.json({ success: true, sharedWith: recipientIds });
      return;
    } catch (error) {
      logger.error({ err: error }, "Failed to share file");
      res.status(500).json({ error: "Failed to share the file." });
      return;
    }
  },
);

/**
 * DELETE /api/files/:id
 * Owner only. Removes the ciphertext from Storage as well as the row, so a
 * deleted file leaves nothing behind in Supabase. Share rows cascade.
 */
router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);

    const deleted = await db
      .delete(filesTable)
      .where(
        and(
          eq(filesTable.id, paramId(req)),
          eq(filesTable.ownerClerkId, clerkId),
        ),
      )
      .returning({
        id: filesTable.id,
        supabasePath: filesTable.supabasePath,
      });

    if (!deleted.length) {
      res.status(404).json({ error: "File not found." });
      return;
    }

    try {
      await deleteEncryptedObject(deleted[0].supabasePath);
    } catch (error) {
      // The row is already gone, so the object is now unreachable and
      // undecryptable regardless. Surface it for cleanup rather than failing
      // the user's delete.
      logger.error(
        { err: error, path: deleted[0].supabasePath },
        "Row deleted but Storage object remains",
      );
    }

    res.json({ success: true, id: deleted[0].id });
    return;
  } catch (error) {
    logger.error({ err: error }, "Failed to delete file");
    res.status(500).json({ error: "Failed to delete the file." });
    return;
  }
});

export default router;
