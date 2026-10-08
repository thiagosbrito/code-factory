import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Element styles for agent and task text. react-markdown never renders raw HTML from the source
 * (no rehype-raw), so agent output cannot inject markup; links open outside the factory.
 */
const components: Components = {
  p: ({ node: _node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
  li: ({ node: _node, ...props }) => <li className="pl-1" {...props} />,
  h1: ({ node: _node, children, ...props }) => (
    <h4 className="mb-1 mt-3 text-base font-semibold" {...props}>
      {children}
    </h4>
  ),
  h2: ({ node: _node, children, ...props }) => (
    <h4 className="mb-1 mt-3 text-base font-semibold" {...props}>
      {children}
    </h4>
  ),
  h3: ({ node: _node, children, ...props }) => (
    <h5 className="mb-1 mt-3 text-sm font-semibold" {...props}>
      {children}
    </h5>
  ),
  h4: ({ node: _node, children, ...props }) => (
    <h5 className="mb-1 mt-3 text-sm font-semibold" {...props}>
      {children}
    </h5>
  ),
  a: ({ node: _node, children, ...props }) => (
    <a
      className="text-primary underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit"
      {...props}
    />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code
      className={cn("rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em]", className)}
      {...props}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th className="border-b px-2 py-1 font-semibold" {...props} />,
  td: ({ node: _node, ...props }) => <td className="border-b px-2 py-1 align-top" {...props} />,
  hr: () => <hr className="my-3" />,
};

/** Formatted Markdown for agent output, review findings and task descriptions. */
export const Markdown = ({ children, className }: { children: string; className?: string }) => (
  <div className={cn("text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  </div>
);
