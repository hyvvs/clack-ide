import { invoke } from "@tauri-apps/api/core";

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await invoke("clipboard_write_text", { text });
    return true;
  } catch {
    return false;
  }
}

export async function readClipboardText(): Promise<string | null> {
  try {
    return await invoke<string>("clipboard_read_text");
  } catch {
    return null;
  }
}
