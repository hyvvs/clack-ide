import { readClipboardText, writeClipboardText } from "@/lib/clipboard";

type WaitForSelection = () => Promise<void>;
type ReadSelection = () => string;
type WriteText = (text: string) => Promise<boolean>;
type ReadText = () => Promise<string | null>;
type PasteText = (text: string) => void;

function waitForSelectionUpdate(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    queueMicrotask(resolve);
  });
}

export async function copyTerminalSelection(
  getSelection: ReadSelection,
  writeText: WriteText = writeClipboardText,
  wait: WaitForSelection = waitForSelectionUpdate,
): Promise<boolean> {
  await wait();
  const selection = getSelection();
  if (!selection) return false;
  return writeText(selection);
}

export async function pasteTerminalClipboard(
  paste: PasteText,
  readText: ReadText = readClipboardText,
): Promise<boolean> {
  const text = await readText();
  if (!text) return false;
  paste(text);
  return true;
}
