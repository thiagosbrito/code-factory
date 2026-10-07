import { useEffect, useRef, useState } from "react";

/** Write text to the clipboard; resolves false when the browser refuses. */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * One polite live-region message for copy helpers, plus a short-lived visible "Copied" key so
 * confirmation is announced and seen.
 */
export const useCopyAnnouncer = () => {
  const [message, setMessage] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (key: string, label: string, text: string, fallback?: HTMLElement | null) => {
    const ok = await copyText(text);
    window.clearTimeout(timer.current);
    if (ok) {
      setMessage(`${label} copied.`);
      setCopiedKey(key);
      timer.current = window.setTimeout(() => setCopiedKey(null), 2000);
      return;
    }
    setCopiedKey(null);
    setMessage("Copy failed. Select the text and copy it manually.");
    if (fallback) {
      const range = document.createRange();
      range.selectNodeContents(fallback);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };
  return { message, setMessage, copiedKey, copy };
};

/** POSIX single-quote escaping for a copyable shell command. */
export const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
