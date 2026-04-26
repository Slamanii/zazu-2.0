import { Router } from "express";
import axios from "axios";
import { randomUUID } from "crypto";
import { ASAP_BASE_URL } from "../env";

const router = Router();

router.post("/ride-preflight", async (req, res) => {
  const payload = req.body;

  console.log("Received preflight:", payload);

  try {
    const preflightResponse = await axios.post(
      `${ASAP_BASE_URL}/drivers/ride-preflight`,
      payload,
    );

    res.json(preflightResponse.data);
  } catch (err: any) {
    const body = err.response?.data;
    console.error("Error calling ASAP preflight:", err.message, JSON.stringify(body, null, 2));
    res.status(500).json({ can_serve: false, error: err.message });
  }
});

router.post("/ride-request", async (req, res) => {
  const payload = {
    ...req.body,
    ride_type: "ASAPEXPRESS",
  };

  console.log("Received Ride Request", JSON.stringify(payload, null, 2));

  try {
    const rideResponse = await axios.post(
      `${ASAP_BASE_URL}/riders/ride-request`,
      payload,
    );

    const { request_id } = rideResponse.data;
    console.log("Ride request inserted — request_id:", request_id);

    // respond immediately, assign-driver runs in the background
    res.json({ success: true, request_id });

    axios.post(`${ASAP_BASE_URL}/riders/assign-driver`, { ...payload, request_id })
      .then((driverRes) => {
        console.log("Driver assigned:", JSON.stringify(driverRes.data, null, 2));
      })
      .catch((err) => {
        console.error("assign-driver error:", err.message, JSON.stringify(err.response?.data, null, 2));
      });
  } catch (err: any) {
    const body = err.response?.data;
    console.error("Error calling ASAP API:", err.message, JSON.stringify(body, null, 2));
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
