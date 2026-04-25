// routes/EmployeeattendanceRoutes.js
// ✅ MINIMAL VERSION — only punch-in, punch-out, break, get attendance
// Removed: nodemailer, LeaveRequest, Holiday, Overtime, onlyAdmin,
//          reverseGeocode, validateCoordinates, getFingerprintAttendanceDecision,
//          all admin routes, correction request routes

import express from "express";
import Attendance from "../models/Attendance.js";
import Shift from "../models/shiftModel.js";
import { protect } from "../controllers/authController.js";

const router = express.Router();

router.use(protect);

/* =============================================================
   UTILITIES
   ============================================================= */

const getToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const getTimeDifferenceInMinutes = (punchIn, shiftStart) => {
  const t = new Date(punchIn);
  const [h, m] = shiftStart.split(":").map(Number);
  return t.getHours() * 60 + t.getMinutes() - (h * 60 + m);
};

const normalizeLoginMethod = (method) => {
  if (method === "fingerprint") return "fingerprint";
  if (method === "face") return "face";
  return "password";
};

/* =============================================================
   GET  /api/attendance/:employeeId
   ============================================================= */
router.get("/:employeeId", async (req, res) => {
  try {
    const requestedId = req.params.employeeId;
    const loggedUser = req.user;

    const isOwnRecord =
      loggedUser.employeeId === requestedId ||
      loggedUser._id?.toString() === requestedId;

    if (loggedUser.role !== "admin" && !isOwnRecord) {
      return res.status(403).json({ message: "Access denied." });
    }

    const record = await Attendance.findOne({ employeeId: requestedId });
    if (!record) return res.json({ success: true, data: [] });

    const sorted = record.attendance.sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );
    return res.json({ success: true, data: sorted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =============================================================
   POST  /api/attendance/punch-in
   ============================================================= */
router.post("/punch-in", async (req, res) => {
  try {
    const { employeeId, employeeName, latitude, longitude, loginMethod } = req.body;

    if (!employeeId || !employeeName) {
      return res.status(400).json({ message: "Employee ID & Name are required." });
    }

    const today = getToday();
    const now = new Date();
    const normalizedLoginMethod = normalizeLoginMethod(loginMethod);

    let shift = await Shift.findOne({ employeeId });
    if (!shift) {
      shift = {
        shiftStartTime: "09:00",
        shiftEndTime: "18:00",
        lateGracePeriod: 15,
        fullDayHours: 8,
        halfDayHours: 4,
        quarterDayHours: 2,
        weeklyOffDays: [0],
      };
    }

    let attendance = await Attendance.findOne({ employeeId });
    if (!attendance) {
      attendance = new Attendance({ employeeId, employeeName, attendance: [] });
    }

    let todayRecord = attendance.attendance.find((a) => a.date === today);

    if (!todayRecord) {
      // First punch-in of the day
      const diffMin = getTimeDifferenceInMinutes(now, shift.shiftStartTime);
      const isLate = diffMin > (shift.lateGracePeriod || 15);

      todayRecord = {
        date: today,
        punchIn: now,
        punchOut: null,
        punchInLocation: latitude && longitude
          ? { latitude, longitude, address: null, timestamp: now }
          : null,
        sessions: [{ punchIn: now, punchOut: null, durationSeconds: 0 }],
        isOnBreak: false,
        breakSessions: [],
        workedHours: 0,
        workedMinutes: 0,
        workedSeconds: 0,
        totalBreakSeconds: 0,
        displayTime: "0h 0m 0s",
        status: "WORKING",
        loginStatus: isLate ? "LATE" : "ON_TIME",
        loginMethod: normalizedLoginMethod,
        isFinalPunchOut: false,
      };
      attendance.attendance.push(todayRecord);

    } else {
      // Resume after break
      if (todayRecord.workedStatus === "FULL_DAY") {
        return res.status(400).json({ message: "Shift completed. Cannot punch in again today." });
      }
      if (todayRecord.isFinalPunchOut) {
        return res.status(400).json({ message: "You have punched out for the day. Re-punch-in not allowed." });
      }
      if (todayRecord.status === "WORKING") {
        return res.status(400).json({ message: "You are already punched in." });
      }

      // Accumulate break time
      const lastSession = todayRecord.sessions[todayRecord.sessions.length - 1];
      if (lastSession && lastSession.punchOut) {
        const breakDiff = (now - new Date(lastSession.punchOut)) / 1000;
        todayRecord.totalBreakSeconds = (todayRecord.totalBreakSeconds || 0) + breakDiff;
      }

      // Close open break session
      if (todayRecord.isOnBreak && todayRecord.breakSessions?.length > 0) {
        const openBreak = [...todayRecord.breakSessions].reverse().find((b) => !b.to);
        if (openBreak) {
          openBreak.to = now;
          openBreak.durationSeconds = (now - new Date(openBreak.from)) / 1000;
        }
      }

      todayRecord.isOnBreak = false;
      todayRecord.sessions.push({ punchIn: now, punchOut: null, durationSeconds: 0 });
      todayRecord.status = "WORKING";
      todayRecord.punchOut = null;

      if (!todayRecord.loginMethod || todayRecord.loginMethod === "unknown") {
        todayRecord.loginMethod = normalizedLoginMethod;
      }
    }

    await attendance.save();
    const saved = attendance.attendance.find((a) => a.date === today);
    return res.json({ success: true, message: "Punch-in successful.", data: saved });

  } catch (err) {
    console.error("PUNCH-IN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =============================================================
   POST  /api/attendance/punch-out
   ============================================================= */
router.post("/punch-out", async (req, res) => {
  try {
    const { employeeId, latitude, longitude } = req.body;

    if (!employeeId) {
      return res.status(400).json({ message: "Employee ID is required." });
    }

    const today = getToday();
    const now = new Date();

    const attendance = await Attendance.findOne({ employeeId });
    if (!attendance) return res.status(404).json({ message: "No attendance record found." });

    const todayRecord = attendance.attendance.find((a) => a.date === today);
    if (!todayRecord) return res.status(400).json({ message: "No attendance record for today." });

    const currentSession = (todayRecord.sessions || []).find((s) => !s.punchOut);
    if (!currentSession) {
      return res.status(400).json({ message: "You are already punched out." });
    }

    currentSession.punchOut = now;
    currentSession.durationSeconds = (now - new Date(currentSession.punchIn)) / 1000;

    todayRecord.punchOut = now;
    todayRecord.punchOutLocation = latitude && longitude
      ? { latitude, longitude, address: null, timestamp: now }
      : null;
    todayRecord.status = "COMPLETED";
    todayRecord.isFinalPunchOut = true;
    todayRecord.isOnBreak = false;

    // Recalculate total worked time
    let totalSeconds = 0;
    todayRecord.sessions.forEach((sess) => {
      if (sess.punchIn && sess.punchOut) {
        totalSeconds += (new Date(sess.punchOut) - new Date(sess.punchIn)) / 1000;
      }
    });

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);

    todayRecord.workedHours = h;
    todayRecord.workedMinutes = m;
    todayRecord.workedSeconds = s;
    todayRecord.displayTime = `${h}h ${m}m ${s}s`;

    // Classify by shift
    let shift = await Shift.findOne({ employeeId });
    if (!shift) shift = { fullDayHours: 8, halfDayHours: 4, quarterDayHours: 2 };

    let workedStatus = "ABSENT";
    let attendanceCategory = "ABSENT";

    if (h >= (shift.fullDayHours || 8)) {
      workedStatus = "FULL_DAY"; attendanceCategory = "FULL_DAY";
    } else if (h >= (shift.halfDayHours || 4)) {
      workedStatus = "HALF_DAY"; attendanceCategory = "HALF_DAY";
    } else if (h >= (shift.quarterDayHours || 2)) {
      workedStatus = "HALF_DAY";
    }

    todayRecord.workedStatus = workedStatus;
    todayRecord.attendanceCategory = attendanceCategory;

    await attendance.save();

    return res.json({
      success: true,
      message: `Punched out. Total: ${h}h ${m}m ${s}s`,
      data: todayRecord,
    });

  } catch (err) {
    console.error("PUNCH-OUT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =============================================================
   POST  /api/attendance/punch-break
   ============================================================= */
router.post("/punch-break", async (req, res) => {
  try {
    const { employeeId, latitude, longitude } = req.body;

    if (!employeeId) {
      return res.status(400).json({ message: "Employee ID is required." });
    }

    const today = getToday();
    const now = new Date();

    const attendance = await Attendance.findOne({ employeeId });
    if (!attendance) return res.status(404).json({ message: "No attendance record found." });

    const todayRecord = attendance.attendance.find((a) => a.date === today);
    if (!todayRecord) return res.status(400).json({ message: "No attendance record for today." });

    if (todayRecord.isOnBreak) {
      return res.status(400).json({ message: "You are already on a break." });
    }

    const currentSession = (todayRecord.sessions || []).find((s) => !s.punchOut);
    if (!currentSession) {
      return res.status(400).json({ message: "No active session. Please punch in first." });
    }

    // Close current work session
    currentSession.punchOut = now;
    currentSession.durationSeconds = (now - new Date(currentSession.punchIn)) / 1000;

    todayRecord.punchOut = now;
    if (latitude && longitude) {
      todayRecord.punchOutLocation = { latitude, longitude, address: null, timestamp: now };
    }
    todayRecord.status = "COMPLETED";
    todayRecord.isFinalPunchOut = false;
    todayRecord.isOnBreak = true;

    if (!todayRecord.breakSessions) todayRecord.breakSessions = [];
    todayRecord.breakSessions.push({ from: now, to: null, durationSeconds: 0 });

    // Worked time so far
    let totalSeconds = 0;
    todayRecord.sessions.forEach((sess) => {
      if (sess.punchIn && sess.punchOut) {
        totalSeconds += (new Date(sess.punchOut) - new Date(sess.punchIn)) / 1000;
      }
    });

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);

    todayRecord.workedHours = h;
    todayRecord.workedMinutes = m;
    todayRecord.workedSeconds = s;
    todayRecord.displayTime = `${h}h ${m}m ${s}s`;

    await attendance.save();

    return res.json({
      success: true,
      message: `Break started. Worked so far: ${h}h ${m}m ${s}s`,
      data: todayRecord,
    });

  } catch (err) {
    console.error("PUNCH-BREAK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;