"use strict";

(function initTorrentImport() {
  const query = document.getElementById("torrentQuery");
  const search = document.getElementById("torrentSearchBtn");
  const results = document.getElementById("torrentResults");
  const selection = document.getElementById("torrentSelection");
  const destination = document.getElementById("torrentDestination");
  const target = document.getElementById("torrentTargetCategory");
  const newCategory = document.getElementById("torrentNewCategory");
  const start = document.getElementById("torrentStartBtn");
  const cancel = document.getElementById("torrentCancelBtn");
  const progress = document.getElementById("torrentProgress");
  const progressText = document.getElementById("torrentProgressText");
  const progressBar = document.getElementById("torrentProgressBar");
  const log = document.getElementById("torrentLog");
  if (!query || !search || !results || !selection) return;

  // The legacy Animepahe controls live in a side panel that is hidden when its
  // optional backend is unavailable. Keep torrent import usable independently
  // by moving this group into Creator's main container at startup.
  const sidePanel = document.querySelector(".side-panel");
  const mainContainer = document.querySelector(".creator-layout > .container");
  const torrentGroup = document.getElementById("torrentImportGroup");
  if (sidePanel?.contains(torrentGroup) && mainContainer) {
    mainContainer.insertBefore(torrentGroup, mainContainer.firstChild);
  }

  const SERVICE = "http://127.0.0.1:41723";
  let selected = null;
  let jobId = null;
  let pollTimer = null;
  let seenEventCount = 0;

  function appendLog(line) {
    if (!log) return;
    log.textContent = `${log.textContent ? `${log.textContent}\n` : ""}${line}`;
    log.scrollTop = log.scrollHeight;
  }

  function refreshTargets() {
    if (!target) return;
    const previous = target.value;
    target.innerHTML = "";
    const categories = document.querySelectorAll("#categories > .category");
    categories.forEach((category, index) => {
      const title = category.querySelector(".category-header input[type=text]")?.value || `Category ${index + 1}`;
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = title;
      target.appendChild(option);
    });
    const create = document.createElement("option");
    create.value = "new";
    create.textContent = "Create new category";
    target.appendChild(create);
    target.value = categories.length && previous !== "new" ? previous : (categories.length ? String(categories.length - 1) : "new");
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
        refreshTargets();
      });
      row.append(label, button);
      results.appendChild(row);
    }
    if (!results.children.length) results.textContent = "No Nyaa results.";
  }

  async function request(path, options) {
    const response = await fetch(`${SERVICE}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function setBusy(busy) {
    search.disabled = busy;
    start.disabled = busy;
    cancel.style.display = busy ? "" : "none";
  }

  function importLinks(links) {
    const episodes = links.map((src, index) => ({ title: `Episode ${String(index + 1).padStart(2, "0")}`, src }));
    let category;
    if (target.value === "new" || !document.querySelectorAll("#categories > .category")[Number(target.value)]) {
      if (typeof window.addCategory !== "function") throw new Error("Creator category builder unavailable");
      window.addCategory({ category: newCategory?.value.trim() || "Season 1", episodes });
      return;
    }
    category = document.querySelectorAll("#categories > .category")[Number(target.value)];
    const rows = category.querySelectorAll(".episode");
    if (rows.length < episodes.length) throw new Error("Target category has fewer episode rows than the torrent result; choose Create new category.");
    episodes.forEach((episode, index) => {
      const input = rows[index]._srcInput || rows[index].querySelector("input");
      if (!input) throw new Error(`Could not find source field for episode ${index + 1}`);
      input.value = episode.src;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function poll() {
    if (!jobId) return;
    const job = await request(`/api/torrent/jobs/${encodeURIComponent(jobId)}`);
    const events = Array.isArray(job.events) ? job.events : [];
    for (const event of events.slice(seenEventCount)) {
      const message = event.message || event.phase || event.event;
      if (message) progressText.textContent = message;
      if (event.event === "progress" && event.totalBytes) progressBar.value = Math.min(1, event.transferredBytes / event.totalBytes);
      if (event.event === "link" && event.url) appendLog(event.url);
    }
    seenEventCount = events.length;
    const latest = events.slice(-1)[0];
    if (latest) {
      const message = latest.message || latest.phase || latest.event;
      if (message) progressText.textContent = message;
      if (latest.event === "progress" && latest.totalBytes) progressBar.value = Math.min(1, latest.transferredBytes / latest.totalBytes);
    }
    if (job.state === "complete") {
      clearInterval(pollTimer);
      setBusy(false);
      importLinks(job.links);
      appendLog(`Imported ${job.links.length} ordered links into Creator.`);
      return;
    }
    if (job.state === "failed" || job.state === "cancelled") {
      clearInterval(pollTimer);
      setBusy(false);
      throw new Error(`Torrent job ${job.state} (exit ${job.exitCode ?? "?"})`);
    }
  }

  search.addEventListener("click", async () => {
    try {
      const data = await request(`/api/nyaa/search?q=${encodeURIComponent(query.value.trim())}`);
      renderSearch(data.items);
    } catch (error) { results.textContent = `Search failed: ${error.message}`; }
  });

  start.addEventListener("click", async () => {
    if (!selected) return;
    try {
      setBusy(true);
      progress.style.display = "";
      progressBar.value = 0;
      log.textContent = "";
      seenEventCount = 0;
      const job = await request("/api/torrent/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ torrentUrl: selected.torrentUrl, magnet: selected.magnet, destination: destination.value.trim() })
      });
      jobId = job.id;
      appendLog(`Started job ${job.id}`);
      pollTimer = setInterval(() => poll().catch((error) => appendLog(error.message)), 2000);
      await poll();
    } catch (error) {
      setBusy(false);
      appendLog(`Start failed: ${error.message}`);
    }
  });

  cancel.addEventListener("click", async () => {
    if (jobId) await request(`/api/torrent/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => {});
    clearInterval(pollTimer);
    setBusy(false);
    appendLog("Cancelled.");
  });

  new MutationObserver(refreshTargets).observe(document.getElementById("categories"), { childList: true });
  refreshTargets();
})();
