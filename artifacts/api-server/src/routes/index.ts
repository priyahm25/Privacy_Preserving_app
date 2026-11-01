import { Router, type IRouter } from "express";
import healthRouter from "./health";
import teammatesRouter from "./teammates";
import filesRouter from "./files";
import keysRouter from "./keys";
import notificationsRouter from "./notifications";
import profileRouter from "./profile";
import chatRouter from "./chat";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/teammates", teammatesRouter);
router.use("/files", filesRouter);
router.use("/keys", keysRouter);
router.use("/notifications", notificationsRouter);
router.use("/profile", profileRouter);
router.use("/chat", chatRouter);
router.use("/push", pushRouter);

export default router;
