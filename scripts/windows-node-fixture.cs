using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

// Test-only native executable: inherit stdio, forward argv to the Node sidecar,
// and own a Windows job so terminating the fixture also terminates its children.
internal static class NodeFixture
{
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            result.Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    private static int Main(string[] args)
    {
        string executable = Assembly.GetExecutingAssembly().Location;
        string sidecar = executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? executable.Substring(0, executable.Length - 4) + ".cjs" : executable + ".cjs";
        var arguments = new StringBuilder(Quote(sidecar));
        foreach (string argument in args) arguments.Append(" ").Append(Quote(argument));
        string node = Environment.GetEnvironmentVariable("CODE_FACTORY_TEST_NODE");
        if (String.IsNullOrEmpty(node)) throw new InvalidOperationException("Missing fixture Node path");
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new InvalidOperationException("Cannot create fixture job");
        try
        {
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)))
                throw new InvalidOperationException("Cannot configure fixture job");
            using (var child = Process.Start(new ProcessStartInfo(node, arguments.ToString()) { UseShellExecute = false }))
            {
                if (!AssignProcessToJobObject(job, child.Handle))
                {
                    child.Kill();
                    throw new InvalidOperationException("Cannot assign fixture child to job");
                }
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        finally { CloseHandle(job); }
    }
}
