const token = localStorage.getItem("token");
if (!token) window.location.href = "/";

document.getElementById("logoutBtn").onclick = () => {
  localStorage.removeItem("token");
  window.location.href = "/";
};

const msg = document.getElementById("msg");

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }
  });

  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function showError(e) {
  msg.textContent = e || "";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function fmt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

async function enrollFaceFromUpload(employeeId) {
  const fileInput = document.getElementById(`faceFile-${employeeId}`);

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert("Please select a clear face image first.");
    return;
  }

  const file = fileInput.files[0];

  if (!file.type.startsWith("image/")) {
    alert("Please upload a valid image file.");
    return;
  }

  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const base64WithPrefix = reader.result;
      const image_base64 = base64WithPrefix.split(",")[1];

      const res = await fetch(`/admin/employees/${employeeId}/enroll-face`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ image_base64 })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(data.error || "Face enrollment failed");
        return;
      }

      alert("Face enrolled successfully.");
      await loadOverview();

    } catch (err) {
      console.error(err);
      alert("Something went wrong while enrolling face.");
    }
  };

  reader.readAsDataURL(file);
}

async function loadOverview() {
  const r = await api("/admin/overview", { method: "GET" });

  if (!r.ok) {
    showError(r.data.error || "Not authorized. Login as admin.");
    return;
  }

  showError("");

  const employees = r.data.employees || [];
  const sites = r.data.sites || [];
  const attendance = r.data.attendance || [];

  const empMap = new Map(employees.map(e => [e.id, e]));
  const siteMap = new Map(sites.map(s => [s.id, s]));

  const employeesDiv = document.getElementById("employeesList");

    if (employeesDiv) {
    employeesDiv.innerHTML = employees.length
      ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Iqama / Email</th>
                <th>Category</th>
                <th>Role</th>
                <th>Face Status</th>
                <th>Upload Face</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${employees.map(e => `
                <tr>
                  <td>${esc(e.full_name)}</td>
                  <td>${esc(e.is_admin ? e.email || "-" : e.iqama_number || "-")}</td>
                  <td>${esc(e.employee_category || "-")}</td>
                  <td>${e.is_admin ? "Admin" : "Employee"}</td>
                  <td>${e.is_admin ? "-" : e.face_enrolled ? "Enrolled ✅" : "Not enrolled ❌"}</td>
                  <td>
                    ${!e.is_admin ? `
                      <label for="faceFile-${e.id}" class="file-upload-btn">
                        Choose Image
                      </label>

                      <input 
                        type="file" 
                        id="faceFile-${e.id}" 
                        accept="image/*"
                        class="hidden-file-input"
                        onchange="showSelectedFileName(${e.id})"
                      />

                     
                    ` : "-"}
                  </td>
                  <td>
                    ${!e.is_admin ? `
                      <button onclick="enrollFaceFromUpload(${e.id})" class="btn-secondary">
                        Upload
                      </button>
                    ` : "-"}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `
      : `<div class="small-note">No employees created yet.</div>`;
  }

  window.showSelectedFileName = function (employeeId) {
  const input = document.getElementById(`faceFile-${employeeId}`);
  const label = document.getElementById(`fileName-${employeeId}`);

  if (!input || !label) return;

  label.textContent = input.files.length
    ? input.files[0].name
    : "No image selected";
  };
  const sitesDiv = document.getElementById("sitesList");

  sitesDiv.innerHTML = sites.length
  ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Site Name</th>
            <th>Latitude</th>
            <th>Longitude</th>
            <th>Radius</th>
            <th>PIN Updated</th>
            <th>New PIN</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${sites.map(s => `
            <tr>
              <td>${esc(s.name)}</td>
              <td>${esc(String(s.latitude))}</td>
              <td>${esc(String(s.longitude))}</td>
              <td>${esc(String(s.radius_m))}m</td>
              <td>${esc(fmt(s.pin_updated_at))}</td>
              <td>
                <input id="pin_${s.id}" placeholder="New PIN" class="table-input" />
              </td>
              <td>
                <button onclick="resetPin(${s.id})" class="btn-secondary">
                  Reset
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `
  : `<div class="small-note">No sites created yet.</div>`;

  const attDiv = document.getElementById("attendanceList");

  attDiv.innerHTML = attendance.length
    ? attendance.map(a => {
        const e = empMap.get(a.employee_id);
        const s = siteMap.get(a.site_id);

        const employeeLabel = e
          ? `${e.full_name}${e.iqama_number ? ` (${e.iqama_number})` : e.email ? ` (${e.email})` : ""}`
          : "Unknown";

        return `
          <div class="attendance-item">
            <div class="list-card-title">${esc(employeeLabel)} @ ${esc(s?.name || "Unknown")}</div>
            <div class="small-note">IN: ${esc(fmt(a.check_in_at))}</div>
            <div class="small-note">OUT: ${esc(a.check_out_at ? fmt(a.check_out_at) : "(open)")}</div>
          </div>
        `;
      }).join("")
    : `<div class="small-note">No attendance records yet.</div>`;
}

window.resetPin = async (siteId) => {
  const pin = document.getElementById(`pin_${siteId}`).value.trim();
  if (!pin) return alert("Enter a PIN");

  const r = await api(`/admin/sites/${siteId}/pin/reset`, {
    method: "POST",
    body: JSON.stringify({ pin })
  });

  if (!r.ok) return alert(r.data.error || "Failed");

  alert("PIN reset");
  await loadOverview();
};

window.enrollFaceFromUpload = enrollFaceFromUpload;

document.getElementById("createSiteBtn").onclick = async () => {
  const name = document.getElementById("siteName").value.trim();
  const latitude = document.getElementById("siteLat").value.trim();
  const longitude = document.getElementById("siteLng").value.trim();
  const radius_m = document.getElementById("siteRadius").value.trim();
  const pin = document.getElementById("sitePin").value.trim();

  const r = await api("/admin/sites", {
    method: "POST",
    body: JSON.stringify({
      name,
      latitude: Number(latitude),
      longitude: Number(longitude),
      radius_m: radius_m ? Number(radius_m) : 250,
      pin
    })
  });

  if (!r.ok) return alert(r.data.error || "Failed");

  alert("Site created");

  document.getElementById("siteName").value = "";
  document.getElementById("siteLat").value = "";
  document.getElementById("siteLng").value = "";
  document.getElementById("siteRadius").value = "";
  document.getElementById("sitePin").value = "";

  await loadOverview();
};

document.getElementById("createEmpBtn").onclick = async () => {
  const full_name = document.getElementById("empName").value.trim();
  const iqama_number = document.getElementById("empIqama").value.trim();
  const password = document.getElementById("empPass").value.trim();
  const employee_category = document.getElementById("empCategory").value;

  if (!full_name || !iqama_number || !password || !employee_category) {
    alert("Please fill all employee fields.");
    return;
  }

  const r = await api("/admin/employees", {
    method: "POST",
    body: JSON.stringify({
      full_name,
      iqama_number,
      password,
      employee_category
    })
  });

  if (!r.ok) {
    alert(r.data.error || "Failed to create employee");
    return;
  }

  alert("Employee created");

  document.getElementById("empName").value = "";
  document.getElementById("empIqama").value = "";
  document.getElementById("empPass").value = "";
  document.getElementById("empCategory").value = "";

  await loadOverview();
};

const summaryTabBtn = document.getElementById("summaryTabBtn");
const homeSection = document.getElementById("homeSection");
const summarySection = document.getElementById("summarySection");

if (summaryTabBtn) {
  summaryTabBtn.onclick = async () => {
    homeSection.style.display = "none";
    summarySection.style.display = "block";
    await loadSummary();
  };
}

function showSection(sectionName) {
  const sections = {
    home: document.getElementById("homeSection"),
    employees: document.getElementById("employeesSection"),
    sites: document.getElementById("sitesSection"),
    summary: document.getElementById("summarySection")
  };

  Object.values(sections).forEach(section => {
    if (section) section.style.display = "none";
  });

  sections[sectionName].style.display = "block";
}

document.getElementById("homeTabBtn").onclick = () => showSection("home");
document.getElementById("employeesTabBtn").onclick = () => showSection("employees");
document.getElementById("sitesTabBtn").onclick = () => showSection("sites");
document.getElementById("summaryTabBtn").onclick = async () => {
  showSection("summary");
  await loadSummary();
};

async function loadSummary() {
  const box = document.getElementById("summaryTable");

  const r = await api("/admin/summary", { method: "GET" });

  if (!r.ok) {
    box.innerHTML = `<p class="message error">${esc(r.data.error || "Failed to load summary")}</p>`;
    return;
  }

  const rows = r.data.rows || [];

  box.innerHTML = rows.length
    ? `
      <table class="data-table">
        <thead>
          <tr>
            <th>Employee Name</th>
            <th>Iqama Number</th>
            <th>Site</th>
            <th>Check In</th>
            <th>Check Out</th>
            <th>Method</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${esc(row.full_name)}</td>
              <td>${esc(row.iqama_number)}</td>
              <td>${esc(row.site_name || "Unknown")}</td>
              <td>${esc(fmt(row.check_in_at))}</td>
              <td>${esc(row.check_out_at ? fmt(row.check_out_at) : "Open")}</td>
              <td>${esc(row.method || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="small-note">No attendance records found.</div>`;
}

loadOverview();