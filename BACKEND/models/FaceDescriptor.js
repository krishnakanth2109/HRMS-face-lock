// --- models/FaceDescriptor.js ---
import mongoose from "mongoose";

const faceDescriptorSchema = new mongoose.Schema(
  {
    // Reference to the user (can be Admin or Employee)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // Which collection the user belongs to
    userType: {
      type: String,
      enum: ["Admin", "Employee"],
      required: true,
    },

    // The email for quick lookup
    email: {
      type: String,
      required: true,
      lowercase: true,
    },

    // The user's name (for display after face match)
    name: {
      type: String,
      required: true,
    },

    // Array of face descriptors (128-dimensional Float32 arrays stored as regular arrays)
    // Multiple descriptors per user improve recognition accuracy
    descriptors: {
      type: [[Number]],
      required: true,
      validate: {
        validator: function (v) {
          return v.length > 0 && v.every((desc) => desc.length === 128);
        },
        message: "Each descriptor must be a 128-dimensional array.",
      },
    },
  },
  { timestamps: true }
);

// Ensure one face record per user
faceDescriptorSchema.index({ userId: 1, userType: 1 }, { unique: true });

const FaceDescriptor = mongoose.model("FaceDescriptor", faceDescriptorSchema);

export default FaceDescriptor;

