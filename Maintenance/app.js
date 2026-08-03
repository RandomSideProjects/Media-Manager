"use strict";

(function initMaintenanceApp() {
  const SERVICE = window.MAINTENANCE_SERVICE || "http://127.0.0.1:41723";
  const $ = (id) => document.getElementById(id);
  const state = {
    sources: [],
    updateRelease: null,
    addRelease: null,
    jobId: null,
    pollTimer: null,
    pollInFlight: false,
    seenEventCount: 0,
  };

  function appendLog(line) {
    const log = $("jobLog");
    if (!log) return;
    log.textContent = `${log.textContent ? `${log.textContent}\n` : ""}${line}`;
    log.scrollTop = log.scrollHeight;
  }

  async function request(path, options) {
    const response = await fetch(`${SERVICE}${path}`, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function setServiceState(text, error = false) {
    const element = $("serviceState");
    element.textContent = text;
    element.style.color = error ? "#ff9da5" : "";
  }

  function formatDate(value) {
    if (!value) return "No update timestamp";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
  }

  function currentUpdateSource() {
    return state.sources.find((source) => source.file === $("updateShow").value) || null;
  }

  function folderFor(title, category) {
    return `${String(title || "Show").trim() || "Show"}/${String(category || "Season 1").trim() || "Season 1"}`;
  }

  function populateUpdateCategories(preferred) {
    const source = currentUpdateSource();
    const select = $("updateCategory");
    select.innerHTML = "";
    for (const category of source?.categories || []) {
      const option = document.createElement("option");
      option.value = category.category;
      option.textContent = `${category.category} (${category.episodeCount}${category.latestEpisode ? `, latest ${category.latestEpisode}` : ""})`;
      select.appendChild(option);
    }
    if (source?.categories?.length) {
      select.value = source.categories.some((category) => category.category === preferred)
        ? preferred
        : source.categories[source.categories.length - 1].category;
    }
  }

  function selectUpdateSource(file, scroll = false) {
    const select = $("updateShow");
    if (file && state.sources.some((source) => source.file === file)) select.value = file;
    const source = currentUpdateSource();
    populateUpdateCategories($("updateCategory").value);
    const category = $("updateCategory").value || "Season 1";
    if (source) {
      $("updateQuery").value = source.title;
      $("updateDestination").value = folderFor(source.title, category);
    }
    if (scroll) $("updateHeading").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderLibrary() {
    const filter = $("libraryFilter").value.trim().toLowerCase();
    const visible = state.sources.filter((source) => !filter || `${source.title} ${source.file}`.toLowerCase().includes(filter));
    $("librarySummary").textContent = `${visible.length} of ${state.sources.length} shows`;
    const list = $("libraryList");
    list.innerHTML = "";
    for (const source of visible) {
      const row = document.createElement("div");
      row.className = "library-row";
      const details = document.createElement("div");
      const title = document.createElement("div");
      title.className = "library-title";
      title.textContent = source.title;
      const meta = document.createElement("div");
      meta.className = "library-meta";
      const categoryText = (source.categories || []).map((category) => `${category.category}: ${category.episodeCount}`).join(" · ") || "No categories";
      meta.textContent = `${categoryText} · ${formatDate(source.latestTime)}${source.hidden ? " · hidden" : ""}`;
      details.append(title, meta);
      const button = document.createElement("button");
      button.className = "button button-secondary";
      button.type = "button";
      button.textContent = "Maintain";
      button.addEventListener("click", () => selectUpdateSource(source.file, true));
      row.append(details, button);
      list.appendChild(row);
    }
    if (!list.children.length) list.textContent = "No matching shows.";
  }

  async function refreshLibrary() {
    const button = $("refreshLibraryBtn");
    button.disabled = true;
    try {
      const data = await request("/api/library");
      state.sources = Array.isArray(data.sources) ? data.sources : [];
      const previous = $("updateShow").value;
      const select = $("updateShow");
      select.innerHTML = "";
      for (const source of state.sources) {
        const option = document.createElement("option");
        option.value = source.file;
        option.textContent = `${source.title}${source.hidden ? " (hidden)" : ""}`;
        select.appendChild(option);
      }
      if (state.sources.length) select.value = state.sources.some((source) => source.file === previous) ? previous : state.sources[0].file;
      selectUpdateSource();
      renderLibrary();
      setServiceState(`${state.sources.length} shows loaded`);
      if (data.errors?.length) appendLog(`Skipped ${data.errors.length} unreadable source file(s).`);
    } catch (error) {
      setServiceState(`Service unavailable: ${error.message}`, true);
      appendLog(`Library scan failed: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  function renderResults(container, items, selectRelease) {
    container.innerHTML = "";
    for (const item of Array.isArray(items) ? items : []) {
      const row = document.createElement("div");
      row.className = "search-result";
      const title = document.createElement("div");
      title.className = "search-result-title";
      title.textContent = item.title;
      const button = document.createElement("button");
      button.className = "button button-secondary";
      button.type = "button";
      button.textContent = "Select";
      button.addEventListener("click", () => selectRelease(item));
      row.append(title, button);
      container.appendChild(row);
    }
    if (!container.children.length) container.textContent = "No Nyaa results.";
  }

  async function searchNyaa(queryInput, results, selectRelease) {
    const query = queryInput.value.trim();
    if (!query) throw new Error("enter a show or release search term");
    results.textContent = "Searching Nyaa…";
    const data = await request(`/api/nyaa/search?q=${encodeURIComponent(query)}`);
    renderResults(results, data.items, selectRelease);
  }

  function selectUpdateRelease(release) {
    state.updateRelease = release;
    $("updateSelectedTitle").textContent = release.title;
    $("updateSelection").hidden = false;
    appendLog(`Selected update release: ${release.title}`);
  }

  function selectAddRelease(release) {
    state.addRelease = release;
    $("addSelectedTitle").textContent = release.title;
    $("addSelection").hidden = false;
    appendLog(`Selected new-show release: ${release.title}`);
  }

  function setJobBusy(busy) {
    document.querySelectorAll(".maintenance-pane button, .maintenance-pane input, .maintenance-pane select").forEach((element) => {
      if (element.id !== "cancelJobBtn") element.disabled = busy;
    });
    $("cancelJobBtn").hidden = !busy;
  }

  function updatePayload() {
    const source = currentUpdateSource();
    if (!source) throw new Error("select an existing show");
    if (!$("updateCategory").value) throw new Error("select a category");
    return {
      action: "update",
      sourcePath: source.path,
      categoryName: $("updateCategory").value,
      replaceExisting: $("updateReplace").checked,
      addMissing: $("updateAdd").checked,
      seasonNumber: Number((($("updateCategory").value || "").match(/\b(?:Season|S)\s*(\d+)/i) || [])[1]) || undefined,
    };
  }

  function addPayload() {
    const title = $("addTitle").value.trim();
    if (!title) throw new Error("enter a title for the new show");
    return {
      action: "new",
      title,
      fileName: $("addFile").value.trim(),
      categoryName: $("addCategory").value.trim() || "Season 1",
      image: $("addImage").value.trim(),
    };
  }

  function handleEvents(job) {
    const events = Array.isArray(job.events) ? job.events : [];
    for (const event of events.slice(state.seenEventCount)) {
      const message = event.message || event.phase || event.event;
      if (message) $("jobProgressText").textContent = message;
      if (event.event === "progress" && event.totalBytes) $("jobProgress").value = Math.min(1, event.transferredBytes / event.totalBytes);
      if (event.event === "link" && event.url) appendLog(`${event.remotePath || "file"} → ${event.url}`);
    }
    state.seenEventCount = events.length;
  }

  async function pollJob() {
    if (!state.jobId || state.pollInFlight) return;
    state.pollInFlight = true;
    try {
      const job = await request(`/api/maintenance/jobs/${encodeURIComponent(state.jobId)}`);
      handleEvents(job);
      if (job.state === "complete") {
        clearInterval(state.pollTimer);
        setJobBusy(false);
        const manifest = job.manifest;
        $("jobProgressText").textContent = "Completed.";
        if (manifest) {
          const summary = `${manifest.title}: ${manifest.added || 0} added, ${manifest.replaced || 0} replaced${manifest.skipped ? `, ${manifest.skipped} skipped` : ""}.`;
          $("jobResult").textContent = `${summary} Wrote ${manifest.path}. Commit and push that JSON to publish it.`;
          appendLog(summary);
        } else {
          $("jobResult").textContent = `Uploaded ${job.links?.length || 0} ordered links.`;
        }
        await refreshLibrary();
      } else if (job.state === "failed" || job.state === "cancelled") {
        clearInterval(state.pollTimer);
        setJobBusy(false);
        $("jobProgressText").textContent = `Job ${job.state}.`;
        $("jobResult").textContent = job.events?.at(-1)?.message || `Exit code: ${job.exitCode ?? "?"}`;
      }
    } catch (error) {
      appendLog(`Status check failed: ${error.message}`);
    } finally {
      state.pollInFlight = false;
    }
  }

  async function startJob(kind) {
    const release = kind === "update" ? state.updateRelease : state.addRelease;
    if (!release) throw new Error("select a Nyaa release first");
    const maintenance = kind === "update" ? updatePayload() : addPayload();
    const title = kind === "update" ? currentUpdateSource()?.title : $("addTitle").value.trim();
    const category = kind === "update" ? $("updateCategory").value : $("addCategory").value.trim();
    const destination = $(kind === "update" ? "updateDestination" : "addDestination").value.trim() || folderFor(title, category);
    setJobBusy(true);
    $("jobProgress").value = 0;
    $("jobProgressText").textContent = "Starting…";
    $("jobResult").textContent = "";
    $("jobLog").textContent = "";
    state.seenEventCount = 0;
    const job = await request("/api/maintenance/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ torrentUrl: release.torrentUrl, magnet: release.magnet, destination, maintenance }),
    });
    state.jobId = job.id;
    appendLog(`Started ${kind} job ${job.id}`);
    state.pollTimer = setInterval(() => { void pollJob(); }, 2000);
    await pollJob();
  }

  function setTab(active) {
    const add = active === "add";
    $("maintenancePane").hidden = add;
    $("addPane").hidden = !add;
    $("maintenanceTab").classList.toggle("is-active", !add);
    $("addTab").classList.toggle("is-active", add);
    $("maintenanceTab").setAttribute("aria-selected", String(!add));
    $("addTab").setAttribute("aria-selected", String(add));
  }

  $("maintenanceTab").addEventListener("click", () => setTab("maintenance"));
  $("addTab").addEventListener("click", () => setTab("add"));
  $("refreshLibraryBtn").addEventListener("click", () => { void refreshLibrary(); });
  $("libraryFilter").addEventListener("input", renderLibrary);
  $("updateShow").addEventListener("change", () => selectUpdateSource());
  $("updateCategory").addEventListener("change", () => {
    const source = currentUpdateSource();
    if (source) $("updateDestination").value = folderFor(source.title, $("updateCategory").value);
  });
  $("updateSearchBtn").addEventListener("click", () => searchNyaa($("updateQuery"), $("updateResults"), selectUpdateRelease).catch((error) => { $("updateResults").textContent = `Search failed: ${error.message}`; }));
  $("addSearchBtn").addEventListener("click", () => searchNyaa($("addQuery"), $("addResults"), selectAddRelease).catch((error) => { $("addResults").textContent = `Search failed: ${error.message}`; }));
  $("addTitle").addEventListener("input", () => {
    if (!$("addQuery").value.trim() || $("addQuery").value === $("addTitle").dataset.previousTitle) $("addQuery").value = $("addTitle").value;
    if (!$("addDestination").value.trim()) $("addDestination").value = folderFor($("addTitle").value, $("addCategory").value);
    $("addTitle").dataset.previousTitle = $("addTitle").value;
  });
  $("updateStartBtn").addEventListener("click", () => startJob("update").catch((error) => { setJobBusy(false); appendLog(`Start failed: ${error.message}`); }));
  $("addStartBtn").addEventListener("click", () => startJob("new").catch((error) => { setJobBusy(false); appendLog(`Start failed: ${error.message}`); }));
  $("cancelJobBtn").addEventListener("click", async () => {
    if (state.jobId) await request(`/api/maintenance/jobs/${encodeURIComponent(state.jobId)}`, { method: "DELETE" }).catch(() => {});
    clearInterval(state.pollTimer);
    setJobBusy(false);
    $("jobProgressText").textContent = "Cancelled.";
    appendLog("Cancelled.");
  });

  setTab("maintenance");
  void refreshLibrary();
})();
