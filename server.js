require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const pool = require("./db");
const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand
} = require("@aws-sdk/client-rekognition");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is missing in .env");
}const AWS_REGION = process.env.AWS_REGION || "us-east-1";
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

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20mb" }));
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

async function countRecentPinFails(employeeId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM pin_attempts
     WHERE employee_id = $1
       AND success = false
       AND attempted_at >= NOW() - INTERVAL '15 minutes'`,
    [employeeId]
  );

  return result.rows[0].count;
}

app.get("/dev/seed", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Seed disabled in production" });
  }
  try {
    const adminEmail = "info@starcare-ksa.com";
    const userIqama = "2222222222";

    const adminPasswordHash = bcrypt.hashSync("Admin123!", 10);
    const userPasswordHash = bcrypt.hashSync("User123!", 10);
    const sitePinHash = bcrypt.hashSync("1234", 10);

    await pool.query(
      `INSERT INTO employees 
       (full_name, email, password_hash, is_admin, created_at)
       VALUES ($1, $2, $3, true, NOW())
       ON CONFLICT (email) DO NOTHING`,
      ["Admin", adminEmail, adminPasswordHash]
    );

    await pool.query(
      `INSERT INTO employees 
       (full_name, iqama_number, employee_category, password_hash, is_admin, face_enrolled, face_reference_image_base64, created_at)
       VALUES ($1, $2, $3, $4, false, false, NULL, NOW())
       ON CONFLICT (iqama_number) DO NOTHING`,
      ["Employee User", userIqama, "StarCare", userPasswordHash]
    );

    const siteResult = await pool.query(
      `INSERT INTO sites 
       (name, latitude, longitude, radius_m, pin_hash, pin_updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ["Jeddah Site", 21.4858, 39.1925, 400, sitePinHash]
    );

    const siteId = siteResult.rows[0].id;

    const userResult = await pool.query(
      "SELECT id FROM employees WHERE iqama_number = $1",
      [userIqama]
    );

    const userId = userResult.rows[0].id;

    const existingAssignment = await pool.query(
      `SELECT id FROM assignments 
       WHERE employee_id = $1 AND site_id = $2 AND status = 'active'`,
      [userId, siteId]
    );

    if (existingAssignment.rows.length === 0) {
      await pool.query(
        `INSERT INTO assignments 
         (employee_id, site_id, start_at, end_at, status, created_at)
         VALUES ($1, $2, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '7 days', 'active', NOW())`,
        [userId, siteId]
      );
    }

    res.json({
      ok: true,
      admin: { email: adminEmail, password: "Admin123!" },
      employee: { iqama_number: userIqama, password: "User123!" },
      sitePin: "1234"
    });
  } catch (err) {
    console.error("Seed error:", err);
    res.status(500).json({ error: "Seed failed", message: err.message });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, iqama_number, password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  let result;

  if (email) {
    const em = String(email).toLowerCase().trim();

    result = await pool.query(
      "SELECT * FROM employees WHERE email = $1 AND is_admin = true",
      [em]
    );
  } else if (iqama_number) {
    const iqama = String(iqama_number).trim();

    if (!isValidIqama(iqama)) {
      return res.status(400).json({ error: "Iqama number must be exactly 10 digits" });
    }

    result = await pool.query(
      "SELECT * FROM employees WHERE iqama_number = $1 AND is_admin = false",
      [iqama]
    );
  } else {
    return res.status(400).json({
      error: "Provide email for admin login or iqama number for employee login"
    });
  }

  const user = result.rows[0];

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
  try {
    const result = await pool.query(
      `SELECT 
         a.id,
         a.site_id,
         a.check_in_at,
         s.name AS site_name
       FROM attendance a
       LEFT JOIN sites s ON s.id = a.site_id
       WHERE a.employee_id = $1
         AND a.check_out_at IS NULL
       ORDER BY a.id DESC
       LIMIT 1`,
      [req.user.id]
    );

    const open = result.rows[0];

    if (!open) return res.json({ checked_in: false, open: null });

    res.json({
      checked_in: true,
      open: {
        id: open.id,
        site_id: open.site_id,
        site_name: open.site_name || "Unknown",
        check_in_at: open.check_in_at
      }
    });
  } catch (err) {
    console.error("Status error:", err);
    res.status(500).json({ error: "Failed to load status" });
  }
});

app.get("/me/face-status", auth, async (req, res) => {
  try {
    const employeeId = Number(req.user.id);

    await pool.query(
      "DELETE FROM face_verifications WHERE expires_at <= NOW()"
    );

    const empResult = await pool.query(
      `SELECT id, face_enrolled
       FROM employees
       WHERE id = $1`,
      [employeeId]
    );

    const emp = empResult.rows[0];

    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const verifiedResult = await pool.query(
      `SELECT id
       FROM face_verifications
       WHERE employee_id = $1
         AND expires_at > NOW()
       LIMIT 1`,
      [employeeId]
    );

    res.json({
      face_enrolled: !!emp.face_enrolled,
      face_verified: verifiedResult.rows.length > 0
    });
  } catch (err) {
    console.error("Face status error:", err);
    res.status(500).json({ error: "Failed to load face status" });
  }
});

app.get("/me/assigned-sites", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         s.id AS site_id,
         s.name,
         s.radius_m,
         a.start_at,
         a.end_at,
         CASE
           WHEN NOW() >= a.start_at
            AND (a.end_at IS NULL OR NOW() <= a.end_at)
           THEN true
           ELSE false
         END AS can_check_in_now
       FROM assignments a
       JOIN sites s ON s.id = a.site_id
       WHERE a.employee_id = $1
         AND a.status = 'active'
       ORDER BY a.start_at DESC`,
      [req.user.id]
    );

    const rows = result.rows.map(row => ({
      site_id: Number(row.site_id),
      name: row.name,
      radius_m: row.radius_m,
      start_at: row.start_at,
      end_at: row.end_at,
      can_check_in_now: row.can_check_in_now,
      assigned_visible: true
    }));

    res.json({
      now: nowIso(),
      sites: rows
    });
  } catch (err) {
    console.error("Assigned sites error:", err);
    res.status(500).json({ error: "Failed to load assigned sites" });
  }
});

async function verifyPunch({ employeeId, siteId, pin, lat, lng, accuracy_m }) {
  if (await countRecentPinFails(employeeId) >= 5) {
    return { ok: false, status: 429, error: "Too many failed PIN attempts. Try again later." };
  }

  const siteResult = await pool.query(
    "SELECT * FROM sites WHERE id = $1",
    [Number(siteId)]
  );

  const site = siteResult.rows[0];
  if (!site) return { ok: false, status: 404, error: "Site not found" };

  const assignmentResult = await pool.query(
    `SELECT *
     FROM assignments
     WHERE employee_id = $1
       AND site_id = $2
       AND status = 'active'
       AND NOW() >= start_at
       AND (end_at IS NULL OR NOW() <= end_at)
     ORDER BY id DESC
     LIMIT 1`,
    [employeeId, site.id]
  );

  if (assignmentResult.rows.length === 0) {
    return { ok: false, status: 403, error: "Not assigned to this site right now" };
  }

  const pinOk = bcrypt.compareSync(String(pin), site.pin_hash);

  await pool.query(
    `INSERT INTO pin_attempts
     (employee_id, site_id, success, attempted_at)
     VALUES ($1, $2, $3, NOW())`,
    [employeeId, site.id, pinOk]
  );

  if (!pinOk) return { ok: false, status: 403, error: "Invalid site PIN" };

  const ACCURACY_LIMIT = 80;
  if (Number(accuracy_m) > ACCURACY_LIMIT) {
    return { ok: false, status: 400, error: "Location accuracy too low. Enable high accuracy and try again." };
  }

  const distance = haversineMeters(
    Number(lat),
    Number(lng),
    Number(site.latitude),
    Number(site.longitude)
  );

  const BUFFER = 20;
  if (distance > (Number(site.radius_m) + BUFFER)) {
    return { ok: false, status: 403, error: `You are not at ${site.name}.` };
  }

  return {
    ok: true,
    site,
    now: nowIso(),
    distance_m: Math.round(distance)
  };
}

async function verifyPinOnlyForSite({ employeeId, siteId, pin }) {
  const siteResult = await pool.query(
    "SELECT * FROM sites WHERE id = $1",
    [Number(siteId)]
  );

  const site = siteResult.rows[0];

  if (!site) {
    return { ok: false, status: 404, error: "Site not found" };
  }

  const pinOk = bcrypt.compareSync(String(pin), site.pin_hash);

  await pool.query(
    `INSERT INTO pin_attempts
     (employee_id, site_id, success, attempted_at)
     VALUES ($1, $2, $3, NOW())`,
    [employeeId, site.id, pinOk]
  );

  if (!pinOk) {
    return { ok: false, status: 403, error: "Invalid site PIN" };
  }

  return { ok: true, site, now: nowIso() };
}

app.post("/attendance/check-in", auth, async (req, res) => {
  try {
    const { site_id, pin, lat, lng, accuracy_m } = req.body || {};
    const employeeId = Number(req.user.id);

    const openResult = await pool.query(
      `SELECT id
       FROM attendance
       WHERE employee_id = $1
         AND check_out_at IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [employeeId]
    );

    if (openResult.rows.length > 0) {
      return res.status(409).json({ error: "Already checked in. Please check out first." });
    }

    const faceResult = await pool.query(
      `SELECT id
       FROM face_verifications
       WHERE employee_id = $1
         AND expires_at > NOW()
       LIMIT 1`,
      [employeeId]
    );

    if (faceResult.rows.length === 0) {
      return res.status(403).json({
        error: "Face verification required before check-in"
      });
    }

    const v = await verifyPunch({
      employeeId,
      siteId: site_id,
      pin,
      lat,
      lng,
      accuracy_m
    });

    if (!v.ok) return res.status(v.status).json({ error: v.error });

    await pool.query(
      `INSERT INTO attendance
       (employee_id, site_id, check_in_at, check_out_at, method)
       VALUES ($1, $2, NOW(), NULL, $3)`,
      [employeeId, Number(site_id), "PIN+GPS+FACE"]
    );

    await pool.query(
      "DELETE FROM face_verifications WHERE employee_id = $1",
      [employeeId]
    );

    res.json({
      ok: true,
      site: v.site.name,
      distance_m: v.distance_m,
      check_in_at: v.now
    });

  } catch (err) {
    console.error("Check-in error:", err);
    res.status(500).json({ error: "Failed to check in" });
  }
});

app.post("/attendance/check-out", auth, async (req, res) => {
  try {
    const { site_id, pin } = req.body || {};
    const employeeId = Number(req.user.id);

    const openResult = await pool.query(
      `SELECT *
       FROM attendance
       WHERE employee_id = $1
         AND check_out_at IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [employeeId]
    );

    const open = openResult.rows[0];

    if (!open) {
      return res.status(409).json({ error: "No active check-in found." });
    }

    if (Number(site_id) !== Number(open.site_id)) {
      return res.status(403).json({
        error: "You must check out from the same site you checked in."
      });
    }

    if (!pin) {
      return res.status(400).json({ error: "Missing pin" });
    }

    const v = await verifyPinOnlyForSite({
      employeeId,
      siteId: site_id,
      pin
    });

    if (!v.ok) {
      return res.status(v.status).json({ error: v.error });
    }

    await pool.query(
      `UPDATE attendance
       SET check_out_at = NOW()
       WHERE id = $1`,
      [open.id]
    );

    res.json({
      ok: true,
      site: v.site.name,
      check_out_at: v.now
    });

  } catch (err) {
    console.error("Check-out error:", err);
    res.status(500).json({ error: "Failed to check out" });
  }
});

app.get("/me/attendance-summary", auth, async (req, res) => {
  try {
    const employeeId = req.user.id;

    const result = await pool.query(
      `SELECT DISTINCT ON (site_id)
         site_id,
         check_in_at AS last_check_in_at,
         check_out_at AS last_check_out_at
       FROM attendance
       WHERE employee_id = $1
       ORDER BY site_id, id DESC`,
      [employeeId]
    );

    const latestBySite = {};

    for (const row of result.rows) {
      latestBySite[Number(row.site_id)] = {
        site_id: Number(row.site_id),
        last_check_in_at: row.last_check_in_at,
        last_check_out_at: row.last_check_out_at || null
      };
    }

    res.json({ latestBySite });
  } catch (err) {
    console.error("Attendance summary error:", err);
    res.status(500).json({ error: "Failed to load attendance summary" });
  }
});

app.get("/admin/overview", auth, adminOnly, async (req, res) => {
  try {
    const employeesResult = await pool.query(`
      SELECT 
        id,
        full_name,
        email,
        iqama_number,
        employee_category,
        face_enrolled,
        is_admin
      FROM employees
      ORDER BY id ASC
    `);

    const sitesResult = await pool.query(`
      SELECT 
        id,
        name,
        latitude,
        longitude,
        radius_m,
        pin_updated_at
      FROM sites
      ORDER BY id ASC
    `);

    const assignmentsResult = await pool.query(`
      SELECT *
      FROM assignments
      ORDER BY id DESC
    `);

    const attendanceResult = await pool.query(`
      SELECT *
      FROM attendance
      ORDER BY id DESC
      LIMIT 200
    `);

    res.json({
      employees: employeesResult.rows,
      sites: sitesResult.rows,
      assignments: assignmentsResult.rows,
      attendance: attendanceResult.rows
    });
  } catch (err) {
    console.error("Admin overview error:", err);
    res.status(500).json({ error: "Failed to load admin overview" });
  }
});

app.post("/admin/employees", auth, adminOnly, async (req, res) => {
  try {
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

    const existing = await pool.query(
      "SELECT id FROM employees WHERE iqama_number = $1",
      [iqama]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Iqama number already exists" });
    }

    const result = await pool.query(
      `INSERT INTO employees 
       (full_name, iqama_number, employee_category, password_hash, is_admin, face_enrolled, created_at)
       VALUES ($1, $2, $3, $4, false, false, NOW())
       RETURNING id, full_name, iqama_number, employee_category, face_enrolled`,
      [
        full_name.trim(),
        iqama,
        category,
        bcrypt.hashSync(password, 10)
      ]
    );

    res.json({
      ok: true,
      employee: result.rows[0]
    });

  } catch (err) {
    console.error("Create employee error:", err);
    res.status(500).json({ error: "Failed to create employee" });
  }
});

app.post("/admin/employees/:id/enroll-face", auth, adminOnly, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    const { image_base64 } = req.body || {};

    if (!image_base64) {
      return res.status(400).json({ error: "Missing image_base64" });
    }

    const empResult = await pool.query(
      "SELECT id, is_admin FROM employees WHERE id = $1",
      [employeeId]
    );

    const emp = empResult.rows[0];

    if (!emp) {
      return res.status(404).json({ error: "Employee not found" });
    }

    if (emp.is_admin) {
      return res.status(400).json({ error: "Cannot enroll face for admin here" });
    }

    await pool.query(
      `UPDATE employees
       SET face_enrolled = true,
           face_reference_image_base64 = $1
       WHERE id = $2`,
      [image_base64, employeeId]
    );

    res.json({ ok: true, message: "Face enrolled successfully" });

  } catch (err) {
    console.error("Enroll face error:", err);
    res.status(500).json({ error: "Failed to enroll face" });
  }
});

app.post("/face/liveness/create-session", auth, async (req, res) => {
  try {
    const employeeId = Number(req.user.id);

    const empResult = await pool.query(
      `SELECT id, face_enrolled, face_reference_image_base64
       FROM employees
       WHERE id = $1`,
      [employeeId]
    );

    const emp = empResult.rows[0];

    if (!emp) return res.status(404).json({ error: "Employee not found" });

    if (!emp.face_enrolled || !emp.face_reference_image_base64) {
      return res.status(400).json({ error: "Face not enrolled for this employee" });
    }

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
  try {
    const employeeId = Number(req.user.id);
    const { sessionId } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }

    const empResult = await pool.query(
      `SELECT id, face_enrolled, face_reference_image_base64
       FROM employees
       WHERE id = $1`,
      [employeeId]
    );

    const emp = empResult.rows[0];

    if (!emp) return res.status(404).json({ error: "Employee not found" });

    if (!emp.face_enrolled || !emp.face_reference_image_base64) {
      return res.status(400).json({ error: "Face not enrolled for this employee" });
    }

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

    await pool.query(
      "DELETE FROM face_verifications WHERE employee_id = $1 OR expires_at <= NOW()",
      [employeeId]
    );

    await pool.query(
      `INSERT INTO face_verifications
       (employee_id, verified_at, expires_at)
       VALUES ($1, NOW(), NOW() + INTERVAL '2 minutes')`,
      [employeeId]
    );

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
  try {
    const { name, latitude, longitude, radius_m, pin } = req.body || {};

    if (!name || latitude == null || longitude == null || !pin) {
      return res.status(400).json({ error: "Missing name/latitude/longitude/pin" });
    }

    const n = String(name).trim();

    const existing = await pool.query(
      "SELECT id FROM sites WHERE LOWER(name) = LOWER($1)",
      [n]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Site name already exists" });
    }

    const result = await pool.query(
      `INSERT INTO sites
       (name, latitude, longitude, radius_m, pin_hash, pin_updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, name`,
      [
        n,
        Number(latitude),
        Number(longitude),
        radius_m == null ? 250 : Number(radius_m),
        bcrypt.hashSync(String(pin), 10)
      ]
    );

    res.json({ ok: true, site: result.rows[0] });

  } catch (err) {
    console.error("Create site error:", err);
    res.status(500).json({ error: "Failed to create site" });
  }
});

app.post("/admin/sites/:id/pin/reset", auth, adminOnly, async (req, res) => {
  try {
    const siteId = Number(req.params.id);
    const { pin } = req.body || {};

    if (!pin) return res.status(400).json({ error: "Missing pin" });

    const result = await pool.query(
      `UPDATE sites
       SET pin_hash = $1, pin_updated_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [bcrypt.hashSync(String(pin), 10), siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("Reset site PIN error:", err);
    res.status(500).json({ error: "Failed to reset site PIN" });
  }
});

app.post("/admin/assignments", auth, adminOnly, async (req, res) => {
  try {
    const { employee_ids, site_id, start_at, end_at } = req.body || {};

    if (!Array.isArray(employee_ids) || !employee_ids.length || !site_id || !start_at) {
      return res.status(400).json({ error: "Missing employee_ids/site_id/start_at" });
    }

    const siteResult = await pool.query(
      "SELECT id FROM sites WHERE id = $1",
      [Number(site_id)]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    const created = [];
    const skipped = [];

    for (const rawId of employee_ids) {
      const empId = Number(rawId);

      const empResult = await pool.query(
        "SELECT id, is_admin FROM employees WHERE id = $1",
        [empId]
      );

      const emp = empResult.rows[0];

      if (!emp) {
        skipped.push({ employee_id: empId, reason: "Employee not found" });
        continue;
      }

      if (emp.is_admin) {
        skipped.push({ employee_id: empId, reason: "Cannot assign sites to admin users" });
        continue;
      }

      const assignmentResult = await pool.query(
        `INSERT INTO assignments
         (employee_id, site_id, start_at, end_at, status, created_at)
         VALUES ($1, $2, $3, $4, 'active', NOW())
         RETURNING *`,
        [
          empId,
          Number(site_id),
          String(start_at),
          end_at ? String(end_at) : null
        ]
      );

      created.push(assignmentResult.rows[0]);
    }

    res.json({
      ok: true,
      created_count: created.length,
      skipped_count: skipped.length,
      created,
      skipped
    });

  } catch (err) {
    console.error("Create assignment error:", err);
    res.status(500).json({ error: "Failed to create assignment" });
  }
});

app.post("/admin/assignments/:id/cancel", auth, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await pool.query(
      `UPDATE assignments
       SET status = 'cancelled'
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("Cancel assignment error:", err);
    res.status(500).json({ error: "Failed to cancel assignment" });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));
app.get("/assignments", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "assignments.html"));
});
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`);
  console.log(`Seed: http://localhost:${PORT}/dev/seed`);
});