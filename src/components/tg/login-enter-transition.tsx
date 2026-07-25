import { cn } from "@/lib/utils";

/** Teal brand atmosphere for the login left panel. */
export function LoginAtmosphere({ className }: { className?: string }) {
  return (
    <div className={cn("tg-login-atmosphere absolute inset-0 overflow-hidden", className)}>
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse at 30% 40%, black 10%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="tg-login-orb absolute -left-16 top-1/4 h-64 w-64 rounded-full bg-teal-300/25 blur-3xl"
      />
      <div
        aria-hidden
        className="tg-login-orb-delayed absolute bottom-1/4 right-[10%] h-48 w-48 rounded-full bg-cyan-200/20 blur-3xl"
      />
    </div>
  );
}
