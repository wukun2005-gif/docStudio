/**
 * Health check API
 */
import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "docstudio", version: "0.1.0" });
});
