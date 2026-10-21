const DBK = "__mockdb2";
try { if (!localStorage.getItem("__allowquiz")) localStorage.setItem("heden.quiz.later", "1"); } catch (e) {}
const load = () => JSON.parse(localStorage.getItem(DBK) || '{"profiles":[],"maps":[],"map_members":[],"map_invites":[],"zones":[],"ratings":[],"zone_photos":[],"calls":[]}');
const persist = db => localStorage.setItem(DBK, JSON.stringify(db));
const uuid = () => crypto.randomUUID();
const IDS = {"johan@x.fr": "11111111-1111-4111-8111-111111111111", "lea@x.fr": "33333333-3333-4333-8333-333333333333", "max@x.fr": "44444444-4444-4444-8444-444444444444"};
window.supabase = { createClient() {
  let session = JSON.parse(sessionStorage.getItem("__mocksession") || (localStorage.getItem("__sharesession") && localStorage.getItem("__mocksession")) || "null"), cbs = [];
  const fire = ev => cbs.forEach(cb => cb(ev, session));
  const uid = () => session && session.user.id;
  const member = (db, m) => db.map_members.some(x => x.map_id === m && x.user_id === uid());
  const visible = (db, table, r) => {
    if (table === "maps") return member(db, r.id);
    if (table === "map_members") return member(db, r.map_id);
    if (table === "zones") return member(db, r.map_id);
    if (table === "ratings" || table === "zone_photos") { const z = db.zones.find(z => z.id === r.zone_id); return z && member(db, z.map_id); }
    if (table === "ingest_tokens" || table === "inbox") return r.user_id === uid();
    if (table === "listings") return member(db, r.map_id);
    if (table === "profiles") return r.id === uid() || db.map_members.some(a => a.user_id === uid() && db.map_members.some(b => b.map_id === a.map_id && b.user_id === r.id));
    return true;
  };
  function builder(table) {
    const q = {op: "select", filters: [], single: false};
    const api = {
      select(cols) { q.cols = cols; return api; },
      eq(k, v) { q.filters.push(r => r[k] === v); return api; },
      in(k, vs) { q.filters.push(r => vs.includes(r[k])); return api; },
      is(k, v) { q.filters.push(r => (r[k] ?? null) === v); return api; },
      gt(k, v) { q.filters.push(r => r[k] > v); return api; },
      maybeSingle() { q.single = true; return api; },
      order() { return api; },
      limit(n) { q.limit = n; return api; },
      upsert(rows) { q.op = "upsert"; q.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      insert(rows) { q.op = "upsert"; q.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      delete() { q.op = "delete"; return api; },
      update(vals) { q.op = "update"; q.vals = vals; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      const db = load(); db.calls.push(q.op + ":" + table); db[table] = db[table] || [];
      const key = table === "ratings" ? r => r.zone_id + "|" + r.user_id : r => r.id;
      if (q.op === "upsert") {
        for (const r of q.rows) {
          if (table === "zones" && !member(db, r.map_id)) return {error: {message: "RLS zones"}};
          if (table === "ratings" && r.user_id !== uid()) return {error: {message: "RLS ratings"}};
          const i = db[table].findIndex(x => key(x) === key(r));
          if (i >= 0) db[table][i] = Object.assign({}, db[table][i], r); else db[table].push(Object.assign({created_at: new Date().toISOString()}, r));
        }
        persist(db); return {error: null};
      }
      if (q.op === "update") { db[table].forEach(r => { if (visible(db, table, r) && q.filters.every(f => f(r))) Object.assign(r, q.vals); }); persist(db); return {error: null}; }
      if (q.op === "delete") { const del = db[table].filter(r => visible(db, table, r) && q.filters.every(f => f(r))); const ids = del.map(r => r.id); db[table] = db[table].filter(r => !del.includes(r)); if (table === "zones") db.ratings = db.ratings.filter(r => !ids.includes(r.zone_id)); persist(db); return {error: null}; }
      let rows = db[table].filter(r => visible(db, table, r) && q.filters.every(f => f(r)));
      if (table === "zones" && /ratings/.test(q.cols || "")) rows = rows.map(z => Object.assign({}, z, {ratings: db.ratings.filter(r => r.zone_id === z.id)}));
      if (table === "maps" && /map_members/.test(q.cols || "")) rows = rows.map(m => Object.assign({}, m, {map_members: db.map_members.filter(x => x.map_id === m.id)}));
      persist(db);
      if (q.limit) rows = rows.slice(0, q.limit);
      return {data: q.single ? (rows[0] || null) : JSON.parse(JSON.stringify(rows)), error: null};
    }
    return api;
  }
  async function rpc(name, args) {
    const db = load(); db.calls.push("rpc:" + name); const me = uid(); let out = null;
    const code = () => uuid().replace(/-/g, "").slice(0, 8).toUpperCase();
    if (name === "ensure_personal_map") {
      let m = db.maps.find(x => x.owner === me && x.kind === "perso");
      if (!m) { m = {id: uuid(), owner: me, name: "Ma carte", kind: "perso", created_at: new Date().toISOString()}; db.maps.push(m); db.map_members.push({map_id: m.id, user_id: me, role: "proprietaire"}); }
      if (!db.profiles.some(p => p.id === me)) db.profiles.push({id: me, display_name: "", criteria: []});
      out = m.id;
    } else if (name === "create_shared_map") {
      const m = {id: uuid(), owner: me, name: args.map_name || "Carte partagée", kind: "partagee", created_at: new Date().toISOString()};
      db.maps.push(m); db.map_members.push({map_id: m.id, user_id: me, role: "proprietaire"});
      const c = code(); db.map_invites.push({code: c, map_id: m.id}); out = [{map_id: m.id, code: c}];
    } else if (name === "new_invite") { const c = code(); db.map_invites.push({code: c, map_id: args.m}); out = c; }
    else if (name === "join_map") {
      const inv = db.map_invites.find(x => x.code === String(args.invite_code).trim().toUpperCase());
      if (!inv) { persist(db); return {data: null, error: {message: "code invalide ou expiré"}}; }
      if (!db.map_members.some(x => x.map_id === inv.map_id && x.user_id === me)) db.map_members.push({map_id: inv.map_id, user_id: me, role: "membre"});
      out = inv.map_id;
    } else if (name === "new_ingest_token") {
      db.ingest_tokens = (db.ingest_tokens || []).filter(x => x.user_id !== me); out = "t" + uuid().replace(/-/g, "") + uuid().replace(/-/g, "").slice(0, 31);
      db.ingest_tokens.push({user_id: me, token: out, last_at: null, received: 0});
    } else if (name === "set_map_criteria") {
      const m = db.maps.find(x => x.id === args.m); if (m) m.criteria = args.c;
    } else if (name === "vivier_prendre") {   // le vivier : e-mails en attente, puis annonces déposées
      out = (db.vivier_courrier || []).splice(0, args.n || 5);
    } else if (name === "vivier_poser") {
      const at = new Date().toISOString(); db.vivier = db.vivier || [];
      for (const a of args.p_annonces || []) db.vivier.push({id: uuid(), url: a.url, source: a.source, kind: a.kind, postcode: a.postcode, price: a.price, surface: a.surface, rooms: a.rooms, carte: a.carte, first_seen: at, last_seen: at, gone_at: null});
      out = (args.p_annonces || []).length;
    } else if (name === "leave_map") {
      db.map_members = db.map_members.filter(x => !(x.map_id === args.m && x.user_id === me));
    }
    persist(db); return {data: out, error: null};
  }
  return {
    auth: {
      onAuthStateChange(cb) { cbs.push(cb); setTimeout(() => cb("INITIAL_SESSION", session), 0); return {data: {subscription: {unsubscribe() {}}}}; },
      async signInWithOtp() { return {error: null}; },
      async verifyOtp({email, token}) { if (token !== "123456") return {error: {message: "bad"}}; session = {user: {id: IDS[email], email}}; sessionStorage.setItem("__mocksession", JSON.stringify(session)); localStorage.setItem("__mocksession", JSON.stringify(session)); fire("SIGNED_IN"); return {error: null}; },
      async signOut() { session = null; sessionStorage.removeItem("__mocksession"); localStorage.removeItem("__mocksession"); fire("SIGNED_OUT"); return {error: null}; }
    },
    rpc, from: builder,
    storage: { from() { return {
      async upload(path, blob) {
        const me = uid(); if (!me || path.split("/")[0] !== me) return {error: {message: "RLS storage"}};
        const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        const st = JSON.parse(localStorage.getItem("__mockstore") || "{}"); st[path] = url; localStorage.setItem("__mockstore", JSON.stringify(st));
        const db = load(); db.calls.push("upload"); persist(db); return {data: {path}, error: null};
      },
      async createSignedUrls(paths) { const st = JSON.parse(localStorage.getItem("__mockstore") || "{}"); return {data: paths.map(p => ({path: p, signedUrl: st[p] || null})), error: null}; },
      async remove(paths) { const st = JSON.parse(localStorage.getItem("__mockstore") || "{}"); paths.forEach(p => delete st[p]); localStorage.setItem("__mockstore", JSON.stringify(st)); return {error: null}; }
    }; } },
    channel() { const ch = {on() { return ch; }, subscribe() { return ch; }}; return ch; },
    removeChannel() {}
  };
}};
