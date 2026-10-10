export type Chapter = {
  /** The file name without its number or extension, e.g. `setup` for `02-setup.md`. */
  id: string;
  file: string;
  title: string;
  body: string;
};

const files = import.meta.glob<string>("./content/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const titleOf = (body: string, fallback: string): string =>
  /^#\s+(.+?)\s*$/m.exec(body)?.[1] ?? fallback;

/** The manual's chapters in file-name order; add a numbered Markdown file to add a chapter. */
export const chapters: Chapter[] = Object.entries(files)
  .map(([path, body]) => {
    const file = path.slice(path.lastIndexOf("/") + 1);
    const id = file.replace(/^\d+-/, "").replace(/\.md$/, "");
    return { id, file, title: titleOf(body, id), body };
  })
  .sort((a, b) => a.file.localeCompare(b.file));

/** The chapter a link such as `02-setup.md#fields` points to, with its anchor. */
export const resolveChapterLink = (
  href: string,
): { chapter: Chapter; anchor: string | undefined } | undefined => {
  const match = /^(?:\.\/)?(\d+-[\w-]+)\.md(?:#(.+))?$/.exec(href);
  const chapter = match && chapters.find((item) => item.file === `${match[1]}.md`);
  return chapter ? { chapter, anchor: match[2] } : undefined;
};
