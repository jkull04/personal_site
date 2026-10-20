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

  function externalIconSvg() {
    return `
      <svg class="external-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 3h7v7"/>
        <path d="M4 12 13 3"/>
        <path d="M13 9v4H3V3h4"/>
      </svg>
    `;
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

    for (const field of ["intro", "interests"]) {
      document.querySelectorAll(`[data-site-${field}]`).forEach((node) => {
        node.textContent = site[field] || node.textContent;
      });
    }
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
    const list=document.getElementById('works-list');if(!list)return;
    const search=document.getElementById('projects-search'),topic=document.getElementById('projects-topic'),sort=document.getElementById('projects-sort');
    if(!Array.isArray(projects)){list.innerHTML=panelState('Projects unavailable','Please refresh to try again.');return;}
    const topics=[...new Set(projects.flatMap(p=>p.tags||[]))].sort();
    if(topic)topic.innerHTML='<option value="">All topics</option>'+topics.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    let limit=6;
    const card=project=>{
      const links=(project.links||[]).filter(l=>ShowcaseData.linkURL(l.href));
      const primary=project.demoUrl || links[0]?.href;
      const remaining=project.demoUrl?links:links.slice(1);
      const image=ShowcaseData.imageURL(project.imageSrc);
      return `<article class="work-detail panel project-card" id="work-${escapeHtml(project.id)}">
        <div class="project-card-layout"><figure class="project-visual ${!image||image.includes('/illustrations/')?'is-art':''}"><img src="${escapeHtml(image||'/assets/illustrations/runtime/hero-projects-forum-960.webp')}" alt="${escapeHtml(project.imageAlt||'')}" width="960" height="540" loading="lazy" decoding="async"></figure>
        <div class="project-card-copy"><header class="work-title-row project-card-header"><h2>${escapeHtml(project.title)}</h2>${resolveProjectDate(project)?`<span class="meta">${escapeHtml(formatDate(resolveProjectDate(project)))}</span>`:''}</header>
        <p class="project-summary">${escapeHtml(project.summary||project.output||'')}</p><div class="tag-list">${(project.tags||[]).filter(t=>t!=='Projects').map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="project-actions">${primary?`<a class="action-link primary-project-link" href="${escapeHtml(primary)}">${project.demoUrl?'Try it':'Read about it'} <span aria-hidden="true">↗</span></a>`:''}${remaining.map(l=>`<a href="${escapeHtml(ShowcaseData.linkURL(l.href))}">${escapeHtml(l.label||'Read about it')} ↗</a>`).join('')}</div>
        <p class="meta-line substack-source">${project.source==='studio'?'Published here':'Published on Substack'}</p></div></div>
        <details class="project-explanation"><summary>Behind the project</summary><div class="detail-grid project-detail-grid">${['problem','approach','output'].filter(k=>project[k]).map(k=>`<section class="detail-block project-section"><h3>${k[0].toUpperCase()+k.slice(1)}</h3><p class="project-section-body">${escapeHtml(project[k])}</p></section>`).join('')}</div></details></article>`;
    };
    function render() {
      const query=(search?.value||'').trim().toLowerCase(),selected=topic?.value||'';
      const filtered=projects.filter(p=>(!selected||(p.tags||[]).includes(selected))&&[p.title,p.summary,p.problem,p.approach,p.output,...(p.tags||[])].join(' ').toLowerCase().includes(query)).sort((a,b)=>(sort?.value==='oldest'?1:-1)*(parseDateValue(resolveProjectDate(a))-parseDateValue(resolveProjectDate(b))));
      // Include a directly linked project even if it is beyond the initial page.
      const target=filtered.findIndex(p=>'#work-'+p.id===window.location?.hash);
      if(target>=limit)limit=target+1;
      list.innerHTML=filtered.length?filtered.slice(0,limit).map(card).join('')+(filtered.length>limit?`<button class="listing-more" id="more-projects" type="button">Show more projects (${filtered.length-limit})</button>`:''):panelState(projects.length?'No projects match.':'No projects yet.',projects.length?'Try another search or topic.':'Projects will appear here.');
      document.getElementById('more-projects')?.addEventListener('click',()=>{const previous=limit;limit+=6;render();list.querySelectorAll('.project-card')[previous]?.querySelector('a')?.focus({preventScroll:true});});
      list.querySelectorAll('.project-visual img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;}));
    }
    [search,topic,sort].forEach(el=>el?.addEventListener(el===search?'input':'change',()=>{limit=6;render();}));
    render();
    const target=projects.find(p=>'#work-'+p.id===window.location?.hash);
    if(target)document.getElementById('work-'+target.id)?.scrollIntoView({block:'start'});
  }

  function renderWritings(writings) {
    const essaysEl = document.getElementById("writings-essays");
    const blogsEl = document.getElementById("writings-notes");
    if (!essaysEl || !blogsEl) return;

    const searchInput = document.getElementById("writings-search");
    const topicSelect = document.getElementById("writings-topic");
    const sortSelect = document.getElementById("writings-sort");

    const visible={essays:6,notes:6};
    const writeColumns = (essaysMarkup, blogsMarkup) => {
      essaysEl.innerHTML = essaysMarkup;
      blogsEl.innerHTML = blogsMarkup;
    };

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
          <div class="substack-cta">
            <p class="meta-line substack-source">${entry.source === "studio" ? "Published here" : "Published on Substack"}</p>
            <a class="action-link card-cta" href="${escapeHtml(entry.href)}" ${entry.source === "studio" ? "" : 'target="_blank" rel="noopener noreferrer"'}>
              ${escapeHtml(linkLabel)}
              ${externalIconSvg()}
            </a>
          </div>
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
          : essays.slice(0,visible.essays).map((entry) => cardHtml(entry, "Read essay")).join("") + (essays.length>visible.essays?`<button class="listing-more" id="more-essays" type="button">Show more essays (${essays.length-visible.essays})</button>`:"");

      const blogsHtml =
        blogs.length === 0
          ? panelState("No notes match.", "Try a different filter combination.")
          : blogs.slice(0,visible.notes).map((entry) => cardHtml(entry, "Read note")).join("") + (blogs.length>visible.notes?`<button class="listing-more" id="more-notes" type="button">Show more notes (${blogs.length-visible.notes})</button>`:"");

      writeColumns(essaysHtml, blogsHtml);
      for(const [kind,list] of [['essays',essaysEl],['notes',blogsEl]])document.getElementById('more-'+kind)?.addEventListener('click',()=>{const previous=visible[kind];visible[kind]+=6;renderFiltered();list.querySelectorAll('.writing-row a')[previous]?.focus({preventScroll:true});});
    };

    [searchInput, topicSelect, sortSelect].forEach((node) => {
      if (!node) return;
      const eventName = node.tagName.toLowerCase() === "input" ? "input" : "change";
      node.addEventListener(eventName, ()=>{visible.essays=6;visible.notes=6;renderFiltered();});
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

  function initializeBackToTopFab() {
    const shouldRender =
      document.getElementById("works-list") !== null ||
      document.getElementById("writings-essays") !== null ||
      document.getElementById("writings-notes") !== null;
    if (!shouldRender) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "back-to-top-fab";
    button.setAttribute("aria-label", "Back to top");
    button.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 12V4"/>
        <path d="M5.3 6.7 8 4l2.7 2.7"/>
      </svg>
    `;
    const footer = document.querySelector(".footer");
    const baseOffset = 14;
    const footerClearance = 12;
    const listContainers = [
      document.getElementById("works-list"),
      document.getElementById("writings-essays"),
      document.getElementById("writings-notes")
    ].filter(Boolean);

    const hasListScroll = () =>
      listContainers.some((node) => {
        if (!node) return false;
        const canScroll = node.scrollHeight > node.clientHeight + 2;
        return canScroll && node.scrollTop > 64;
      });

    const updateVisibility = () => {
      const visibleFromPage = window.scrollY > 180;
      const visibleFromList = hasListScroll();
      button.classList.toggle("is-visible", visibleFromPage || visibleFromList);

      let offset = baseOffset;
      if (footer) {
        const footerRect = footer.getBoundingClientRect();
        const overlap = Math.max(0, window.innerHeight - footerRect.top);
        if (overlap > 0) {
          offset = baseOffset + overlap + footerClearance;
        }
      }

      const maxOffset = Math.max(baseOffset, window.innerHeight - 56);
      const clampedOffset = Math.min(offset, maxOffset);
      button.style.setProperty("--fab-offset", `${Math.round(clampedOffset)}px`);
    };

    button.addEventListener("click", () => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior = reduceMotion ? "auto" : "smooth";
      window.scrollTo({ top: 0, behavior });
      listContainers.forEach((node) => {
        if (!node) return;
        node.scrollTo({ top: 0, behavior });
      });
    });

    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility, { passive: true });
    listContainers.forEach((node) => {
      node.addEventListener("scroll", updateVisibility, { passive: true });
    });
    document.body.appendChild(button);
    updateVisibility();
  }

  async function hydrateContent() {
    const needsSiteContent =
      document.querySelector("[data-site-name]") !== null ||
      document.querySelector("[data-site-tagline]") !== null;
    const needsProjectsContent = document.getElementById("works-list") !== null;
    const needsWritingsContent =
      document.getElementById("writings-essays") !== null ||
      document.getElementById("writings-notes") !== null;

    const [site, projects, writings, localWritings, showcase] = await Promise.all([
      needsSiteContent ? readJson("/data/site.json").catch(() => null) : Promise.resolve(null),
      needsProjectsContent ? readJson("/data/works-substack.json").catch(() => null) : Promise.resolve(null),
      needsWritingsContent ? readJson("/data/writings.json").catch(() => null) : Promise.resolve(null),
      (needsWritingsContent || needsProjectsContent) ? readJson("/data/writings-local.json").catch(() => null) : Promise.resolve(null),
      needsProjectsContent ? readJson("/data/showcase.json").catch(() => []) : Promise.resolve([])
    ]);

    if (needsSiteContent) renderSiteContent(site);
    if (needsProjectsContent) renderProjects(Array.isArray(projects) || Array.isArray(localWritings) ? WritingData.projects(localWritings,projects).map(p=>ShowcaseData.project(p,showcase)) : null);
    if (needsWritingsContent) renderWritings(Array.isArray(writings) || Array.isArray(localWritings) ? WritingData.listing(localWritings,writings) : null);
    initializeBackToTopFab();

    if (typeof window.initializeDinoInteractions === "function") {
      window.initializeDinoInteractions();
    }
  }

  document.addEventListener("DOMContentLoaded", hydrateContent);
})();

