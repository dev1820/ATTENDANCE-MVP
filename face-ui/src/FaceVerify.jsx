import { useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";

Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID,
      region: import.meta.env.VITE_AWS_REGION,
      allowGuestAccess: true
    }
  }
});

function getLivenessErrorMessage(livenessError) {
  const err = livenessError?.error;
  if (!err) return "Liveness failed";

  if (typeof err.message === "string" && err.message.length > 0) {
    if (err.name && err.name !== "Error" && !err.message.includes(err.name)) {
      return `${err.name}: ${err.message}`;
    }
    return err.message;
  }

  if (err.name && err.name !== "Error") return err.name;

  return "Liveness failed";
}

export default function FaceVerify() {
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Preparing verification...");
  const [showTimeoutHint, setShowTimeoutHint] = useState(false);

  useEffect(() => {
    const run = async () => {
      try {
        const token = localStorage.getItem("token");

        const res = await fetch("/face/liveness/create-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          }
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || data.error || "Failed to create liveness session");
        }

        setSessionId(data.sessionId);
        setStatus("Session ready");
      } catch (e) {
        setError(e.message || "Failed to start face verification");
      }
    };

    run();
  }, []);

  useEffect(() => {
    if (!sessionId || error) return;

    const timer = setTimeout(() => {
      setShowTimeoutHint(true);
    }, 12000);

    return () => clearTimeout(timer);
  }, [sessionId, error]);

  const handleAnalysisComplete = async () => {
    try {
      setStatus("Completing verification...");

      const token = localStorage.getItem("token");
      const res = await fetch("/face/verify-complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Verification failed");
      }

      window.location.href = "/app?face=success";
    } catch (e) {
      setError(e.message || "Verification failed");
    }
  };

  const handleLivenessError = (livenessError) => {
    setError(getLivenessErrorMessage(livenessError));
  };

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f9ff" }}>
        <div style={{ background: "#fff", padding: 24, borderRadius: 16, width: 460 }}>
          <h2>Face Verification</h2>
          <p style={{ color: "#dc2626", lineHeight: 1.5 }}>{error}</p>
          <button onClick={() => (window.location.href = "/app")}>Back</button>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f9ff" }}>
        <div style={{ background: "#fff", padding: 24, borderRadius: 16, width: 420 }}>
          <h2>Face Verification</h2>
          <p>{status}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f9ff", padding: 24 }}>
      <div style={{ background: "#fff", padding: 24, borderRadius: 16, width: 560 }}>
        <h2 style={{ marginTop: 0 }}>Face Verification</h2>
        <p>Please complete the liveness check to continue.</p>

        <FaceLivenessDetector
          sessionId={sessionId}
          region={import.meta.env.VITE_AWS_REGION}
          onAnalysisComplete={handleAnalysisComplete}
          onError={handleLivenessError}
        />

        {showTimeoutHint && (
          <div style={{ marginTop: 16, color: "#b45309", lineHeight: 1.5 }}>
            Still connecting? Check that camera access is allowed in Chrome and that your Cognito Identity Pool
            guest role has permission for <b>rekognition:StartFaceLivenessSession</b>.
          </div>
        )}
      </div>
    </div>
  );
}