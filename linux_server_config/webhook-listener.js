// Standalone GitHub webhook listener. No app dependencies required.
// Verifies the X-Hub-Signature-256 header against WEBHOOK_SECRET, then on a
// push to refs/heads/main runs deploy.sh in the background.
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");

const PORT = process.env.WEBHOOK_PORT || 4001;
const SECRET = process.env.WEBHOOK_SECRET;
const DEPLOY_SCRIPT = path.join(__dirname, "deploy.sh");

if (!SECRET) {
  console.error("WEBHOOK_SECRET is not set. Refusing to start.");
  process.exit(1);
}

function verifySignature(payload, signatureHeader) {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function runDeploy() {
  console.log("Triggering deploy.sh...");
  const child = spawn("bash", [DEPLOY_SCRIPT], {
    detached: true,
    stdio: "inherit",
  });
  child.unref();
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    return res.end();
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);

    if (!verifySignature(body, req.headers["x-hub-signature-256"])) {
      console.warn("Invalid webhook signature, rejecting.");
      res.writeHead(401);
      return res.end("invalid signature");
    }

    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      res.writeHead(400);
      return res.end("invalid json");
    }

    if (payload.ref !== "refs/heads/main") {
      console.log(`Ignoring push to ${payload.ref}`);
      res.writeHead(200);
      return res.end("ignored (not main)");
    }

    res.writeHead(202);
    res.end("deploy triggered");
    runDeploy();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Webhook listener on 127.0.0.1:${PORT}`);
});
