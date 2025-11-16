import dotenv from "dotenv";
import connectDB from "./db/index.js";
import { app } from "./app.js";
import { startCronJobs } from "./services/cron.service.js";

// Load env (Railway uses environment variables)
dotenv.config();
console.log("PORT:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);


(async () => {
  try {
    await connectDB();
    console.log("✅ Database connected");

    const PORT = process.env.PORT || 8000;
    const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces

    app.listen(PORT, HOST, () => {
      console.log(`🚀 Server running on http://${HOST}:${PORT}`);
      console.log(`📱 Network access: http://192.168.1.11:${PORT}`);
      startCronJobs();
    });
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
})();
