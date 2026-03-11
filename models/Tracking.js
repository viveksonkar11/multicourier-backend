const mongoose = require("mongoose");

const trackingSchema = new mongoose.Schema(
  {
    trackingNumber: {
      type: String,
      required: true,
    },

    courier: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      required: true,
    },

    from: String,
    to: String,

    currentLocation: String,

    // ✅ IMPORTANT: STRING hi rahega (2–5 Days, Today, null)
    expectedDelivery: {
      type: String,
      default: null,
    },

    // ✅ 15 min rule ke liye
    lastStatusUpdate: {
      type: Date,
      default: Date.now,
    },

    history: [
      {
        status: String,
        location: String,
        time: Date,
      },
    ],
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

module.exports = mongoose.model("Tracking", trackingSchema);
