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
    projects: document.getElementById("projectsSection"),
    summary: document.getElementById("summarySection")
  };
  if (sectionName === "projects") document.getElementById("projectsTabBtn")?.classList.add("active");
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
  renderProjectFormOptions(employees, sites);
  await loadProjects();
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
                      <div class="inline-actions" style="margin-top:0;">
                        
                        <button onclick="editEmployee(${e.id})" class="btn-secondary">
                          Edit
                        </button>

                        <button onclick="enrollFaceFromUpload(${e.id})" class="btn-secondary">
                          Upload Face
                        </button>

                      </div>
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

window.editEmployee = function (employeeId) {
  const employee = cachedEmployees.find(e => Number(e.id) === Number(employeeId));
  if (!employee) return alert("Employee not found");

  editingEmployeeId = employee.id;

  document.getElementById("empName").value = employee.full_name || "";
  document.getElementById("empIqama").value = employee.iqama_number || "";
  document.getElementById("empPass").value = "";
  document.getElementById("empPass").placeholder = "Leave blank to keep current password";
  document.getElementById("empCategory").value = employee.employee_category || "";

  document.getElementById("createEmpBtn").textContent = "Update Employee";
  document.getElementById("cancelEmpEditBtn").style.display = "inline-flex";

  showSection("employees");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

function resetEmployeeForm() {
  editingEmployeeId = null;

  document.getElementById("empName").value = "";
  document.getElementById("empIqama").value = "";
  document.getElementById("empPass").value = "";
  document.getElementById("empPass").placeholder = "Password";
  document.getElementById("empCategory").value = "";

  document.getElementById("createEmpBtn").textContent = "Create Employee";
  document.getElementById("cancelEmpEditBtn").style.display = "none";
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
  const iqama_number = document.getElementById("empIqama").value.trim().toUpperCase();
  const password = document.getElementById("empPass").value.trim();
  const employee_category = document.getElementById("empCategory").value;

  if (!full_name || !iqama_number || !employee_category) {
    alert("Please fill employee name, iqama/passport, and category.");
    return;
  }

  if (!editingEmployeeId && !password) {
    alert("Please enter a password for the new employee.");
    return;
  }

  const payload = {
    full_name,
    iqama_number,
    employee_category
  };

  if (password) {
    payload.password = password;
  }

  const url = editingEmployeeId
    ? `/admin/employees/${editingEmployeeId}`
    : "/admin/employees";

  const method = editingEmployeeId ? "PUT" : "POST";

  const r = await api(url, {
    method,
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    alert(r.data.error || "Failed to save employee");
    return;
  }

  alert(editingEmployeeId ? "Employee updated" : "Employee created");

  resetEmployeeForm();
  await loadOverview();
});

let currentSummaryPeriod = "daily";
let selectedSummaryEmployeeId = null;
let cachedEmployees = [];
let editingProjectId = null;
let cachedProjects = [];
let editingEmployeeId = null;

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

function renderProjectFormOptions(employees, sites) {
  const projectSite = document.getElementById("projectSite");
  const projectEmployeesList = document.getElementById("projectEmployeesList");

  if (projectSite) {
    projectSite.innerHTML = sites.length
      ? sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")
      : `<option value="">No sites found</option>`;
  }

  if (projectEmployeesList) {
    const employeesOnly = employees.filter(e => !e.is_admin);

    projectEmployeesList.innerHTML = employeesOnly.length
      ? `
        <div class="project-employee-grid">
          ${employeesOnly.map(e => `
            <label class="project-employee-item">
              <input type="checkbox" class="projectEmployeeCheckbox" value="${e.id}" />
              <span>
                <strong>${esc(e.full_name)}</strong>
                <small>${esc(e.iqama_number || "-")} • ${esc(e.employee_category || "-")}</small>
              </span>
            </label>
          `).join("")}
        </div>
      `
      : `<div class="small-note">No employees found.</div>`;
  }
}

async function loadProjects() {
  const box = document.getElementById("projectsList");
  if (!box) return;

  const r = await api("/admin/projects", { method: "GET" });

  if (!r.ok) {
    box.innerHTML = `<p class="message error">${esc(r.data.error || "Failed to load projects")}</p>`;
    return;
  }

  const projects = r.data.projects || [];
  cachedProjects = projects;

  box.innerHTML = projects.length
    ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Project / Site</th>
              <th>Start Date</th>
              <th>End Date</th>
              <th>Shift</th>
              <th>Employees</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${projects.map(p => `
              <tr>
                <td>${esc(p.project_name)}</td>
                <td>${esc(fmtDateOnly(p.start_date))}</td>
                <td>${esc(fmtDateOnly(p.end_date))}</td>
                <td>${esc(formatTime(p.shift_start))} - ${esc(formatTime(p.shift_end))}</td>
                <td>
                  ${
                    p.employees.length
                      ? p.employees.map(e => esc(e.full_name)).join(", ")
                      : "No employees"
                  }
                </td>
                <td>${esc(p.status)}</td>
                <td>
                  <div class="inline-actions" style="margin-top:0;">
                    <button onclick="editProject(${p.id})" class="btn-secondary">
                      Edit
                    </button>

                    ${
                      p.status === "active"
                        ? `<button onclick="cancelProject(${p.id})" class="btn-danger-small">Cancel</button>`
                        : "-"
                    }
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="small-note">No projects created yet.</div>`;
}

function fmtDateOnly(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

function formatTime(value) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

window.cancelProject = async function (projectId) {
  if (!confirm("Cancel this project?")) return;

  const r = await api(`/admin/projects/${projectId}/cancel`, {
    method: "POST",
    body: JSON.stringify({})
  });

  if (!r.ok) {
    alert(r.data.error || "Failed to cancel project");
    return;
  }

  alert("Project cancelled");
  await loadProjects();
};

function toInputDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

window.editProject = function (projectId) {
  const project = cachedProjects.find(p => Number(p.id) === Number(projectId));
  if (!project) return alert("Project not found");

  editingProjectId = project.id;

  document.getElementById("projectSite").value = project.site_id;
  document.getElementById("projectStartDate").value = toInputDate(project.start_date);
  document.getElementById("projectEndDate").value = toInputDate(project.end_date);
  document.getElementById("projectShiftStart").value = String(project.shift_start).slice(0, 5);
  document.getElementById("projectShiftEnd").value = String(project.shift_end).slice(0, 5);
  document.getElementById("projectManagerEmail").value = project.manager_email || "";
  const statusInput = document.getElementById("projectStatus");
  if (statusInput) statusInput.value = project.status || "active";

  const assignedIds = new Set((project.employees || []).map(e => Number(e.id)));

  document.querySelectorAll(".projectEmployeeCheckbox").forEach(cb => {
    cb.checked = assignedIds.has(Number(cb.value));
  });

  document.getElementById("createProjectBtn").textContent = "Update Project";
  document.getElementById("cancelProjectEditBtn").style.display = "inline-flex";

  window.scrollTo({ top: 0, behavior: "smooth" });
};

function resetProjectForm() {
  editingProjectId = null;

  document.getElementById("projectStartDate").value = "";
  document.getElementById("projectEndDate").value = "";
  document.getElementById("projectShiftStart").value = "";
  document.getElementById("projectShiftEnd").value = "";
  document.getElementById("projectManagerEmail").value = "";
  const statusInput = document.getElementById("projectStatus");
  if (statusInput) statusInput.value = "active";

  document.querySelectorAll(".projectEmployeeCheckbox").forEach(cb => {
    cb.checked = false;
  });

  document.getElementById("createProjectBtn").textContent = "Create Project";
  document.getElementById("cancelProjectEditBtn").style.display = "none";
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
                <tr class="${row.record_type === "failed_offsite" ? "summary-alert-row" : ""}">
                  <td>${esc(row.full_name)}</td>

                  <td>${esc(row.iqama_number)}</td>

                  <td>
                    ${
                      row.record_type === "failed_offsite"
                        ? `<span class="not-on-site-badge">Not on site</span>`
                        : esc(row.site_name || "Unknown")
                    }
                  </td>

                  <td>${esc(fmt(row.check_in_at))}</td>

                  <td>
                    ${
                      row.record_type === "failed_offsite"
                        ? "N/A"
                        : esc(row.check_out_at ? fmt(row.check_out_at) : "Open")
                    }
                  </td>

                  <td>
                    ${
                      row.record_type === "failed_offsite"
                        ? `Attempted outside range${row.distance_m ? ` • ${row.distance_m}m away` : ""}`
                        : esc(row.method || "")
                    }
                  </td>
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
document.getElementById("createProjectBtn")?.addEventListener("click", async () => {
  const site_id = document.getElementById("projectSite").value;
  const start_date = document.getElementById("projectStartDate").value;
  const end_date = document.getElementById("projectEndDate").value;
  const shift_start = document.getElementById("projectShiftStart").value;
  const shift_end = document.getElementById("projectShiftEnd").value;
  const status = document.getElementById("projectStatus")?.value || "active";
  const manager_email = document.getElementById("projectManagerEmail").value.trim();

  const employee_ids = [...document.querySelectorAll(".projectEmployeeCheckbox:checked")]
    .map(cb => Number(cb.value));

  if (!site_id || !start_date || !end_date || !shift_start || !shift_end || !manager_email) {
    alert("Please fill all project fields.");
    return;
  }

  if (!employee_ids.length) {
    alert("Please select at least one employee.");
    return;
  }

  const payload = {
    site_id: Number(site_id),
    start_date,
    end_date,
    shift_start,
    shift_end,
    manager_email,
    status,
    employee_ids
  };

  const url = editingProjectId
    ? `/admin/projects/${editingProjectId}`
    : "/admin/projects";

  const method = editingProjectId ? "PUT" : "POST";

  const r = await api(url, {
    method,
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    alert(r.data.message || r.data.error || "Failed to save project");
    return;
  }

  alert(editingProjectId ? "Project updated" : "Project created");

  resetProjectForm();
  await loadProjects();
});
document.getElementById("cancelProjectEditBtn")?.addEventListener("click", resetProjectForm);
document.getElementById("projectsTabBtn")?.addEventListener("click", async () => {
  showSection("projects");
  await loadProjects();
});
document.getElementById("dailySummaryBtn")?.addEventListener("click", () => setSummaryTab("daily"));
document.getElementById("weeklySummaryBtn")?.addEventListener("click", () => setSummaryTab("weekly"));
document.getElementById("monthlySummaryBtn")?.addEventListener("click", () => setSummaryTab("monthly"));
document.getElementById("clearSummaryEmployeeBtn")?.addEventListener("click", clearSummaryEmployeeFilter);
document.getElementById("cancelEmpEditBtn")?.addEventListener("click", resetEmployeeForm);
document.getElementById("summarySearchInput")?.addEventListener("input", () => {
  loadSummary();
});

loadOverview();
const initialHash = window.location.hash.replace("#", "");
if (initialHash === "summary") {
  showSection("summary");
  loadSummary();
} else if (initialHash === "employees") {
  showSection("employees");
} else if (initialHash === "sites") {
  showSection("sites");
} else if (initialHash === "projects") {
  showSection("projects");
  loadProjects();
} else {
  showSection("home");
}