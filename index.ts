import express from "express";
import path from "path";
import "./src/telegram/zazu_main_client";
import "./src/telegram/zazu_vendor_acct";
import ridesRouter from "./src/api/rides";
import payRouter from "./src/api/pay";
import menuRouter from "./src/api/menu";
import webhookRouter from "./src/api/webhook";

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
});
