import express from "express";
import axios from "axios";
import path from "path";
import "./telegram/zazu_main_client";
import "./telegram/zazu_vendor_acct";
import { vendorState } from "./freezer/vendorState";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../web")));

app.post("/ride-preflight", async (req, res) => {
  const payload = req.body;

  console.log("Received preflight:", payload);

  try {
    const preflightResponse = await axios.post(
      "http://127.0.0.1:8080/ride-request",
      payload,
    );

    res.json({
      can_serve: true,
      rec: preflightResponse.data,
    });
  } catch (err: any) {
    console.error("Error calling ASAP API:", err.message);
    res.status(500).json({ can_serve: false, error: err.message });
  }
});

app.post("/ride-request", async (req, res) => {
  const payload = req.body;

  console.log("Received Ride Request", payload);

  try {
    const rideResponse = await axios.post(
      "http://127.0.0.1:8080/ride-request",
      payload,
    );

    const rideId = rideResponse.data.request_id;

    const driverResponse = await axios.get(
      `http://127.0.0.1:8080/assign-driver?ride_id=${rideId}`,
    );

    res.json({
      success: true,
      ride: rideResponse.data,
      driver: driverResponse.data,
    });
  } catch (err: any) {
    console.error("Error calling ASAP API:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/menu", (_req, res) => {
  if (!vendorState) {
    return res.status(503).json({ error: "Menu not loaded yet" })
  }
  res.json(vendorState.categories)
})

app.listen(4000, () => console.log("Zazu Main Client listening on port 4000"));
