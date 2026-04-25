// --- controllers/authController.js ---
import { promisify } from "util";
import jwt from "jsonwebtoken";
import Admin from "../models/adminModel.js";
import Employee from "../models/employeeModel.js";

// Create JWT
const signToken = (id, role, loginMethod = "password") => {
  return jwt.sign({ id, role, loginMethod }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

export const login = async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Please provide both email and password." });

  try {
    let user = await Admin.findOne({ email }).select("+password +role");
    let role = user ? user.role : null;

    if (!user) {
      user = await Employee.findOne({ email }).select("+password");
      if (user) role = "employee";
    }

    if (!user || !(await user.correctPassword(password, user.password))) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    if (role === "employee" && user.isActive === false) {
      return res.status(403).json({ message: "Your account is deactivated." });
    }

    const loginMethod = "password";
    const token = signToken(user._id, role, loginMethod);
    user.password = undefined;

    return res.status(200).json({
      status: "success",
      token,
      loginMethod,
      data: { ...user.toObject(), role, loginMethod },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({ message: "An internal server error occurred." });
  }
};

export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) return res.status(401).json({ message: "You are not logged in!" });

  try {
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    let currentUser = await Admin.findById(decoded.id).select("+role");
    if (!currentUser) currentUser = await Employee.findById(decoded.id);

    if (!currentUser) return res.status(401).json({ message: "User no longer exists." });
    if (currentUser.isActive === false) return res.status(401).json({ message: "User is deactivated." });

    currentUser.role = decoded.role || currentUser.role;
    req.user = currentUser;
    req.auth = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token." });
  }
};
