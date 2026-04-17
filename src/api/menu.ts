import { Router } from "express";
import { vendorStore } from "../freezer/vendorState";

const router = Router();

router.get("/menu", (req, res) => {
  const vendorId = Number(req.query.vendorId);
  if (!vendorId) {
    return res.status(400).json({ error: "vendorId query param required" });
  }
  const state = vendorStore.get(vendorId);
  if (!state) {
    return res.status(503).json({ error: "Menu not loaded yet" });
  }
  res.json(state.categories);
});

export default router;
