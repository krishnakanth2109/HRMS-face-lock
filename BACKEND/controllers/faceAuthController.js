// --- controllers/faceAuthController.js ---
import jwt from "jsonwebtoken";
import Admin from "../models/adminModel.js";
import Employee from "../models/employeeModel.js";
import FaceDescriptor from "../models/FaceDescriptor.js";
// Shift import removed — fullDayHours is returned as a default (8h)
// If you restore the Shift model later, re-add the import and the query below.


const signToken = (id, role, loginMethod = "face") => {
  return jwt.sign({ id, role, loginMethod }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const euclideanDistance = (desc1, desc2) => {
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    sum += Math.pow(desc1[i] - desc2[i], 2);
  }
  return Math.sqrt(sum);
};

export const registerFace = async (req, res) => {
  try {
    const { descriptors } = req.body;
    const userId = req.user._id;

    if (!descriptors || !Array.isArray(descriptors) || descriptors.length === 0) {
      return res.status(400).json({ message: "Please provide at least one face descriptor." });
    }

    let userType = "Employee";
    let userName = "";
    let userEmail = "";

    const admin = await Admin.findById(userId);
    if (admin) {
      userType = "Admin";
      userName = admin.name;
      userEmail = admin.email;
    } else {
      const employee = await Employee.findById(userId);
      if (employee) {
        userType = "Employee";
        userName = employee.name;
        userEmail = employee.email;
      } else {
        return res.status(404).json({ message: "User not found." });
      }
    }

    const faceRecord = await FaceDescriptor.findOneAndUpdate(
      { userId, userType },
      { userId, userType, email: userEmail, name: userName, descriptors },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      status: "success",
      message: "Face registered successfully!",
      data: { id: faceRecord._id, name: userName, descriptorCount: descriptors.length },
    });
  } catch (error) {
    console.error("FACE REGISTER ERROR:", error);
    res.status(500).json({ message: "Failed to register face." });
  }
};

export const loginWithFace = async (req, res) => {
  try {
    const { descriptor } = req.body;
    if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
      return res.status(400).json({ message: "Invalid face descriptor." });
    }

    const allFaces = await FaceDescriptor.find({});
    if (allFaces.length === 0) {
      return res.status(404).json({ message: "No registered faces found." });
    }

    let bestMatch = null;
    let bestDistance = Infinity;
    const THRESHOLD = 0.42;

    for (const faceRecord of allFaces) {
      for (const storedDesc of faceRecord.descriptors) {
        const distance = euclideanDistance(descriptor, storedDesc);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestMatch = faceRecord;
        }
      }
    }

    if (!bestMatch || bestDistance > THRESHOLD) {
      return res.status(401).json({ message: "Face not recognized.", distance: bestDistance });
    }

    let user = null;
    let role = null;
    if (bestMatch.userType === "Admin") {
      user = await Admin.findById(bestMatch.userId).select("+role");
      if (user) role = user.role;
    } else {
      user = await Employee.findById(bestMatch.userId);
      if (user) role = "employee";
    }

    if (!user) return res.status(404).json({ message: "User account no longer exists." });
    if (role === "employee" && user.isActive === false) {
      return res.status(403).json({ message: "Your account is deactivated." });
    }

    const loginMethod = "face";
    const token = signToken(user._id, role, loginMethod);
    user.password = undefined;

    // ✅ FIX: Shift model was not imported (it was commented out), causing ReferenceError
    // and crashing the entire login with a 500 "Face login failed" error.
    // We now return a safe default of 8 hours. Re-add Shift lookup if/when needed.
    const fullDayHours = 8;

    return res.status(200).json({
      status: "success",
      message: `Welcome back, ${bestMatch.name}!`,
      token,
      loginMethod,
      data: {
        ...user.toObject(),
        role,
        loginMethod,
        fullDayHours,
      },
      confidence: Math.round((1 - bestDistance / THRESHOLD) * 100),
    });

  } catch (error) {
    console.error("FACE LOGIN ERROR:", error);
    res.status(500).json({ message: "Face login failed." });
  }
};

export const checkFaceRegistration = async (req, res) => {
  try {
    const userId = req.user._id;
    const faceRecord = await FaceDescriptor.findOne({ userId });
    return res.status(200).json({
      status: "success",
      registered: !!faceRecord,
      descriptorCount: faceRecord ? faceRecord.descriptors.length : 0,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to check face registration." });
  }
};

export const deleteFaceRegistration = async (req, res) => {
  try {
    const userId = req.user._id;
    const result = await FaceDescriptor.findOneAndDelete({ userId });
    if (!result) return res.status(404).json({ message: "No face registration found." });
    return res.status(200).json({ status: "success", message: "Face registration deleted." });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete face registration." });
  }
};