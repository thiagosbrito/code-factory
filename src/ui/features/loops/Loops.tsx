import type { AgentConnection } from "../../../adapters/contract.js";
import type { LoopDefinition } from "../../../domain/loop.js";
import type { ProjectResponse } from "../../shared/project-api";
import { LoopCard } from "./LoopCard";
import { LoopEditor } from "./LoopEditor";
import { LoopImportPanel } from "./LoopImportPanel";
import { LoopsEmptyState } from "./LoopsEmptyState";
import { LoopsLibraryHeader } from "./LoopsLibraryHeader";
import { StarterPicker } from "./StarterPicker";
import { useLoopsLibrary } from "./useLoopsLibrary";

export const Loops = ({
  project,
  agents,
  onPublished,
}: {
  project: ProjectResponse;
  agents: AgentConnection[];
  onPublished?: (loop: LoopDefinition) => void;
}) => {
  const library = useLoopsLibrary(onPublished);
  if (library.selected)
    return (
      <LoopEditor
        key={`${library.selected.id}-${library.selected.version}`}
        initial={library.selected}
        project={project}
        agents={agents}
        onBack={library.closeEditor}
        onPublished={library.editorPublished}
      />
    );
  return (
    <section className="mt-7">
      <LoopsLibraryHeader
        createRef={library.createRef}
        onToggleStarters={library.toggleChooser}
        onImport={library.openImport}
        onCreate={() => void library.create()}
      />
      {library.error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {library.error}
        </p>
      )}
      {library.chooser && (
        <StarterPicker onChoose={(starter) => void library.chooseStarter(starter)} />
      )}
      <LoopImportPanel
        text={library.importText}
        errors={library.importErrors}
        preview={library.preview}
        onTextChange={library.changeImportText}
        onValidate={library.previewImport}
        onConfirm={library.confirmImport}
      />
      {library.loading ? (
        <p className="mt-8">Loading loops…</p>
      ) : library.entries.length ? (
        <div className="mt-6 grid gap-3">
          {library.entries.map((entry) => (
            <div key={entry.id} className="grid gap-3">
              {entry.draft && (
                <LoopCard
                  loop={entry.draft}
                  onEdit={() => library.setSelected(entry.draft)}
                  onExport={() => entry.draft && library.exportLoop(entry.draft)}
                />
              )}
              {entry.published && (
                <LoopCard
                  loop={entry.published}
                  versions={entry.versions}
                  onExport={() => entry.published && library.exportLoop(entry.published)}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <LoopsEmptyState onCreate={() => void library.create()} />
      )}
    </section>
  );
};
