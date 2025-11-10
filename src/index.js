import dotenv from "dotenv";
import connectDB from "./db/index.js";
import { app } from "./app.js";
import { startCronJobs } from "./services/cron.service.js";

dotenv.config({
  path: "./.env",
});

connectDB()
  .then(() => {
    app.listen(process.env.PORT || 8000, () => {
      console.log(`✅ Server is running at port : ${process.env.PORT}`);
      
      // Start cron jobs for notifications
      startCronJobs();
    });
  })
  .catch((err) => {
    console.log("❌ MONGO db connection failed !!! ", err);
  });
