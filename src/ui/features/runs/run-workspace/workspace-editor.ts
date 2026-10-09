import { shellQuote } from "../../../shared/clipboard";

const EDITOR_KEY = "code-factory.editor-command";
export const EDITORS = [
  { cli: "code", label: "VS Code" },
  { cli: "kiro", label: "Kiro" },
  { cli: "cursor", label: "Cursor" },
] as const;
export type EditorCli = (typeof EDITORS)[number]["cli"];

export const storedEditor = (): EditorCli => {
  try {
    const value = window.localStorage.getItem(EDITOR_KEY);
    return EDITORS.find((item) => item.cli === value)?.cli ?? "code";
  } catch {
    return "code";
  }
};

/** Remembers the choice for next time; storage may be unavailable, and the choice still applies. */
export const saveEditor = (cli: EditorCli): void => {
  try {
    window.localStorage.setItem(EDITOR_KEY, cli);
  } catch {
    /* Storage may be unavailable; the choice still applies to this page. */
  }
};

export const openInEditorCommand = (cli: string, path: string): string =>
  `${cli} -n ${shellQuote(path)}`;
