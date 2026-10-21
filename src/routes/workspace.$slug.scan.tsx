import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import {
  BarcodeFormat,
  DecodeHintType,
} from "@zxing/library";
import { ApiError, resolveScanCode, type ScanResolveMatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  Flashlight,
  ImageIcon,
  Keyboard,
  Loader2,
  SwitchCamera,
  X,
} from "lucide-react";

export const Route = createFileRoute("/workspace/$slug/scan")({
  head: () => ({ meta: [{ title: "Scan · TrueGage" }] }),
  component: ScanPage,
});

const DEBOUNCE_MS = 2000;

function ScanPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastCodeRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const resolvingRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [matches, setMatches] = useState<ScanResolveMatch[] | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);

  const stopCamera = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      /* ignore */
    }
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStarted(false);
    setTorchOn(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      readerRef.current = null;
    };
  }, [stopCamera]);

  const openEquipment = useCallback(
    async (equipmentId: string, label: string) => {
      stopCamera();
      try {
        navigator.vibrate?.(40);
      } catch {
        /* ignore */
      }
      toast.success(`Opened ${label}`);
      await navigate({
        to: "/workspace/$slug/equipment/$id",
        params: { slug, id: equipmentId },
        search: { from: "scan" },
      });
    },
    [navigate, slug, stopCamera],
  );

  const handleDecoded = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || resolvingRef.current) return;
      const now = Date.now();
      if (lastCodeRef.current.value === code && now - lastCodeRef.current.at < DEBOUNCE_MS) {
        return;
      }
      lastCodeRef.current = { value: code, at: now };
      resolvingRef.current = true;
      try {
        const result = await resolveScanCode(code);
        if (result.equipment) {
          await openEquipment(
            result.equipment.id,
            result.equipment.tag || result.equipment.name,
          );
          return;
        }
        if (result.matches && result.matches.length > 0) {
          setMatches(result.matches);
          return;
        }
        toast.error("Code not recognized");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          toast.error("Code not recognized");
        } else if (!navigator.onLine) {
          toast.error("You're offline — reconnect to resolve scans");
        } else {
          toast.error(err instanceof Error ? err.message : "Resolve failed");
        }
      } finally {
        resolvingRef.current = false;
      }
    },
    [openEquipment],
  );

  const startCamera = useCallback(async () => {
    setError(null);
    setStarting(true);
    setMatches(null);
    try {
      if (!window.isSecureContext && location.hostname !== "localhost") {
        throw new Error("Camera requires HTTPS. Use manual entry or open TrueGage over https.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser has no camera API. Enter a code manually or upload a photo.");
      }

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.EAN_13,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices();
      setDevices(videoInputDevices);
      const preferred =
        deviceId ||
        videoInputDevices.find((d) => /back|rear|environment/i.test(d.label))?.deviceId ||
        videoInputDevices[0]?.deviceId;

      if (!videoRef.current) throw new Error("Video element missing");

      const callback = (result: { getText: () => string } | undefined, _err: unknown, ctrl: IScannerControls) => {
        controlsRef.current = ctrl;
        if (result) void handleDecoded(result.getText());
      };

      const controls = preferred
        ? await reader.decodeFromVideoDevice(preferred, videoRef.current, callback)
        : await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            videoRef.current,
            callback,
          );
      controlsRef.current = controls;
      setDeviceId(preferred);
      setStarted(true);

      // Torch support probe
      const stream = videoRef.current.srcObject as MediaStream | null;
      const track = stream?.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchSupported(Boolean(caps?.torch));
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          "Camera permission denied. Enable it in browser settings, then try again — or enter a code manually.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Could not start camera");
      }
      stopCamera();
    } finally {
      setStarting(false);
    }
  }, [deviceId, handleDecoded, stopCamera]);

  const toggleTorch = async () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      toast.error("Torch not available on this camera");
    }
  };

  const switchCamera = async () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(idx + 1) % devices.length];
    stopCamera();
    setDeviceId(next.deviceId);
    // restart after state settles
    setTimeout(() => {
      void startCamera();
    }, 50);
  };

  const onManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    void handleDecoded(manualCode);
  };

  const onPhoto = async (file: File | null) => {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const reader = readerRef.current ?? new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(url);
      URL.revokeObjectURL(url);
      await handleDecoded(result.getText());
    } catch {
      toast.error("No barcode found in that photo");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <header className="flex items-center justify-between gap-2 px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Button
          variant="ghost"
          size="sm"
          className="text-white hover:bg-white/10"
          asChild
        >
          <Link to="/workspace/$slug/equipment" params={{ slug }}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Close
          </Link>
        </Button>
        <span className="text-sm font-medium">Scan equipment</span>
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/10"
          onClick={() => {
            stopCamera();
            void navigate({ to: "/workspace/$slug/equipment", params: { slug } });
          }}
          aria-label="Close scanner"
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          playsInline
          autoPlay
        />
        {!started && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center">
            <Camera className="h-12 w-12 text-white/70" />
            <p className="max-w-sm text-sm text-white/80">
              Point your camera at a TrueGage QR label or plant barcode. Tip: hold 10–30 cm away;
              use torch in low light.
            </p>
            {error && <p className="max-w-sm text-sm text-red-300">{error}</p>}
            <Button
              size="lg"
              className="min-h-12 w-full max-w-xs"
              disabled={starting}
              onClick={() => void startCamera()}
            >
              {starting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Camera className="mr-2 h-4 w-4" />
              )}
              Start camera
            </Button>
          </div>
        )}
        {started && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-48 w-48 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
      </div>

      {matches && matches.length > 0 && (
        <div className="absolute inset-x-0 bottom-28 z-10 mx-3 max-h-48 overflow-y-auto rounded-xl bg-white p-3 text-foreground shadow-lg">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Multiple matches — pick one
          </p>
          <ul className="space-y-1">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => void openEquipment(m.id, m.tag || m.name)}
                >
                  <span className="font-mono text-xs">{m.tag}</span>
                  <span className="truncate text-muted-foreground">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3 border-t border-white/10 bg-black/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {started && (
          <div className="flex justify-center gap-3">
            {torchSupported && (
              <Button
                size="icon"
                variant={torchOn ? "default" : "secondary"}
                className="h-11 w-11 rounded-full"
                onClick={() => void toggleTorch()}
                aria-label="Toggle torch"
              >
                <Flashlight className="h-5 w-5" />
              </Button>
            )}
            {devices.length > 1 && (
              <Button
                size="icon"
                variant="secondary"
                className="h-11 w-11 rounded-full"
                onClick={() => void switchCamera()}
                aria-label="Switch camera"
              >
                <SwitchCamera className="h-5 w-5" />
              </Button>
            )}
          </div>
        )}

        {manualOpen ? (
          <form onSubmit={onManualSubmit} className="flex gap-2">
            <Input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Tag, serial, token, or URL"
              className="h-11 bg-white text-foreground"
              autoFocus
            />
            <Button type="submit" className="h-11 shrink-0">
              Go
            </Button>
          </form>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="h-11 flex-1"
              onClick={() => setManualOpen(true)}
            >
              <Keyboard className="mr-1.5 h-4 w-4" />
              Enter code
            </Button>
            <label className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground">
              <ImageIcon className="h-4 w-4" />
              Upload photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onPhoto(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
