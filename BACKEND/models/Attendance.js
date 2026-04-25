// --- START OF FILE Attendance.js ---

import mongoose from "mongoose";

const LocationSchema = new mongoose.Schema({
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  address: { type: String, default: null },
  timestamp: { type: Date, default: null }
}, { _id: false });


const SessionSchema = new mongoose.Schema({
  punchIn: { type: Date, required: true },
  punchOut: { type: Date, default: null },
  durationSeconds: { type: Number, default: 0 } 
}, { _id: false });

// ✅ NEW: Break Session Schema — tracks each individual break (from / to)
const BreakSessionSchema = new mongoose.Schema({
  from: { type: Date, default: null },
  to: { type: Date, default: null },
  durationSeconds: { type: Number, default: 0 }
}, { _id: false });

const DailySchema = new mongoose.Schema({
  date: { type: String, required: true },
  
  punchIn: { type: Date, default: null },
  punchOut: { type: Date, default: null },

  punchInLocation: { type: LocationSchema, default: null },
  punchOutLocation: { type: LocationSchema, default: null },

  sessions: { type: [SessionSchema], default: [] },

  // ✅ NEW: isOnBreak flag — true while employee is on an active break
  isOnBreak: { type: Boolean, default: false },

  // ✅ NEW: Break sessions — each break has from/to/durationSeconds
  breakSessions: { type: [BreakSessionSchema], default: [] },

  workedHours: { type: Number, default: 0 },
  workedMinutes: { type: Number, default: 0 },
  workedSeconds: { type: Number, default: 0 },

  totalBreakSeconds: { type: Number, default: 0 },

  displayTime: { type: String, default: "0h 0m 0s" },

  status: {
    type: String,
    enum: ["NOT_STARTED", "WORKING", "COMPLETED", "ABSENT"],
    default: "NOT_STARTED",
  },

  loginStatus: {
    type: String,
    enum: ["ON_TIME", "LATE", "NOT_APPLICABLE"],
    default: "NOT_APPLICABLE",
  },

  loginMethod: {
    type: String,
    enum: ["password", "fingerprint", "face", "unknown"], // ✅ FIXED: added "face" — was missing, causing face punch-ins to silently fall back to "password"
    default: "unknown",
  },

  workedStatus: {
    type: String,
    enum: ["FULL_DAY", "HALF_DAY", "QUARTER_DAY", "ABSENT", "NOT_APPLICABLE"],
    default: "NOT_APPLICABLE",
  },

  attendanceCategory: {
    type: String,
    enum: ["FULL_DAY", "HALF_DAY", "ABSENT", "NOT_APPLICABLE"],
    default: "NOT_APPLICABLE"
  },


  // ✅ NEW: Request for Late Login Correction
  lateCorrectionRequest: {
    hasRequest: { type: Boolean, default: false },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
    requestedTime: { type: Date, default: null }, // The time employee claims they arrived
    reason: { type: String, default: null },
    adminComment: { type: String, default: null }
  },

  // ✅ Track if employee did a final punch out (not just a break)
  isFinalPunchOut: { type: Boolean, default: false },

  adminPunchOut: { type: Boolean, default: false },
  adminPunchOutBy: { type: String, default: null },
  adminPunchOutTimestamp: { type: Date, default: null },

   statusCorrectionRequest: {
    hasRequest: { type: Boolean, default: false },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
    requestedPunchOut: { type: Date, default: null }, // The new Punch Out time
    reason: { type: String, default: null },
    adminComment: { type: String, default: null }
  },
});

const AttendanceSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true },
  employeeName: { type: String, required: true },
  attendance: [DailySchema],
  
  // ✅ NEW: Monthly Request Limit Tracking
  monthlyRequestLimits: {
    type: Map,
    of: {
      limit: { type: Number, default: 5 },
      used: { type: Number, default: 0 }
    },
    default: {}
  }
});

export default mongoose.model("Attendance", AttendanceSchema);