require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

// ================== CORS & MIDDLEWARE ==================
app.use(cors({
  origin: ["https://multicourier-frontend.vercel.app", "http://localhost:3000"],
  methods: ["GET", "POST", "DELETE", "PUT"],
  credentials: true
}));
app.use(express.json());

// ================== MONGODB CONNECTION ==================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log(" MongoDB Connected Successfully"))
  .catch((err) => console.log(" Mongo Error:", err));

// ================== MODELS ==================

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "Franchisee" } 
});
const User = mongoose.model("User", userSchema);

const trackingSchema = new mongoose.Schema(
  {
    trackingNumber: String,
    courier: String,
    status: String,
    from: String,
    to: String,
    currentLocation: String,
    expectedDelivery: String, 
    bookedBy: String, 
    lastStatusUpdate: { type: Date, default: Date.now },
    history: [
      {
        status: String,
        location: String,
        time: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);
const Tracking = mongoose.model("Tracking", trackingSchema);

// ================== COURIERS STRUCTURE ==================
const courierMaster = [
  {
    name: "BlueDart",
    prefix: "BD-",
    expected: ["2–3 Days", "1–2 Days", "Today", null],
  },
  {
    name: "DTDC",
    prefix: "DTDC-",
    expected: ["3–4 Days", "2–3 Days", "Today", null],
  },
  {
    name: "Amazon",
    prefix: "AMZ-",
    expected: ["1–2 Days", "1 Day", "Today", null],
  },
  {
    name: "Delhivery",
    prefix: "DLV-",
    expected: ["4–5 Days", "3–4 Days", "Today", null],
  },
  {
    name: "DHL",
    prefix: "DHL-",
    expected: ["4–6 Days", "3–4 Days", "Today", null],
  },
  {
    name: "Ekart",
    prefix: "EK-",
    expected: ["2–4 Days", "1–2 Days", "Today", null],
  },
  {
    name: "FedEx",
    prefix: "FDX-",
    expected: ["3–5 Days", "2–3 Days", "Today", null],
  },
  {
    name: "Trackon",
    prefix: "TRKON-",
    expected: ["3–5 Days", "2–3 Days", "Today", null],
  },
];

const statusFlow = ["Booked", "In Transit", "Out for Delivery", "Delivered"];
const STATUS_INTERVAL = 2 * 60 * 1000; 

// ================== AUTH ROUTES ==================

app.post("/register", async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const existingUser = await User.findOne({ 
      username: { $regex: new RegExp("^" + username + "$", "i") } 
    });
    if (existingUser) return res.status(400).json({ message: "Hub Name already exists" });

    const newUser = new User({ username, password: String(password), role });
    await newUser.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ 
      username: { $regex: new RegExp("^" + username + "$", "i") }
    });
    if (user && String(user.password) === String(password)) {
      res.json({ success: true, role: user.role, username: user.username });
    } else {
      res.status(401).json({ success: false, message: "Invalid User ID or Password" });
    }
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/all-partners", async (req, res) => {
  try {
    const partners = await User.find({ role: "Franchisee" }).sort({ username: 1 });
    const partnersWithCount = await Promise.all(partners.map(async (p) => {
      const count = await Tracking.countDocuments({ bookedBy: p.username });
      return { ...p._doc, shipmentCount: count };
    }));
    res.json(partnersWithCount);
  } catch (err) {
    res.status(500).json({ error: "Partners fetch failed" });
  }
});

app.delete("/delete-hub/:id", async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Hub deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

// ================== AUTO STATUS LOGIC ==================

const updateStatusIfNeeded = async (tracking) => {
  if (tracking.status === "Delivered") return tracking;

  const now = new Date();
  const diff = now - new Date(tracking.lastStatusUpdate);
  if (diff < STATUS_INTERVAL) return tracking; 

  const currentIndex = statusFlow.indexOf(tracking.status);
  const nextIndex = currentIndex + 1;
  if (nextIndex >= statusFlow.length) return tracking;

  const nextStatus = statusFlow[nextIndex];
  const courier = courierMaster.find((c) => tracking.trackingNumber.startsWith(c.prefix));

  tracking.status = nextStatus;
  tracking.lastStatusUpdate = now;

  if (nextStatus === "In Transit") {
    if (tracking.from.toLowerCase() === "noida" || tracking.to.toLowerCase() === "chandigarh") {
      tracking.currentLocation = "Delhi National Sorting Hub";
    } else {
      tracking.currentLocation = `${tracking.from} Regional Hub`;
    }
  } else if (nextStatus === "Out for Delivery") {
    tracking.currentLocation = `${tracking.to} Hub`;
  } else {
    tracking.currentLocation = tracking.to; 
  }

  tracking.expectedDelivery = courier ? courier.expected[nextIndex] : "Soon";
  tracking.history.push({ status: nextStatus, location: tracking.currentLocation, time: now });

  return await tracking.save();
};

// ================== TRACKING ROUTES ==================

app.get("/all-trackings", async (req, res) => {
  try {
    const allData = await Tracking.find().sort({ createdAt: -1 });
    res.json(allData);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed" });
  }
});

// FIXED ROUTE: Manual Admin Update
app.post("/update-status", async (req, res) => {
  try {
    const { trackingNumber, status } = req.body;
    
    const tracking = await Tracking.findOne({ trackingNumber });
    if (!tracking) return res.status(404).json({ error: "Tracking ID not found" });

    // Status aur time update
    tracking.status = status;
    tracking.lastStatusUpdate = new Date();

    // Location logic based on manual status
    if (status === "In Transit") {
      tracking.currentLocation = `${tracking.from} Regional Hub`;
    } else if (status === "Out for Delivery") {
      tracking.currentLocation = `${tracking.to} Hub`;
    } else if (status === "Delivered") {
      tracking.currentLocation = tracking.to;
    }

    // Expected delivery update logic for manual change
    const courier = courierMaster.find((c) => tracking.trackingNumber.startsWith(c.prefix));
    const statusIndex = statusFlow.indexOf(status);
    if (courier && statusIndex !== -1) {
        tracking.expectedDelivery = courier.expected[statusIndex];
    }

    // History update
    tracking.history.push({
      status: status,
      location: tracking.currentLocation,
      time: new Date()
    });

    await tracking.save();
    res.json({ success: true, message: "Status Updated Successfully!" });
  } catch (err) {
    res.status(500).json({ error: "Manual Update failed" });
  }
});

app.post("/track", async (req, res) => {
  try {
    const { trackingNumber, trackingNumbers } = req.body;

    if (trackingNumber) {
      let t = await Tracking.findOne({ trackingNumber });
      if (!t) return res.json({ found: [], invalid: [trackingNumber] });
      t = await updateStatusIfNeeded(t);
      return res.json({ found: [t], invalid: [] });
    }

    if (Array.isArray(trackingNumbers)) {
      const found = await Tracking.find({ trackingNumber: { $in: trackingNumbers } });
      const updatedFound = [];
      for (let t of found) {
        const updated = await updateStatusIfNeeded(t);
        updatedFound.push(updated);
      }
      const foundIds = updatedFound.map((x) => x.trackingNumber);
      const invalid = trackingNumbers.filter((x) => !foundIds.includes(x));
      return res.json({ found: updatedFound, invalid });
    }
    res.status(400).json({ error: "Invalid request" });
  } catch (err) {
    res.status(500).json({ error: "Tracking failed" });
  }
});

app.post("/create-tracking", async (req, res) => {
  try {
    const { from, to, courier: courierName, bookedBy } = req.body; 
    const courier = courierMaster.find(c => c.name === courierName) || courierMaster[0];
    const trackingNumber = courier.prefix + Math.floor(100000 + Math.random() * 900000);

    const data = new Tracking({
      trackingNumber,
      courier: courier.name,
      status: "Booked",
      from, to,
      currentLocation: from,
      expectedDelivery: courier.expected[0],
      bookedBy: bookedBy || "System Admin", 
      history: [{ status: "Booked", location: from, time: new Date() }],
    });

    await data.save();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Creation failed" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(` Server running on port ${PORT}`));