root = System.fetch_env!("SYMPHONY_TEST_ROOT")
workspace = Path.join(root, "THI-CLEANUP")
workflow = Path.join(Path.dirname(root), "WORKFLOW.md")
File.mkdir_p!(workspace)
File.write!(Path.join(workspace, "keep.txt"), "valuable work")

configure = fn hook ->
  File.write!(workflow, "---\ntracker:\n  kind: linear\n  provider:\n    api_key: fixture-token\n    project_slug: fixture-project\nworkspace:\n  root: #{root}\nhooks:\n  before_remove: #{inspect(hook)}\n---\nTest cleanup.\n")
  SymphonyElixir.Workflow.set_workflow_file_path(workflow)
end

configure.("exit 7")
{:error, _, ^workspace} = SymphonyElixir.Workspace.remove(workspace)
true = File.exists?(Path.join(workspace, "keep.txt"))
{:error, _, ^workspace} = SymphonyElixir.Workspace.remove_recorded(workspace, nil)
true = File.exists?(Path.join(workspace, "keep.txt"))
configure.("true")
{:ok, _} = SymphonyElixir.Workspace.remove(workspace)
false = File.exists?(workspace)

File.write!(workflow, "---\ntracker:\n  kind: linear\n  provider:\n    api_key: fixture-token\n    project_slug: fixture-project\nworkspace:\n  root: #{root}\nhooks:\n  after_create: touch keep.txt; exit 7\n  before_remove: exit 7\n---\nTest partial creation.\n")
SymphonyElixir.Workflow.set_workflow_file_path(workflow)
{:error, _} = SymphonyElixir.Workspace.create_for_issue("THI-PARTIAL")
true = File.exists?(Path.join([root, "THI-PARTIAL", "keep.txt"]))
IO.puts("Patched cleanup preserves failures and removes successful workspaces.")
