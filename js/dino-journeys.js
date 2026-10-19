/* One small, tab-local world shared by the public pages. No navigation delays. */
((root) => {
  const pages = ['home', 'books', 'photography', 'projects', 'writings', 'contact'];
  const kinds = ['stego', 'raptor', 'longneck'];
  const favorites = { stego: 'photography', raptor: 'projects', longneck: 'books' };
  const key = 'jfk-dino-journeys-v1';
  const fresh = now => ({ version: 1, updated: now, lastPage: '', nextTrip: now + 65000,
    members: Object.fromEntries(kinds.map(kind => [kind, { page: 'home', until: 0, fullUntil: 0 }])) });

  function pageForPath(path) {
    const name = path.replace(/\/index\.html$/, '/').replace(/^\/|\/$/g, '').replace(/\.html$/, '');
    return !name ? 'home' : pages.includes(name) ? name : null;
  }

  function create(storage, now = Date.now(), random = Math.random) {
    let data = fresh(now);
    try {
      const saved = JSON.parse(storage?.getItem(key) || 'null');
      if (saved?.version === 1 && Number.isFinite(saved.updated) && now - saved.updated < 1800000 && now >= saved.updated &&
          kinds.every(kind => pages.includes(saved.members?.[kind]?.page) && Number.isFinite(saved.members[kind].until))) {
        data = saved;
        if (!Number.isFinite(data.nextTrip)) data.nextTrip = now + 65000;
        // Discard malformed optional fields, and never allow multiple visitors.
        let away = false;
        kinds.forEach(kind => {
          const member = data.members[kind];
          if (member.page !== 'home') { if (away) member.page = 'home'; away = true; }
          if (!Number.isFinite(member.fullUntil)) member.fullUntil = 0;
          if (!member.position || !pages.includes(member.position.page) || !Number.isFinite(member.position.u) || !Number.isFinite(member.position.v)) delete member.position;
          if (![':)', ':D', ';)', ':P', ':]'].includes(member.reaction)) delete member.reaction;
        });
      }
    } catch (_) { /* Private browsing and blocked storage still get a working arena. */ }

    function save(time) {
      data.updated = time;
      try { storage?.setItem(key, JSON.stringify(data)); } catch (_) { /* Session memory is optional. */ }
    }
    function expire(time, engagedKind) {
      kinds.forEach(kind => {
        const member = data.members[kind];
        if (member.page !== 'home' && kind !== engagedKind && time >= member.until) member.page = 'home';
      });
    }
    function send(kind, page, time) {
      const member = data.members[kind];
      member.arriving = page;
      member.page = page;
      member.until = page === 'home' ? 0 : time + (favorites[kind] === page ? 105000 : 55000) + random() * 20000;
      data.nextTrip = time + 150000 + random() * 45000;
    }
    function choose(page, candidates) {
      const weights = candidates.map(kind => favorites[kind] === page ? 7 : kind === 'raptor' ? 4 : 1);
      let roll = random() * weights.reduce((a, b) => a + b, 0);
      return candidates.find((_, i) => (roll -= weights[i]) < 0) || candidates[0];
    }
    function arrive(page, time) {
      expire(time);
      const previous = data.lastPage;
      const interest = data.interest;
      const invited = interest?.page === page && time - interest.at < 12000 && kinds.includes(interest.kind);
      // Reloads and same-page links never reshuffle the population.
      if (page !== 'home' && page !== previous) {
        const away = kinds.find(kind => data.members[kind].page !== 'home');
        if (invited && (!away || away === interest.kind)) {
          send(interest.kind, page, time);
        } else if (away) {
          if (data.members[away].page !== page && random() < (away === 'raptor' ? .94 : .88)) send(away, page, time);
        } else if (random() < .9) {
          const candidates = kinds.filter(kind => time >= data.members[kind].fullUntil);
          if (candidates.length) send(choose(page, candidates), page, time);
        }
      } else if (page === 'home' && page !== previous) {
        const follower = kinds.find(kind => data.members[kind].page === previous);
        if (follower && random() < .9) send(follower, 'home', time);
      }
      delete data.interest;
      data.lastPage = page;
      save(time);
    }
    function tick(page, time, allowTrip, engagedKind) {
      expire(time, engagedKind);
      if (page === 'home' && allowTrip && time >= data.nextTrip && kinds.every(kind => data.members[kind].page === 'home')) {
        const candidates = kinds.filter(kind => time >= data.members[kind].fullUntil);
        if (candidates.length) {
          const kind = candidates[Math.floor(random() * candidates.length)];
          send(kind, favorites[kind], time);
          save(time);
        }
      }
    }
    function recall(type, time) {
      kinds.filter(kind => (kind === 'raptor' ? 'meat' : 'leaf') === type).forEach(kind => {
        if (data.members[kind].page !== 'home') send(kind, 'home', time);
      });
      data.nextTrip = Math.max(data.nextTrip, time + 65000);
      save(time);
    }
    function notice(page, time) {
      if (!pages.includes(page) || page === data.lastPage) return null;
      if (kinds.some(kind => data.members[kind].page !== 'home' && data.members[kind].page !== data.lastPage)) return null;
      const candidates = kinds.filter(kind => data.members[kind].page === data.lastPage && time >= data.members[kind].fullUntil);
      if (!candidates.length) return null;
      if (data.interest?.page === page && time - data.interest.at < 12000 && candidates.includes(data.interest.kind)) {
        data.interest.at = time;
        save(time);
        return data.interest.kind;
      }
      const kind = choose(page, candidates);
      data.interest = { page, kind, at: time };
      save(time);
      return kind;
    }
    return { data, arrive, tick, recall, notice, save };
  }
  const api = { create, pageForPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DinoJourneys = api;
})(typeof window === 'undefined' ? globalThis : window);
