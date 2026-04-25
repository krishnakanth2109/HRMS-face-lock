// --- models/employeeModel.js ---
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const experienceSchema = new mongoose.Schema({
  company: String,
  role: String,
  department: String,
  years: Number,
  joiningDate: String,
  lastWorkingDate: String,
  salary: Number,
  reason: String,
  experienceLetterUrl: String,
  employmentType: String,
});

const personalSchema = new mongoose.Schema({
  dob: String,
  gender: { type: String, enum: ["Male", "Female", "Prefer not to say", "Other"] },
  maritalStatus: String,
  nationality: String,
  panNumber: String,
  aadhaarNumber: String,
  aadhaarFileUrl: { type: String, default: null }, 
  panFileUrl: { type: String, default: null },     
});

const bankSchema = new mongoose.Schema({
  accountNumber: String,
  bankName: String,
  ifsc: String,
  branch: String,
});

const EmployeeSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: {
    type: String,
    minlength: 8,
    select: false,
    default: null,
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
  },
  companyName: String,
  companyPrefix: String,
  phone: String,
  address: String,
  emergency: String,
  emergencyPhone: String,
  currentRole: { type: String, default: null },
  currentDepartment: { type: String, default: null },
  currentSalary: { type: Number, default: null },
  joiningDate: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  deactivationDate: { type: String, default: null },
  deactivationReason: { type: String, default: null },
  reactivationDate: { type: String, default: null },
  reactivationReason: { type: String, default: null },
  bankDetails: bankSchema,
  personalDetails: personalSchema,
  experienceDetails: [experienceSchema],
  companyDocuments: [
    {
      fileName: String,
      fileUrl: String,
      uploadedAt: { type: Date, default: Date.now }
    }
  ],
  role: { type: String, enum: ["employee", "admin", "manager"], default: "employee" },
  isAdmin: { type: Boolean, default: false },
}, { timestamps: true });

EmployeeSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

EmployeeSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

export default mongoose.model("Employee", EmployeeSchema);
