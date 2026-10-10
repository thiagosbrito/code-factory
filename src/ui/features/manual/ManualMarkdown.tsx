import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { resolveChapterLink, type Chapter } from "./chapters";

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

/**
 * Anchor ids for the `##` and `###` headings, by source line, so they are stable across renders and
 * unique within a chapter even when two sections share a title. Fenced code is skipped.
 */
export const headingIds = (body: string): Map<number, string> => {
  const ids = new Map<number, string>();
  const seen = new Map<string, number>();
  let fenced = false;
  body.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{2,3}\s+(.+?)\s*#*$/.exec(line);
    if (!heading?.[1]) return;
    const plain = heading[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "");
    const base = slug(plain) || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    ids.set(index + 1, count ? `${base}-${count + 1}` : base);
  });
  return ids;
};

/**
 * The manual's Markdown. Unlike agent text, headings are real headings with anchors, tables are
 * readable, and links to other chapters switch chapter instead of opening a tab. No raw HTML is
 * rendered, and external links open outside the app.
 */
export const ManualMarkdown = ({
  chapter,
  onOpenChapter,
}: {
  chapter: Chapter;
  onOpenChapter: (chapter: Chapter, anchor?: string) => void;
}) => {
  const components = useMemo<Components>(() => {
    const ids = headingIds(chapter.body);
    return {
      h1: ({ node: _node, children, ...props }) => (
        <h2 className="text-3xl font-semibold tracking-tight" {...props}>
          {children}
        </h2>
      ),
      h2: ({ node, children, ...props }) => (
        <h3
          id={ids.get(node?.position?.start.line ?? 0)}
          className="mt-10 scroll-mt-6 border-b pb-2 text-xl font-semibold"
          {...props}
        >
          {children}
        </h3>
      ),
      h3: ({ node, children, ...props }) => (
        <h4
          id={ids.get(node?.position?.start.line ?? 0)}
          className="mt-6 scroll-mt-6 text-base font-semibold"
          {...props}
        >
          {children}
        </h4>
      ),
      h4: ({ node: _node, children, ...props }) => (
        <h5 className="mt-4 text-sm font-semibold" {...props}>
          {children}
        </h5>
      ),
      p: ({ node: _node, ...props }) => <p className="my-3 leading-7" {...props} />,
      ul: ({ node: _node, ...props }) => (
        <ul className="my-3 list-disc space-y-1 pl-6" {...props} />
      ),
      ol: ({ node: _node, ...props }) => (
        <ol className="my-3 list-decimal space-y-1 pl-6" {...props} />
      ),
      blockquote: ({ node: _node, ...props }) => (
        <blockquote
          className="my-4 rounded-r-md border-l-4 border-primary/60 bg-muted/50 py-1 pl-4 pr-3"
          {...props}
        />
      ),
      pre: ({ node: _node, ...props }) => (
        <pre
          className="my-4 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit"
          {...props}
        />
      ),
      code: ({ node: _node, className, ...props }) => (
        <code
          className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)}
          {...props}
        />
      ),
      table: ({ node: _node, ...props }) => (
        <div className="my-4 overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm" {...props} />
        </div>
      ),
      th: ({ node: _node, ...props }) => (
        <th className="border-b bg-muted/60 px-3 py-2 text-left font-semibold" {...props} />
      ),
      td: ({ node: _node, ...props }) => (
        <td className="border-b px-3 py-2 align-top last:border-b-0" {...props} />
      ),
      a: ({ node: _node, href = "", children, ...props }) => {
        const link = resolveChapterLink(href);
        if (link)
          return (
            <a
              href={`#${link.chapter.id}`}
              className="text-primary underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                onOpenChapter(link.chapter, link.anchor);
              }}
              {...props}
            >
              {children}
            </a>
          );
        if (href.startsWith("#"))
          return (
            <a
              href={href}
              className="text-primary underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(href.slice(1))?.scrollIntoView?.({ block: "start" });
              }}
              {...props}
            >
              {children}
            </a>
          );
        return (
          <a
            href={href}
            className="text-primary underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {children}
          </a>
        );
      },
    };
  }, [chapter.body, onOpenChapter]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {chapter.body}
    </ReactMarkdown>
  );
};
