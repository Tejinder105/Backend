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

// Import routes
import authRouter from "./routes/auth.routes.js";
import flatRouter from "./routes/flat.routes.js";
import billRouter from "./routes/bill.routes.js";
import transactionRouter from "./routes/transaction.routes.js";
import notificationRouter from "./routes/notification.routes.js";
import reportRouter from "./routes/report.routes.js";
import expenseRouter from "./routes/expense.routes.js";
import paymentRouter from "./routes/payment.routes.js";
import budgetRouter from "./routes/budget.routes.js";

// Register routes
app.use("/api/auth", authRouter);
app.use("/api/flats", flatRouter);
app.use("/api/bills", billRouter);
app.use("/api/transactions", transactionRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/reports", reportRouter);
app.use("/api/budget", budgetRouter);

// Legacy routes (kept for backward compatibility)
app.use("/api/v1/expenses", expenseRouter);
app.use("/api/v1/payments", paymentRouter);

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: "Route not found" 
  });
});

// Error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  
  res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || [],
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined
  });
});

export { app };
