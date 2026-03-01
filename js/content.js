(() => {
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDate(isoDate) {
    const date = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return isoDate;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function parseDateValue(value) {
    const parsed = new Date(`${value}T00:00:00`).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function panelState(title, message) {
    return `
      <article class="empty-state panel">
        <h3>${escapeHtml(title)}</h3>
        <p class="meta-line">${escapeHtml(message)}</p>
      </article>
    `;
  }

  async function readJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to load ${path}`);
    return response.json();
  }

  function renderSiteContent(site) {
    if (!site) return;

    document.querySelectorAll("[data-site-name]").forEach((node) => {
      node.textContent = site.name || node.textContent;
    });

    document.querySelectorAll("[data-site-tagline]").forEach((node) => {
      node.textContent = site.tagline || node.textContent;
    });
  }

  function domId(value) {
    return String(value)
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "");
  }

  function resolveProjectDate(project) {
    const date = String(project?.date || "").trim();
    if (date) return date;
    const year = String(project?.year || "").trim();
    if (/^\d{4}$/.test(year)) return `${year}-01-01`;
    return "";
  }

  function getProjectMetadata(project) {
    const rawMetadata = project?.metadata;
    const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata : {};

    const tools =
      String(metadata.tools || project?.tools || "").trim() || "Substack";
    const summary = String(project?.summary || "").trim();
    const outcome =
      String(metadata.outcome || project?.outcome || "").trim() ||
      summary ||
      "Project update published on Substack.";
    const stack = String(metadata.stack || "").trim();
    const role = String(metadata.role || "").trim();

    const entries = [
      { label: "Tools", value: tools },
      { label: "Outcome", value: outcome }
    ];

    if (stack) entries.push({ label: "Stack", value: stack });
    if (role) entries.push({ label: "Role", value: role });

    return entries;
  }

  function renderProjects(projects) {
    const worksList = document.getElementById("works-list");
    if (!worksList) return;

    const searchInput = document.getElementById("projects-search");
    const topicSelect = document.getElementById("projects-topic");
    const sortSelect = document.getElementById("projects-sort");

    const writeList = (markup) => {
      worksList.innerHTML = markup;
      wireSectionToggles();
      scheduleClamp();
    };

    const disableControls = () => {
      [searchInput, topicSelect, sortSelect].forEach((node) => {
        if (node) node.disabled = true;
      });
    };

    const sectionHtml = (projectId, key, label, value) => {
      const bodyId = `project-${domId(projectId)}-${key}`;
      const text = String(value || "").trim() || "Not provided.";
      return `
        <article class="detail-block project-section" data-project-section="${escapeHtml(key)}">
          <h3>${escapeHtml(label)}</h3>
          <p class="project-section-body" id="${escapeHtml(bodyId)}">${escapeHtml(text)}</p>
          <button
            class="project-section-toggle"
            type="button"
            hidden
            aria-expanded="false"
            aria-controls="${escapeHtml(bodyId)}"
            data-section-label="${escapeHtml(label)}"
          >
            Read more
          </button>
        </article>
      `;
    };

    const cardHtml = (project) => {
      const dateIso = resolveProjectDate(project);
      const summary =
        String(project.summary || "").trim() ||
        "Project notes published on Substack.";

      const links = Array.isArray(project.links) ? project.links : [];
      const linksHtml =
        links.length === 0
          ? ""
          : `
            <div class="detail-links">
              ${links
                .map(
                  (link) =>
                    `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`
                )
                .join("")}
            </div>
          `;

      return `
        <section class="work-detail panel project-card" id="work-${escapeHtml(project.id)}">
          <header class="work-title-row project-card-header">
            <h2>${escapeHtml(project.title)}</h2>
            ${dateIso ? `<span class="meta">${escapeHtml(formatDate(dateIso))}</span>` : ""}
          </header>
          <p class="project-summary">${escapeHtml(summary)}</p>
          <div class="tag-list">
            ${(project.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <div class="detail-grid project-detail-grid">
            ${sectionHtml(project.id, "problem", "Problem", project.problem)}
            ${sectionHtml(project.id, "approach", "Approach", project.approach)}
            ${sectionHtml(project.id, "output", "Output", project.output)}
          </div>
          ${linksHtml}
          <p class="back-top"><a href="#top">Back to top</a></p>
        </section>
      `;
    };

    const matchesFilters = (project, query, topic) => {
      const tags = (project.tags || []).map((tag) => String(tag).trim()).filter(Boolean);
      const tagsLower = tags.map((tag) => tag.toLowerCase());
      if (topic && !tagsLower.includes(topic.toLowerCase())) return false;
      if (!query) return true;

      const metadata = getProjectMetadata(project);
      const haystack = [
        project.title || "",
        project.summary || "",
        project.problem || "",
        project.approach || "",
        project.output || "",
        ...tags,
        ...metadata.map((entry) => entry.value)
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    };

    const sortProjects = (items, mode) => {
      const sorted = items.slice();
      sorted.sort((a, b) => {
        const aDate = parseDateValue(resolveProjectDate(a));
        const bDate = parseDateValue(resolveProjectDate(b));
        return mode === "oldest" ? aDate - bDate : bDate - aDate;
      });
      return sorted;
    };

    const wireSectionToggles = () => {
      worksList.querySelectorAll(".project-section").forEach((section) => {
        const body = section.querySelector(".project-section-body");
        const button = section.querySelector(".project-section-toggle");
        if (!body || !button) return;

        body.classList.remove("is-expanded");
        button.hidden = true;
        button.textContent = "Read more";
        button.setAttribute("aria-expanded", "false");

        const hasOverflow = body.scrollHeight > body.clientHeight + 2;
        if (!hasOverflow) return;

        button.hidden = false;
        button.addEventListener("click", () => {
          const expanded = body.classList.toggle("is-expanded");
          button.textContent = expanded ? "Show less" : "Read more";
          button.setAttribute("aria-expanded", expanded ? "true" : "false");
        });
      });
    };

    let clampRaf = null;
    const visibleCards = 2;

    const applyClamp = () => {
      worksList.classList.remove("listing--scroll-clamp");
      worksList.style.maxHeight = "";
      worksList.style.overflowY = "";
      worksList.removeAttribute("tabindex");

      const cards = Array.from(worksList.querySelectorAll(".work-detail"));
      if (cards.length <= visibleCards) return;

      const styles = window.getComputedStyle(worksList);
      const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
      let maxHeight = 0;

      cards.slice(0, visibleCards).forEach((card, index) => {
        maxHeight += card.getBoundingClientRect().height;
        if (index > 0) maxHeight += gap;
      });

      if (maxHeight > 0) {
        worksList.classList.add("listing--scroll-clamp");
        worksList.style.maxHeight = `${Math.ceil(maxHeight)}px`;
        worksList.style.overflowY = "auto";
        worksList.setAttribute("tabindex", "0");
      }
    };

    const scheduleClamp = () => {
      if (clampRaf !== null) window.cancelAnimationFrame(clampRaf);
      clampRaf = window.requestAnimationFrame(() => {
        clampRaf = null;
        applyClamp();
      });
    };

    window.addEventListener("resize", scheduleClamp, { passive: true });

    if (!Array.isArray(projects)) {
      writeList(panelState("Projects unavailable", "Project entries could not be loaded."));
      disableControls();
      return;
    }

    const allProjects = projects.slice();
    const topics = Array.from(
      new Set(
        allProjects
          .flatMap((entry) => entry.tags || [])
          .map((tag) => String(tag).trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    if (topicSelect) {
      topicSelect.innerHTML =
        '<option value="">All topics</option>' +
        topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join("");
    }

    const renderFiltered = () => {
      const query = (searchInput?.value || "").trim().toLowerCase();
      const topic = topicSelect?.value || "";
      const sortMode = sortSelect?.value || "newest";

      const filtered = sortProjects(
        allProjects.filter((entry) => matchesFilters(entry, query, topic)),
        sortMode
      );

      if (filtered.length === 0) {
        writeList(panelState("No projects match.", "Try a different search or clear the topic filter."));
        return;
      }

      writeList(filtered.map((entry) => cardHtml(entry)).join(""));
    };

    [searchInput, topicSelect, sortSelect].forEach((node) => {
      if (!node) return;
      const eventName = node.tagName.toLowerCase() === "input" ? "input" : "change";
      node.addEventListener(eventName, renderFiltered);
    });

    if (allProjects.length === 0) {
      writeList(panelState("No projects yet.", "New project entries will appear here soon."));
      return;
    }

    renderFiltered();
  }

  function renderWritings(writings) {
    const essaysEl = document.getElementById("writings-essays");
    const blogsEl = document.getElementById("writings-notes");
    if (!essaysEl || !blogsEl) return;

    const searchInput = document.getElementById("writings-search");
    const topicSelect = document.getElementById("writings-topic");
    const sortSelect = document.getElementById("writings-sort");

    const writeColumns = (essaysMarkup, blogsMarkup) => {
      essaysEl.innerHTML = essaysMarkup;
      blogsEl.innerHTML = blogsMarkup;
      scheduleClamp();
    };

    const visibleCards = 3;
    let clampRaf = null;

    const clampColumn = (listEl) => {
      listEl.classList.remove("listing--scroll-clamp");
      listEl.style.maxHeight = "";
      listEl.style.overflowY = "";
      listEl.removeAttribute("tabindex");

      const cards = Array.from(listEl.querySelectorAll(".writing-row"));
      if (cards.length <= visibleCards) return;

      const styles = window.getComputedStyle(listEl);
      const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
      let maxHeight = 0;

      cards.slice(0, visibleCards).forEach((card, index) => {
        maxHeight += card.getBoundingClientRect().height;
        if (index > 0) maxHeight += gap;
      });

      if (maxHeight > 0) {
        listEl.classList.add("listing--scroll-clamp");
        listEl.style.maxHeight = `${Math.ceil(maxHeight)}px`;
        listEl.style.overflowY = "auto";
        listEl.setAttribute("tabindex", "0");
      }
    };

    const applyScrollClamp = () => {
      clampColumn(essaysEl);
      clampColumn(blogsEl);
    };

    const scheduleClamp = () => {
      if (clampRaf !== null) window.cancelAnimationFrame(clampRaf);
      clampRaf = window.requestAnimationFrame(() => {
        clampRaf = null;
        applyScrollClamp();
      });
    };

    window.addEventListener("resize", scheduleClamp, { passive: true });

    const disableControls = () => {
      [searchInput, topicSelect, sortSelect].forEach((node) => {
        if (node) node.disabled = true;
      });
    };

    if (!Array.isArray(writings)) {
      writeColumns(
        panelState("Essays unavailable", "Writings data could not be loaded."),
        panelState("Notes unavailable", "Writings data could not be loaded.")
      );
      disableControls();
      return;
    }

    const allEntries = writings.slice();
    const topics = Array.from(
      new Set(
        allEntries
          .flatMap((entry) => entry.tags || [])
          .map((tag) => String(tag).trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    if (topicSelect) {
      topicSelect.innerHTML =
        '<option value="">All topics</option>' +
        topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join("");
    }

    const cardHtml = (entry, linkLabel) => `
      <article class="writing-row panel">
        <div class="row-main">
          <div class="row-title-line">
            <h3>${escapeHtml(entry.title)}</h3>
            <span class="meta">${escapeHtml(formatDate(entry.date))}</span>
          </div>
          <div class="tag-list">
            ${(entry.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <p>${escapeHtml(entry.abstract)}</p>
          <a href="${escapeHtml(entry.href)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(linkLabel)}
            <svg class="external-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 3h7v7"/>
              <path d="M4 12 13 3"/>
              <path d="M13 9v4H3V3h4"/>
            </svg>
          </a>
        </div>
      </article>
    `;

    const matchesFilters = (entry, query, topic) => {
      const normalizedTags = (entry.tags || []).map((tag) => String(tag).toLowerCase());
      if (topic && !normalizedTags.includes(topic.toLowerCase())) return false;

      if (!query) return true;

      const haystack = [entry.title || "", entry.abstract || "", ...(entry.tags || [])]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    };

    const sortEntries = (entries, mode) => {
      const sorted = entries.slice();
      sorted.sort((a, b) => {
        const aDate = parseDateValue(a.date);
        const bDate = parseDateValue(b.date);
        return mode === "oldest" ? aDate - bDate : bDate - aDate;
      });
      return sorted;
    };

    const renderFiltered = () => {
      const query = (searchInput?.value || "").trim().toLowerCase();
      const topic = topicSelect?.value || "";
      const sortMode = sortSelect?.value || "newest";

      const filtered = sortEntries(
        allEntries.filter((entry) => matchesFilters(entry, query, topic)),
        sortMode
      );

      const essays = filtered.filter((entry) => (entry.type || "essay") === "essay");
      const blogs = filtered.filter((entry) => entry.type === "blog");

      if (filtered.length === 0) {
        writeColumns(
          panelState("No matches found", "Try a different search or clear the topic filter."),
          panelState("No matches found", "Try a different search or clear the topic filter.")
        );
        return;
      }

      const essaysHtml =
        essays.length === 0
          ? panelState("No essays match.", "Try a different filter combination.")
          : essays.map((entry) => cardHtml(entry, "Read essay")).join("");

      const blogsHtml =
        blogs.length === 0
          ? panelState("No notes match.", "Try a different filter combination.")
          : blogs.map((entry) => cardHtml(entry, "Read note")).join("");

      writeColumns(essaysHtml, blogsHtml);
    };

    [searchInput, topicSelect, sortSelect].forEach((node) => {
      if (!node) return;
      const eventName = node.tagName.toLowerCase() === "input" ? "input" : "change";
      node.addEventListener(eventName, renderFiltered);
    });

    if (allEntries.length === 0) {
      writeColumns(
        panelState("No essays yet.", "New entries will appear here soon."),
        panelState("No notes yet.", "New entries will appear here soon.")
      );
      return;
    }

    renderFiltered();
  }

  async function hydrateContent() {
    const [site, projects, writings] = await Promise.all([
      readJson("/data/site.json").catch(() => null),
      readJson("/data/works-substack.json").catch(() => null),
      readJson("/data/writings.json").catch(() => null)
    ]);

    renderSiteContent(site);
    renderProjects(projects);
    renderWritings(writings);

    if (typeof window.initializeDinoInteractions === "function") {
      window.initializeDinoInteractions();
    }
  }

  document.addEventListener("DOMContentLoaded", hydrateContent);
})();
