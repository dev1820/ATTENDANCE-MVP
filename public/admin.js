const token = localStorage.getItem("token");
if (!token) window.location.href = "/";

const msg = document.getElementById("msg");

document.getElementById("logoutBtn").onclick = () => {
  localStorage.removeItem("token");
  window.location.href = "/";
};

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

  if (sections[sectionName]) {
    sections[sectionName].style.display = "block";
  }

  document.querySelectorAll(".sidebar-link").forEach(btn => {
    btn.classList.remove("active");
  });

  if (sectionName === "home") document.getElementById("homeTabBtn")?.classList.add("active");
  if (sectionName === "employees") document.getElementById("employeesTabBtn")?.classList.add("active");
  if (sectionName === "sites") document.getElementById("sitesTabBtn")?.classList.add("active");
  if (sectionName === "summary") document.getElementById("summaryTabBtn")?.classList.add("active");
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
      const image_base64 = reader.result.split(",")[1];

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

window.enrollFaceFromUpload = enrollFaceFromUpload;

window.showSelectedFileName = function (employeeId) {
  const input = document.getElementById(`faceFile-${employeeId}`);
  const label = document.getElementById(`fileName-${employeeId}`);

  if (!input || !label) return;

  label.textContent = input.files.length
    ? input.files[0].name
    : "No image selected";
};

async function loadOverview() {
  const r = await api("/admin/overview", { method: "GET" });

  if (!r.ok) {
    showError(r.data.error || "Not authorized. Login as admin.");
    return;
  }

  showError("");

  const employees = r.data.employees || [];
  cachedEmployees = employees;
  renderSummaryEmployees();
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
                      <label for="faceFile-${e.id}" class="btn-secondary file-upload-btn">
                        Choose Image
                      </label>

                      <input 
                        type="file" 
                        id="faceFile-${e.id}" 
                        accept="image/*"
                        class="hidden-file-input"
                        onchange="showSelectedFileName(${e.id})"
                      />

                      <span id="fileName-${e.id}" class="file-name-text"></span>
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

  const sitesDiv = document.getElementById("sitesList");

  if (sitesDiv) {
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
  }

  const attDiv = document.getElementById("attendanceList");

  if (attDiv) {
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

document.getElementById("createSiteBtn")?.addEventListener("click", async () => {
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
});

document.getElementById("createEmpBtn")?.addEventListener("click", async () => {
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
});

let currentSummaryPeriod = "daily";
let selectedSummaryEmployeeId = null;
let cachedEmployees = [];

function renderSummaryEmployees() {
  const box = document.getElementById("summaryEmployeeList");
  if (!box) return;

  const employeesOnly = cachedEmployees.filter(e => !e.is_admin);

  box.innerHTML = employeesOnly.length
    ? employeesOnly.map(e => `
      <label class="summary-employee-item">
        <input
          type="checkbox"
          ${Number(selectedSummaryEmployeeId) === Number(e.id) ? "checked" : ""}
          onchange="selectSummaryEmployee(${e.id})"
        />
        <span>
          ${esc(e.full_name)}
          <div class="summary-employee-meta">${esc(e.iqama_number || "-")}</div>
        </span>
      </label>
    `).join("")
    : `<div class="small-note">No employees found.</div>`;
}

window.selectSummaryEmployee = function (employeeId) {
  selectedSummaryEmployeeId = Number(employeeId);
  renderSummaryEmployees();
  loadSummary();
};

function clearSummaryEmployeeFilter() {
  selectedSummaryEmployeeId = null;
  renderSummaryEmployees();
  loadSummary();
}

function setSummaryTab(period) {
  currentSummaryPeriod = period;

  document.querySelectorAll(".summary-tab").forEach(btn => {
    btn.classList.remove("active");
  });

  if (period === "daily") document.getElementById("dailySummaryBtn")?.classList.add("active");
  if (period === "weekly") document.getElementById("weeklySummaryBtn")?.classList.add("active");
  if (period === "monthly") document.getElementById("monthlySummaryBtn")?.classList.add("active");

  loadSummary();
}

async function loadSummary() {
  const box = document.getElementById("summaryTable");
  if (!box) return;

  const query = new URLSearchParams({
    period: currentSummaryPeriod
  });

  if (selectedSummaryEmployeeId) {
    query.set("employee_id", selectedSummaryEmployeeId);
  }

  const r = await api(`/admin/summary?${query.toString()}`, { method: "GET" });

  if (!r.ok) {
    box.innerHTML = `<p class="message error">${esc(r.data.error || "Failed to load summary")}</p>`;
    return;
  }

  const rows = r.data.rows || [];
  const selectedEmployee = cachedEmployees.find(
    e => Number(e.id) === Number(selectedSummaryEmployeeId)
  );

  box.innerHTML = `
    <div class="table-wrap">
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
          ${
            rows.length
              ? rows.map(row => `
                <tr>
                  <td>${esc(row.full_name)}</td>
                  <td>${esc(row.iqama_number)}</td>
                  <td>${esc(row.site_name || "Unknown")}</td>
                  <td>${esc(fmt(row.check_in_at))}</td>
                  <td>${esc(row.check_out_at ? fmt(row.check_out_at) : "Open")}</td>
                  <td>${esc(row.method || "")}</td>
                </tr>
              `).join("")
              : `
                <tr>
                  <td>${esc(selectedEmployee?.full_name || "N/A")}</td>
                  <td>${esc(selectedEmployee?.iqama_number || "N/A")}</td>
                  <td>N/A</td>
                  <td>N/A</td>
                  <td>N/A</td>
                  <td>N/A</td>
                </tr>
              `
          }
        </tbody>
      </table>
    </div>
  `;
}

document.getElementById("homeTabBtn")?.addEventListener("click", () => showSection("home"));
document.getElementById("employeesTabBtn")?.addEventListener("click", () => showSection("employees"));
document.getElementById("sitesTabBtn")?.addEventListener("click", () => showSection("sites"));

document.getElementById("summaryTabBtn")?.addEventListener("click", async () => {
  showSection("summary");
  await loadSummary();
});

document.getElementById("goEmployeesBtn")?.addEventListener("click", () => showSection("employees"));
document.getElementById("goSitesBtn")?.addEventListener("click", () => showSection("sites"));

document.getElementById("dailySummaryBtn")?.addEventListener("click", () => setSummaryTab("daily"));
document.getElementById("weeklySummaryBtn")?.addEventListener("click", () => setSummaryTab("weekly"));
document.getElementById("monthlySummaryBtn")?.addEventListener("click", () => setSummaryTab("monthly"));
document.getElementById("clearSummaryEmployeeBtn")?.addEventListener("click", clearSummaryEmployeeFilter);
document.getElementById("summarySearchInput")?.addEventListener("input", () => {
  loadSummary();
});

loadOverview();
const initialHash = window.location.hash.replace("#", "");
if (window.location.hash === "#summary") {
  showSection("summary");
  loadSummary();
}
if (initialHash === "summary") {
  showSection("summary");
  loadSummary();
} else if (initialHash === "employees") {
  showSection("employees");
} else if (initialHash === "sites") {
  showSection("sites");
} else {
  showSection("home");
}