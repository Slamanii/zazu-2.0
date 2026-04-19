import express from "express";
import path from "path";
import "./telegram/zazu_main_client";
import "./telegram/zazu_vendor_acct";
import { startNgrok } from "./ngrok";
import ridesRouter from "./api/rides";
import payRouter from "./api/pay";
import menuRouter from "./api/menu";

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
