require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand
} = require("@aws-sdk/client-rekognition");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change_me";
const DB_FILE = process.env.DB_FILE || "db.json";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const FACE_LIVENESS_MIN_CONFIDENCE = Number(process.env.FACE_LIVENESS_MIN_CONFIDENCE || 90);
const FACE_MATCH_MIN_SIMILARITY = Number(process.env.FACE_MATCH_MIN_SIMILARITY || 90);

const awsCreds = {
  accessKeyId: (process.env.AWS_ACCESS_KEY_ID || "").trim(),
  secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || "").trim()
};

if (!awsCreds.accessKeyId || !awsCreds.secretAccessKey) {
  throw new Error("AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is missing in .env");
}

const rekognition = new RekognitionClient({
  region: AWS_REGION,
  credentials: awsCreds
});

const adapter = new JSONFile(DB_FILE);
const db = new Low(adapter, {
  employees: [],
  sites: [],
  assignments: [],
  attendance: [],
  pinAttempts: [],
  faceVerifications: []
});

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/face-verify", express.static(path.join(__dirname, "public", "face-verify")));
app.get("/face-verify/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "face-verify", "index.html"));
});

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function isValidIqama(iqama) {
  return /^\d{10}$/.test(String(iqama || "").trim());
}

function cleanupExpiredFaceVerifications() {
  const now = Date.now();
  db.data.faceVerifications = db.data.faceVerifications.filter(v => Date.parse(v.expires_at) > now);
}

function markFaceVerified(employeeId) {
  cleanupExpiredFaceVerifications();

  const verifiedAt = nowIso();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  db.data.faceVerifications = db.data.faceVerifications.filter(
    v => Number(v.employee_id) !== Number(employeeId)
  );

  db.data.faceVerifications.push({
    employee_id: Number(employeeId),
    verified_at: verifiedAt,
    expires_at: expiresAt
  });
}

function hasValidFaceVerification(employeeId) {
  cleanupExpiredFaceVerifications();
  return db.data.faceVerifications.some(v =>
    Number(v.employee_id) === Number(employeeId) &&
    Date.parse(v.expires_at) > Date.now()
  );
}

function clearFaceVerification(employeeId) {
  db.data.faceVerifications = db.data.faceVerifications.filter(
    v => Number(v.employee_id) !== Number(employeeId)
  );
}

function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: "Admin only" });
  next();
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isAssignmentActive(a, now) {
  if (!a || a.status !== "active") return false;
  const t = Date.parse(now);
  const start = Date.parse(a.start_at);
  const end = a.end_at ? Date.parse(a.end_at) : null;
  if (t < start) return false;
  if (end !== null && t > end) return false;
  return true;
}

function countRecentPinFails(employeeId) {
  const since = Date.now() - 15 * 60 * 1000;
  return db.data.pinAttempts.filter(p =>
    p.employee_id === employeeId &&
    p.success === false &&
    Date.parse(p.attempted_at) >= since
  ).length;
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}

async function ensureDb() {
  await db.read();
  db.data ||= {
    employees: [],
    sites: [],
    assignments: [],
    attendance: [],
    pinAttempts: [],
    faceVerifications: []
  };
  db.data.faceVerifications ||= [];
  await db.write();
}

app.get("/dev/seed", async (req, res) => {
  await ensureDb();

  const adminEmail = "admin@demo.com";
  const userIqama = "2222222222";

  const admin = db.data.employees.find(u => u.email === adminEmail);
  const user = db.data.employees.find(u => u.iqama_number === userIqama);

  if (!admin) {
    db.data.employees.push({
      id: nextId(db.data.employees),
      full_name: "Admin",
      email: adminEmail,
      password_hash: bcrypt.hashSync("Admin123!", 10),
      is_admin: true,
      created_at: nowIso()
    });
  }

  if (!user) {
    db.data.employees.push({
      id: nextId(db.data.employees),
      full_name: "Employee User",
      iqama_number: userIqama,
      employee_category: "StarCare",
      password_hash: bcrypt.hashSync("User123!", 10),
      is_admin: false,
      face_enrolled: false,
      face_reference_image_base64: null,
      created_at: nowIso()
    });
  }

  const siteName = "Jeddah Site";
  let site = db.data.sites.find(s => s.name === siteName);
  if (!site) {
    site = {
      id: nextId(db.data.sites),
      name: siteName,
      latitude: 21.4858,
      longitude: 39.1925,
      radius_m: 400,
      pin_hash: bcrypt.hashSync("1234", 10),
      pin_updated_at: nowIso()
    };
    db.data.sites.push(site);
  }

  const userId = db.data.employees.find(u => u.iqama_number === userIqama).id;

  const hasAssignment = db.data.assignments.some(a =>
    Number(a.employee_id) === Number(userId) &&
    Number(a.site_id) === Number(site.id) &&
    a.status === "active"
  );

  if (!hasAssignment) {
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.data.assignments.push({
      id: nextId(db.data.assignments),
      employee_id: userId,
      site_id: site.id,
      start_at: start,
      end_at: end,
      status: "active"
    });
  }

  await db.write();

  res.json({
    ok: true,
    admin: { email: adminEmail, password: "Admin123!" },
    employee: { iqama_number: userIqama, password: "User123!" },
    sitePin: "1234"
  });
});

app.post("/auth/login", async (req, res) => {
  await ensureDb();
  const { email, iqama_number, password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  let user = null;

  if (email) {
    const em = String(email).toLowerCase().trim();
    user = db.data.employees.find(u => u.email === em && !!u.is_admin);
  } else if (iqama_number) {
    const iqama = String(iqama_number).trim();
    if (!isValidIqama(iqama)) {
      return res.status(400).json({ error: "Iqama number must be exactly 10 digits" });
    }
    user = db.data.employees.find(u => String(u.iqama_number) === iqama && !u.is_admin);
  } else {
    return res.status(400).json({ error: "Provide email for admin login or iqama number for employee login" });
  }

  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken({
    id: user.id,
    is_admin: !!user.is_admin
  });

  res.json({
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email || null,
      iqama_number: user.iqama_number || null,
      is_admin: !!user.is_admin
    }
  });
});

app.get("/me/status", auth, async (req, res) => {
  await ensureDb();
  const open = [...db.data.attendance]
    .reverse()
    .find(a => a.employee_id === req.user.id && !a.check_out_at);

  if (!open) return res.json({ checked_in: false, open: null });

  const site = db.data.sites.find(s => s.id === open.site_id);
  res.json({
    checked_in: true,
    open: {
      id: open.id,
      site_id: open.site_id,
      site_name: site?.name || "Unknown",
      check_in_at: open.check_in_at
    }
  });
});

app.get("/me/face-status", auth, async (req, res) => {
  await ensureDb();

  const employeeId = Number(req.user.id);
  const emp = db.data.employees.find(e => Number(e.id) === employeeId);

  if (!emp) return res.status(404).json({ error: "Employee not found" });

  cleanupExpiredFaceVerifications();

  res.json({
    face_enrolled: !!emp.face_enrolled,
    face_verified: hasValidFaceVerification(employeeId)
  });
});

app.get("/me/assigned-sites", auth, async (req, res) => {
  await ensureDb();
  const now = nowIso();
  const nowMs = Date.parse(now);

  const rows = db.data.assignments
    .filter(a => Number(a.employee_id) === Number(req.user.id) && a.status === "active")
    .map(a => {
      const s = db.data.sites.find(x => Number(x.id) === Number(a.site_id));
      if (!s) return null;

      const startMs = Date.parse(a.start_at);
      const endMs = a.end_at ? Date.parse(a.end_at) : null;

      const can_check_in_now =
        !Number.isNaN(startMs) &&
        nowMs >= startMs &&
        (endMs === null || nowMs <= endMs);

      return {
        site_id: Number(s.id),
        name: s.name,
        radius_m: s.radius_m,
        start_at: a.start_at,
        end_at: a.end_at,
        can_check_in_now,
        assigned_visible: true
      };
    })
    .filter(Boolean);

  res.json({ now, sites: rows });
});

function verifyPunch({ employeeId, siteId, pin, lat, lng, accuracy_m }) {
  if (countRecentPinFails(employeeId) >= 5) {
    return { ok: false, status: 429, error: "Too many failed PIN attempts. Try again later." };
  }

  const site = db.data.sites.find(s => s.id === Number(siteId));
  if (!site) return { ok: false, status: 404, error: "Site not found" };

  const now = nowIso();
  const assignment = [...db.data.assignments].reverse().find(a =>
    Number(a.employee_id) === Number(employeeId) &&
    Number(a.site_id) === Number(site.id) &&
    a.status === "active"
  );

  if (!isAssignmentActive(assignment, now)) {
    return { ok: false, status: 403, error: "Not assigned to this site right now" };
  }

  const pinOk = bcrypt.compareSync(String(pin), site.pin_hash);
  db.data.pinAttempts.push({
    id: nextId(db.data.pinAttempts),
    employee_id: employeeId,
    site_id: site.id,
    success: pinOk,
    attempted_at: nowIso()
  });

  if (!pinOk) return { ok: false, status: 403, error: "Invalid site PIN" };

  const ACCURACY_LIMIT = 80;
  if (Number(accuracy_m) > ACCURACY_LIMIT) {
    return { ok: false, status: 400, error: "Location accuracy too low. Enable high accuracy and try again." };
  }

  const distance = haversineMeters(Number(lat), Number(lng), site.latitude, site.longitude);
  const BUFFER = 20;
  if (distance > (site.radius_m + BUFFER)) {
    return { ok: false, status: 403, error: `You are not at ${site.name}.` };
  }

  return { ok: true, site, now: nowIso(), distance_m: Math.round(distance) };
}

function verifyPinOnlyForSite({ employeeId, siteId, pin }) {
  const site = db.data.sites.find(s => s.id === Number(siteId));
  if (!site) return { ok: false, status: 404, error: "Site not found" };

  const pinOk = bcrypt.compareSync(String(pin), site.pin_hash);

  db.data.pinAttempts.push({
    id: nextId(db.data.pinAttempts),
    employee_id: employeeId,
    site_id: site.id,
    success: pinOk,
    attempted_at: nowIso()
  });

  if (!pinOk) return { ok: false, status: 403, error: "Invalid site PIN" };

  return { ok: true, site, now: nowIso() };
}

app.post("/attendance/check-in", auth, async (req, res) => {
  await ensureDb();
  const { site_id, pin, lat, lng, accuracy_m } = req.body || {};
  const employeeId = req.user.id;

  const open = [...db.data.attendance].reverse().find(a => a.employee_id === employeeId && !a.check_out_at);
  if (open) return res.status(409).json({ error: "Already checked in. Please check out first." });

  if (!hasValidFaceVerification(employeeId)) {
    return res.status(403).json({
      error: "Face verification required before check-in"
    });
  }

  const v = verifyPunch({ employeeId, siteId: site_id, pin, lat, lng, accuracy_m });
  await db.write();
  if (!v.ok) return res.status(v.status).json({ error: v.error });

  db.data.attendance.push({
    id: nextId(db.data.attendance),
    employee_id: employeeId,
    site_id: Number(site_id),
    check_in_at: v.now,
    check_out_at: null,
    method: "PIN+GPS+FACE"
  });

  clearFaceVerification(employeeId);
  await db.write();

  res.json({ ok: true, site: v.site.name, distance_m: v.distance_m, check_in_at: v.now });
});

app.post("/attendance/check-out", auth, async (req, res) => {
  await ensureDb();
  const { site_id, pin } = req.body || {};
  const employeeId = req.user.id;

  const openIndex = db.data.attendance.findIndex(
    a => a.employee_id === employeeId && !a.check_out_at
  );
  if (openIndex === -1) return res.status(409).json({ error: "No active check-in found." });

  const open = db.data.attendance[openIndex];

  if (Number(site_id) !== Number(open.site_id)) {
    return res.status(403).json({ error: "You must check out from the same site you checked in." });
  }

  if (!pin) return res.status(400).json({ error: "Missing pin" });

  const v = verifyPinOnlyForSite({ employeeId, siteId: site_id, pin });
  await db.write();

  if (!v.ok) return res.status(v.status).json({ error: v.error });

  db.data.attendance[openIndex].check_out_at = v.now;
  await db.write();

  res.json({ ok: true, site: v.site.name, check_out_at: v.now });
});

app.get("/me/attendance-summary", auth, async (req, res) => {
  await ensureDb();
  const employeeId = req.user.id;

  const latestBySite = new Map();

  for (let i = db.data.attendance.length - 1; i >= 0; i--) {
    const a = db.data.attendance[i];
    if (a.employee_id !== employeeId) continue;

    const key = Number(a.site_id);
    if (latestBySite.has(key)) continue;

    latestBySite.set(key, {
      site_id: key,
      last_check_in_at: a.check_in_at,
      last_check_out_at: a.check_out_at || null
    });
  }

  res.json({ latestBySite: Object.fromEntries(latestBySite) });
});

app.get("/admin/overview", auth, adminOnly, async (req, res) => {
  await ensureDb();
  res.json({
    employees: db.data.employees.map(e => ({
      id: e.id,
      full_name: e.full_name,
      email: e.email || null,
      iqama_number: e.iqama_number || null,
      employee_category: e.employee_category || null,
      face_enrolled: !!e.face_enrolled,
      is_admin: !!e.is_admin
    })),
    sites: db.data.sites.map(s => ({
      id: s.id,
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      radius_m: s.radius_m,
      pin_updated_at: s.pin_updated_at
    })),
    assignments: db.data.assignments,
    attendance: [...db.data.attendance].reverse().slice(0, 200)
  });
});

app.post("/admin/employees", auth, adminOnly, async (req, res) => {
  await ensureDb();

  const { full_name, iqama_number, password, employee_category } = req.body || {};

  if (!full_name || !iqama_number || !password || !employee_category) {
    return res.status(400).json({
      error: "Missing full_name / iqama_number / password / employee_category"
    });
  }

  const iqama = String(iqama_number).trim();
  const category = String(employee_category).trim();

  if (!isValidIqama(iqama)) {
    return res.status(400).json({ error: "Iqama number must be exactly 10 digits" });
  }

  if (!["StarCare", "Outsider"].includes(category)) {
    return res.status(400).json({ error: "employee_category must be StarCare or Outsider" });
  }

  if (db.data.employees.some(u => String(u.iqama_number) === String(iqama))) {
    return res.status(409).json({ error: "Iqama number already exists" });
  }

  const user = {
    id: nextId(db.data.employees),
    full_name: String(full_name).trim(),
    iqama_number: iqama,
    employee_category: category,
    password_hash: bcrypt.hashSync(String(password), 10),
    is_admin: false,
    face_enrolled: false,
    face_reference_image_base64: null,
    created_at: nowIso()
  };

  db.data.employees.push(user);
  await db.write();

  res.json({
    ok: true,
    employee: {
      id: user.id,
      full_name: user.full_name,
      iqama_number: user.iqama_number,
      employee_category: user.employee_category,
      face_enrolled: user.face_enrolled
    }
  });
});

app.post("/admin/employees/:id/enroll-face", auth, adminOnly, async (req, res) => {
  await ensureDb();

  const employeeId = Number(req.params.id);
  const { image_base64 } = req.body || {};

  if (!image_base64) {
    return res.status(400).json({ error: "Missing image_base64" });
  }

  const emp = db.data.employees.find(e => Number(e.id) === Number(employeeId));
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  if (emp.is_admin) {
    return res.status(400).json({ error: "Cannot enroll face for admin here" });
  }

  emp.face_enrolled = true;
  emp.face_reference_image_base64 = image_base64;

  await db.write();

  res.json({ ok: true, message: "Face enrolled successfully" });
});

app.post("/face/liveness/create-session", auth, async (req, res) => {
  await ensureDb();

  const employeeId = Number(req.user.id);
  const emp = db.data.employees.find(e => Number(e.id) === employeeId);

  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!emp.face_enrolled || !emp.face_reference_image_base64) {
    return res.status(400).json({ error: "Face not enrolled for this employee" });
  }

  try {
    const command = new CreateFaceLivenessSessionCommand({
      ClientRequestToken: `${employeeId}-${Date.now()}`
    });

    const result = await rekognition.send(command);

    res.json({
      ok: true,
      sessionId: result.SessionId
    });
  } catch (err) {
  console.error("CreateFaceLivenessSession error full:", err);
  res.status(500).json({
    error: err?.name || "CreateFaceLivenessSessionError",
    message: err?.message || "Failed to create face liveness session"
  });
  }
});

app.post("/face/verify-complete", auth, async (req, res) => {
  await ensureDb();

  const employeeId = Number(req.user.id);
  const { sessionId } = req.body || {};

  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }

  const emp = db.data.employees.find(e => Number(e.id) === employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  if (!emp.face_enrolled || !emp.face_reference_image_base64) {
    return res.status(400).json({ error: "Face not enrolled for this employee" });
  }

  try {
    const livenessResult = await rekognition.send(
      new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId })
    );

    const confidence = Number(livenessResult.Confidence || 0);

    if (confidence < FACE_LIVENESS_MIN_CONFIDENCE) {
      return res.status(403).json({
        error: `Face liveness failed. Confidence ${confidence.toFixed(2)} is below threshold.`
      });
    }

    const sessionReferenceImageBytes = livenessResult.ReferenceImage?.Bytes;
    if (!sessionReferenceImageBytes) {
      return res.status(400).json({ error: "No reference image returned from liveness session" });
    }

    const enrolledBytes = Buffer.from(emp.face_reference_image_base64, "base64");

    const compareResult = await rekognition.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: enrolledBytes },
        TargetImage: { Bytes: sessionReferenceImageBytes },
        SimilarityThreshold: FACE_MATCH_MIN_SIMILARITY
      })
    );

    const bestMatch = compareResult.FaceMatches?.[0];
    const similarity = Number(bestMatch?.Similarity || 0);

    if (!bestMatch || similarity < FACE_MATCH_MIN_SIMILARITY) {
      return res.status(403).json({
        error: `Face identity verification failed. Similarity ${similarity.toFixed(2)} is below threshold.`
      });
    }

    markFaceVerified(employeeId);
    await db.write();

    res.json({
      ok: true,
      liveness_confidence: confidence,
      face_similarity: similarity,
      expires_in_seconds: 120
    });
  } catch (err) {
    console.error("Face verification error:", err);
    res.status(500).json({ error: "Failed to verify face" });
  }
});

app.post("/admin/sites", auth, adminOnly, async (req, res) => {
  await ensureDb();
  const { name, latitude, longitude, radius_m, pin } = req.body || {};
  if (!name || latitude == null || longitude == null || !pin) {
    return res.status(400).json({ error: "Missing name/latitude/longitude/pin" });
  }

  const n = String(name).trim();
  if (db.data.sites.some(s => s.name.toLowerCase() === n.toLowerCase())) {
    return res.status(409).json({ error: "Site name already exists" });
  }

  const site = {
    id: nextId(db.data.sites),
    name: n,
    latitude: Number(latitude),
    longitude: Number(longitude),
    radius_m: radius_m == null ? 250 : Number(radius_m),
    pin_hash: bcrypt.hashSync(String(pin), 10),
    pin_updated_at: nowIso()
  };
  db.data.sites.push(site);
  await db.write();

  res.json({ ok: true, site: { id: site.id, name: site.name } });
});

app.post("/admin/sites/:id/pin/reset", auth, adminOnly, async (req, res) => {
  await ensureDb();
  const siteId = Number(req.params.id);
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: "Missing pin" });

  const site = db.data.sites.find(s => s.id === siteId);
  if (!site) return res.status(404).json({ error: "Site not found" });

  site.pin_hash = bcrypt.hashSync(String(pin), 10);
  site.pin_updated_at = nowIso();
  await db.write();

  res.json({ ok: true });
});

app.post("/admin/assignments", auth, adminOnly, async (req, res) => {
  await ensureDb();

  const { employee_ids, site_id, start_at, end_at } = req.body || {};

  if (!Array.isArray(employee_ids) || !employee_ids.length || !site_id || !start_at) {
    return res.status(400).json({ error: "Missing employee_ids/site_id/start_at" });
  }

  const site = db.data.sites.find(s => Number(s.id) === Number(site_id));
  if (!site) return res.status(404).json({ error: "Site not found" });

  const created = [];
  const skipped = [];

  for (const rawId of employee_ids) {
    const empId = Number(rawId);
    const emp = db.data.employees.find(e => Number(e.id) === empId);

    if (!emp) {
      skipped.push({ employee_id: empId, reason: "Employee not found" });
      continue;
    }

    if (emp.is_admin) {
      skipped.push({ employee_id: empId, reason: "Cannot assign sites to admin users" });
      continue;
    }

    const assignment = {
      id: nextId(db.data.assignments),
      employee_id: empId,
      site_id: Number(site_id),
      start_at: String(start_at),
      end_at: end_at ? String(end_at) : null,
      status: "active",
      created_at: nowIso()
    };

    db.data.assignments.push(assignment);
    created.push(assignment);
  }

  await db.write();

  res.json({
    ok: true,
    created_count: created.length,
    skipped_count: skipped.length,
    created,
    skipped
  });
});

app.post("/admin/assignments/:id/cancel", auth, adminOnly, async (req, res) => {
  await ensureDb();
  const id = Number(req.params.id);
  const a = db.data.assignments.find(x => x.id === id);
  if (!a) return res.status(404).json({ error: "Assignment not found" });
  a.status = "cancelled";
  await db.write();
  res.json({ ok: true });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));
app.get("/assignments", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "assignments.html"));
});
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.listen(PORT, async () => {
  await ensureDb();
  console.log(`Running on http://localhost:${PORT}`);
  console.log(`Seed: http://localhost:${PORT}/dev/seed`);
});