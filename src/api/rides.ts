import { Router } from "express";
import axios from "axios";

const router = Router();

router.post("/ride-preflight", async (req, res) => {
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

router.post("/ride-request", async (req, res) => {
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

export default router;
