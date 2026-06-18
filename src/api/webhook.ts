import { Router } from "express";
import crypto from "crypto";
import { spawn } from "child_process";
import path from "path";
import { WEBHOOK_SECRET } from "../env";

const DEPLOY_SCRIPT = path.join(__dirname, "..", "..", "linux_server_config", "deploy.sh");

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader || !WEBHOOK_SECRET) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function runDeploy() {
  console.log("[webhook] Triggering deploy.sh...");
  const child = spawn("bash", [DEPLOY_SCRIPT], { detached: true, stdio: "inherit" });
  child.unref();
}

const router = Router();

router.post("/webhook", (req, res) => {
  const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));

  if (!verifySignature(rawBody, req.headers["x-hub-signature-256"] as string | undefined)) {
    console.warn("[webhook] Invalid signature, rejecting.");
    return res.status(401).send("invalid signature");
  }

  if (req.body?.ref !== "refs/heads/main") {
    console.log(`[webhook] Ignoring push to ${req.body?.ref}`);
    return res.status(200).send("ignored (not main)");
  }

  res.status(202).send("deploy triggered");
  runDeploy();
});

export default router;
