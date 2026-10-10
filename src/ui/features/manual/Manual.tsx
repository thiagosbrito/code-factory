import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/shared/components/input";
import { chapters, type Chapter } from "./chapters";
import { ManualMarkdown } from "./ManualMarkdown";

const matches = (chapter: Chapter, query: string): boolean =>
  !query || `${chapter.title}\n${chapter.body}`.toLowerCase().includes(query.toLowerCase());

/** The in-app user manual: a chapter list with search, the chapter text, and previous/next. */
export const Manual = () => {
  const [chapterId, setChapterId] = useState(chapters[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  const article = useRef<HTMLElement>(null);
  const pendingAnchor = useRef<string | undefined>(undefined);
  const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0];
  const visible = useMemo(() => chapters.filter((item) => matches(item, query)), [query]);
  const index = chapter ? chapters.indexOf(chapter) : -1;

  const open = useCallback((target: Chapter, anchor?: string) => {
    pendingAnchor.current = anchor;
    setChapterId(target.id);
    if (!anchor) article.current?.scrollIntoView?.({ block: "start" });
  }, []);

  // After a chapter renders, list its sections and honor a pending anchor.
  useEffect(() => {
    const headings = [...(article.current?.querySelectorAll<HTMLElement>("h3[id]") ?? [])];
    setSections(headings.map((heading) => ({ id: heading.id, title: heading.textContent ?? "" })));
    const anchor = pendingAnchor.current;
    pendingAnchor.current = undefined;
    if (anchor) document.getElementById(anchor)?.scrollIntoView?.({ block: "start" });
  }, [chapter]);

  if (!chapter) return <p className="mt-8 text-sm text-muted-foreground">The manual is empty.</p>;
  const previous = chapters[index - 1];
  const next = chapters[index + 1];
  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="grid content-start gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
        <div className="grid gap-1 text-sm font-medium">
          <label htmlFor="manual-search">Search the manual</label>
          <Input
            id="manual-search"
            type="search"
            value={query}
            placeholder="Field, button or topic"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <nav aria-label="Manual chapters">
          <ol className="grid gap-1">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  aria-current={item.id === chapter.id ? "page" : undefined}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    item.id === chapter.id ? "bg-primary/10 font-semibold" : "hover:bg-muted"
                  }`}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ol>
          {visible.length === 0 && (
            <output className="block px-3 py-2 text-sm text-muted-foreground">
              No chapter mentions “{query}”.
            </output>
          )}
        </nav>
        {sections.length > 0 && (
          <nav aria-label="On this page" className="border-t pt-3">
            <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              On this page
            </h2>
            <ul className="mt-2 grid gap-0.5">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(section.id)?.scrollIntoView?.({ block: "start" });
                    }}
                    className="block rounded-md px-3 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      <article ref={article} aria-label={chapter.title} className="min-w-0 max-w-3xl text-sm">
        <ManualMarkdown chapter={chapter} onOpenChapter={open} />
        <div className="mt-12 flex justify-between gap-3 border-t pt-4">
          {previous ? (
            <button
              type="button"
              onClick={() => open(previous)}
              className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-xs text-muted-foreground">Previous</span>
              {previous.title}
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button
              type="button"
              onClick={() => open(next)}
              className="rounded-md border px-3 py-2 text-right text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-xs text-muted-foreground">Next</span>
              {next.title}
            </button>
          )}
        </div>
      </article>
    </div>
  );
};
