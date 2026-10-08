import { lazy, Suspense, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useChatStore } from "@/modules/ai/store/chatStore";

const Manager = lazy(() =>
  import("./CustomToolsManager").then((module) => ({
    default: module.CustomToolsManager,
  })),
);

export function ChatToolsControl({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const session = useChatStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label="Manage tools for this chat"
          title="Manage tools for this chat"
        >
          <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.7} />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-24px)] max-w-2xl flex-col overflow-hidden p-4">
        <DialogHeader className="min-w-0 pr-7 [overflow-wrap:anywhere]">
          <DialogTitle>Tools for {session?.title ?? "this chat"}</DialogTitle>
          <DialogDescription>
            {session?.profile?.workspaceRoot ?? "No workspace bound"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 overflow-y-auto [overflow-wrap:anywhere]">
          {open && (
            <Suspense fallback={<p role="status">Loading tools...</p>}>
              <Manager sessionId={sessionId} />
            </Suspense>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
