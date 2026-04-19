import { Router } from "express";
import { getCategoriesWithItems } from "../db/queries";

const router = Router();

router.get("/menu", async (req, res) => {
  const vendorId = Number(req.query.vendorId);
  if (!vendorId) {
    return res.status(400).json({ error: "vendorId query param required" });
  }
  const categories = await getCategoriesWithItems(vendorId);
  res.json(categories);
});

export default router;
