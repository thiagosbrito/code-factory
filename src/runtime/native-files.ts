import { spawn } from "node:child_process";
import { z } from "zod";
import { ProjectError } from "./project.js";

type NativeFileRequest = {
  project: string;
  directory: string;
  name: string;
  action: "read" | "create" | "list";
  content?: string;
};

const resultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    content: z.string().nullable().optional(),
    names: z.array(z.string()).optional(),
  }),
  z.strictObject({ status: z.literal("error"), code: z.string() }),
]);

// Python's dir_fd operations map to openat(2). Node's path-based open cannot pin
// parent directories against a concurrent rename or symlink replacement.
const helper = String.raw`
import errno, json, os, stat, sys

request = json.load(sys.stdin)
fds = []
try:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    parent = os.open(request['project'], flags)
    fds.append(parent)
    missing = False
    for segment in request['directory'].split('/'):
        try:
            child = os.open(segment, flags, dir_fd=parent)
        except FileNotFoundError:
            if request['action'] != 'create':
                missing = True
                break
            try:
                os.mkdir(segment, dir_fd=parent)
            except FileExistsError:
                pass
            child = os.open(segment, flags, dir_fd=parent)
        fds.append(child)
        parent = child
    if missing:
        result = {'status': 'ok', 'content': None, 'names': []}
    elif request['action'] == 'list':
        result = {'status': 'ok', 'names': os.listdir(parent)}
    else:
        if request['action'] == 'create' and len(request['content'].encode('utf-8')) > 1048576:
            raise ValueError('invalid_file')
        file_flags = os.O_NOFOLLOW | (os.O_RDONLY if request['action'] == 'read' else os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        try:
            fd = os.open(request['name'], file_flags, 0o600, dir_fd=parent)
        except FileNotFoundError:
            if request['action'] != 'read':
                raise
            result = {'status': 'ok', 'content': None}
        else:
            fds.append(fd)
            if request['action'] == 'read':
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_size > 1048576:
                    raise ValueError('invalid_file')
                with os.fdopen(os.dup(fd), 'rb') as source:
                    data = source.read(1048577)
                if len(data) > 1048576:
                    raise ValueError('invalid_file')
                result = {'status': 'ok', 'content': data.decode('utf-8')}
            else:
                with os.fdopen(os.dup(fd), 'wb') as target:
                    target.write(request['content'].encode('utf-8'))
                result = {'status': 'ok'}
    print(json.dumps(result))
except (OSError, ValueError, UnicodeError) as error:
    code = errno.errorcode.get(error.errno, 'EIO') if isinstance(error, OSError) else 'invalid_file'
    print(json.dumps({'status': 'error', 'code': code}))
finally:
    for fd in reversed(fds):
        os.close(fd)
`;

export const nativeFile = async (request: NativeFileRequest) => {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("python3", ["-c", helper], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let errorOutput = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      errorOutput += chunk;
    });
    child.on("error", () =>
      reject(
        new ProjectError(
          "Native translation requires Python 3 with POSIX directory operations.",
          501,
        ),
      ),
    );
    child.stdin.on("error", () => {
      // A failed spawn closes stdin before the request can be written.
    });
    child.on("close", (code) => {
      if (code !== 0)
        reject(new ProjectError(`Native file operation failed: ${errorOutput.trim()}`, 409));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(JSON.stringify(request));
  });
  const result = resultSchema.parse(JSON.parse(output));
  if (result.status === "error") {
    if (result.code === "ELOOP" || result.code === "ENOTDIR")
      throw new ProjectError("Native configuration path contains a link or non-directory.", 409);
    if (result.code === "EEXIST")
      throw new ProjectError("Native rule was created after preview.", 409);
    if (result.code === "invalid_file")
      throw new ProjectError("Native rule must be a regular UTF-8 file under 1 MB.", 422);
    throw new ProjectError(`Native file operation failed: ${result.code}`, 409);
  }
  return result;
};
