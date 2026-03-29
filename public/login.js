const roleSelect = document.getElementById("roleSelect");
const loginForm = document.getElementById("loginForm");

const adminBtn = document.getElementById("adminBtn");
const userBtn = document.getElementById("userBtn");
const backBtn = document.getElementById("backBtn");

const emailGroup = document.getElementById("emailGroup");
const iqamaGroup = document.getElementById("iqamaGroup");
const formTitle = document.getElementById("formTitle");

const msg = document.getElementById("msg");

let loginMode = null; // "admin" or "user"

// Switch to Admin login
adminBtn.onclick = () => {
  loginMode = "admin";
  roleSelect.style.display = "none";
  loginForm.style.display = "block";
  emailGroup.style.display = "block";
  iqamaGroup.style.display = "none";
  formTitle.textContent = "Admin Login";
};

// Switch to Employee login
userBtn.onclick = () => {
  loginMode = "user";
  roleSelect.style.display = "none";
  loginForm.style.display = "block";
  emailGroup.style.display = "none";
  iqamaGroup.style.display = "block";
  formTitle.textContent = "Employee Login";
};

// Back button
backBtn.onclick = () => {
  loginMode = null;
  loginForm.style.display = "none";
  roleSelect.style.display = "block";
  msg.textContent = "";
};

// Login action
document.getElementById("loginBtn").onclick = async () => {
  msg.textContent = "";

  const password = document.getElementById("password").value;

  let body = null;

  if (loginMode === "admin") {
    const email = document.getElementById("email").value.trim();
    if (!email) return msg.textContent = "Enter admin email";
    body = { email, password };
  }

  else if (loginMode === "user") {
    const iqama_number = document.getElementById("iqama_number").value.trim();
    if (!iqama_number) return msg.textContent = "Enter iqama number";
    body = { iqama_number, password };
  }

  if (!password) return msg.textContent = "Enter password";

  try {
    const r = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await r.json();

    if (!r.ok) {
      msg.textContent = data.error || "Login failed";
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    if (data.user.is_admin) window.location.href = "/admin";
    else window.location.href = "/app";

  } catch (e) {
    msg.textContent = "Network error";
  }
};