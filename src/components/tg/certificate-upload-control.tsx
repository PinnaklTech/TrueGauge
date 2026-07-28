import { useRef, useState, type DragEvent } from "react";
import { CERTIFICATE_MAX_BYTES, uploadCertificateFile, type AppCertificate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CloudUpload, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function CertificateUploadControl({
  equipmentId,
  calibrationId,
  disabled,
  onUploaded,
  /** When set, file pick/drop opens this callback instead of uploading immediately. */
  onFileSelected,
  compact,
  variant = "button",
  className,
}: {
  equipmentId?: string;
  calibrationId?: string;
  disabled?: boolean;
  onUploaded?: (cert: AppCertificate) => void;
  onFileSelected?: (file: File) => void;
  compact?: boolean;
  variant?: "button" | "dropzone";
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const deferEquipment = typeof onFileSelected === "function";
  const canUploadNow = Boolean(equipmentId) || deferEquipment;

  const validateFile = (file: File): string | null => {
    if (file.type && file.type !== "application/pdf") return "Only PDF documents are supported";
    if (!file.name.toLowerCase().endsWith(".pdf")) return "Only PDF documents are supported";
    if (file.size > CERTIFICATE_MAX_BYTES) return "File exceeds the 2 MB size limit";
    if (file.size <= 0) return "File is empty";
    return null;
  };

  const onPick = async (file: File | undefined) => {
    if (!file || disabled || busy) return;

    const invalid = validateFile(file);
    if (invalid) {
      toast.error(invalid);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (deferEquipment) {
      onFileSelected(file);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (!equipmentId) {
      toast.error("Select a target gauge before uploading");
      return;
    }

    setBusy(true);
    try {
      const cert = await uploadCertificateFile({
        file,
        equipmentId,
        calibrationId,
      });
      toast.success("Certificate uploaded");
      onUploaded?.(cert);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (disabled || busy) return;
    void onPick(e.dataTransfer.files?.[0]);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf,.pdf"
      className="sr-only"
      disabled={disabled || busy || (!canUploadNow && !deferEquipment)}
      onChange={(e) => void onPick(e.target.files?.[0])}
    />
  );

  if (variant === "dropzone") {
    return (
      <div className={cn("space-y-2", className)}>
        {input}
        <div
          role="button"
          tabIndex={disabled || busy ? -1 : 0}
          aria-disabled={disabled || busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!disabled && !busy) inputRef.current?.click();
            }
          }}
          onClick={() => {
            if (!disabled && !busy) inputRef.current?.click();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
            dragging
              ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
              : "border-border bg-muted/20 hover:border-[color:var(--color-primary)]/50 hover:bg-muted/40",
            (disabled || busy) && "cursor-not-allowed opacity-60",
          )}
        >
          {busy ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <CloudUpload className="h-8 w-8 text-muted-foreground" />
          )}
          <p className="mt-3 text-sm font-medium text-foreground">
            {busy ? "Uploading…" : "Drag cert file here or click to browse"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            PDF only · up to {Math.round(CERTIFICATE_MAX_BYTES / (1024 * 1024))} MB
            {deferEquipment ? " · choose gauge after selecting" : ""}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={disabled || busy}
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            {busy ? "Uploading…" : "Select File"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {!compact ? (
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          PDF certificate (max 2 MB)
        </Label>
      ) : null}
      {input}
      <Button
        type="button"
        variant={compact ? "outline" : "default"}
        size="sm"
        disabled={disabled || busy || (!equipmentId && !deferEquipment)}
        onClick={() => inputRef.current?.click()}
        className={compact ? undefined : "w-full"}
      >
        {busy ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileUp className="mr-1.5 h-3.5 w-3.5" />
        )}
        {busy ? "Uploading…" : compact ? "Upload PDF" : "Choose PDF to upload"}
      </Button>
      {!compact ? (
        <p className="text-[11px] text-muted-foreground">
          PDF only · up to {Math.round(CERTIFICATE_MAX_BYTES / (1024 * 1024))} MB · stored privately
        </p>
      ) : null}
    </div>
  );
}
