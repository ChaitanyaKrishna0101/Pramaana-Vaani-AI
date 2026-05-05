import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vaaniRouter from "./vaani";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vaaniRouter);

export default router;
