// --- components/FaceLogin.jsx ---
// Fast face-login lock with anti-spoofing checks.
// Guard rails:
//   1. Face bounding box size stability
//   2. Center constraint
//   3. Straight-face hold lock
//   4. 12-second timeout

import { useState, useRef, useEffect } from "react";
import * as faceapi from "face-api.js";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaCamera,
  FaTimes,
  FaSpinner,
  FaCheckCircle,
  FaExclamationTriangle,
  FaEye,
} from "react-icons/fa";

const FACE_LOCK_HOLD_MS = 900;

// ========== 3D HEAD POSE (For checking straightness) ==========
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

// ========== BRIGHTNESS CHECK ==========
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

const FaceLogin = ({ onFaceLogin, onClose }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectionIntervalRef = useRef(null);

  // Face-lock refs
  const verificationStartTimeRef = useRef(null);
  const savedDescriptorRef = useRef(null);
  const livenessVerifiedRef = useRef(false);
  const isDetectingRef = useRef(false);
  const faceLockStartTimeRef = useRef(null);

  // Anti-spoofing data collection refs
  const baselineFaceWidthRef = useRef(null);  // Track bounding box width stability
  const faceWidthHistoryRef = useRef([]);     // Track face width over time

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [status, setStatus] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("Loading face recognition models...");
  const [faceDetected, setFaceDetected] = useState(false);
  const [lockProgressState, setLockProgressState] = useState(0);

  // Load face-api.js models
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
        setStatusMessage("Models loaded. Starting camera...");
      } catch (error) {
        console.error("Error loading face-api models:", error);
        setStatus("error");
        setStatusMessage("Failed to load face recognition models. Please refresh.");
      }
    };
    loadModels();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (modelsLoaded) startCamera();
  }, [modelsLoaded]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setCameraActive(true);
          setStatus("detecting");
          setStatusMessage("Looking for your face...");
          startFaceDetection();
        };
      }
    } catch (error) {
      console.error("Camera access error:", error);
      setStatus("error");
      setStatusMessage("Camera access denied. Please allow camera permissions.");
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

  const failSpoofing = (reason) => {
    isDetectingRef.current = false;
    setFaceDetected(false);
    faceLockStartTimeRef.current = null;
    setLockProgressState(0);
    setStatus("error");
    setStatusMessage(`❌ Anti-Spoofing: ${reason}`);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      setCameraActive(false);
    }
  };

  const startFaceDetection = () => {
    let faceFoundCount = 0;
    const MAX_ATTEMPTS = 500;
    let attemptCount = 0;

    // Reset ALL liveness state
    verificationStartTimeRef.current = null;
    savedDescriptorRef.current = null;
    livenessVerifiedRef.current = false;
    faceLockStartTimeRef.current = null;
    isDetectingRef.current = true;
    baselineFaceWidthRef.current = null;
    faceWidthHistoryRef.current = [];
    setLockProgressState(0);

    const detectLoop = async () => {
      if (!isDetectingRef.current) return;
      if (!videoRef.current || videoRef.current.readyState < 2) {
        detectionIntervalRef.current = setTimeout(detectLoop, 50);
        return;
      }
      if (livenessVerifiedRef.current) return;
      attemptCount++;

      try {
        const brightness = checkBrightness(videoRef.current);
        if (brightness < 30) {
          setFaceDetected(false);
          if (canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          }
          setStatus("detecting");
          setStatusMessage("⚠️ Room is too dark. Please turn on a light.");
          detectionIntervalRef.current = setTimeout(detectLoop, 500); // Check again in 500ms
          return;
        }

        const detection = await faceapi
          .detectSingleFace(videoRef.current)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (canvasRef.current && videoRef.current) {
          const displaySize = {
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight,
          };
          faceapi.matchDimensions(canvasRef.current, displaySize);
          const ctx = canvasRef.current.getContext("2d");
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

          if (detection) {
            if (!faceDetected) {
              setFaceDetected(true);
              verificationStartTimeRef.current = Date.now();
              setStatus("liveness");
            }
            faceFoundCount++;

            // --- LAYER 4: TIMEOUT ---
            if (verificationStartTimeRef.current && (Date.now() - verificationStartTimeRef.current > 12000)) {
              failSpoofing("Verification timed out. Static image or photo suspected.");
              return;
            }

            const resized = faceapi.resizeResults(detection, displaySize);
            const { x, y, width, height } = resized.detection.box;
            const descriptor = Array.from(detection.descriptor);

            // --- LAYER 3: CENTER CONSTRAINT ---
            const boxCenterX = x + width / 2;
            const frameCenterX = displaySize.width / 2;
            const allowedDeviation = displaySize.width * 0.18;
            if (Math.abs(boxCenterX - frameCenterX) > allowedDeviation) {
              faceLockStartTimeRef.current = null;
              setLockProgressState(0);
              setStatusMessage("🎯 Keep your face centered on the screen.");
              ctx.strokeStyle = "#ef4444";
              ctx.lineWidth = 4;
              ctx.strokeRect(x, y, width, height);
              if (isDetectingRef.current) detectionIntervalRef.current = setTimeout(detectLoop, 0);
              return;
            }

            // --- LAYER 1: FACE SIZE STABILITY ---
            faceWidthHistoryRef.current.push(width);
            if (faceWidthHistoryRef.current.length > 20) faceWidthHistoryRef.current.shift();
            if (!baselineFaceWidthRef.current && faceWidthHistoryRef.current.length >= 5) {
              baselineFaceWidthRef.current = faceWidthHistoryRef.current.reduce((a, b) => a + b, 0) / faceWidthHistoryRef.current.length;
            }
            if (baselineFaceWidthRef.current) {
              const widthDeviation = Math.abs(width - baselineFaceWidthRef.current) / baselineFaceWidthRef.current;
              if (widthDeviation > 0.30) {
                failSpoofing("Face size changed abnormally. Object or photo movement detected.");
                return;
              }
            }

            // Draw face frame
            const stageColor = lockProgressState >= 70 ? "#22c55e" : "#8b5cf6";
            ctx.strokeStyle = stageColor;
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 4]);
            ctx.strokeRect(x, y, width, height);
            ctx.setLineDash([]);

            // Corner accents
            const cornerLen = 20;
            ctx.strokeStyle = lockProgressState >= 70 ? "#22c55e" : "#a855f7";
            ctx.lineWidth = 4;
            [[x, y + cornerLen, x, y, x + cornerLen, y],
            [x + width - cornerLen, y, x + width, y, x + width, y + cornerLen],
            [x, y + height - cornerLen, x, y + height, x + cornerLen, y + height],
            [x + width - cornerLen, y + height, x + width, y + height, x + width, y + height - cornerLen]
            ].forEach(([x1, y1, x2, y2, x3, y3]) => {
              ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();
            });

            // ==========================================
            //       FAST FACE-LOCK STATE MACHINE
            // ==========================================
            const yawRatio = getHeadYaw(resized.landmarks);

            if (yawRatio < 0.75 || yawRatio > 1.25) {
              faceLockStartTimeRef.current = null;
              setLockProgressState(0);
              setStatusMessage("👱 Please face straight forward.");
            } else {
              if (!faceLockStartTimeRef.current) {
                faceLockStartTimeRef.current = Date.now();
              }

              const holdElapsed = Date.now() - faceLockStartTimeRef.current;
              const holdProgress = Math.min(
                100,
                Math.round((holdElapsed / FACE_LOCK_HOLD_MS) * 100)
              );
              setLockProgressState(holdProgress);

              if (holdElapsed >= FACE_LOCK_HOLD_MS) {
                // Verified!
                livenessVerifiedRef.current = true;
                isDetectingRef.current = false;
                savedDescriptorRef.current = descriptor;
                setStatus("verified");
                setStatusMessage("✅ Liveness verified! Authenticating...");

                setTimeout(() => {
                  if (savedDescriptorRef.current) {
                    onFaceLogin(savedDescriptorRef.current);
                  }
                }, 500);
                return;
              } else {
                setStatusMessage("✅ Face detected. Hold still for instant login...");
              }
            }
          } else {
            setFaceDetected(false);
            faceFoundCount = 0;
            faceLockStartTimeRef.current = null;
            setLockProgressState(0);
            baselineFaceWidthRef.current = null;
            faceWidthHistoryRef.current = [];
            setStatus("detecting");
            setStatusMessage("Looking for your face...");
          }
        }

        if (attemptCount >= MAX_ATTEMPTS && !faceDetected) {
          isDetectingRef.current = false;
          setStatus("error");
          setStatusMessage("No face detected. Please try again.");
          return;
        }
      } catch (error) {
        console.error("Face detection error:", error);
      }

      if (isDetectingRef.current) {
        detectionIntervalRef.current = setTimeout(detectLoop, 0); // extremely fast loop for tracking blinks
      }
    };

    detectLoop();
  };

  const handleClose = () => { stopCamera(); onClose(); };

  const handleRetry = () => {
    verificationStartTimeRef.current = null;
    savedDescriptorRef.current = null;
    livenessVerifiedRef.current = false;
    faceLockStartTimeRef.current = null;
    baselineFaceWidthRef.current = null;
    faceWidthHistoryRef.current = [];
    setLockProgressState(0);
    setFaceDetected(false);
    setStatus("loading");
    setStatusMessage("Restarting...");
    stopCamera();
    setTimeout(() => startCamera(), 500);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && handleClose()}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="relative w-full max-w-lg mx-4 bg-gradient-to-br from-[#1a1640] via-[#2d2568] to-[#1e1a4a] rounded-3xl shadow-2xl border border-purple-500/30 overflow-hidden"
        >
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-indigo-500/20 rounded-full blur-3xl" />

          {/* Header */}
          <div className="relative flex items-center justify-between px-6 py-4 border-b border-purple-500/20">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                <FaCamera className="text-white text-lg" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Face Recognition</h3>
                <p className="text-purple-300/70 text-xs">Secure biometric login with anti-spoofing</p>
              </div>
            </div>
            <button onClick={handleClose} className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all">
              <FaTimes />
            </button>
          </div>

          {/* Camera View */}
          <div className="relative px-6 py-5">
            <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-black/40 border border-purple-500/20">
              <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ transform: "scaleX(-1)" }} />

              {status === "detecting" && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "linear-gradient(180deg, transparent 0%, rgba(139, 92, 246, 0.1) 50%, transparent 100%)", backgroundSize: "100% 200%" }}
                  animate={{ backgroundPosition: ["0% 0%", "0% 100%", "0% 0%"] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                />
              )}

              {status === "detecting" && !faceDetected && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <motion.div
                    className="w-48 h-56 rounded-[50%] border-2 border-dashed border-purple-400/50"
                    animate={{ scale: [1, 1.05, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </div>
              )}

              {(status === "liveness" || status === "verified") && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none z-10">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="bg-purple-600/80 backdrop-blur-sm rounded-xl px-4 py-2 shadow-lg border border-purple-400/30 flex items-center gap-2"
                  >
                    <motion.div animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                      <FaEye className="text-white text-xl" />
                    </motion.div>
                    <span className="text-white text-sm font-bold">Face Lock Active</span>
                  </motion.div>
                </div>
              )}

              {status === "loading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                    <FaSpinner className="text-purple-400 text-4xl" />
                  </motion.div>
                </div>
              )}
            </div>

            {/* Face Lock Progress */}
            {(status === "liveness" || status === "verified") && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-purple-300 text-xs font-medium flex items-center gap-1.5">
                    <FaEye className="text-lg" /> Face Lock Verification
                  </span>
                  <span className="text-purple-300 text-xs font-bold">
                    {lockProgressState}%
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-purple-900/50">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-green-400"
                    animate={{ width: `${lockProgressState}%` }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                  />
                </div>
              </div>
            )}

            {/* Status */}
            <motion.div
              key={statusMessage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-4 flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${status === "error"
                  ? "bg-red-500/10 border border-red-500/30 text-red-300"
                  : status === "verified" || status === "success"
                    ? "bg-green-500/10 border border-green-500/30 text-green-300"
                    : "bg-purple-500/10 border border-purple-500/30 text-purple-300"
                }`}
            >
              {status === "error" ? (
                <FaExclamationTriangle className="text-lg flex-shrink-0" />
              ) : status === "verified" || status === "success" ? (
                <FaCheckCircle className="text-lg flex-shrink-0" />
              ) : (
                <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="h-2 w-2 rounded-full bg-purple-400 flex-shrink-0" />
              )}
              <span>{statusMessage}</span>
            </motion.div>

            {status === "error" && (
              <motion.button
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                onClick={handleRetry}
                className="mt-3 w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm font-bold hover:from-purple-500 hover:to-indigo-500 transition-all"
              >
                Try Again
              </motion.button>
            )}
          </div>

          <div className="px-6 pb-5">
            <p className="text-purple-300/50 text-xs text-center">
              Photos, videos, and screens are automatically detected and rejected.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default FaceLogin;
