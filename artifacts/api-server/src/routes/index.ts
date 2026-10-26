import { Router, type IRouter } from "express";
import healthRouter from "./health";
import teammatesRouter from "./teammates";
import filesRouter from "./files";
import keysRouter from "./keys";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/teammates", teammatesRouter);
router.use("/files", filesRouter);
router.use("/keys", keysRouter);
router.use("/notifications", notificationsRouter);

export default router;
