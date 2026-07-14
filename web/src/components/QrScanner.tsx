import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Live camera QR scanner. Calls onScan once with the decoded text, then stops.
// Remount (change key) to scan again. Reports camera failures via onError so
// the parent can lean on its manual-entry fallback.
export function QrScanner({ onScan, onError }: { onScan: (text: string) => void; onError?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const cbRef = useRef({ onScan, onError });
  cbRef.current = { onScan, onError };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const tick = () => {
          if (stopped) return;
          if (ctx && video.readyState >= 2 && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height);
            if (code?.data) { cbRef.current.onScan(code.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        if (!stopped) { setFailed(true); cbRef.current.onError?.(); }
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (failed)
    return <p className="rounded-xl bg-gray-100 p-3 text-center text-xs text-gray-500">Camera unavailable — type the asset ID below instead.</p>;
  return <video ref={videoRef} className="h-48 w-full rounded-xl bg-gray-900 object-cover" muted playsInline />;
}
