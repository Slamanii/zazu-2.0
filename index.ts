import express from "express";
import path from "path";
import "./src/telegram/zazu_main_client";
import "./src/telegram/zazu_vendor_acct";
import { startNgrok } from "./src/ngrok";
import ridesRouter from "./src/api/rides";
import payRouter from "./src/api/pay";
import menuRouter from "./src/api/menu";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "web")));

app.use(ridesRouter);
app.use(payRouter);
app.use(menuRouter);

app.listen(4000, async () => {
  console.log("Zazu Main Client listening on port 4000");
  await startNgrok(4000);
});
