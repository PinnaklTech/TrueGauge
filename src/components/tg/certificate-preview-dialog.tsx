import { useEffect, useState } from "react";
import { getCertificateViewUrl } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export function CertificatePreviewDialog({
  certificateId,
  fileName,
  open,
  onOpenChange,
}: {
  certificateId: string | null;
  fileName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState(fileName || "Certificate");

  useEffect(() => {
    if (!open || !certificateId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setUrl(null);
    void getCertificateViewUrl(certificateId)
      .then((res) => {
        if (cancelled) return;
        setUrl(res.url);
        setTitle(res.file_name || fileName || "Certificate");
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Could not open certificate");
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, certificateId, fileName, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,880px)] w-full max-w-4xl flex-col gap-3 overflow-hidden p-4 sm:p-5">
        <DialogHeader className="shrink-0 space-y-1 pr-8 text-left">
          <DialogTitle className="truncate">{title}</DialogTitle>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/30">
          {loading || !url ? (
            <div className="grid h-full min-h-[420px] place-items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Loading PDF…
            </div>
          ) : (
            <iframe
              title={title}
              src={url}
              className="h-full min-h-[420px] w-full border-0 bg-white"
            />
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2">
          {url ? (
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
              </a>
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
