const token = localStorage.getItem("token");
if (!token) window.location.href = "/";

document.getElementById("logoutBtn").onclick = () => {
  localStorage.removeItem("token");
  window.location.href = "/";
};

document.getElementById("verifyFaceBtn").onclick = () => {
  window.location.href = "/face-verify/";
};

const user = JSON.parse(localStorage.getItem("user") || "{}");
const welcomeBox = document.getElementById("welcomeBox");

if (user.full_name) {
  welcomeBox.innerHTML = `
    <h3 style="margin:0">Welcome, ${user.full_name} 👋</h3>
    <p style="margin:6px 0 0; color:#555">
      You are successfully signed in. Please check your assignments below.
    </p>
  `;
}

let selected = { site_id: null, action: null, site_name: null };
let currentOpen = null; // { site_id, site_name, check_in_at }
let ticker = null;

function toast(msg, ok=true) {
  const t = document.getElementById("toast");
  t.style.color = ok ? "green" : "red";
  t.textContent = msg;
  setTimeout(() => (t.textContent = ""), 4000);
}

async function api(path, opts={}) {
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

function fmt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy
      }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function msToHuman(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hrs <= 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

function startTicker() {
  if (ticker) clearInterval(ticker);

  ticker = setInterval(() => {
    if (!currentOpen?.check_in_at) return;

    const start = Date.parse(currentOpen.check_in_at);
    if (Number.isNaN(start)) return;

    const delta = Date.now() - start;
    const label = document.querySelector(`[data-checkin-label="site-${currentOpen.site_id}"]`);
    if (label) label.textContent = `Checked In • ${msToHuman(delta)} ago`;
  }, 30000);
}

function openPin(site_id, site_name, action) {
  selected = { site_id: Number(site_id), action, site_name };
  document.getElementById("pinTitle").textContent =
    `${action === "check-in" ? "Check-in" : "Check-out"} — ${site_name}`;
  document.getElementById("pinInput").value = "";
  document.getElementById("pinMsg").textContent = "";
  document.getElementById("pinBox").style.display = "block";
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

document.getElementById("confirmBtn").onclick = async () => {
  const pin = document.getElementById("pinInput").value.trim();
  const msg = document.getElementById("pinMsg");
  msg.textContent = "";

  if (!pin) {
    msg.textContent = "Enter PIN";
    return;
  }

  let loc;
  try {
    toast("Getting location...");
    loc = await getLocation();
  } catch {
    msg.textContent = "Location required. Enable GPS and try again.";
    return;
  }

  const endpoint = selected.action === "check-in"
    ? "/attendance/check-in"
    : "/attendance/check-out";

  const r = await api(endpoint, {
    method: "POST",
    body: JSON.stringify({
      site_id: selected.site_id,
      pin,
      lat: loc.lat,
      lng: loc.lng,
      accuracy_m: loc.accuracy_m
    })
  });

  if (!r.ok) {
    msg.textContent = r.data.error || "Failed";
    toast(r.data.error || "Failed", false);
    return;
  }

  document.getElementById("pinBox").style.display = "none";
  if (selected.action === "check-in") {
    toast(`${selected.action} OK (${r.data.distance_m}m)`);
  } else {
    toast(`${selected.action} OK`);
  }  await refresh();
};

async function refresh() {
  // status
  const faceRes = await api("/me/face-status", { method: "GET" });
  const faceMsg = document.getElementById("faceMsg");

  if (faceRes.ok) {
    if (!faceRes.data.face_enrolled) {
      faceMsg.textContent = "Face not enrolled yet. Please contact admin.";
      faceMsg.className = "message error";
    } else if (faceRes.data.face_verified) {
      faceMsg.textContent = "Face verified successfully. You can now check in.";
      faceMsg.className = "message success";
    } else {
      faceMsg.textContent = "Face verification is required before check-in.";
      faceMsg.className = "message";
    }
  }
  const st = await api("/me/status", { method: "GET" });
  if (!st.ok) {
    toast("Session expired. Login again.", false);
    localStorage.removeItem("token");
    window.location.href = "/";
    return;
  }

  currentOpen = st.data.checked_in ? st.data.open : null;

  const statusBox = document.getElementById("statusBox");
  if (currentOpen) {
    const start = Date.parse(currentOpen.check_in_at);
    const delta = Number.isNaN(start) ? 0 : (Date.now() - start);
    statusBox.innerHTML = `
      <b>Checked in:</b> Yes<br/>
      <b>Site:</b> ${currentOpen.site_name}<br/>
      <b>Since:</b> ${fmt(currentOpen.check_in_at)}<br/>
      <b>Elapsed:</b> ${msToHuman(delta)}
    `;
    startTicker();
  } else {
    statusBox.innerHTML = `<b>Checked in:</b> No`;
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  // assigned sites
  const asg = await api("/me/assigned-sites", { method: "GET" });
  const sum = await api("/me/attendance-summary", { method: "GET" });
  const latestBySite = (sum.ok && sum.data.latestBySite) ? sum.data.latestBySite : {};
  const sitesDiv = document.getElementById("sites");
  sitesDiv.innerHTML = "";

  if (!asg.ok) {
    sitesDiv.textContent = asg.data.error || "Failed to load sites";
    return;
  }

  // Use assigned sites list, but ALWAYS include checked-in site if missing
  // Use assigned sites list, but ALWAYS include checked-in site if missing
  const sites = (asg.data.sites || []).map(s => ({ ...s }));

  if (currentOpen && !sites.some(x => Number(x.site_id) === Number(currentOpen.site_id))) {
    sites.unshift({
      site_id: currentOpen.site_id,
      name: currentOpen.site_name,
      radius_m: "(current)",
      start_at: currentOpen.check_in_at,
      end_at: null,
      can_check_in_now: false
    });
  }

  // Deduplicate by site_id (keep the latest assignment entry for each site)
  const bySite = new Map();

  for (const s of sites) {
    const key = Number(s.site_id);
    const existing = bySite.get(key);

    const sStart = s.start_at ? Date.parse(s.start_at) : -Infinity;
    const eStart = existing?.start_at ? Date.parse(existing.start_at) : -Infinity;

    if (!existing || sStart > eStart) {
      bySite.set(key, s);
    }
  }

  const uniqueSites = Array.from(bySite.values());

  if (!uniqueSites.length) {
    sitesDiv.textContent = "No assigned sites right now.";
    return;
  }

  uniqueSites.forEach(s => {
    const wrap = document.createElement("div");
    wrap.className = "list-card";

    const isCheckedIn = !!currentOpen;
    const isThisSiteOpen = isCheckedIn && Number(currentOpen.site_id) === Number(s.site_id);

    // RULES YOU ASKED:
    // - disable ALL check-in buttons once checked in
    const checkInDisabled = isCheckedIn || (s.can_check_in_now === false);

    // - hide check-out everywhere; show ONLY on the checked-in site
    const showCheckout = isThisSiteOpen;

    // label
    let labelText = "Not checked in";

    const last = latestBySite[String(Number(s.site_id))];
    const startMs = s.start_at ? Date.parse(s.start_at) : NaN;
    const isFutureAssignment = !Number.isNaN(startMs) && startMs > Date.now();

    // PRIORITY 1: if this exact site is currently open
    if (isThisSiteOpen) {
      const start = Date.parse(currentOpen.check_in_at);
      const delta = Number.isNaN(start) ? 0 : (Date.now() - start);
      labelText = `Checked In • ${msToHuman(delta)} ago`;
    }
    // PRIORITY 2: if this assignment is scheduled for future, always show it
    else if (isFutureAssignment) {
      labelText = `Scheduled • Starts at ${fmt(s.start_at)}`;
    }
    // PRIORITY 3: if checked into another site
    else if (isCheckedIn && !isThisSiteOpen) {
      labelText = `Checked in at: ${currentOpen.site_name}`;
    }
    // PRIORITY 4: otherwise show last checkout/checkin history
    else if (last?.last_check_out_at) {
      labelText = `Checked Out at: ${fmt(last.last_check_out_at)}`;
    } else if (last?.last_check_in_at) {
      labelText = `Last Check-in: ${fmt(last.last_check_in_at)}`;
    }

    wrap.innerHTML = `
      <div><b>${s.name}</b></div>
      <div style="font-size: 13px; color:#555;">Radius: ${s.radius_m}m</div>
      <div style="margin:6px 0; font-size: 13px;">
        <span data-checkin-label="site-${s.site_id}">${labelText}</span>
      </div>

      <button
        data-site="${s.site_id}"
        data-name="${s.name}"
        data-action="check-in"
        style="margin-top:8px;"
        ${checkInDisabled ? "disabled" : ""}>
        Check-in
      </button>

      ${showCheckout ? `
        <button
          data-site="${s.site_id}"
          data-name="${s.name}"
          data-action="check-out"
          style="margin-top:8px; margin-left:8px;">
          Check-out
        </button>
      ` : ""}
    `;

    // attach handlers only for visible/enabled buttons
    wrap.querySelectorAll("button").forEach(btn => {
      btn.onclick = () => {
        if (btn.disabled) return;
        openPin(btn.dataset.site, btn.dataset.name, btn.dataset.action);
      };
    });

    sitesDiv.appendChild(wrap);
  });
}

refresh();