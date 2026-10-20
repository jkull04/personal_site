(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const VARIANT_COUNT = 3;

  const DEFAULT_FLOOR_BOUNDS = {
    left: 44,
    right: 75.8,
    top: 60.9,
    bottom: 70.3
  };
  const DEFAULT_ROAMER_SLOTS = {
    projects: { u: 0.2, v: 0.84 },
    writings: { u: 0.44, v: 0.54 },
    contact: { u: 0.7, v: 0.84 }
  };
  const DINO_BOTTOM_TRIM_RATIO = {
    stego: 3 / 35,
    raptor: 3 / 30,
    longneck: 5 / 72
  };
  const DINO_SCALE_REFERENCE_WIDTH = 920;
  const DINO_SCALE_MIN = 0.38;
  const DINO_SCALE_MAX = 1.12;
  const SHOW_DEBUG_BOUNDS = false;
  const TOOLTIP_MIN_VISIBLE_MS = 1250;
  const TOOLTIP_EMOTIONS = [":)", ":D", ";)", ":P", ":]"];
  const ROOT_DEFER_CLASS = "defer-dino-atlases";
  const ROOT_ATLAS_READY_CLASS = "dino-atlases-ready";
  const ROOT_ATLAS_LOADING_CLASS = "dino-atlases-loading";
  const ATLAS_PRELOAD_DELAY_MS = 120;
  const DINO_ATLAS_URLS = [
    "/assets/sprites/stegosaurus-walk-atlas-2x.webp?v=20261020-stego-shading-v3",
    "/assets/sprites/raptor-walk-atlas-2x.webp?v=20261020-approved-dinos-v2",
    "/assets/sprites/marble-brach-walk-atlas-2x.webp?v=20261020-approved-dinos-v2",
    "/assets/sprites/stegosaurus-standing-atlas.webp?v=20261020-stego-color-v4",
    "/assets/sprites/raptor-standing-atlas.webp?v=20261020-approved-dinos-v2",
    "/assets/sprites/marble-brach-standing-atlas.webp?v=20261020-approved-dinos-v2"
  ];

  const copyResetTimers = new WeakMap();
  const roamerTooltipTimers = new WeakMap();

  let arenaRaf = 0;
  let arenaLastTick = 0;
  const arenaMotion = new Map();
  let resizeRaf = 0;
  let resizeBound = false;
  let atlasPreloadPromise = null;
  let atlasPreloadScheduled = false;

  document.documentElement.style.setProperty(
    "--dino-row-global",
    String(Math.floor(Math.random() * VARIANT_COUNT))
  );

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return clamp(value, 0, 1);
  }

  function length(x, y) {
    return Math.hypot(x, y);
  }

  function normalize(x, y) {
    const mag = length(x, y) || 1;
    return { x: x / mag, y: y / mag };
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function randomBetweenInt(min, max) {
    return Math.round(randomBetween(min, max));
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.setAttribute("readonly", "");
      temp.style.position = "absolute";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      const ok = document.execCommand("copy");
      temp.remove();
      if (ok) resolve();
      else reject(new Error("copy failed"));
    });
  }

  function setTemporaryCopyLabel(button, label, stateClass, durationMs = 2000) {
    if (!button) return;
    const fallbackLabel = "Email";
    const originalLabel = button.dataset.copyOriginalLabel || button.textContent.trim() || fallbackLabel;

    button.dataset.copyOriginalLabel = originalLabel;
    button.textContent = label;
    button.classList.remove("is-copied", "is-copy-error");
    if (stateClass) button.classList.add(stateClass);

    const existingTimer = copyResetTimers.get(button);
    if (existingTimer) window.clearTimeout(existingTimer);

    const resetTimer = window.setTimeout(() => {
      button.textContent = originalLabel;
      button.classList.remove("is-copied", "is-copy-error");
      copyResetTimers.delete(button);
    }, durationMs);

    copyResetTimers.set(button, resetTimer);
  }

  function bindCopyEmail() {
    const buttons = document.querySelectorAll("[data-copy-email]");
    if (buttons.length === 0) return;

    buttons.forEach((button) => {
      if (button.dataset.copyBound === "true") return;

      const originalLabel = button.textContent.trim() || "Email";
      button.dataset.copyOriginalLabel = originalLabel;

      button.addEventListener("click", async () => {
        const email = button.dataset.email || "jkull@mail.wlu.edu";

        try {
          await copyText(email);
          setTemporaryCopyLabel(button, "Email Copied", "is-copied");
        } catch (_error) {
          setTemporaryCopyLabel(button, "Copy Failed", "is-copy-error");
        }
      });

      button.dataset.copyBound = "true";
    });
  }

  function markArenaState(dino, state) {
    if (!dino || !dino.hasAttribute("data-dino-state")) return;
    dino.dataset.dinoState = state;
  }

  function clearTravelVars(dino) {
    if (!dino) return;
    dino.style.removeProperty("--walk-dx");
    dino.style.removeProperty("--walk-dy");
    dino.style.removeProperty("--walk-ms");
    dino.style.removeProperty("--walk-face");
  }

  function resetDinoClasses(dino) {
    if (!dino) return;
    dino.classList.remove("play-sent", "play-loop-walk", "play-walk-to-slot");
  }

  function setFacing(dino, face) {
    if (!dino) return;
    dino.style.setProperty("--dino-face", String(face));
  }

  function setFacingFromVx(dino, vx) {
    if (!dino) return;
    if (vx > 0.0008) {
      setFacing(dino, 1);
    } else if (vx < -0.0008) {
      setFacing(dino, -1);
    }
  }

  function hideDino(dino) {
    if (!dino) return;
    resetDinoClasses(dino);
    clearTravelVars(dino);
    dino.classList.add("is-idle", "is-hidden");
    markArenaState(dino, "hidden");
  }

  function setLoungeVisible(dino) {
    if (!dino) return;
    resetDinoClasses(dino);
    clearTravelVars(dino);
    dino.classList.remove("is-hidden");
    dino.classList.add("is-idle");
    markArenaState(dino, "lounge");
    if (!dino.style.getPropertyValue("--dino-face")) {
      const defaultFace = dino.classList.contains("dino--longneck") ? -1 : 1;
      setFacing(dino, defaultFace);
    }
  }

  function defaultRoamerSlot(roamer) {
    const lounge = roamer?.dataset?.dinoLounge;
    return DEFAULT_ROAMER_SLOTS[lounge] || { u: 0.5, v: 0.5 };
  }

  function writeRoamerUv(roamer, u, v) {
    if (!roamer) return;
    roamer.dataset.arenaU = clamp01(u).toFixed(4);
    roamer.dataset.arenaV = clamp01(v).toFixed(4);
  }

  function readRoamerUv(roamer) {
    const fallback = defaultRoamerSlot(roamer);
    if (!roamer) return fallback;
    const u = Number.parseFloat(roamer.dataset.arenaU || "");
    const v = Number.parseFloat(roamer.dataset.arenaV || "");
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      return fallback;
    }
    return { u: clamp01(u), v: clamp01(v) };
  }

  function normalizedToBounds(bounds, u, v) {
    const x = bounds.minX + clamp01(u) * (bounds.maxX - bounds.minX);
    const y = bounds.minY + clamp01(v) * (bounds.maxY - bounds.minY);
    return { x, y };
  }

  function pointToNormalized(bounds, x, y) {
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const safeX = Number.isFinite(x) ? x : bounds.centerX;
    const safeY = Number.isFinite(y) ? y : bounds.centerY;
    return {
      u: clamp01((safeX - bounds.minX) / width),
      v: clamp01((safeY - bounds.minY) / height)
    };
  }

  function sceneFallbackBounds(scene) {
    const sceneWidth = scene?.clientWidth || 0;
    const sceneHeight = scene?.clientHeight || 0;
    const minX = sceneWidth * (DEFAULT_FLOOR_BOUNDS.left / 100);
    const maxX = sceneWidth * (DEFAULT_FLOOR_BOUNDS.right / 100);
    const minY = sceneHeight * (DEFAULT_FLOOR_BOUNDS.top / 100);
    const maxY = sceneHeight * (DEFAULT_FLOOR_BOUNDS.bottom / 100);
    return {
      minX,
      maxX,
      minY,
      maxY,
      centerX: minX + (maxX - minX) * 0.5,
      centerY: minY + (maxY - minY) * 0.5
    };
  }

  function setArenaSceneScale(scene, colosseumWidth) {
    if (!scene) return;
    if (!Number.isFinite(colosseumWidth) || colosseumWidth <= 1) return;
    const scale = clamp(colosseumWidth / DINO_SCALE_REFERENCE_WIDTH, DINO_SCALE_MIN, DINO_SCALE_MAX);
    scene.style.setProperty("--arena-dino-scale", scale.toFixed(4));
  }

  function setDebugFloorBounds(scene, bounds) {
    if (!scene || !bounds) return;
    if (!SHOW_DEBUG_BOUNDS) {
      scene.removeAttribute("data-debug-bounds");
      scene.style.removeProperty("--debug-floor-left");
      scene.style.removeProperty("--debug-floor-top");
      scene.style.removeProperty("--debug-floor-width");
      scene.style.removeProperty("--debug-floor-height");
      return;
    }

    const width = Math.max(0, bounds.maxX - bounds.minX);
    const height = Math.max(0, bounds.maxY - bounds.minY);
    scene.dataset.debugBounds = "true";
    scene.style.setProperty("--debug-floor-left", `${Math.round(bounds.minX)}px`);
    scene.style.setProperty("--debug-floor-top", `${Math.round(bounds.minY)}px`);
    scene.style.setProperty("--debug-floor-width", `${Math.round(width)}px`);
    scene.style.setProperty("--debug-floor-height", `${Math.round(height)}px`);
  }

  function setRoamerDebugBox(roamer, radius) {
    if (!roamer) return;
    if (!SHOW_DEBUG_BOUNDS) {
      roamer.removeAttribute("data-debug-box");
      roamer.style.removeProperty("--debug-box-size");
      return;
    }
    const size = Math.max(12, Math.round((Number.isFinite(radius) ? radius : 16) * 2));
    roamer.dataset.debugBox = "true";
    roamer.style.setProperty("--debug-box-size", `${size}px`);
  }

  function dinoKindForRoamer(roamer) {
    if (!roamer) return "";
    const dino = roamer.querySelector("[data-dino]");
    if (!dino) return "";
    if (dino.classList.contains("dino--stego")) return "stego";
    if (dino.classList.contains("dino--raptor")) return "raptor";
    if (dino.classList.contains("dino--longneck")) return "longneck";
    return "";
  }

  function effectiveRoamerBottomY(roamer, y) {
    if (!Number.isFinite(y)) return y;
    const dino = roamer?.querySelector?.("[data-dino]");
    if (!dino) return y;
    const kind = dinoKindForRoamer(roamer);
    const trimRatio = DINO_BOTTOM_TRIM_RATIO[kind] || 0;
    const spriteH = dino.offsetHeight || 0;
    return y - spriteH * trimRatio;
  }

  function setRoamerDepth(roamer, scene, y) {
    if (!roamer) return;
    const depthY = effectiveRoamerBottomY(roamer, y);
    const depth = 200 + Math.round((Number.isFinite(depthY) ? depthY : 0) * 10);
    roamer.style.zIndex = String(depth);
  }

  function roamerBoundsForScene(scene) {
    if (!scene) {
      return {
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
        centerX: 0,
        centerY: 0
      };
    }

    if (scene.classList.contains("dino-visit-scene")) {
      const rect = scene.getBoundingClientRect();
      const art = scene.parentElement.querySelector(".monument-img").getBoundingClientRect();
      const width = art.width, height = art.height;
      const left = art.left - rect.left, top = art.top - rect.top;
      scene.style.setProperty("--arena-dino-scale", String(clamp(width / 740, .65, .98)));
      // The runtime illustrations share transparent margins and a ground line
      // at ~74% of the image; figure height also includes a responsive caption.
      return { minX: left + width * .22, maxX: left + width * .82, minY: top + height * .725,
        maxY: top + height * .748, centerX: left + width * .52, centerY: top + height * .7365 };
    }
    const colosseum = scene.querySelector(".arena-colosseum");
    const sceneRect = scene.getBoundingClientRect();
    const sceneWidth = scene.clientWidth || sceneRect.width || 0;
    const sceneHeight = scene.clientHeight || sceneRect.height || 0;

    if (!colosseum || sceneWidth < 2 || sceneHeight < 2) {
      const fallback = sceneFallbackBounds(scene);
      setArenaSceneScale(scene, sceneWidth);
      setDebugFloorBounds(scene, fallback);
      return fallback;
    }

    const colosseumRect = colosseum.getBoundingClientRect();
    if (colosseumRect.width < 2 || colosseumRect.height < 2) {
      const fallback = sceneFallbackBounds(scene);
      setArenaSceneScale(scene, sceneWidth);
      setDebugFloorBounds(scene, fallback);
      return fallback;
    }

    const styles = window.getComputedStyle(colosseum);
    const floorLeftPct =
      parseFloat(styles.getPropertyValue("--arena-floor-left")) || DEFAULT_FLOOR_BOUNDS.left;
    const floorRightPct =
      parseFloat(styles.getPropertyValue("--arena-floor-right")) || DEFAULT_FLOOR_BOUNDS.right;
    const floorTopPct =
      parseFloat(styles.getPropertyValue("--arena-floor-top")) || DEFAULT_FLOOR_BOUNDS.top;
    const floorBottomPct =
      parseFloat(styles.getPropertyValue("--arena-floor-bottom")) || DEFAULT_FLOOR_BOUNDS.bottom;

    let minX = colosseumRect.left - sceneRect.left + colosseumRect.width * (floorLeftPct / 100);
    let maxX = colosseumRect.left - sceneRect.left + colosseumRect.width * (floorRightPct / 100);
    let minY = colosseumRect.top - sceneRect.top + colosseumRect.height * (floorTopPct / 100);
    let maxY = colosseumRect.top - sceneRect.top + colosseumRect.height * (floorBottomPct / 100);

    minX = clamp(minX, 0, sceneWidth);
    maxX = clamp(maxX, 0, sceneWidth);
    minY = clamp(minY, 0, sceneHeight);
    maxY = clamp(maxY, 0, sceneHeight);

    if (maxX - minX < 8 || maxY - minY < 8) {
      const fallback = sceneFallbackBounds(scene);
      setArenaSceneScale(scene, colosseumRect.width);
      setDebugFloorBounds(scene, fallback);
      return fallback;
    }

    const bounds = {
      minX,
      maxX,
      minY,
      maxY,
      centerX: minX + (maxX - minX) * 0.5,
      centerY: minY + (maxY - minY) * 0.5
    };
    setArenaSceneScale(scene, colosseumRect.width);
    setDebugFloorBounds(scene, bounds);
    return bounds;
  }

  function setRoamerPosition(roamer, x, y) {
    roamer.style.left = `${x.toFixed(2)}px`;
    roamer.style.top = `${y.toFixed(2)}px`;
  }

  function roamerRadius(roamer) {
    const w = roamer?.offsetWidth || 56;
    const h = roamer?.offsetHeight || 56;
    return Math.max(20, Math.round(Math.max(w, h) * 0.38));
  }

  function boundsForRoamer(scene, roamer) {
    return roamerBoundsForScene(scene);
  }

  // Independent decisions plus continuous steering: no animation paths or shared schedule.
  const personalities = {
    raptor: { speed: 29, curiosity: 0.85, rest: [1400, 2800], walk: [1100, 2300], reaction: [180, 700], food: "meat" },
    stego: { speed: 15, curiosity: 0.3, rest: [2600, 5600], walk: [1800, 3400], reaction: [550, 1400], food: "leaf" },
    longneck: { speed: 10, curiosity: 0.5, rest: [3600, 7200], walk: [2200, 4000], reaction: [1000, 2200], food: "leaf" }
  };
  const habitats = new Map();
  let activeDrag = null;
  let motionLifecycleBound = false;
  let journeys = null;
  let journeyPage = null;
  let journeyBound = false;
  let journeyLastSave = 0;
  let interestTimer = 0;
  let interestTarget = null;

  function inspectionSpot(target) {
    const rect = target.getBoundingClientRect();
    const width = 72, height = 80;
    const candidates = [
      { x: rect.right + 8, y: rect.top + Math.min(rect.height, 110) - height },
      { x: rect.left - width - 8, y: rect.top + Math.min(rect.height, 110) - height },
      { x: rect.left + rect.width / 2 - width / 2, y: rect.top - height - 8 }
    ];
    const obstacles = [...document.querySelectorAll("a, button, input, select, textarea, label, img, h1, h2, h3, h4, p, figcaption, .book-cover-fallback, .writing-row, .project-card")]
      .filter(el => !el.closest(".arena-scene"))
      .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
    return candidates.find(p => p.x >= 12 && p.y >= 100 && p.x + width <= window.innerWidth - 12 && p.y + height <= window.innerHeight - 16 &&
      !obstacles.some(r => p.x < r.right + 4 && p.x + width > r.left - 4 && p.y < r.bottom + 4 && p.y + height > r.top - 4));
  }

  function endInspection(state) {
    if (!state.inspection) return;
    state.scene.append(state.roamer);
    state.inspection.element.remove();
    state.inspection = null;
    state.roamer.style.opacity = "1";
    setRoamerPosition(state.roamer, state.x, state.y);
    state.dino.classList.remove("play-loop-walk");
    state.dino.classList.add("is-idle");
  }

  function inspectContent(state, target) {
    if (state.transit || state.food || state.activity === "eating") return;
    const rect = target.getBoundingClientRect(), sceneRect = state.scene.getBoundingClientRect();
    if (state.inspection) {
      const visit = state.inspection;
      const perch = { left: visit.x - window.scrollX, top: visit.top - window.scrollY,
        bottom: visit.top - window.scrollY + 80 };
      if (perch.bottom > 0 && perch.top < window.innerHeight) {
        state.inspection.face = perch.left > rect.left + rect.width / 2 ? -1 : 1;
        return;
      }
      endInspection(state);
    }
    state.attention = { u: clamp01((rect.left + rect.width / 2 - sceneRect.left) / Math.max(1, sceneRect.width)),
      until: performance.now() + 5000 };
    setFacing(state.dino, rect.left + rect.width / 2 > sceneRect.left + state.x ? 1 : -1);
    if (reducedMotion.matches) { showRoamerReaction(state.roamer); return; }
    if (journeyPage === "home") return;
    // Never visibly teleport out of the artwork. Investigate farther down the
    // page only after the original habitat has scrolled out of sight.
    if (sceneRect.bottom > 0 && sceneRect.top < window.innerHeight) return;
    const spot = inspectionSpot(target);
    if (!spot) return;
    const element = document.createElement("div");
    element.className = "arena-scene dino-inspection-scene";
    element.style.left = `${window.scrollX}px`;
    element.style.top = `${spot.y + window.scrollY}px`;
    const width = document.documentElement.clientWidth || window.innerWidth;
    element.style.width = `${width}px`;
    document.body.append(element);
    element.append(state.roamer);
    const to = spot.x + 36;
    const from = to < width / 2 ? -state.roamer.offsetWidth : width + state.roamer.offsetWidth;
    state.inspection = { element, x: spot.x + window.scrollX, top: spot.y + window.scrollY,
      from, to, duration: clamp(Math.abs(to - from) / (state.personality.speed * 2) * 1000, 1400, 12000), started: performance.now(),
      face: spot.x > rect.left ? -1 : 1 };
    setRoamerPosition(state.roamer, from, 77);
    state.roamer.style.opacity = "1";
    queueArenaTick();
  }

  function updateInspection(state, now) {
    const visit = state.inspection;
    if (!visit) return false;
    if (journeys.data.members[state.kind].page !== journeyPage || document.querySelector("dialog[open]")) {
      endInspection(state);
      return false;
    }
    const progress = clamp01((now - visit.started) / visit.duration);
    setRoamerPosition(state.roamer, visit.from + (visit.to - visit.from) * progress, 77);
    setFacing(state.dino, progress < 1 ? (visit.to > visit.from ? 1 : -1) : visit.face);
    state.dino.classList.toggle("play-loop-walk", progress < 1);
    state.dino.classList.toggle("is-idle", progress === 1);
    state.dino.style.setProperty("--walk-frame-ms", `${Math.round(16000 / state.personality.speed)}ms`);
    return true;
  }

  function bindPageCuriosity() {
    // Attend to semantic page elements, rather than arbitrary layout containers.
    const contentSelector = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], img, h1, h2, h3, h4, p, figcaption, label, .book-cover, .album-trigger, .writing-row, .project-card";
    const notice = (target) => {
      if (!journeys || !target?.isConnected || target.closest(".arena-scene, .arena-pantry")) return;
      const now = performance.now();
      const residents = [...arenaMotion.values()].filter(s => s.present && !s.roamer.hidden && !s.transit);
      // Let the user interact with a modal uninterrupted; curiosity resumes when it closes.
      if (document.querySelector("dialog[open]")) {
        residents.forEach(s => { s.pettedUntil = now + 1500; });
        return;
      }
      const link = target.closest("a[href]");
      if (link) {
        const url = new URL(link.href, window.location.href);
        const page = url.origin === window.location.origin && window.DinoJourneys.pageForPath(url.pathname);
        if (page && page !== journeyPage) {
          const kind = journeys.notice(page, Date.now());
          const state = residents.find(s => s.kind === kind);
          if (!state || state.food) return;
          const rect = link.getBoundingClientRect(), sceneRect = state.scene.getBoundingClientRect();
          state.attention = { u: rect.left + rect.width / 2 < sceneRect.left + state.x ? .05 : .95, until: now + 7000 };
          setFacing(state.dino, state.attention.u < state.u ? -1 : 1);
          queueArenaTick();
          return;
        }
      }
      const content = target.closest(".book-cover, .album-trigger") || target.closest(contentSelector);
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const interest = s => {
        const scene = s.scene.getBoundingClientRect();
        return Math.abs(rect.left + rect.width / 2 - scene.left - s.x) / s.personality.curiosity;
      };
      const resident = residents.sort((a, b) => interest(a) - interest(b))[0];
      if (resident && now >= (resident.pageInterestAt || 0)) {
        resident.pageInterestAt = now + 1400;
        inspectContent(resident, content);
        queueArenaTick();
      }
    };
    const consider = event => {
      if (event.pointerType === "touch") return;
      const target = event.target.closest?.(contentSelector);
      if (!target || target === interestTarget) return;
      window.clearTimeout(interestTimer);
      interestTarget = target;
      interestTimer = window.setTimeout(() => {
        if (target.matches(":hover, :focus, :focus-within")) notice(target);
        interestTarget = null;
      }, 450);
    };
    document.addEventListener("pointerover", consider);
    document.addEventListener("focusin", consider);
    // Touch and keyboard activation also create interest, without intercepting navigation.
    document.addEventListener("click", event => {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) notice(event.target);
    });
    document.addEventListener("input", event => notice(event.target));
    document.addEventListener("change", event => notice(event.target));
    const finish = () => arenaMotion.forEach(endInspection);
    window.addEventListener("resize", finish);
  }

  function prepareJourneys() {
    if (!window.DinoJourneys || journeyBound) return;
    journeyPage = window.DinoJourneys.pageForPath(window.location.pathname);
    if (!journeyPage) return;
    const monument = document.querySelector(".page-monument");
    if (journeyPage !== "home" && !monument) return;
    let storage;
    try { storage = window.sessionStorage; } catch (_) { /* Storage can be blocked. */ }
    journeys = window.DinoJourneys.create(storage);
    journeys.arrive(journeyPage, Date.now());
    journeyBound = true;
    bindPageCuriosity();
    if (monument) {
      // Keep visitors inside the illustration, below the foreground page text.
      monument.removeAttribute("aria-hidden");
      const scene = document.createElement("div");
      scene.className = "arena-scene dino-visit-scene";
      scene.setAttribute("aria-label", "Visiting dinosaurs");
      const floor = document.createElement("div");
      floor.className = "arena-floor";
      floor.setAttribute("aria-hidden", "true");
      scene.append(floor);
      Object.keys(personalities).forEach(kind => {
        const roamer = document.createElement("button");
        roamer.type = "button";
        roamer.className = "arena-statue arena-roamer";
        roamer.dataset.dinoLounge = kind;
        roamer.dataset.tooltip = ":)";
        roamer.hidden = journeys.data.members[kind].page !== journeyPage;
        roamer.setAttribute("aria-label", `Pet the ${kind === "stego" ? "stegosaurus" : kind}`);
        const dino = document.createElement("span");
        dino.className = `dino dino--sheet dino--${kind} dino--arena dino--lounge`;
        dino.dataset.dino = "";
        dino.dataset.dinoLounge = kind;
        dino.dataset.dinoState = "lounge";
        dino.setAttribute("aria-hidden", "true");
        roamer.append(dino);
        scene.append(roamer);
      });
      monument.append(scene);
    }
    window.addEventListener("pagehide", () => { snapshotJourneys(); cancelFoodDrag(); });
    // BFCache restores must consult the newer world saved by the page just left.
    window.addEventListener("pageshow", event => {
      if (!event.persisted) return;
      journeys = window.DinoJourneys.create(storage);
      journeys.arrive(journeyPage, Date.now());
      initializeDinoInteractions();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) snapshotJourneys();
    });
  }

  function snapshotJourneys() {
    if (!journeys) return;
    arenaMotion.forEach(state => {
      const member = journeys.data.members[state.kind];
      if (member.page !== journeyPage || state.roamer.hidden || state.transit) return;
      member.position = { page: journeyPage, u: state.u, v: state.v };
      member.face = state.dino.style.getPropertyValue("--dino-face");
      member.reaction = state.roamer.dataset.lastReaction;
      member.fullUntil = Date.now() + Math.max(0, state.fullUntil - performance.now());
    });
    journeys.save(Date.now());
  }

  function startJourneyTransition(state, arriving, now) {
    if (state.food) state.food.owner = null;
    state.food = null;
    state.vx = state.vy = 0;
    state.pettedUntil = 0;
    setActivity(state, "resting");
    if (reducedMotion.matches) {
      endJourneyLayer(state);
      state.transit = null;
      state.u = clamp01(state.u);
      Object.assign(state, normalizedToBounds(state.bounds, state.u, state.v));
      setRoamerPosition(state.roamer, state.x, state.y);
      return;
    }
    const left = arriving ? Math.random() < .5 : state.u < .5;
    const b = state.bounds, span = Math.max(1, b.maxX - b.minX);
    // Travel outside the artwork's clipped box, all the way to the viewport edge.
    endJourneyLayer(state);
    const rect = state.scene.getBoundingClientRect();
    const width = document.documentElement.clientWidth || window.innerWidth || state.scene.clientWidth;
    const layer = document.createElement("div");
    layer.className = "arena-scene dino-transit-scene";
    Object.assign(layer.style, { left: `${window.scrollX || 0}px`, top: `${rect.top + (window.scrollY || 0)}px`,
      width: `${width}px`, height: `${rect.height}px` });
    layer.style.setProperty("--arena-dino-scale", state.scene.style.getPropertyValue("--arena-dino-scale") || "1");
    document.body.append(layer);
    layer.append(state.roamer);
    state.journeyLayer = layer;
    const edge = left ? (-rect.left - state.roamer.offsetWidth - b.minX) / span
      : (width - rect.left + state.roamer.offsetWidth - b.minX) / span;
    const target = arriving ? (left ? .18 : .82) : edge;
    const start = arriving ? edge : state.u;
    const distance = Math.abs(target - start) * (state.bounds.maxX - state.bounds.minX);
    state.transit = { arriving, left, from: start, to: target, start: now + (arriving ? randomBetween(700, 1800) : 0),
      duration: clamp(distance / state.personality.speed * 1000, 1400, 10000) };
    state.v = clamp(state.v, .25, .75);
    state.roamer.hidden = false;
    state.roamer.disabled = true;
    state.roamer.style.opacity = "1";
    state.u = start;
    state.x = b.minX + start * span;
    setRoamerPosition(state.roamer, rect.left + state.x, state.y);
  }

  function endJourneyLayer(state) {
    if (!state.journeyLayer) return;
    state.scene.append(state.roamer);
    state.journeyLayer.remove();
    state.journeyLayer = null;
    setRoamerPosition(state.roamer, state.x, state.y);
  }

  function syncJourneyState(state, now) {
    if (!journeys) return false;
    const present = journeys.data.members[state.kind].page === journeyPage;
    if (state.present !== present) {
      state.present = present;
      startJourneyTransition(state, present, now);
    }
    if (reducedMotion.matches) {
      endJourneyLayer(state);
      state.transit = null;
      state.roamer.hidden = !present;
      state.roamer.disabled = !present;
      state.roamer.style.opacity = "1";
      return !present;
    }
    if (state.transit) {
      const t = state.transit;
      const rect = state.scene.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth || state.scene.clientWidth;
      const b = state.bounds, span = Math.max(1, b.maxX - b.minX);
      const edge = ((t.left ? -state.roamer.offsetWidth : width + state.roamer.offsetWidth) - rect.left - b.minX) / span;
      if (t.arriving) t.from = edge;
      else t.to = edge;
      const progress = clamp01((now - t.start) / t.duration);
      const u = t.from + (t.to - t.from) * progress;
      state.x = b.minX + u * (b.maxX - b.minX);
      state.y = b.minY + state.v * (b.maxY - b.minY);
      state.u = u;
      state.dino.classList.toggle("play-loop-walk", now >= t.start);
      state.dino.classList.toggle("is-idle", now < t.start);
      state.dino.style.setProperty("--walk-frame-ms", `${Math.round(16000 / state.personality.speed)}ms`);
      setFacing(state.dino, t.to > t.from ? 1 : -1);
      if (state.journeyLayer) {
        Object.assign(state.journeyLayer.style, { width: `${width}px`, height: `${rect.height}px`,
          top: `${rect.top + (window.scrollY || 0)}px` });
        state.journeyLayer.style.setProperty("--arena-dino-scale", state.scene.style.getPropertyValue("--arena-dino-scale") || "1");
      }
      setRoamerPosition(state.roamer, state.x + (state.journeyLayer ? rect.left : 0), state.y);
      if (progress === 1) {
        endJourneyLayer(state);
        state.transit = null;
        state.roamer.hidden = !present;
        state.roamer.disabled = !present;
        state.roamer.style.opacity = "1";
        state.decisionAt = now + randomBetween(...state.personality.rest);
        state.dino.classList.remove("play-loop-walk");
        state.dino.classList.add("is-idle");
      }
      return true;
    }
    return !present;
  }

  function announce(habitat, text) {
    const status = habitat.scene.querySelector(".arena-feeding-status");
    if (status) status.textContent = text;
  }

  function foodPoint(habitat, food) {
    return normalizedToBounds(habitat.bounds, food.u, food.v);
  }

  function renderFood(habitat, food) {
    const point = foodPoint(habitat, food);
    food.element.style.left = `${point.x}px`;
    food.element.style.top = `${point.y}px`;
    food.element.style.zIndex = String(190 + Math.round(point.y * 10));
  }

  function removeFood(habitat, food) {
    food.element.remove();
    habitat.foods = habitat.foods.filter(item => item !== food);
  }

  function setActivity(state, activity) {
    if (state.activity === activity) return;
    state.activity = activity;
    state.roamer.dataset.activity = activity;
    state.dino.classList.toggle("is-eating", activity === "eating");
  }

  function wander(state, now) {
    state.heading += randomBetween(-1.5, 1.5);
    state.decisionAt = now + randomBetween(...state.personality.walk);
    setActivity(state, "wandering");
  }

  function remapArenaRoamers() {
    habitats.forEach(habitat => {
      habitat.bounds = roamerBoundsForScene(habitat.scene);
      const b = habitat.bounds;
      const floor = habitat.scene.querySelector(".arena-floor");
      Object.assign(floor.style, { left: `${b.minX - 12}px`, top: `${b.minY - 12}px`, width: `${b.maxX - b.minX + 24}px`, height: `${b.maxY - b.minY + 24}px` });
      habitat.foods.forEach(food => renderFood(habitat, food));
    });
    document.querySelectorAll(".arena-roamer").forEach(roamer => {
      const traveling = arenaMotion.get(roamer);
      if (traveling?.inspection) return;
      if (traveling?.transit) {
        traveling.bounds = habitats.get(traveling.scene).bounds;
        syncJourneyState(traveling, performance.now());
        return;
      }
      const scene = roamer.closest(".arena-scene");
      if (!scene) return;
      const bounds = habitats.get(scene)?.bounds || roamerBoundsForScene(scene);
      const state = arenaMotion.get(roamer);
      const uv = state ? { u: state.u, v: state.v } : readRoamerUv(roamer);
      const point = normalizedToBounds(bounds, uv.u, uv.v);
      if (state) Object.assign(state, point, { bounds, radius: roamerRadius(roamer), vx: 0, vy: 0 });
      setRoamerPosition(roamer, point.x, point.y);
      setRoamerDepth(roamer, scene, point.y);
      setRoamerDebugBox(roamer, roamerRadius(roamer));
    });
  }

  function beginRoamerAmble(roamer) {
    const existing = arenaMotion.get(roamer);
    if (existing) {
      existing.pettedUntil = performance.now() + 1300;
      showRoamerReaction(roamer);
      return;
    }
    const scene = roamer.closest(".arena-scene");
    const habitat = habitats.get(scene);
    const dino = roamer.querySelector("[data-dino]");
    if (!habitat || !dino) return;
    const uv = readRoamerUv(roamer);
    const point = normalizedToBounds(habitat.bounds, uv.u, uv.v);
    const kind = dinoKindForRoamer(roamer);
    const state = {
      roamer, scene, habitat, dino, kind, personality: personalities[kind],
      ...point, ...uv, bounds: habitat.bounds, vx: 0, vy: 0,
      radius: roamerRadius(roamer), heading: randomBetween(-Math.PI, Math.PI),
      activity: "resting", decisionAt: performance.now() + randomBetween(400, 2600),
      food: null, noticeAt: 0, fullUntil: 0, curiousUntil: 0, curiosityCooldown: 0,
      pettedUntil: 0, eatUntil: 0
    };
    arenaMotion.set(roamer, state);
    if (journeys) {
      const member = journeys.data.members[kind];
      state.present = member.page === journeyPage;
      roamer.hidden = !state.present;
      roamer.disabled = !state.present;
      roamer.style.opacity = "1";
      if (member.reaction) roamer.dataset.lastReaction = member.reaction;
      if (member.face === "1" || member.face === "-1") setFacing(dino, Number(member.face));
      state.fullUntil = performance.now() + Math.max(0, member.fullUntil - Date.now());
      const position = member.position;
      if (position?.page === journeyPage) {
        state.u = clamp01(position.u); state.v = clamp01(position.v);
        Object.assign(state, normalizedToBounds(state.bounds, state.u, state.v));
        setRoamerPosition(roamer, state.x, state.y);
      }
      if (state.present && (member.arriving === journeyPage || (!position && journeyPage !== "home")) && !reducedMotion.matches) {
        startJourneyTransition(state, true, performance.now());
      }
      delete member.arriving;
    }
    roamer.dataset.activity = "resting";
    queueArenaTick();
  }

  function canEat(state, type) {
    return state.personality.food === type;
  }

  function eatFood(state, food, now) {
    if (!canEat(state, food.type)) return;
    removeFood(state.habitat, food);
    state.food = null;
    state.eatUntil = now + randomBetween(1600, 2400);
    state.fullUntil = now + randomBetween(4500, 8000);
    state.decisionAt = state.eatUntil + randomBetween(...state.personality.rest);
    state.vx = state.vy = 0;
    setActivity(state, "eating");
    showRoamerReaction(state.roamer);
    announce(state.habitat, `The ${state.kind === "stego" ? "stegosaurus" : state.kind} enjoyed the ${food.type}.`);
  }

  function updateRoamerState(roamer, state, dt, now) {
    const { habitat, bounds: b, personality: p } = state;
    if (updateInspection(state, now)) return;
    if (!habitat.visible) return;
    if (syncJourneyState(state, now)) return;
    let target = null;
    let speed = p.speed * clamp((b.maxX - b.minX) / 270, 0.45, 1.1);
    let moving = false;

    if (state.activity === "eating" && now >= state.eatUntil) setActivity(state, "resting");
    if (state.food && !habitat.foods.includes(state.food)) state.food = null;

    // Food is claimed once, so three noses don't pile onto the same snack.
    if (!state.food && now >= state.fullUntil && state.activity !== "eating") {
      let best = null;
      let bestScore = Infinity;
      habitat.foods.forEach(food => {
        if (!canEat(state, food.type)) return;
        if (food.owner && food.owner !== state) return;
        const point = foodPoint(habitat, food);
        // Let proximity, appetite and personality decide who notices first,
        // rather than giving the first dinosaur in the DOM every new snack.
        if (!food.owner) {
          const contenders = [...arenaMotion.values()].filter(other => !other.roamer.hidden && !other.transit && other.present !== false && other.habitat === habitat && canEat(other, food.type) && !other.food && now >= other.fullUntil && other.activity !== "eating");
          const interest = other => length(point.x - other.x, point.y - other.y) / other.personality.speed
            + other.personality.reaction[0] / 1000;
          contenders.sort((a, b) => interest(a) - interest(b));
          if (contenders[0] !== state) return;
        }
        const score = length(point.x - state.x, point.y - state.y);
        if (score < bestScore) { best = food; bestScore = score; }
      });
      if (best) {
        best.owner = state;
        state.food = best;
        state.noticeAt = now + randomBetween(...p.reaction);
      }
    }

    if (state.activity === "eating" || now < state.pettedUntil) {
      // A real pause makes their movement feel intentional.
    } else if (state.food) {
      target = foodPoint(habitat, state.food);
      setFacingFromVx(state.dino, target.x - state.x);
      if (now >= state.noticeAt) {
        setActivity(state, "seeking");
        const distance = length(target.x - state.x, target.y - state.y);
        if (distance < 7) {
          eatFood(state, state.food, now);
        } else {
          moving = true;
          speed *= state.kind === "raptor" ? 1.75 : 1.3;
          speed *= Math.min(1, distance / 22 + 0.2);
        }
      }
    } else if (state.attention && now < state.attention.until) {
      target = normalizedToBounds(b, state.attention.u, .55);
      setActivity(state, "curious");
      setFacingFromVx(state.dino, target.x - state.x);
      moving = length(target.x - state.x, target.y - state.y) > 9;
      speed *= .8;
    } else {
      const pointer = habitat.pointer;
      const near = pointer && now - pointer.at < 3200 && length(pointer.x - state.x, pointer.y - state.y) < 135;
      if (near && now > state.curiosityCooldown && now > state.decisionAt) {
        state.curiosityCooldown = now + randomBetween(5000, 10000);
        if (Math.random() < p.curiosity) {
          state.curiousUntil = now + randomBetween(1200, 2800);
          setActivity(state, "curious");
        }
      }
      if (state.activity === "curious" && near && now < state.curiousUntil) {
        setFacingFromVx(state.dino, pointer.x - state.x);
        target = { x: clamp(pointer.x, b.minX, b.maxX), y: clamp(pointer.y, b.minY, b.maxY) };
        moving = state.kind !== "longneck" && length(target.x - state.x, target.y - state.y) > 28;
        speed *= 0.65;
      } else {
        if (state.activity === "curious" || state.activity === "seeking") {
          setActivity(state, "resting");
          state.decisionAt = now + randomBetween(...p.rest);
        }
        if (now >= state.decisionAt) {
          if (state.activity === "wandering") {
            setActivity(state, "resting");
            state.decisionAt = now + randomBetween(...p.rest);
          } else wander(state, now);
        }
        moving = state.activity === "wandering";
      }
    }

    let desiredX = 0, desiredY = 0;
    if (moving) {
      state.heading += randomBetween(-0.8, 0.8) * dt / 1000;
      let direction = target ? normalize(target.x - state.x, target.y - state.y) : { x: Math.cos(state.heading), y: Math.sin(state.heading) };
      let sx = 0, sy = 0;
      arenaMotion.forEach(other => {
        if (other === state || other.scene !== state.scene || other.roamer.hidden || other.transit) return;
        const dx = state.x - other.x, dy = state.y - other.y;
        const distance = length(dx, dy);
        const gap = Math.min(48, (state.radius + other.radius) * 0.65);
        if (distance < gap) {
          const away = distance > 0.1 ? normalize(dx, dy) : { x: state.kind === "raptor" ? 1 : -1, y: 0 };
          const force = (1 - distance / gap) * (target ? 0.5 : 1.8);
          sx += away.x * force; sy += away.y * force;
        }
      });
      // Soft walls turn them before the edge; no forced perimeter route.
      const pad = Math.min(18, (b.maxY - b.minY) / 3);
      if (!target) {
        sx += Math.max(0, 1 - (state.x - b.minX) / pad) * 2 - Math.max(0, 1 - (b.maxX - state.x) / pad) * 2;
        sy += Math.max(0, 1 - (state.y - b.minY) / pad) * 2 - Math.max(0, 1 - (b.maxY - state.y) / pad) * 2;
      }
      direction = normalize(direction.x + sx, direction.y + sy);
      if (!target) state.heading = Math.atan2(direction.y, direction.x);
      desiredX = direction.x * speed; desiredY = direction.y * speed * (target ? 1 : 0.55);
    }
    const ease = 1 - Math.exp(-dt / (moving ? 220 : 100));
    state.vx += (desiredX - state.vx) * ease;
    state.vy += (desiredY - state.vy) * ease;
    state.x = clamp(state.x + state.vx * dt / 1000, b.minX, b.maxX);
    state.y = clamp(state.y + state.vy * dt / 1000, b.minY, b.maxY);
    const walking = length(state.vx, state.vy) > 2;
    state.dino.classList.toggle("play-loop-walk", walking);
    state.dino.classList.toggle("is-idle", !walking);
    state.dino.style.setProperty("--walk-frame-ms", `${Math.round(16000 / Math.max(9, speed))}ms`);
    if (walking && Math.abs(state.vx) > 2) setFacingFromVx(state.dino, state.vx);
    markArenaState(state.dino, walking ? "moving" : "lounge");
    const uv = pointToNormalized(b, state.x, state.y);
    state.u = uv.u; state.v = uv.v;
    writeRoamerUv(roamer, state.u, state.v);
    setRoamerPosition(roamer, state.x, state.y);
    setRoamerDepth(roamer, state.scene, state.y);
  }

  function queueArenaTick() {
    if (arenaRaf || !arenaMotion.size || reducedMotion.matches || document.hidden ||
        (! [...habitats.values()].some(h => h.visible) && ![...arenaMotion.values()].some(s => s.inspection))) return;
    if (journeys && journeyPage !== "home" && ![...arenaMotion.values()].some(s => s.present || s.transit)) return;
    arenaRaf = window.requestAnimationFrame(stepArenaMotion);
  }

  function stepArenaMotion(now) {
    arenaRaf = 0;
    const dt = clamp(arenaLastTick ? now - arenaLastTick : 16, 0, 50);
    arenaLastTick = now;
    if (journeys) {
      const states = [...arenaMotion.values()];
      const engaged = states.find(s => s.inspection || s.pettedUntil > now || s.roamer.matches(":hover, :focus"));
      const busy = states.some(s => s.food || s.activity === "eating" || s.transit || s.inspection || s.attention?.until > now);
      journeys.tick(journeyPage, Date.now(), !busy && !engaged && [...habitats.values()].some(h => h.visible && !h.foods.length), engaged?.kind);
      if (now - journeyLastSave > 4000) { snapshotJourneys(); journeyLastSave = now; }
    }
    habitats.forEach(h => h.foods.slice().forEach(food => { if (now > food.expires) removeFood(h, food); }));
    arenaMotion.forEach((state, roamer) => {
      if (!roamer.isConnected) { arenaMotion.delete(roamer); return; }
      updateRoamerState(roamer, state, dt, now);
    });
    queueArenaTick();
  }

  function stopArenaMotion() {
    if (arenaRaf) window.cancelAnimationFrame(arenaRaf);
    arenaRaf = 0; arenaLastTick = 0;
    arenaMotion.forEach(state => {
      endInspection(state);
      endJourneyLayer(state);
      state.dino.classList.remove("play-loop-walk", "is-eating");
      state.dino.classList.add("is-idle");
      markArenaState(state.dino, "lounge");
    });
    arenaMotion.clear();
    habitats.forEach(h => h.foods.forEach(food => { food.owner = null; }));
  }

  function dropFood(habitat, type, point) {
    if (type !== "leaf" && type !== "meat") return;
    if (habitat.foods.length >= 6) { announce(habitat, "Let them finish these snacks first."); return; }
    if (journeys && journeyPage === "home") {
      journeys.recall(type, Date.now());
      arenaMotion.forEach(state => syncJourneyState(state, performance.now()));
    }
    const uv = pointToNormalized(habitat.bounds, point.x, point.y);
    const element = document.createElement("span");
    element.className = `arena-food pixel-food pixel-food--${type}`;
    element.setAttribute("aria-hidden", "true");
    habitat.scene.append(element);
    const food = { type, ...uv, element, owner: null, expires: performance.now() + 45000 };
    habitat.foods.push(food);
    renderFood(habitat, food);
    announce(habitat, `${type === "leaf" ? "Leaf" : "Meat"} offered.`);
    if (reducedMotion.matches) {
      const candidates = [...arenaMotion.values()].filter(s => !s.roamer.hidden && s.habitat === habitat && canEat(s, type));
      const nearest = candidates.sort((a, b) => length(a.x - point.x, a.y - point.y) - length(b.x - point.x, b.y - point.y))[0];
      if (nearest) { eatFood(nearest, food, performance.now()); nearest.dino.classList.remove("is-eating"); }
      else removeFood(habitat, food);
    }
    queueArenaTick();
  }

  function cancelFoodDrag(suppressClick = true) {
    if (!activeDrag) return;
    const drag = activeDrag;
    activeDrag = null;
    document.body.classList.remove("is-dragging-arena-food");
    if (suppressClick) drag.suppressClick();
    drag.ghost.remove();
    drag.habitat.scene.classList.remove("is-feeding", "is-food-over");
    drag.button.setAttribute("aria-pressed", "false");
    if (drag.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id);
  }

  function dragPoint(habitat, event) {
    const rect = habitat.scene.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function validDrop(habitat, point) {
    const b = habitat.bounds;
    return point.x >= b.minX - 14 && point.x <= b.maxX + 14 && point.y >= b.minY - 18 && point.y <= b.maxY + 18;
  }

  function bindLivingArena() {
    document.querySelectorAll(".arena-scene").forEach(scene => {
      if (habitats.has(scene)) return;
      const habitat = { scene, foods: [], pointer: null, bounds: roamerBoundsForScene(scene), visible: true };
      habitats.set(scene, habitat);
      scene.addEventListener("pointermove", event => {
        if (event.pointerType === "touch" || activeDrag) return;
        habitat.pointer = { ...dragPoint(habitat, event), at: performance.now() };
      });
      scene.addEventListener("pointerleave", () => { habitat.pointer = null; });
      (scene.closest(".arena-exhibit") || scene).querySelectorAll("[data-food]").forEach(button => {
        let suppressClick = false;
        button.addEventListener("pointerdown", event => {
          if (event.button !== 0 || activeDrag) return;
          suppressClick = false;
          const ghost = document.createElement("span");
          ghost.className = `arena-food-ghost pixel-food pixel-food--${button.dataset.food}`;
          ghost.setAttribute("aria-hidden", "true");
          document.body.append(ghost);
          ghost.style.left = `${event.clientX}px`; ghost.style.top = `${event.clientY}px`;
          activeDrag = { habitat, button, ghost, id: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, suppressClick: () => { suppressClick = true; } };
          button.setPointerCapture(event.pointerId);
          document.body.classList.add("is-dragging-arena-food");
          button.setAttribute("aria-pressed", "true");
          scene.classList.add("is-feeding");
        });
        button.addEventListener("pointermove", event => {
          const drag = activeDrag;
          if (!drag || drag.button !== button || drag.id !== event.pointerId) return;
          drag.moved ||= length(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
          drag.ghost.style.left = `${event.clientX}px`; drag.ghost.style.top = `${event.clientY}px`;
          scene.classList.toggle("is-food-over", validDrop(habitat, dragPoint(habitat, event)));
        });
        button.addEventListener("pointerup", event => {
          const drag = activeDrag;
          if (!drag || drag.button !== button || drag.id !== event.pointerId) return;
          const point = dragPoint(habitat, event);
          suppressClick = drag.moved;
          if (drag.moved && validDrop(habitat, point)) dropFood(habitat, button.dataset.food, point);
          cancelFoodDrag(false);
        });
        button.addEventListener("pointercancel", cancelFoodDrag);
        button.addEventListener("lostpointercapture", () => { if (activeDrag?.button === button) cancelFoodDrag(); });
        button.addEventListener("click", event => {
          if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
          suppressClick = false;
          dropFood(habitat, button.dataset.food, normalizedToBounds(habitat.bounds, randomBetween(0.2, 0.8), randomBetween(0.25, 0.75)));
        });
      });
      if (typeof IntersectionObserver !== "undefined") {
        const observer = new IntersectionObserver(entries => {
          habitat.visible = entries[0].isIntersecting;
          arenaLastTick = 0;
          queueArenaTick();
        });
        observer.observe(scene);
      }
      if (typeof ResizeObserver !== "undefined") new ResizeObserver(remapArenaRoamers).observe(scene);
    });
    if (!motionLifecycleBound) {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          cancelFoodDrag();
          if (arenaRaf) window.cancelAnimationFrame(arenaRaf);
          arenaRaf = 0;
        } else queueArenaTick();
        arenaLastTick = 0;
      });
      document.addEventListener("keydown", event => { if (event.key === "Escape") cancelFoodDrag(); });
      window.addEventListener("blur", cancelFoodDrag);
      motionLifecycleBound = true;
    }
  }

  function clearRoamerTooltipTimer(roamer) {
    const timer = roamerTooltipTimers.get(roamer);
    if (timer) {
      window.clearTimeout(timer);
      roamerTooltipTimers.delete(roamer);
    }
  }

  function scheduleRoamerTooltipHide(roamer, delayMs = 0) {
    if (!roamer) return;
    clearRoamerTooltipTimer(roamer);
    const timer = window.setTimeout(() => {
      hideRoamerTooltipIfAllowed(roamer);
    }, Math.max(0, Math.round(delayMs)));
    roamerTooltipTimers.set(roamer, timer);
  }

  function showRoamerReaction(roamer) {
    const choices = TOOLTIP_EMOTIONS.filter(face => face !== roamer.dataset.lastReaction);
    const face = choices[Math.floor(Math.random() * choices.length)];
    roamer.dataset.lastReaction = face;
    showRoamerTooltip(roamer, face);
  }

  function showRoamerTooltip(roamer, message) {
    if (!roamer) return;
    const now = Date.now();
    roamer.setAttribute("data-tooltip", message);
    roamer.dataset.tooltipVisible = "true";
    roamer.dataset.tooltipPinnedUntil = String(now + TOOLTIP_MIN_VISIBLE_MS);
    scheduleRoamerTooltipHide(roamer, TOOLTIP_MIN_VISIBLE_MS + 24);
  }

  function hideRoamerTooltipIfAllowed(roamer) {
    if (!roamer) return;
    const pinnedUntil = Number.parseInt(roamer.dataset.tooltipPinnedUntil || "0", 10) || 0;
    const remaining = pinnedUntil - Date.now();
    if (remaining > 0) {
      scheduleRoamerTooltipHide(roamer, remaining + 24);
      return;
    }

    const interacting = roamer.matches(":hover");
    if (interacting) {
      scheduleRoamerTooltipHide(roamer, 220);
      return;
    }

    roamer.removeAttribute("data-tooltip-visible");
    roamer.removeAttribute("data-tooltip-pinned-until");
    clearRoamerTooltipTimer(roamer);
  }

  function bindRoamerClicks() {
    document.querySelectorAll(".arena-roamer").forEach((roamer) => {
      if (roamer.dataset.ambleBound === "true") return;
      roamer.addEventListener("click", () => {
        beginRoamerAmble(roamer);
      });
      roamer.dataset.ambleBound = "true";
    });
  }

  function pageUsesDinoAtlases() {
    return document.querySelector("[data-dino]") !== null;
  }

  function preloadAtlas(url) {
    return new Promise((resolve) => {
      const image = new Image();
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
      image.src = url;

      if (typeof image.decode === "function") {
        image.decode().then(done).catch(done);
      }
    });
  }

  function startAtlasPreload() {
    if (atlasPreloadPromise) return atlasPreloadPromise;

    const root = document.documentElement;
    root.classList.add(ROOT_ATLAS_LOADING_CLASS);

    atlasPreloadPromise = Promise.all(DINO_ATLAS_URLS.map((url) => preloadAtlas(url)))
      .catch(() => null)
      .finally(() => {
        root.classList.remove(ROOT_ATLAS_LOADING_CLASS);
        root.classList.add(ROOT_ATLAS_READY_CLASS);
        initializeDinoInteractions();
      });

    return atlasPreloadPromise;
  }

  function scheduleAtlasPreload() {
    const root = document.documentElement;
    if (!root.classList.contains(ROOT_DEFER_CLASS)) {
      root.classList.add(ROOT_ATLAS_READY_CLASS);
      return;
    }
    if (root.classList.contains(ROOT_ATLAS_READY_CLASS)) return;
    if (!pageUsesDinoAtlases()) {
      root.classList.add(ROOT_ATLAS_READY_CLASS);
      return;
    }
    if (atlasPreloadScheduled || atlasPreloadPromise) return;

    atlasPreloadScheduled = true;
    const kickoff = () => {
      atlasPreloadScheduled = false;
      startAtlasPreload();
    };

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(kickoff, { timeout: 1200 });
      return;
    }

    window.setTimeout(kickoff, ATLAS_PRELOAD_DELAY_MS);
  }

  function initializeDinoInteractions() {
    prepareJourneys();
    stopArenaMotion();
    bindCopyEmail();

    const root = document.documentElement;
    const shouldDefer = root.classList.contains(ROOT_DEFER_CLASS);
    const atlasesReady = !shouldDefer || root.classList.contains(ROOT_ATLAS_READY_CLASS);
    if (shouldDefer && !atlasesReady) {
      scheduleAtlasPreload();
    }

    document.querySelectorAll("[data-dino]").forEach((dino) => {
      resetDinoClasses(dino);
      clearTravelVars(dino);
      dino.classList.add("is-idle");

      if (!atlasesReady) {
        hideDino(dino);
        return;
      }

      if (dino.hasAttribute("data-dino-lounge")) {
        setLoungeVisible(dino);
        return;
      }

      hideDino(dino);
    });

    if (!atlasesReady) return;

    bindLivingArena();
    if (reducedMotion.matches) habitats.forEach(h => h.foods.slice().forEach(food => removeFood(h, food)));
    remapArenaRoamers();
    bindRoamerClicks();
    document.querySelectorAll(".arena-roamer").forEach(beginRoamerAmble);
  }

  function bindResizeRefresh() {
    if (resizeBound) return;
    window.addEventListener("resize", () => {
      if (resizeRaf) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        remapArenaRoamers();
      });
    });
    resizeBound = true;
  }

  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", initializeDinoInteractions);
  } else if (typeof reducedMotion.addListener === "function") {
    reducedMotion.addListener(initializeDinoInteractions);
  }

  bindResizeRefresh();
  window.initializeDinoInteractions = initializeDinoInteractions;
  document.addEventListener("DOMContentLoaded", () => {
    initializeDinoInteractions();
    scheduleAtlasPreload();
  });
})();

