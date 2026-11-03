import express from "express";
import path from "path";
import { startBotRegistry, stopBotRegistry } from "./src/telegram/registry";
import ridesRouter from "./src/api/rides";
import payRouter from "./src/api/pay";
import menuRouter from "./src/api/menu";
import webhookRouter from "./src/api/webhook";
import { startZazuUrlRegistration } from "./src/api/asap";

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);
app.use(express.static(path.join(__dirname, "src/web")));

app.use(ridesRouter);
app.use(payRouter);
app.use(menuRouter);
app.use(webhookRouter);

app.listen(4000, () => {
  console.log("Zazu listening on port 4000");
  // Tell the ASAP backend where to send /order-status, /ride-details and /driver-arrived.
  startZazuUrlRegistration();
});

void startBotRegistry().catch(() => {
  console.error("[bots] Startup failed; check the server Supabase credential and telegram_bots access");
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void stopBotRegistry().finally(() => process.exit(0)); });
}
