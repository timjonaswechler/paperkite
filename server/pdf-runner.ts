import { spawn, execFile } from "node:child_process";
import { check } from "./files.ts";
export type PdfResult = { pages: number; note?: string };
export type PdfRunner = (input: string, output: string, name: string) => Promise<PdfResult>;
export function dockerPdfRunner(image: string): PdfRunner {
  check(/^sha256:[a-f0-9]{64}$/.test(image), "PDF-Image muss per ID gepinnt sein", 503);
  return (input, output, name) => new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/docker", [
      "run", "--rm", "--name", name, "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=48", "--memory=768m", "--cpus=1",
      "--ulimit", "fsize=188743680:188743680", "--ulimit", "cpu=100:110", "--user", `${process.getuid!()}:${process.getgid!()}`,
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777", "--mount", `type=bind,src=${input},dst=/input,readonly`, "--mount", `type=bind,src=${output},dst=/out`, image,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const append = (current: string, bytes: Buffer) => (current + bytes.toString()).slice(0, 65536);
    child.stdout.on("data", (bytes: Buffer) => { stdout = append(stdout, bytes); });
    child.stderr.on("data", (bytes: Buffer) => { stderr = append(stderr, bytes); });
    const timer = setTimeout(() => {
      timedOut = true;
      execFile("/usr/bin/docker", ["rm", "-f", name], () => {});
      child.kill("SIGTERM");
    }, 120000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("PDF-Aufbereitung: Zeitlimit überschritten"));
      if (code !== 0) return reject(new Error(stderr.trim().slice(-2000) || "PDF-Aufbereitung fehlgeschlagen"));
      try {
        const result = JSON.parse(stdout.trim());
        check(Number.isSafeInteger(result.pages) && result.pages > 0 && result.pages <= 500, "Ungültiges PDF-Ergebnis");
        resolve({ pages: result.pages, ...(typeof result.note === "string" ? { note: result.note.slice(0, 1000) } : {}) });
      } catch (error) { reject(error); }
    });
  });
}
