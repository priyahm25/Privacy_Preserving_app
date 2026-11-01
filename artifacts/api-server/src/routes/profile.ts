import { Router, type Request, type Response } from "express";
import { db, filesTable, fileSharesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getClerkId, requireAuth } from "../middlewares/auth";
import { summarizeProfileState } from "../lib/profileSummary";

const router = Router();
router.use(requireAuth);

router.get("/summary", async (req: Request, res: Response): Promise<void> => {
  const clerkId = getClerkId(req);
  try {
    const [files, shares] = await Promise.all([
      db.select({ ownerClerkId: filesTable.ownerClerkId, sizeBytes: filesTable.sizeBytes, encrypted: filesTable.encrypted, iv: filesTable.iv })
        .from(filesTable).where(eq(filesTable.ownerClerkId, clerkId)),
      db.select({ ownerClerkId: filesTable.ownerClerkId, wrappedFileKey: fileSharesTable.wrappedFileKey, wrappingIv: fileSharesTable.wrappingIv, wrappingAlgorithm: fileSharesTable.wrappingAlgorithm })
        .from(fileSharesTable).innerJoin(filesTable, eq(filesTable.id, fileSharesTable.fileId)).where(eq(filesTable.ownerClerkId, clerkId)),
    ]);
    res.json(summarizeProfileState(clerkId, files, shares));
  } catch {
    res.status(500).json({ error: "Could not load account security and storage summary." });
  }
});

export default router;
