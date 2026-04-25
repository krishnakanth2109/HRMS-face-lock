// --- models/CompanyModel.js ---
import mongoose from "mongoose";

const CompanySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Company name is required"],
    unique: true,
    trim: true,
  },
  prefix: {
    type: String,
    required: [true, "Company prefix is required"],
    unique: true,
    uppercase: true,
    trim: true,
    maxlength: [4, "Prefix must be 3-4 characters"],
    minlength: [3, "Prefix must be 3-4 characters"],
  },
  description: {
    type: String,
    default: "",
  },
  email: {
    type: String,
    trim: true,
  },
  phone: String,
  address: String,
  city: String,
  state: String,
  zipCode: String,
  country: String,
  registrationNumber: String,
  website: String,
  employeeCount: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

CompanySchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model("Company", CompanySchema);
