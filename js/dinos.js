(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const VARIANT_COUNT = 3;

  const AMBLE_DURATION_MIN_MS = 900;
  const AMBLE_DURATION_MAX_MS = 1500;
  const AMBLE_NOISE_MIN_MS = 180;
  const AMBLE_NOISE_MAX_MS = 360;
  const AMBLE_SPEED_MIN = 0.018;
  const AMBLE_SPEED_MAX = 0.038;
  const AMBLE_SEPARATION_PAD = 24;
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
    stego: 21 / 258,
    raptor: 20 / 223,
    longneck: 20 / 288
  };
  const DINO_SCALE_REFERENCE_WIDTH = 920;
  const DINO_SCALE_MIN = 0.72;
  const DINO_SCALE_MAX = 1.12;
  const EDGE_TARGET_MIN_RADIUS = 0.72;
  const EDGE_TARGET_MAX_RADIUS = 0.96;
  const SHOW_DEBUG_BOUNDS = true;
  const TOOLTIP_MIN_VISIBLE_MS = 1250;
  const TOOLTIP_EMOTIONS = [":)", ":D", ";)", ":P", ":]"];
  const ROOT_DEFER_CLASS = "defer-dino-atlases";
  const ROOT_ATLAS_READY_CLASS = "dino-atlases-ready";
  const ROOT_ATLAS_LOADING_CLASS = "dino-atlases-loading";
  const ATLAS_PRELOAD_DELAY_MS = 120;
  const DINO_ATLAS_URLS = [
    "/assets/sprites/stegosaurus-walk-atlas-2x.webp?v=20260301b",
    "/assets/sprites/raptor-walk-atlas-2x.webp?v=20260301b",
    "/assets/sprites/marble-brach-walk-atlas-2x.webp?v=20260301b"
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

  function nearestDistanceToOtherRoamers(roamer, x, y) {
    let nearest = Number.POSITIVE_INFINITY;
    arenaMotion.forEach((otherState, otherRoamer) => {
      if (otherRoamer === roamer || !otherState) return;
      const dist = length(x - otherState.x, y - otherState.y);
      if (dist < nearest) nearest = dist;
    });
    return nearest;
  }

  function edgeBiasForce(state, bounds) {
    const halfW = Math.max(1, (bounds.maxX - bounds.minX) * 0.5);
    const halfH = Math.max(1, (bounds.maxY - bounds.minY) * 0.5);
    const nx = (state.x - bounds.centerX) / halfW;
    const ny = (state.y - bounds.centerY) / halfH;
    const radial = Math.hypot(nx, ny);
    const outward = normalize(state.x - bounds.centerX, state.y - bounds.centerY);
    const inward = { x: -outward.x, y: -outward.y };
    const desired = 0.86;

    if (radial < desired) {
      const strength = (desired - radial) * 0.75;
      return { x: outward.x * strength, y: outward.y * strength };
    }
    if (radial > 0.98) {
      const strength = (radial - 0.98) * 1.2;
      return { x: inward.x * strength, y: inward.y * strength };
    }
    return { x: 0, y: 0 };
  }

  function randomRoamerTarget(bounds, roamer) {
    const centerX = bounds.centerX;
    const centerY = bounds.centerY;
    const radiusX = Math.max(1, (bounds.maxX - bounds.minX) * 0.5);
    const radiusY = Math.max(1, (bounds.maxY - bounds.minY) * 0.5);
    const desiredGap = roamerRadius(roamer) * 2 + AMBLE_SEPARATION_PAD;

    let best = null;
    let bestScore = -Number.POSITIVE_INFINITY;

    for (let i = 0; i < 8; i += 1) {
      const theta = randomBetween(0, Math.PI * 2);
      const ring = clamp01(randomBetween(EDGE_TARGET_MIN_RADIUS, EDGE_TARGET_MAX_RADIUS));
      const candidateX = centerX + Math.cos(theta) * radiusX * ring;
      const candidateY = centerY + Math.sin(theta) * radiusY * ring;
      const clampedX = clamp(candidateX, bounds.minX, bounds.maxX);
      const clampedY = clamp(candidateY, bounds.minY, bounds.maxY);
      const normalized = pointToNormalized(bounds, clampedX, clampedY);
      const nearest = nearestDistanceToOtherRoamers(roamer, clampedX, clampedY);
      const score = (Number.isFinite(nearest) ? nearest : desiredGap) + ring * 24 + Math.random() * 3;

      if (score > bestScore) {
        bestScore = score;
        best = {
          targetU: normalized.u,
          targetV: normalized.v,
          targetX: clampedX,
          targetY: clampedY
        };
      }

      if (Number.isFinite(nearest) && nearest >= desiredGap) {
        return {
          targetU: normalized.u,
          targetV: normalized.v,
          targetX: clampedX,
          targetY: clampedY
        };
      }
    }

    return (
      best || {
        targetU: 0.5,
        targetV: 0.5,
        targetX: centerX,
        targetY: centerY
      }
    );
  }

  function remapArenaRoamers() {
    document.querySelectorAll(".arena-roamer").forEach((roamer) => {
      const scene = roamer.closest(".arena-scene");
      if (!scene) return;

      const bounds = boundsForRoamer(scene, roamer);
      const state = arenaMotion.get(roamer);

      if (state) {
        const currentUv =
          Number.isFinite(state.u) && Number.isFinite(state.v)
            ? { u: clamp01(state.u), v: clamp01(state.v) }
            : readRoamerUv(roamer);
        const targetUv =
          Number.isFinite(state.targetU) && Number.isFinite(state.targetV)
            ? { u: clamp01(state.targetU), v: clamp01(state.targetV) }
            : pointToNormalized(bounds, state.targetX, state.targetY);

        const currentPoint = normalizedToBounds(bounds, currentUv.u, currentUv.v);
        const targetPoint = normalizedToBounds(bounds, targetUv.u, targetUv.v);

        state.scene = scene;
        state.minX = bounds.minX;
        state.maxX = bounds.maxX;
        state.minY = bounds.minY;
        state.maxY = bounds.maxY;
        state.centerX = bounds.centerX;
        state.centerY = bounds.centerY;
        state.radius = roamerRadius(roamer);
        state.u = currentUv.u;
        state.v = currentUv.v;
        state.x = currentPoint.x;
        state.y = currentPoint.y;
        state.targetU = targetUv.u;
        state.targetV = targetUv.v;
        state.targetX = targetPoint.x;
        state.targetY = targetPoint.y;

        writeRoamerUv(roamer, currentUv.u, currentUv.v);
        setRoamerPosition(roamer, currentPoint.x, currentPoint.y);
        setRoamerDepth(roamer, scene, currentPoint.y);
        setRoamerDebugBox(roamer, state.radius);
        return;
      }

      const uv = readRoamerUv(roamer);
      const point = normalizedToBounds(bounds, uv.u, uv.v);
      writeRoamerUv(roamer, uv.u, uv.v);
      setRoamerPosition(roamer, point.x, point.y);
      setRoamerDepth(roamer, scene, point.y);
      setRoamerDebugBox(roamer, roamerRadius(roamer));
    });

    if (arenaMotion.size > 0) {
      queueArenaTick();
    }
  }

  function separationForceForRoamer(roamer, state) {
    let forceX = 0;
    let forceY = 0;

    arenaMotion.forEach((otherState, otherRoamer) => {
      if (otherRoamer === roamer || !otherState) return;
      const dx = state.x - otherState.x;
      const dy = state.y - otherState.y;
      const dist = length(dx, dy);
      const gap = (state.radius || 22) + (otherState.radius || 22) + AMBLE_SEPARATION_PAD;
      if (dist <= 0.001 || dist >= gap) return;

      const push = ((gap - dist) / gap) ** 2;
      const away = normalize(dx, dy);
      forceX += away.x * push;
      forceY += away.y * push;
    });

    return { x: forceX, y: forceY };
  }

  function beginRoamerAmble(roamer) {
    const scene = roamer.closest(".arena-scene");
    if (!scene) return;
    if (arenaMotion.has(roamer)) return;

    const dino = roamer.querySelector("[data-dino]");
    if (!dino) return;

    const bounds = boundsForRoamer(scene, roamer);
    const stored = readRoamerUv(roamer);
    const storedPoint = normalizedToBounds(bounds, stored.u, stored.v);
    const x = clamp(storedPoint.x, bounds.minX, bounds.maxX);
    const y = clamp(storedPoint.y, bounds.minY, bounds.maxY);
    const normalized = pointToNormalized(bounds, x, y);
    const target = randomRoamerTarget(bounds, roamer);
    const now = performance.now();

    setRoamerPosition(roamer, x, y);
    setRoamerDepth(roamer, scene, y);
    setRoamerDebugBox(roamer, roamerRadius(roamer));
    writeRoamerUv(roamer, normalized.u, normalized.v);
    dino.classList.add("play-loop-walk");
    markArenaState(dino, "moving");

    arenaMotion.set(roamer, {
      scene,
      dino,
      x,
      y,
      u: normalized.u,
      v: normalized.v,
      vx: 0,
      vy: 0,
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
      centerX: bounds.centerX,
      centerY: bounds.centerY,
      radius: roamerRadius(roamer),
      targetU: target.targetU,
      targetV: target.targetV,
      targetX: target.targetX,
      targetY: target.targetY,
      speed: randomBetween(AMBLE_SPEED_MIN, AMBLE_SPEED_MAX),
      noiseX: 0,
      noiseY: 0,
      noiseUntil: now + randomBetweenInt(AMBLE_NOISE_MIN_MS, AMBLE_NOISE_MAX_MS),
      endAt: now + randomBetweenInt(AMBLE_DURATION_MIN_MS, AMBLE_DURATION_MAX_MS)
    });

    queueArenaTick();
  }

  function finishRoamerAmble(roamer, state) {
    if (!state) return;
    if (Number.isFinite(state.u) && Number.isFinite(state.v)) {
      writeRoamerUv(roamer, state.u, state.v);
    }
    state.dino.classList.remove("play-loop-walk");
    markArenaState(state.dino, "lounge");
    arenaMotion.delete(roamer);
  }

  function updateRoamerState(roamer, state, dt, now) {
    const bounds = boundsForRoamer(state.scene, roamer);
    state.minX = bounds.minX;
    state.maxX = bounds.maxX;
    state.minY = bounds.minY;
    state.maxY = bounds.maxY;
    state.centerX = bounds.centerX;
    state.centerY = bounds.centerY;
    state.radius = roamerRadius(roamer);

    if (now >= state.endAt) {
      finishRoamerAmble(roamer, state);
      return;
    }

    const toTargetX = state.targetX - state.x;
    const toTargetY = state.targetY - state.y;
    const targetDist = length(toTargetX, toTargetY);

    if (targetDist < 9) {
      const target = randomRoamerTarget(bounds, roamer);
      state.targetU = target.targetU;
      state.targetV = target.targetV;
      state.targetX = target.targetX;
      state.targetY = target.targetY;
    }

    if (now >= state.noiseUntil) {
      state.noiseX = randomBetween(-0.25, 0.25);
      state.noiseY = randomBetween(-0.18, 0.18);
      state.noiseUntil = now + randomBetweenInt(AMBLE_NOISE_MIN_MS, AMBLE_NOISE_MAX_MS);
    }

    const targetDir = normalize(state.targetX - state.x, state.targetY - state.y);
    const edgeForce = edgeBiasForce(state, bounds);
    const separation = separationForceForRoamer(roamer, state);

    const steerX = targetDir.x + state.noiseX * 0.7 + edgeForce.x * 0.85 + separation.x * 1.25;
    const steerY = targetDir.y + state.noiseY * 0.7 + edgeForce.y * 0.85 + separation.y * 1.25;
    const steerDir = normalize(steerX, steerY);

    const desiredVx = steerDir.x * state.speed;
    const desiredVy = steerDir.y * state.speed;
    state.vx += (desiredVx - state.vx) * 0.11;
    state.vy += (desiredVy - state.vy) * 0.11;

    state.x += state.vx * dt;
    state.y += state.vy * dt;

    if (state.x < state.minX) {
      state.x = state.minX;
      state.vx = Math.abs(state.vx) * 0.5;
      const target = randomRoamerTarget(bounds, roamer);
      state.targetU = target.targetU;
      state.targetV = target.targetV;
      state.targetX = target.targetX;
      state.targetY = target.targetY;
    } else if (state.x > state.maxX) {
      state.x = state.maxX;
      state.vx = -Math.abs(state.vx) * 0.5;
      const target = randomRoamerTarget(bounds, roamer);
      state.targetU = target.targetU;
      state.targetV = target.targetV;
      state.targetX = target.targetX;
      state.targetY = target.targetY;
    }

    if (state.y < state.minY) {
      state.y = state.minY;
      state.vy = Math.abs(state.vy) * 0.5;
      const target = randomRoamerTarget(bounds, roamer);
      state.targetU = target.targetU;
      state.targetV = target.targetV;
      state.targetX = target.targetX;
      state.targetY = target.targetY;
    } else if (state.y > state.maxY) {
      state.y = state.maxY;
      state.vy = -Math.abs(state.vy) * 0.5;
      const target = randomRoamerTarget(bounds, roamer);
      state.targetU = target.targetU;
      state.targetV = target.targetV;
      state.targetX = target.targetX;
      state.targetY = target.targetY;
    }

    const normalized = pointToNormalized(bounds, state.x, state.y);
    state.u = normalized.u;
    state.v = normalized.v;
    writeRoamerUv(roamer, normalized.u, normalized.v);
    setRoamerPosition(roamer, state.x, state.y);
    setRoamerDepth(roamer, state.scene, state.y);
    setRoamerDebugBox(roamer, state.radius);
    setFacingFromVx(state.dino, state.vx);
  }

  function queueArenaTick() {
    if (arenaRaf || arenaMotion.size === 0 || reducedMotion.matches) return;
    arenaRaf = window.requestAnimationFrame(stepArenaMotion);
  }

  function stepArenaMotion(timestamp) {
    arenaRaf = 0;

    if (reducedMotion.matches || arenaMotion.size === 0) {
      arenaLastTick = 0;
      return;
    }

    const now = timestamp;
    const dt = clamp(arenaLastTick ? now - arenaLastTick : 16, 8, 34);
    arenaLastTick = now;

    arenaMotion.forEach((state, roamer) => {
      if (!roamer.isConnected || !state.scene?.isConnected) {
        arenaMotion.delete(roamer);
        return;
      }
      updateRoamerState(roamer, state, dt, now);
    });

    if (arenaMotion.size > 0) {
      queueArenaTick();
    }
  }

  function stopArenaMotion() {
    if (arenaRaf) {
      window.cancelAnimationFrame(arenaRaf);
      arenaRaf = 0;
    }
    arenaLastTick = 0;
    arenaMotion.forEach((state) => {
      if (state?.dino) {
        state.dino.classList.remove("play-loop-walk");
        markArenaState(state.dino, "lounge");
      }
    });
    arenaMotion.clear();
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

  function nextRoamerTooltipMessage(roamer) {
    const count = Number.parseInt(roamer.dataset.tooltipCount || "0", 10) || 0;
    let message = "Click me!";

    if (count > 0) {
      const previous = roamer.dataset.tooltipLast || "";
      const pool =
        TOOLTIP_EMOTIONS.length > 1
          ? TOOLTIP_EMOTIONS.filter((emotion) => emotion !== previous)
          : TOOLTIP_EMOTIONS;
      message = pool[Math.floor(Math.random() * pool.length)] || ":)";
    }

    roamer.dataset.tooltipCount = String(count + 1);
    roamer.dataset.tooltipLast = message;
    return message;
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

  function beginRoamerTooltipInteraction(roamer) {
    if (!roamer) return;
    const message = nextRoamerTooltipMessage(roamer);
    showRoamerTooltip(roamer, message);
  }

  function endRoamerTooltipInteraction(roamer) {
    if (!roamer) return;
    hideRoamerTooltipIfAllowed(roamer);
  }

  function bindRoamerTooltips() {
    document.querySelectorAll(".arena-roamer").forEach((roamer) => {
      if (roamer.dataset.tooltipBound === "true") return;

      roamer.addEventListener("pointerenter", () => beginRoamerTooltipInteraction(roamer));
      roamer.addEventListener("focus", () => beginRoamerTooltipInteraction(roamer));
      roamer.addEventListener("pointerleave", () => endRoamerTooltipInteraction(roamer));
      roamer.addEventListener("blur", () => endRoamerTooltipInteraction(roamer));
      roamer.addEventListener(
        "touchstart",
        () => {
          beginRoamerTooltipInteraction(roamer);
          hideRoamerTooltipIfAllowed(roamer);
        },
        { passive: true }
      );

      roamer.dataset.tooltipBound = "true";
    });
  }

  function bindRoamerClicks() {
    document.querySelectorAll(".arena-roamer").forEach((roamer) => {
      if (roamer.dataset.ambleBound === "true") return;
      roamer.addEventListener("click", () => {
        if (reducedMotion.matches) return;
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

    remapArenaRoamers();
    bindRoamerTooltips();
    bindRoamerClicks();
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
