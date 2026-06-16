import { useTheme } from "@/modules/theme";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedMode } = useTheme();

  return (
    <Sonner
      theme={resolvedMode}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--clack-surface-raised)",
          "--normal-text": "var(--clack-text-1)",
          "--normal-border": "var(--clack-border-strong)",
          "--border-radius": "var(--clack-radius-panel)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
