// core/pythonRunner.js
const path = require("path");
const { spawn } = require("child_process");

// In dev, you can set env AICLIPPER_PYTHON to a system Python.
// In production, you bundle python-runtime/python.exe here:

function runPython(relativeScript, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(
      process.resourcesPath || path.join(__dirname, ".."),
      "python",
      relativeScript
    );

    const proc = spawn(global.TOOLS.python, [scriptPath, ...args], {
      cwd:
        process.resourcesPath || path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error("Python exited with code " + code + ":\n" + stderr)
        );
      }
      resolve(stdout.trim());
    });
  });
}

module.exports = { runPython };
