import React, { useState, useEffect, useRef } from "react";
import * as faceapi from "face-api.js";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaSpinner,
  FaCheckCircle,
  FaExclamationTriangle,
  FaEye,
} from "react-icons/fa";
import { loginWithFace, getAttendance, punchIn, punchOut, startBreak } from "./api";
import { getCurrentLocation } from "./location";
import "./FaceApp.css";

const FACE_LOCK_HOLD_MS = 900;
const RESET_TIMEOUT_MS = 5000; // 5 seconds as requested

const getHeadYaw = (landmarks) => {
  const p = landmarks.positions;
  const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  const nose = p[30];
  const leftEdge = p[1];
  const rightEdge = p[15];
  const leftDist = dist(nose, leftEdge);
  const rightDist = dist(nose, rightEdge);
  if (rightDist === 0) return 1.0;
  return leftDist / rightDist;
};

const checkBrightness = (videoEl) => {
  const canvas = document.createElement("canvas");
  canvas.width = 50;
  canvas.height = 50;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, 50, 50);
  const data = ctx.getImageData(0, 0, 50, 50).data;
  let colorSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    colorSum += Math.floor((data[i] + data[i + 1] + data[i + 2]) / 3);
  }
  return Math.floor(colorSum / (50 * 50));
};

const FacePortal = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectionIntervalRef = useRef(null);

  const faceLockStartTimeRef = useRef(null);
  const isDetectingRef = useRef(false);
  const baselineFaceWidthRef = useRef(null);
  const faceWidthHistoryRef = useRef([]);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [status, setStatus] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("Loading AI Engine...");
  const [faceDetected, setFaceDetected] = useState(false);
  const [lockProgress, setLockProgress] = useState(0);

  const [session, setSession] = useState(null);
  const [todayRecord, setTodayRecord] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [countdown, setCountdown] = useState(null);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = "/models";
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        setModelsLoaded(true);
        setStatus("ready");
        setStatusMessage("System Ready. Starting camera...");
      } catch (error) {
        setStatus("error");
        setStatusMessage("Failed to load models. Please refresh.");
      }
    };
    loadModels();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (modelsLoaded && !session && countdown === null) startCamera();
  }, [modelsLoaded, session, countdown]);

  const startCamera = async () => {
    try {
      if (streamRef.current) return; // Stream already exists
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setCameraActive(true);
          setStatus("detecting");
          setStatusMessage("Looking for Face...");
          startFaceDetection();
        };
      }
    } catch (error) {
      setStatus("error");
      setStatusMessage("Camera access denied.");
    }
  };

  const stopCamera = () => {
    isDetectingRef.current = false;
    if (detectionIntervalRef.current) {
      clearTimeout(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startFaceDetection = () => {
    isDetectingRef.current = true;
    faceLockStartTimeRef.current = null;
    baselineFaceWidthRef.current = null;
    faceWidthHistoryRef.current = [];
    setLockProgress(0);

    const detectLoop = async () => {
      if (!isDetectingRef.current) return;
      if (!videoRef.current || videoRef.current.readyState < 2) {
        detectionIntervalRef.current = setTimeout(detectLoop, 50);
        return;
      }

      try {
        const brightness = checkBrightness(videoRef.current);
        if (brightness < 30) {
          setFaceDetected(false);
          setStatusMessage("⚠️ Room is too dark.");
          detectionIntervalRef.current = setTimeout(detectLoop, 500);
          return;
        }

        const detection = await faceapi
          .detectSingleFace(videoRef.current)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (canvasRef.current && videoRef.current) {
          const displaySize = {
            width: videoRef.current.clientWidth,
            height: videoRef.current.clientHeight,
          };
          faceapi.matchDimensions(canvasRef.current, displaySize);
          const ctx = canvasRef.current.getContext("2d");
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

          if (detection) {
            setFaceDetected(true);
            const resized = faceapi.resizeResults(detection, displaySize);
            const { x, y, width, height } = resized.detection.box;
            const descriptor = Array.from(detection.descriptor);

            const boxCenterX = x + width / 2;
            const frameCenterX = displaySize.width / 2;
            if (Math.abs(boxCenterX - frameCenterX) > displaySize.width * 0.2) {
              faceLockStartTimeRef.current = null;
              setLockProgress(0);
              setStatusMessage("🎯 Please center your face.");
              ctx.strokeStyle = "#ef4444";
              ctx.lineWidth = 4;
              ctx.strokeRect(x, y, width, height);
              detectionIntervalRef.current = setTimeout(detectLoop, 50);
              return;
            }

            const yawRatio = getHeadYaw(resized.landmarks);
            if (yawRatio < 0.75 || yawRatio > 1.25) {
              faceLockStartTimeRef.current = null;
              setLockProgress(0);
              setStatusMessage("👱 Please face straight.");
              ctx.strokeStyle = "#f59e0b";
              ctx.lineWidth = 3;
              ctx.strokeRect(x, y, width, height);
            } else {
              if (!faceLockStartTimeRef.current) faceLockStartTimeRef.current = Date.now();
              const holdElapsed = Date.now() - faceLockStartTimeRef.current;
              const progress = Math.min(100, Math.round((holdElapsed / FACE_LOCK_HOLD_MS) * 100));
              setLockProgress(progress);

              ctx.strokeStyle = progress >= 80 ? "#10b981" : "#6366f1";
              ctx.lineWidth = 4;
              ctx.strokeRect(x, y, width, height);

              if (holdElapsed >= FACE_LOCK_HOLD_MS) {
                isDetectingRef.current = false;
                setStatus("verified");
                setStatusMessage("✅ Verified! Processing...");
                await authenticateWithFace(descriptor);
                return;
              } else {
                setStatusMessage("✅ Keep still...");
              }
            }
          } else {
            setFaceDetected(false);
            faceLockStartTimeRef.current = null;
            setLockProgress(0);
            setStatus("detecting");
            setStatusMessage("Position your face to begin...");
          }
        }
      } catch (e) {
        console.error("Detection error:", e);
      }

      if (isDetectingRef.current) {
        detectionIntervalRef.current = setTimeout(detectLoop, 80);
      }
    };
    detectLoop();
  };

  const authenticateWithFace = async (descriptor) => {
    try {
      // ── Step 1: Face login (if this fails, it's a real auth error) ──
      const result = await loginWithFace(descriptor);
      const userObj = result.data || result;
      const userName = userObj.name || "Employee";
      const userId = userObj.employeeId || userObj._id;

      setSession({
        token: result.token,
        user: { ...userObj, employeeId: userId, name: userName },
      });

      setStatus("success");
      setStatusMessage(`✅ Face Matched: ${userName}`);

      // ── Step 2: Fetch today's attendance — ISOLATED try/catch ──
      // A 404 here just means no record yet (fresh day) → proceed to punch-in.
      // This must NOT crash the auth success flow above.
      let records = [];
      try {
        records = await getAttendance(userId, result.token);
      } catch (attendanceErr) {
        // Only non-404 errors reach here (api.js handles 404 → []).
        // Log it but still continue — we'll treat it as no record → punch-in.
        console.warn("[Attendance fetch error]", attendanceErr.message);
        records = [];
      }

      const dateStr = new Date().toLocaleDateString("en-CA");
      const today = records.find((r) => r.date === dateStr) || null;
      setTodayRecord(today);

      const isWorking = today?.status === "WORKING";
      const isOnBreak = today?.isOnBreak === true;
      const isFinalPunchOut = today?.isFinalPunchOut === true;

      // --- SMART DURATION CHECK ---
      let isShiftDurationCompleted = false;
      if (isWorking && today?.punchIn) {
        const punchInTime = new Date(today.punchIn);
        const now = new Date();
        const elapsedHours = (now - punchInTime) / (1000 * 60 * 60);
        const requiredHours = userObj.requiredWorkHours || userObj.fullDayHours || 7;
        if (elapsedHours >= requiredHours) {
          isShiftDurationCompleted = true;
        }
      }

      const userForAction = { ...userObj, employeeId: userId, name: userName };

      if (!today || (!isWorking && !isOnBreak && !isFinalPunchOut)) {
        await performAutoAction("punchIn", userForAction, result.token);
      } else if (isOnBreak) {
        await performAutoAction("resume", userForAction, result.token);
      } else if (isWorking && !isOnBreak) {
        if (isShiftDurationCompleted) {
          await performAutoAction("punchOut", userForAction, result.token);
        } else {
          await performAutoAction("breakStart", userForAction, result.token);
        }
      } else if (isFinalPunchOut) {
        setStatusMessage(`✅ ${userName} has completed their shift.`);
        triggerAutoReset();
      }

    } catch (error) {
      // Only face login failures reach here now
      setStatus("error");
      setStatusMessage(error.message || "Face not recognized.");
      triggerAutoReset();
    }
  };

  const performAutoAction = async (actionName, userObj, token) => {
    setActionLoading(actionName);
    try {
      const coords = await getCurrentLocation();
      let displayMsg = "";

      if (actionName === "punchIn") {
        await punchIn(userObj, coords, token);
        displayMsg = `✅ ${userObj.name} Punch In successful!`;
      } else if (actionName === "punchOut") {
        await punchOut(userObj, coords, token);
        displayMsg = `✅ ${userObj.name} Punch Out successful!`;
      } else if (actionName === "breakStart") {
        await startBreak(userObj, coords, token);
        displayMsg = `✅ ${userObj.name} Break Start successful!`;
      } else if (actionName === "resume") {
        await punchIn(userObj, coords, token);
        displayMsg = `✅ ${userObj.name} Work Resume successful!`;
      }

      setStatus("success");
      setStatusMessage(displayMsg);
      triggerAutoReset();
    } catch (error) {
      setStatus("error");
      setStatusMessage("Action failed: " + (error.message || "Unknown error"));
      triggerAutoReset();
    } finally {
      setActionLoading(null);
    }
  };

  const triggerAutoReset = () => {
    let timeLeft = 5;
    setCountdown(timeLeft);

    const interval = setInterval(() => {
      timeLeft -= 1;
      setCountdown(timeLeft);
      if (timeLeft <= 0) {
        clearInterval(interval);
        setCountdown(null);
        setSession(null);
        setTodayRecord(null);
        setStatus("detecting");
        setStatusMessage("Position your face to begin...");
        setLockProgress(0);
        setFaceDetected(false);
        startFaceDetection();
      }
    }, 1000);
  };

  return (
    <div className="portal-container kiosk-mode">
      <AnimatePresence mode="wait">
        {session ? (
          <motion.div key="profile" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="profile-section" >
            <div className="avatar"> {session.user.name.charAt(0).toUpperCase()} </div>
            <div className="user-details">
              <h2 style={{ fontSize: "2rem" }}>{session.user.name}</h2>
              <p style={{ fontSize: "1.2rem" }}>{session.user.role?.toUpperCase() || "EMPLOYEE"}</p>
            </div>
          </motion.div>
        ) : (
          <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="profile-section" >
            <div className="avatar" style={{ background: "#4b5563" }}>?</div>
            <div className="user-details">
              <h2 style={{ fontSize: "1.8rem" }}>Face Recognition Attendance</h2>
              <p style={{ fontSize: "1rem" }}>Secure Identity Verification</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div key={statusMessage} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={`status-alert ${status}`} style={{ padding: "20px", fontSize: "1.4rem" }} >
        {statusMessage}
      </motion.div>

      <div className="camera-container" style={{ height: "450px" }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ transform: "scaleX(-1)", height: "100%", width: "100%", objectFit: "cover" }} />
        <canvas ref={canvasRef} style={{ transform: "scaleX(-1)", height: "100%", width: "100%" }} />

        <AnimatePresence>
          {countdown !== null && (
            <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none" >
              <div className="bg-black/40 backdrop-blur-sm rounded-full w-32 h-32 flex flex-col items-center justify-center border-4 border-white/30">
                <span className="text-white text-5xl font-black">{countdown}</span>
                <span className="text-white/80 text-xs font-bold mt-1">NEXT CANDIDATE</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!session && countdown === null && (status === "liveness" || status === "verified") && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute top-4 left-1/2 -translate-x-1/2 z-20" >
              <div className="bg-purple-600 px-6 py-2 rounded-full border border-purple-400 flex items-center gap-3">
                <FaEye className="text-white" />
                <span className="text-white font-bold">SCANNING IDENTITY...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isDetectingRef.current && lockProgress > 0 && (
          <div className="lock-progress-container" style={{ bottom: "0", height: "10px" }}>
            <motion.div className="lock-progress-bar" initial={{ width: 0 }} animate={{ width: `${lockProgress}%` }} />
          </div>
        )}
      </div>

      <div className="kiosk-footer" style={{ marginTop: "20px", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
        <p>Please stand 2-3 feet away from the camera for best results.</p>
      </div>
    </div>
  );
};

export default FacePortal;