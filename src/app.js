import express from "express";
import cors from "cors";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));

import userRouter from "./routes/user.routes.js";
import paymentRouter from "./routes/payment.routes.js";
import expenseRouter from "./routes/expense.routes.js";
import flatmateRouter from "./routes/flatmate.routes.js";
import flatRouter from "./routes/flat.routes.js";

app.use("/api/v1/users", userRouter);
app.use("/api/v1/payments", paymentRouter);
app.use("/api/v1/expenses", expenseRouter);
app.use("/api/v1/flatmates", flatmateRouter);
app.use("/api/v1/flats", flatRouter);

export { app };
