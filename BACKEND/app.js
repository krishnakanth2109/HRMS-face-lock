import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import faceAuthRoutes from "./routes/faceAuthRoutes.js";
import attendanceRoutes from "./routes/Employeeattendanceroutes.js"; // ✅ FIXED: correct filename is EmployeeattendanceRoutes.js

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/face-auth", faceAuthRoutes);
app.use("/api/attendance", attendanceRoutes); // ✅ ADD: mount attendance routes — this was missing, causing all attendance calls to return 404

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/face_attendance";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected");
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => console.error("❌ MongoDB Error:", err));
