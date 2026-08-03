"use strict";

(function initLibraryMaintenance() {
  const group = document.getElementById("torrentImportGroup");
  const mode = document.getElementById("maintenanceMode");
  const existingFields = document.getElementById("maintenanceExistingFields");
  const newFields = document.getElementById("maintenanceNewFields");
  const showSelect = document.getElementById("maintenanceShow");
  const categorySelect = document.getElementById("maintenanceCategory");
  const newTitle = document.getElementById("maintenanceNewTitle");
  const newFile = document.getElementById("maintenanceNewFile");
  const newCategory = document.getElementById("maintenanceNewCategory");
  const newImage = document.getElementById("maintenanceNewImage");
  const replaceExisting = document.getElementById("torrentReplaceExisting");
  const addMissing = document.getElementById("torrentAddMissing");
  const query = document.getElementById("torrentQuery");
  const search = document.getElementById("torrentSearchBtn");
  const results = document.getElementById("torrentResults");
  const selection = document.getElementById("torrentSelection");
  const destination = document.getElementById("torrentDestination");
  const start = document.getElementById("torrentStartBtn");
  const cancel = document.getElementById("torrentCancelBtn");
  const progress = document.getElementById("torrentProgress");
  const progressText = document.getElementById("torrentProgressText");
  const progressBar = document.getElementById("torrentProgressBar");
  const log = document.getElementById("torrentLog");
  const manifestStatus = document.getElementById("torrentManifestStatus");
  if (!group || !mode || !showSelect || !categorySelect || !query || !search || !results || !selection) return;

  // The legacy Animepahe controls live in a side panel that may be hidden when
  // its optional backend is unavailable. Maintenance is independent of it.
  const sidePanel = document.querySelector(".side-panel");
  const mainContainer = document.querySelector(".creator-layout > .container");
  if (sidePanel?.contains(group) && mainContainer) mainContainer.insertBefore(group, mainContainer.firstChild);

  const SERVICE = window.CREATOR_MAINTENANCE_SERVICE || "http://127.0.0.1:41723";
  let library = [];
  let selected = null;
  let jobId = null;
  let pollTimer = null;
  let pollInFlight = false;
  let seenEventCount = 0;

  function appendLog(line) {
    if (!log) return;
    log.textContent = `${log.textContent ? `${log.textContent}\n` : ""}${line}`;
    log.scrollTop = log.scrollHeight;
  }

  async function request(path, options) {
    const response = await fetch(`${SERVICE}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function currentSource() {
    return library.find((source) => source.file === showSelect.value) || null;
  }

  function titleToFolder(title, category) {
    const cleanTitle = String(title || "Show").trim() || "Show";
    const cleanCategory = String(category || "Season 1").trim() || "Season 1";
    return `${cleanTitle}/${cleanCategory.replace(/\s+/g, " ")}`;
  }

  function refreshCategories() {
    const source = currentSource();
    const previous = categorySelect.value;
    categorySelect.innerHTML = "";
    for (const category of source?.categories || []) {
      const option = document.createElement("option");
      option.value = category.category;
      option.textContent = `${category.category} (${category.episodeCount}${category.latestEpisode ? `, latest ${category.latestEpisode}` : ""})`;
      categorySelect.appendChild(option);
    }
    if (source?.categories?.length) {
      categorySelect.value = source.categories.some((category) => category.category === previous)
        ? previous
        : source.categories[source.categories.length - 1].category;
    }
  }

  function updateExistingDefaults(force = false) {
    const source = currentSource();
    if (!source || mode.value !== "update") return;
    const category = categorySelect.value || source.categories?.[source.categories.length - 1]?.category || "Season 1";
    if (force || !query.value.trim()) query.value = source.title;
    if (force || !destination.value.trim()) destination.value = titleToFolder(source.title, category);
  }

  function refreshShowOptions() {
    const previous = showSelect.value;
    showSelect.innerHTML = "";
    for (const source of library) {
      const option = document.createElement("option");
      option.value = source.file;
      option.textContent = `${source.title}${source.hidden ? " (hidden)" : ""}`;
      showSelect.appendChild(option);
    }
    if (library.length) showSelect.value = library.some((source) => source.file === previous) ? previous : library[0].file;
    refreshCategories();
    updateExistingDefaults(!previous && Boolean(library.length));
  }

  async function loadLibrary() {
    try {
      const data = await request("/api/library");
      library = Array.isArray(data.sources) ? data.sources : [];
      refreshShowOptions();
      if (data.errors?.length) appendLog(`Skipped ${data.errors.length} unreadable source file(s).`);
    } catch (error) {
      appendLog(`Library scan failed: ${error.message}`);
    }
  }

  function setMode() {
    const isNew = mode.value === "new";
    existingFields.style.display = isNew ? "none" : "";
    newFields.style.display = isNew ? "" : "none";
    if (isNew) {
      query.value = newTitle.value.trim();
      destination.value = titleToFolder(newTitle.value, newCategory.value);
      newTitle.dataset.previousTitle = newTitle.value;
    } else {
      updateExistingDefaults(true);
    }
  }

  function renderSearch(items) {
    results.innerHTML = "";
    for (const item of Array.isArray(items) ? items : []) {
      const row = document.createElement("div");
      row.className = "pahe-result-item";
      const label = document.createElement("div");
      label.textContent = item.title;
      label.style.flex = "1";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Select";
      button.addEventListener("click", () => {
        selected = item;
        selection.style.display = "";
        appendLog(`Selected: ${item.title}`);
      });
      row.append(label, button);
      results.appendChild(row);
    }
    if (!results.children.length) results.textContent = "No Nyaa results.";
  }

  function setBusy(busy) {
    search.disabled = busy;
    start.disabled = busy;
    mode.disabled = busy;
    showSelect.disabled = busy;
    categorySelect.disabled = busy;
    cancel.style.display = busy ? "" : "none";
  }

  function maintenancePayload() {
    if (mode.value === "new") {
      const title = newTitle.value.trim();
      if (!title) throw new Error("enter a title for the new show");
      return {
        action: "new",
        title,
        fileName: newFile.value.trim(),
        categoryName: newCategory.value.trim() || "Season 1",
        image: newImage.value.trim(),
      };
    }
    const source = currentSource();
    if (!source) throw new Error("select an existing show");
    if (!categorySelect.value) throw new Error("select a category");
    return {
      action: "update",
      sourcePath: source.path,
      categoryName: categorySelect.value,
      replaceExisting: replaceExisting.checked,
      addMissing: addMissing.checked,
      seasonNumber: Number((categorySelect.value.match(/\b(?:Season|S)\s*(\d+)/i) || [])[1]) || undefined,
    };
  }

  function handleJobEvents(job) {
    const events = Array.isArray(job.events) ? job.events : [];
    for (const event of events.slice(seenEventCount)) {
      const message = event.message || event.phase || event.event;
      if (message) progressText.textContent = message;
      if (event.event === "progress" && event.totalBytes) progressBar.value = Math.min(1, event.transferredBytes / event.totalBytes);
      if (event.event === "link" && event.url) appendLog(`${event.remotePath || "file"} → ${event.url}`);
    }
    seenEventCount = events.length;
  }

  async function poll() {
    if (!jobId || pollInFlight) return;
    pollInFlight = true;
    try {
      const job = await request(`/api/maintenance/jobs/${encodeURIComponent(jobId)}`);
      handleJobEvents(job);
      if (job.state === "complete") {
        clearInterval(pollTimer);
        setBusy(false);
        const manifest = job.manifest;
        if (manifest) {
          const summary = `Updated ${manifest.title}: +${manifest.added || 0} added, ${manifest.replaced || 0} replaced${manifest.skipped ? `, ${manifest.skipped} skipped` : ""}.`;
          appendLog(summary);
          manifestStatus.textContent = `${summary} Wrote ${manifest.path}. Commit and push the source JSON to publish it.`;
        } else {
          appendLog(`Uploaded ${job.links?.length || 0} ordered links.`);
        }
        await loadLibrary();
      } else if (job.state === "failed" || job.state === "cancelled") {
        clearInterval(pollTimer);
        setBusy(false);
        appendLog(`Job ${job.state} (exit ${job.exitCode ?? "?"}).`);
      }
    } catch (error) {
      appendLog(`Status check failed: ${error.message}`);
    } finally {
      pollInFlight = false;
    }
  }

  mode.addEventListener("change", setMode);
  showSelect.addEventListener("change", () => { refreshCategories(); updateExistingDefaults(true); });
  categorySelect.addEventListener("change", () => updateExistingDefaults(true));
  newTitle.addEventListener("input", () => {
    if (mode.value !== "new") return;
    if (!query.value.trim() || query.value === newTitle.dataset.previousTitle) query.value = newTitle.value;
    if (!destination.value.trim()) destination.value = titleToFolder(newTitle.value, newCategory.value);
    newTitle.dataset.previousTitle = newTitle.value;
  });

  search.addEventListener("click", async () => {
    try {
      const value = query.value.trim();
      if (!value) throw new Error("enter a show or release search term");
      results.textContent = "Searching Nyaa…";
      renderSearch((await request(`/api/nyaa/search?q=${encodeURIComponent(value)}`)).items);
    } catch (error) { results.textContent = `Search failed: ${error.message}`; }
  });

  start.addEventListener("click", async () => {
    if (!selected) { appendLog("Select a Nyaa release first."); return; }
    try {
      const maintenance = maintenancePayload();
      const folder = destination.value.trim() || titleToFolder(mode.value === "new" ? newTitle.value : currentSource()?.title, mode.value === "new" ? newCategory.value : categorySelect.value);
      if (!folder) throw new Error("enter a Toodrive destination folder");
      setBusy(true);
      progress.style.display = "";
      progressBar.value = 0;
      manifestStatus.textContent = "";
      log.textContent = "";
      seenEventCount = 0;
      const job = await request("/api/maintenance/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ torrentUrl: selected.torrentUrl, magnet: selected.magnet, destination: folder, maintenance }),
      });
      jobId = job.id;
      appendLog(`Started ${maintenance.action} job ${job.id}`);
      pollTimer = setInterval(() => { void poll(); }, 2000);
      await poll();
    } catch (error) {
      setBusy(false);
      appendLog(`Start failed: ${error.message}`);
    }
  });

  cancel.addEventListener("click", async () => {
    if (jobId) await request(`/api/maintenance/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => {});
    clearInterval(pollTimer);
    setBusy(false);
    appendLog("Cancelled.");
  });

  refreshShowOptions();
  setMode();
  void loadLibrary();
})();

