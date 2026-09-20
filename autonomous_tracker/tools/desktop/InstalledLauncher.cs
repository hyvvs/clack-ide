using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class InstalledLauncher
{
    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        string application = AppDomain.CurrentDomain.BaseDirectory;
        string runtime = Path.Combine(application, "runtime");
        string python = Path.Combine(runtime, "pythonw.exe");
        try
        {
            if (!File.Exists(python) || !File.Exists(Path.Combine(runtime, "python312._pth")))
                throw new IOException("The bundled runtime is missing. Reinstall Rescue Studio. Your workspace files are separate and will be retained.");
            var info = new ProcessStartInfo(python, "-B -m tracker.cli.rescue_desktop");
            info.WorkingDirectory = application;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.EnvironmentVariables["TCL_LIBRARY"] = Path.Combine(runtime, "tcl", "tcl8.6");
            info.EnvironmentVariables["TK_LIBRARY"] = Path.Combine(runtime, "tcl", "tk8.6");
            info.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"] = "1";
            info.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            using (Process process = Process.Start(info))
            {
                process.WaitForExit();
                if (process.ExitCode != 0)
                    MessageBox.Show("Rescue Studio exited with an error. See diagnostics\\studio in your workspace. Reinstalling the app will not delete the workspace.", "Rescue Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Rescue Studio could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
