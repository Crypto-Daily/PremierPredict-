const API_URL = "https://premierpredict.onrender.com/api";

// Save token in localStorage
function saveToken(token) {
  localStorage.setItem("token", token);
}

// Get token
function getToken() {
  return localStorage.getItem("token");
}

// Handle Registration
async function registerUser(event) {
  event.preventDefault();
  const username = document.getElementById("username").value;
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const res = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });

  const data = await res.json();
  if (data.user) {
    alert("✅ Registration successful! Please login.");
    window.location.href = "index.html";
  } else {
    alert("❌ Registration failed!");
  }
}

// Handle Login
async function loginUser(event) {
  event.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (data.token) {
    saveToken(data.token);
    alert("✅ Login successful!");
    window.location.href = "dashboard.html";
  } else {
    alert("❌ Login failed!");
  }
}

// Fetch Protected Dashboard
async function loadDashboard() {
  const token = getToken();
  if (!token) {
    alert("⚠ Please login first.");
    window.location.href = "index.html";
    return;
  }

  const res = await fetch(`${API_URL}/protected`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  document.getElementById("dashboard").innerText =
    data.message || "Welcome to your dashboard!";
      }
