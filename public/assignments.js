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

function datetimeLocalToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function setError(text) {
  msg.textContent = text || "";
}

document.getElementById("selectAllEmpBtn").onclick = () => {
  document.querySelectorAll(".assign-emp-checkbox").forEach(cb => {
    cb.checked = true;
  });
};

document.getElementById("clearAllEmpBtn").onclick = () => {
  document.querySelectorAll(".assign-emp-checkbox").forEach(cb => {
    cb.checked = false;
  });
};

async function loadAssignmentsPage() {
  const r = await api("/admin/overview", { method: "GET" });
  if (!r.ok) {
    setError(r.data.error || "Not authorized. Login as admin.");
    return;
  }

  setError("");

  const employees = r.data.employees || [];
  const sites = r.data.sites || [];
  const assignments = r.data.assignments || [];

  const empList = document.getElementById("assignEmpList");
  const siteSel = document.getElementById("assignSite");
  const assignmentsDiv = document.getElementById("assignmentsList");

  empList.innerHTML = employees
    .filter(e => !e.is_admin)
    .map(e => `
      <label class="checkbox-item">
        <input type="checkbox" class="assign-emp-checkbox" value="${e.id}" />
        <span>${esc(e.full_name)} (${esc(e.iqama_number || "")})${e.employee_category ? ` - ${esc(e.employee_category)}` : ""}</span>
      </label>
    `)
    .join("");

  siteSel.innerHTML = sites
    .map(s => `<option value="${s.id}">${esc(s.name)}</option>`)
    .join("");

  const empMap = new Map(employees.map(e => [e.id, e]));
  const siteMap = new Map(sites.map(s => [s.id, s]));

  assignmentsDiv.innerHTML = assignments
    .slice()
    .reverse()
    .map(a => {
      const e = empMap.get(a.employee_id);
      const s = siteMap.get(a.site_id);

      return `
        <div class="list-card">
          <div class="list-card-title">${esc(e?.full_name || "Unknown Employee")} → ${esc(s?.name || "Unknown Site")}</div>
          <div class="small-note">Start: ${esc(fmt(a.start_at))}</div>
          <div class="small-note">End: ${esc(a.end_at ? fmt(a.end_at) : "(no end)")}</div>
          <div class="small-note">Status: ${esc(a.status)}</div>
          ${a.status === "active" ? `
            <div class="inline-actions">
              <button onclick="cancelAssignment(${a.id})" class="btn-danger">Cancel Assignment</button>
            </div>
          ` : ""}
        </div>
      `;
    })
    .join("");
}

window.cancelAssignment = async (id) => {
  const r = await api(`/admin/assignments/${id}/cancel`, { method: "POST" });
  if (!r.ok) {
    alert(r.data.error || "Failed");
    return;
  }
  await loadAssignmentsPage();
};

document.getElementById("createAssignBtn").onclick = async () => {
  const employee_ids = Array.from(document.querySelectorAll(".assign-emp-checkbox:checked"))
    .map(cb => Number(cb.value));

  const site_id = Number(document.getElementById("assignSite").value);
  const start_at = datetimeLocalToIso(document.getElementById("assignStart").value);
  const end_at = datetimeLocalToIso(document.getElementById("assignEnd").value);

  if (!employee_ids.length) {
    alert("Select at least one employee.");
    return;
  }

  if (!start_at) {
    alert("Start time is required.");
    return;
  }

  if (end_at && Date.parse(end_at) <= Date.parse(start_at)) {
    alert("End time must be after Start time.");
    return;
  }

  const r = await api("/admin/assignments", {
    method: "POST",
    body: JSON.stringify({
      employee_ids,
      site_id,
      start_at,
      end_at: end_at || null
    })
  });

  if (!r.ok) {
    alert(r.data.error || "Failed");
    return;
  }

  alert(`Assignments created: ${r.data.created_count}`);

  document.querySelectorAll(".assign-emp-checkbox").forEach(cb => {
    cb.checked = false;
  });
  document.getElementById("assignStart").value = "";
  document.getElementById("assignEnd").value = "";

  await loadAssignmentsPage();
};

loadAssignmentsPage();