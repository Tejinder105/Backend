import dotenv from "dotenv";
import connectDB from "./db/index.js";
import { app } from "./app.js";
import { startCronJobs } from "./services/cron.service.js";

// Load env (Railway uses environment variables)
dotenv.config();
console.log("MONGO_URI:", process.env.MONGO_URI);
console.log("PORT:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);


(async () => {
  try {
    await connectDB();
    console.log("✅ Database connected");

    const PORT = process.env.PORT || 8000;

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      startCronJobs();
    });
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
})();
