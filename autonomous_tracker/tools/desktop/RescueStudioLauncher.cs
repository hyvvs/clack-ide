using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class RescueStudioLauncher
{
    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        string workspace = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string python = Path.Combine(workspace, ".venv", "Scripts", "pythonw.exe");
        if (!File.Exists(python) || !Directory.Exists(Path.Combine(workspace, "src", "tracker")))
        {
            MessageBox.Show("Keep Rescue Studio.exe in the autonomous_tracker folder with its " +
                ".venv and source files. This is a local launcher, not a portable Python installer.",
                "Rescue Studio", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
        try
        {
            var info = new ProcessStartInfo(python,
                "-m tracker.cli.rescue_studio --workspace \"" + workspace + "\"");
            info.WorkingDirectory = workspace;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            using (Process process = Process.Start(info))
            {
                process.WaitForExit();
                if (process.ExitCode != 0)
                    MessageBox.Show("Rescue Studio exited with an error. Details are in " +
                        Path.Combine(workspace, "diagnostics", "studio") +
                        ". The launcher requires the project's installed Python environment.",
                        "Rescue Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Rescue Studio could not start",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
