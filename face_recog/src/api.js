const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

async function request(path, { method = "GET", token, body } = {}) {
  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null
        ? payload.message || payload.error || `Request failed with status ${response.status}`
        : `Request failed with status ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function loginWithFace(descriptor) {
  return request("/api/face-auth/login", {
    method: "POST",
    body: { descriptor },
  });
}

// ✅ FIX: If attendance route returns 404 (employee has no record yet, or route misconfigured),
// return empty array instead of throwing — so the login flow continues to punch-in normally.
export async function getAttendance(employeeId, token) {
  try {
    const result = await request(`/api/attendance/${encodeURIComponent(employeeId)}`, {
      token,
    });
    return Array.isArray(result) ? result : result.data || [];
  } catch (err) {
    if (err.status === 404) {
      console.warn(`[getAttendance] No attendance record found for ${employeeId} — treating as fresh day.`);
      return [];
    }
    throw err; // re-throw real errors (401, 500, network failures, etc.)
  }
}

export function punchIn(user, coords, token) {
  return request("/api/attendance/punch-in", {
    method: "POST",
    token,
    body: {
      employeeId: user.employeeId,
      employeeName: user.name,
      latitude: coords.latitude,
      longitude: coords.longitude,
      loginMethod: "face",
    },
  });
}

export function punchOut(user, coords, token) {
  return request("/api/attendance/punch-out", {
    method: "POST",
    token,
    body: {
      employeeId: user.employeeId,
      latitude: coords.latitude,
      longitude: coords.longitude,
    },
  });
}

export function startBreak(user, coords, token) {
  return request("/api/attendance/punch-break", {
    method: "POST",
    token,
    body: {
      employeeId: user.employeeId,
      latitude: coords.latitude,
      longitude: coords.longitude,
    },
  });
}