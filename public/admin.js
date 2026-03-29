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
      "Authorization": `Bearer ${token}`
    }
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function showError(e) {
  msg.textContent = e || "";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({
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

function enrollFace(id) {
  window.location.href = `/enroll-face.html?id=${id}`;
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

  // Employees list
  const employeesDiv = document.getElementById("employeesList");
  if (employeesDiv) {
    employeesDiv.innerHTML = employees.length
      ? employees.map(e => {
          const employeeLabel = e.is_admin
            ? `${e.full_name}${e.email ? ` (${e.email})` : ""}`
            : `${e.full_name}${e.iqama_number ? ` (${e.iqama_number})` : ""}${e.employee_category ? ` - ${e.employee_category}` : ""}`;

          return `
            <div class="list-card">
              <div class="list-card-title">${esc(employeeLabel)}</div>
              <div class="small-note">
                ${e.is_admin ? "Admin" : "Employee"}
                ${!e.is_admin && e.face_enrolled ? " • Face enrolled" : !e.is_admin ? " • Face not enrolled" : ""}
              </div>
              ${!e.is_admin ? `
                <div class="inline-actions">
                  <button onclick="enrollFace(${e.id})" class="btn-secondary">Enroll Face</button>
                </div>
              ` : ""}
            </div>
          `;
        }).join("")
      : `<div class="small-note">No employees created yet.</div>`;
  }

  // Sites list
  const sitesDiv = document.getElementById("sitesList");
  sitesDiv.innerHTML = sites.length
    ? sites.map(s => `
      <div class="list-card">
        <div class="list-card-title">${esc(s.name)}</div>
        <div class="list-card-meta">
          Lat/Lng: ${esc(String(s.latitude))}, ${esc(String(s.longitude))} • Radius: ${esc(String(s.radius_m))}m
        </div>
        <div class="small-note">PIN updated: ${esc(s.pin_updated_at || "")}</div>
        <div class="inline-actions">
          <input id="pin_${s.id}" placeholder="New PIN" style="max-width: 220px;" />
          <button onclick="resetPin(${s.id})" class="btn-secondary">Reset PIN</button>
        </div>
      </div>
    `).join("")
    : `<div class="small-note">No sites created yet.</div>`;

  // Attendance list
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

// Expose functions for inline buttons
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

window.enrollFace = enrollFace;

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

function datetimeLocalToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

loadOverview();