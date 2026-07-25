import { useTheme } from "@/lib/theme";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Inverts against app theme: dark UI → light toast, light UI → dark toast. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  const toastTheme = theme === "dark" ? "light" : "dark";

  return (
    <Sonner
      theme={toastTheme}
      className="toaster group"
      richColors
      closeButton
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:border group-[.toaster]:shadow-lg group-[.toaster]:font-sans",
          title: "group-[.toast]:font-semibold",
          description: "group-[.toast]:opacity-90",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "tg-toast-success",
          error: "tg-toast-error",
          info: "tg-toast-info",
          warning: "tg-toast-warning",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
