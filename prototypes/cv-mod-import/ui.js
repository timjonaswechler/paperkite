/* Standalone prototype UI; real API in the branch, explicitly labelled demo only in html_render. */
(() => {
  const $ = (s) => document.querySelector(s),
    base = "/bewerbung/api/prototype/cv-mods",
    preview = JSON.parse($("#preview-config").textContent).demo === true;
  const labels = {
    uploaded: "Bereit zum Start",
    generating: "KI arbeitet",
    "needs-input": "Antwort im Thread nötig",
    checking: "Build-Prüfung",
    review: "Zur Durchsicht",
    failed: "Prüfung fehlgeschlagen",
    interrupted: "Unterbrochen",
  };
  const cases = {
    bullets: "Stichpunkte",
    paragraphs: "Fließtext & Sonderzeichen",
    mixed: "Gemischte Inhalte",
    "optional-role": "Optionale Rolle",
    empty: "Ohne Abschnitte",
  };
  let file = null,
    current = null,
    timer = null,
    busy = false;
  if (preview) {
    $("#mode").textContent = "Demo · KI und Builds simuliert";
    $(".submit-row .small").textContent =
      "Interaktive Demo · keine Modellaufrufe oder Kosten.";
    $("#settings").removeAttribute("href");
    $("#settings").textContent = "Native Einstellungen";
    $("#filehint").textContent =
      "ZIP auswählen oder den Beispielablauf ausprobieren";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "choose";
    b.textContent = "Beispiel-ZIP verwenden";
    b.onclick = (e) => {
      e.preventDefault();
      file = { name: "beispiel-cv.zip", size: 2048, demo: true };
      $("#document-type").value = "cv-template";
      updateFile();
    };
    $("#dropzone").after(b);
  }
  function error(message) {
    $("#error").textContent = message;
    $("#error").classList.toggle("hidden", !message);
  }
  function updateFile() {
    const kind = $("#document-type").value;
    $("#filename").textContent = file ? file.name : "LaTeX-Projekt auswählen";
    $("#filehint").textContent = file
      ? Math.ceil(file.size / 1024) + " KiB · ZIP-Vorlagenpaket"
      : "ZIP mit Hauptdatei und benötigten Dateien · bis 8 MiB";
    $("#kind-note").classList.toggle("hidden", kind !== "document");
    $("#start").disabled = busy || kind !== "cv-template" || !file;
  }
  function choose(next) {
    error("");
    if (
      next &&
      (!/\.zip$/i.test(next.name) ||
        next.size > 8 * 1024 * 1024 ||
        next.size === 0)
    ) {
      file = null;
      error(
        "Bitte ein LaTeX-ZIP bis 8 MiB hochladen. Eine PDF allein genügt nicht für einen Adapter.",
      );
    } else file = next;
    updateFile();
  }
  $("#document-type").onchange = updateFile;
  $("#file").onchange = (e) => choose(e.target.files[0] || null);
  $("#dropzone").ondragover = (e) => {
    e.preventDefault();
    $("#dropzone").classList.add("drag");
  };
  $("#dropzone").ondragleave = () => $("#dropzone").classList.remove("drag");
  $("#dropzone").ondrop = (e) => {
    e.preventDefault();
    $("#dropzone").classList.remove("drag");
    choose(e.dataTransfer.files[0] || null);
  };
  async function api(url, body) {
    const response = await fetch(base + url, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", "X-Bewerbung-Request": "1" }
        : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Anfrage fehlgeschlagen");
    return value;
  }
  async function base64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(new Error("ZIP konnte nicht gelesen werden"));
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(file);
    });
  }
  function phase(name, state, label) {
    const item = $("[data-phase=" + name + "]");
    item.classList.toggle("done", state === "done");
    item.classList.toggle("active", state === "active");
    item.querySelector(".phase-state").textContent = label || "";
  }
  function render(job) {
    current = job;
    $("#job-panel").classList.remove("hidden");
    $("#job-file").textContent = job.name;
    $("#job-status").textContent =
      (preview ? "Demo: " : "") + (labels[job.status] || job.status);
    $("#source-info").textContent =
      (job.files?.length || 0) +
      " Quelldateien · " +
      (job.entrypoints || []).join(", ");
    phase("upload", "done", "Geprüft");
    phase(
      "ai",
      ["generating", "needs-input"].includes(job.status)
        ? "active"
        : job.threadId || (preview && job.status !== "uploaded")
          ? "done"
          : "",
      job.status === "needs-input"
        ? "Antwort nötig"
        : job.status === "generating"
          ? "Läuft"
          : job.threadId
            ? "Erstellt"
            : "",
    );
    phase(
      "build",
      job.status === "checking" ? "active" : job.checks?.length ? "done" : "",
      job.status === "checking"
        ? "Läuft"
        : job.checks?.length
          ? job.checks.filter((c) => c.status === "passed").length +
            "/" +
            job.checks.length
          : "",
    );
    phase(
      "review",
      job.status === "review" ? "done" : "",
      job.status === "review" ? "Bereit" : "",
    );
    const link = $("#thread-link");
    link.classList.toggle("hidden", !job.threadUrl || preview);
    if (job.threadUrl) {
      const url = new URL(job.threadUrl, location.href);
      if (url.origin === location.origin) link.href = url.href;
      else link.classList.add("hidden");
    }
    $("#check").classList.toggle(
      "hidden",
      !job.threadId ||
        ["generating", "needs-input", "checking"].includes(job.status),
    );
    $("#resume").classList.toggle("hidden", job.status !== "uploaded");
    $("#job-error").textContent = job.error || "";
    $("#job-error").classList.toggle("hidden", !job.error);
    $("#results").classList.toggle(
      "hidden",
      !job.checks?.length && !job.manifest,
    );
    $("#checks").replaceChildren();
    for (const test of job.checks || []) {
      const li = document.createElement("li"),
        name = document.createElement("span"),
        state = document.createElement("span");
      name.textContent = cases[test.id] || test.id;
      state.textContent =
        test.status === "passed"
          ? "Bestanden"
          : test.status === "unsupported"
            ? "Nicht deklariert"
            : "Fehler";
      state.className =
        test.status === "passed"
          ? "pass"
          : test.status === "unsupported"
            ? "muted"
            : "fail";
      li.append(name, state);
      if (test.error) li.title = test.error;
      $("#checks").append(li);
    }
    $("#fields").replaceChildren();
    for (const field of job.manifest?.fields || []) {
      const li = document.createElement("li"),
        name = document.createElement("span"),
        required = document.createElement("span");
      name.textContent = field.label;
      required.textContent = field.required
        ? "Pflicht für diese Mod"
        : "Optional";
      required.className = "muted";
      li.append(name, required);
      $("#fields").append(li);
    }
    if (
      job.manifest?.format === "bewerbung-cv-mod-prototype-v1" &&
      !job.manifest.fields.length
    ) {
      const li = document.createElement("li");
      li.textContent = "Keine zusätzlichen Pflichtfelder";
      $("#fields").append(li);
    }
    $("#manifest").textContent = job.manifest
      ? JSON.stringify(job.manifest, null, 2)
      : "";
    $("#pdfs").replaceChildren();
    if (!preview)
      for (const test of job.checks || []) {
        if (test.status !== "passed") continue;
        const a = document.createElement("a");
        a.className = "button";
        a.textContent = "PDF: " + (cases[test.id] || test.id) + " ↗";
        a.href = base + "/jobs/" + job.id + "/pdf/" + test.id;
        a.target = "_blank";
        a.rel = "noopener";
        $("#pdfs").append(a);
      }
    if (preview && job.status === "review") {
      const note = document.createElement("p");
      note.className = "muted small";
      note.textContent = "Demo-Ergebnis · keine echte PDF oder KI-Ausführung";
      $("#pdfs").append(note);
    }
  }
  async function poll(id) {
    clearTimeout(timer);
    try {
      const job = await api("/jobs/" + id);
      if (current?.id !== id) return;
      render(job);
      if (["generating", "needs-input", "checking"].includes(job.status))
        timer = setTimeout(() => poll(id), 1500);
      else history();
    } catch (e) {
      error(e.message);
    }
  }
  async function history() {
    if (preview) return;
    try {
      const jobs = await api("/jobs");
      $("#history-panel").classList.toggle("hidden", jobs.length === 0);
      $("#history").replaceChildren();
      for (const job of jobs) {
        const li = document.createElement("li"),
          b = document.createElement("button"),
          name = document.createElement("span"),
          status = document.createElement("span");
        name.textContent = job.name;
        status.textContent = labels[job.status] || job.status;
        b.type = "button";
        b.append(name, status);
        b.onclick = () => {
          render(job);
          poll(job.id);
        };
        li.append(b);
        $("#history").append(li);
      }
    } catch (e) {
      error(e.message);
    }
  }
  function demoStart() {
    clearTimeout(timer);
    const job = {
      id: "demo",
      name: file.name,
      status: "generating",
      files: ["main.tex", "preamble.tex", "adapter.lua"],
      entrypoints: ["main.tex"],
      checks: [],
    };
    render(job);
    timer = setTimeout(() => {
      job.status = "checking";
      render(job);
      timer = setTimeout(() => {
        job.status = "review";
        job.manifest = {
          format: "bewerbung-cv-mod-prototype-v1",
          engine: "lualatex",
          entrypoint: "layout/main.tex",
          fields: [
            {
              key: "person.role",
              label: "Rolle / Berufsbezeichnung",
              type: "text",
              required: false,
            },
          ],
        };
        job.checks = Object.keys(cases).map((id) => ({ id, status: "passed" }));
        render(job);
      }, 900);
    }, 900);
  }
  $("#upload-form").onsubmit = async (e) => {
    e.preventDefault();
    if (busy || !file || $("#document-type").value !== "cv-template") return;
    error("");
    busy = true;
    updateFile();
    try {
      if (preview) {
        demoStart();
        return;
      }
      const job = await api("/jobs", {
        name: file.name,
        documentType: "cv-template",
        zipBase64: await base64(file),
      });
      render(job);
      const started = await api("/jobs/" + job.id + "/start", {});
      render(started);
      poll(job.id);
      history();
    } catch (e) {
      error(e.message);
    } finally {
      busy = false;
      updateFile();
    }
  };
  $("#resume").onclick = async () => {
    if (preview) {
      demoStart();
      return;
    }
    try {
      const job = await api("/jobs/" + current.id + "/start", {});
      render(job);
      poll(job.id);
    } catch (e) {
      error(e.message);
    }
  };
  $("#check").onclick = async () => {
    if (preview) return;
    try {
      const job = await api("/jobs/" + current.id + "/check", {});
      render(job);
      poll(job.id);
    } catch (e) {
      error(e.message);
    }
  };
  updateFile();
  history();
})();
