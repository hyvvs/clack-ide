import { Button } from "@/components/ui/button";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { Message01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export const AI_CHAT_TOOLTIP = `Open AI Chat (${fmtShortcut(MOD_KEY, "I")})`;

export function AiChatButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      onClick={onOpen}
      size="xs"
      variant={open ? "secondary" : "ghost"}
      className="h-7 gap-1.5 px-2 text-[11px]"
      aria-label={AI_CHAT_TOOLTIP}
      aria-pressed={open}
      data-state={open ? "open" : "closed"}
    >
      <HugeiconsIcon icon={Message01Icon} size={13} strokeWidth={1.75} />
      <span>AI Chat</span>
    </Button>
  );
}
