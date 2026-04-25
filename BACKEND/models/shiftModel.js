import mongoose from "mongoose";

const ShiftSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    required: true,
    unique: true,
    ref: 'Employee'
  },
  employeeName: { type: String, required: true },
  email: { type: String, required: true },
  department: { type: String, default: 'N/A' },
  role: { type: String, default: 'N/A' },
  
  // Shift Timings (Stored as String HH:MM)
  // These represent Indian Standard Time (IST)
  shiftStartTime: {
    type: String,
    required: true,
    default: "09:00"
  },
  shiftEndTime: {
    type: String,
    required: true,
    default: "18:00"
  },
  
  // Explicitly store that these timings are for India
  // This helps the backend convert UTC server time to this timezone before comparing
  timezone: {
    type: String,
    default: "Asia/Kolkata" 
  },
  
  lateGracePeriod: { type: Number, default: 15 }, // in minutes
  
  // UPDATED: Default is now 9 hours
  fullDayHours: { type: Number, default: 9 },
  halfDayHours: { type: Number, default: 5},
  
  autoExtendShift: { type: Boolean, default: true },
  weeklyOffDays: { type: [Number], default: [0] }, // 0 = Sunday
  
  isActive: { type: Boolean, default: true },
  
  createdBy: { type: String, default: 'SYSTEM' },
  updatedBy: { type: String, default: 'SYSTEM' },
}, { 
  timestamps: true 
});

export default mongoose.model("Shift", ShiftSchema);