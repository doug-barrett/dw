// Layered (Sugiyama-style) layout for the model canvas, aware of column ports.
//
//   nodes: [{ key, w, h, ports: { <colId>: <y offset of the row centre inside the card> } }]
//   edges: [{ from, fromPort, to, toPort }]  oriented child -> parent (parent is placed right)
//   returns { <key>: { x, y } }
//
// starLayout() is the dimensional variant: facts in the centre, dimensions around them (see below).
//
// Steps per connected component: break cycles, assign layers (longest path, then pull each node
// next to its neighbours), insert dummy nodes so long edges get a free corridor, order each layer
// by port barycentre keeping the ordering with the fewest crossings, then place nodes vertically
// as close as possible to the rows they connect to without overlapping (isotonic regression).
(function (root) {
  const NODE_GAP = 40;
  const DUMMY_GAP = 14;
  const DUMMY_H = 20;
  const LAYER_GAP = 170;
  const COMPONENT_GAP = 100;

  function layout(nodes, edges, opts = {}) {
    const origin = opts.origin || { x: 40, y: 40 };
    const maxHeight = opts.maxHeight || 900;
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    edges = edges.filter((e) => byKey.has(e.from) && byKey.has(e.to) && e.from !== e.to);

    // Connected components (union-find).
    const parent = new Map(nodes.map((n) => [n.key, n.key]));
    const find = (k) => {
      while (parent.get(k) !== k) {
        parent.set(k, parent.get(parent.get(k)));
        k = parent.get(k);
      }
      return k;
    };
    for (const e of edges) parent.set(find(e.from), find(e.to));
    const groups = new Map();
    for (const n of nodes) {
      const r = find(n.key);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(n);
    }

    const comps = [];
    const isolated = [];
    for (const g of groups.values()) {
      if (g.length === 1) isolated.push(g[0]);
      else {
        const ks = new Set(g.map((n) => n.key));
        const es = edges.filter((e) => ks.has(e.from));
        comps.push(layoutComponent(g, es, opts.layering ? opts.layering(g, es) : null));
      }
    }
    comps.sort((a, b) => b.count - a.count);

    // Components stacked vertically, isolated nodes in wrapped columns to the right.
    const out = {};
    let y = origin.y;
    let width = 0;
    for (const c of comps) {
      for (const [k, p] of c.pos) out[k] = { x: Math.round(origin.x + p.x), y: Math.round(y + p.y) };
      y += c.h + COMPONENT_GAP;
      width = Math.max(width, c.w);
    }
    const colHeight = Math.max(maxHeight, y - origin.y - COMPONENT_GAP);
    let x = origin.x + (comps.length ? width + LAYER_GAP : 0);
    let cy = 0;
    let colW = 0;
    for (const n of isolated) {
      if (cy > 0 && cy + n.h > colHeight) {
        x += colW + NODE_GAP * 2;
        cy = 0;
        colW = 0;
      }
      out[n.key] = { x: Math.round(x), y: Math.round(origin.y + cy) };
      cy += n.h + NODE_GAP;
      colW = Math.max(colW, n.w);
    }
    return out;
  }

  function assignLayers(keys, es) {
    // 1. Break cycles: reverse DFS back edges.
    const out = new Map(keys.map((k) => [k, []]));
    es.forEach((e, i) => out.get(e.from).push(i));
    const state = new Map();
    const rev = new Set();
    const visit = (k) => {
      state.set(k, 1);
      for (const i of out.get(k)) {
        const s = state.get(es[i].to);
        if (s === 1) rev.add(i);
        else if (!s) visit(es[i].to);
      }
      state.set(k, 2);
    };
    keys.forEach((k) => state.get(k) || visit(k));
    const D = es.map((e, i) =>
      rev.has(i) ? { from: e.to, fp: e.toPort, to: e.from, tp: e.fromPort } : { from: e.from, fp: e.fromPort, to: e.to, tp: e.toPort },
    );

    // 2. Layers: longest path from the leaves, then move nodes next to their neighbours.
    const layer = new Map(keys.map((k) => [k, 0]));
    const indeg = new Map(keys.map((k) => [k, 0]));
    D.forEach((e) => indeg.set(e.to, indeg.get(e.to) + 1));
    const queue = keys.filter((k) => indeg.get(k) === 0);
    while (queue.length) {
      const k = queue.shift();
      for (const e of D) {
        if (e.from !== k) continue;
        layer.set(e.to, Math.max(layer.get(e.to), layer.get(k) + 1));
        indeg.set(e.to, indeg.get(e.to) - 1);
        if (indeg.get(e.to) === 0) queue.push(e.to);
      }
    }
    for (let it = 0; it < 4; it++) {
      for (const k of keys) {
        const children = D.filter((e) => e.to === k).map((e) => layer.get(e.from));
        const parents = D.filter((e) => e.from === k).map((e) => layer.get(e.to));
        const lo = children.length ? Math.max(...children) + 1 : -Infinity;
        const hi = parents.length ? Math.min(...parents) - 1 : Infinity;
        const ideal = [...children.map((l) => l + 1), ...parents.map((l) => l - 1)].sort((a, b) => a - b);
        if (!ideal.length) continue;
        const med = ideal[Math.floor((ideal.length - 1) / 2)];
        layer.set(k, Math.min(hi, Math.max(lo, med)));
      }
    }
    return { D, layer };
  }

  // preset: optional Map key -> layer (e.g. from the spine layout); skips steps 1 and 2.
  function layoutComponent(ns, es, preset) {
    const keys = ns.map((n) => n.key);
    const N = new Map(ns.map((n) => [n.key, n]));
    let D, layer;
    if (preset) {
      layer = new Map(keys.map((k) => [k, preset.get(k) ?? 0]));
      D = es
        .filter((e) => layer.get(e.from) !== layer.get(e.to))
        .map((e) => (layer.get(e.from) < layer.get(e.to) ? { from: e.from, fp: e.fromPort, to: e.to, tp: e.toPort } : { from: e.to, fp: e.toPort, to: e.from, tp: e.fromPort }));
    } else {
      ({ D, layer } = assignLayers(keys, es));
    }
    const minL = Math.min(...layer.values());
    for (const k of keys) layer.set(k, layer.get(k) - minL);
    const L = Math.max(...layer.values()) + 1;


    // 3. Items per layer, with dummies along edges that span several layers.
    const items = new Map();
    const layers = Array.from({ length: L }, () => []);
    for (const k of keys) {
      const n = N.get(k);
      const it = { key: k, h: n.h, w: n.w, dummy: false, ports: n.ports || {}, layer: layer.get(k) };
      items.set(k, it);
      layers[it.layer].push(it);
    }
    const off = (it, port) => (it.dummy ? DUMMY_H / 2 : it.ports[port] ?? it.h / 2);
    const segs = []; // between adjacent layers: { a (left), ao, b (right), bo }
    D.forEach((e, i) => {
      let a = items.get(e.from);
      let b = items.get(e.to);
      let ao = off(a, e.fp);
      const bo = off(b, e.tp);
      if (a.layer > b.layer) {
        // Can only happen for edges flattened onto one layer; skip, they draw as loops.
        return;
      }
      for (let l = a.layer + 1; l < b.layer; l++) {
        const d = { key: `~${i}:${l}`, h: DUMMY_H, w: 0, dummy: true, ports: {}, layer: l };
        items.set(d.key, d);
        layers[l].push(d);
        segs.push({ a, ao, b: d, bo: DUMMY_H / 2 });
        a = d;
        ao = DUMMY_H / 2;
      }
      if (a.layer < b.layer) segs.push({ a, ao, b, bo });
    });
    const left = new Map([...items.keys()].map((k) => [k, []]));
    const right = new Map([...items.keys()].map((k) => [k, []]));
    for (const s of segs) {
      right.get(s.a.key).push(s);
      left.get(s.b.key).push(s);
    }

    const gapBetween = (a, b) => (a.dummy || b.dummy ? DUMMY_GAP : NODE_GAP);
    const stack = (arr) => {
      let y = 0;
      arr.forEach((it, i) => {
        if (i) y += gapBetween(arr[i - 1], it);
        it.y = y;
        y += it.h;
      });
    };
    layers.forEach(stack);

    const crossings = () => {
      let c = 0;
      for (let l = 0; l < L - 1; l++) {
        const ss = segs.filter((s) => s.a.layer === l);
        for (let i = 0; i < ss.length; i++)
          for (let j = i + 1; j < ss.length; j++) {
            const da = ss[i].a.y + ss[i].ao - (ss[j].a.y + ss[j].ao);
            const db = ss[i].b.y + ss[i].bo - (ss[j].b.y + ss[j].bo);
            if (da * db < 0) c++;
          }
      }
      return c;
    };

    // 4. Ordering: alternate barycentre sweeps, keep the best.
    let best = layers.map((l) => l.slice());
    let bestC = crossings();
    for (let it = 0; it < 24 && bestC > 0; it++) {
      const down = it % 2 === 0;
      const range = down ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].reverse().slice(1);
      for (const l of range) {
        const bc = new Map();
        for (const item of layers[l]) {
          const ss = down ? left.get(item.key) : right.get(item.key);
          const vals = ss.map((s) => (down ? s.a.y + s.ao - s.bo : s.b.y + s.bo - s.ao));
          bc.set(item, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : item.y);
        }
        layers[l].sort((p, q) => bc.get(p) - bc.get(q));
        stack(layers[l]);
      }
      const c = crossings();
      if (c < bestC) {
        bestC = c;
        best = layers.map((l) => l.slice());
      }
    }
    best.forEach((arr, l) => {
      layers[l] = arr;
      stack(arr);
    });

    // 5. Vertical placement: pull nodes towards connected rows, order and spacing preserved.
    for (let it = 0; it < 40; it++) {
      const order = it % 2 === 0 ? [...Array(L).keys()] : [...Array(L).keys()].reverse();
      for (const l of order) {
        const arr = layers[l];
        const desired = arr.map((item) => {
          const vals = [
            ...left.get(item.key).map((s) => s.a.y + s.ao - s.bo),
            ...right.get(item.key).map((s) => s.b.y + s.bo - s.ao),
          ];
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : item.y;
        });
        place(arr, desired, gapBetween);
      }
    }

    // 6. X per layer; wider gaps where many edges run between two layers.
    const xs = [];
    let x = 0;
    for (let l = 0; l < L; l++) {
      xs.push(x);
      const w = Math.max(0, ...layers[l].map((i) => i.w));
      const between = segs.filter((s) => s.a.layer === l).length;
      x += w + LAYER_GAP + Math.min(120, between * 8);
    }
    const real = [...items.values()].filter((i) => !i.dummy);
    const minY = Math.min(...[...items.values()].map((i) => i.y));
    const pos = new Map(real.map((i) => [i.key, { x: xs[i.layer], y: i.y - minY }]));
    const h = Math.max(...real.map((i) => i.y - minY + i.h));
    const w = Math.max(...real.map((i) => xs[i.layer] + i.w));
    return { pos, w, h, count: real.length };
  }

  // Least-squares placement of an ordered column of boxes with minimum gaps (pool adjacent violators).
  function place(arr, desired, gapBetween) {
    const offs = [];
    let o = 0;
    arr.forEach((it, i) => {
      if (i) o += arr[i - 1].h + gapBetween(arr[i - 1], it);
      offs.push(o);
    });
    const blocks = [];
    arr.forEach((_, i) => {
      blocks.push({ sum: desired[i] - offs[i], n: 1 });
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1];
        const a = blocks[blocks.length - 2];
        if (a.sum / a.n <= b.sum / b.n) break;
        a.sum += b.sum;
        a.n += b.n;
        blocks.pop();
      }
    });
    let i = 0;
    for (const b of blocks) for (let j = 0; j < b.n; j++, i++) arr[i].y = b.sum / b.n + offs[i];
  }

  // Star / snowflake layout. Facts (nodes flagged `fact`, else the nodes with the most outgoing
  // many-to-one edges and none incoming) form the centre column. Their dimensions sit left and
  // right, alternating in the order of the fact rows they join, so lines on one side never cross;
  // each is pulled level with its fact row without overlapping. Outriggers (dimensions of
  // dimensions) go one ring further out on the same side. Everything not reachable from a fact is
  // laid out with the layered layout to the right.
  function starLayout(nodes, edges, opts = {}) {
    const origin = opts.origin || { x: 40, y: 40 };
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    edges = edges.filter((e) => byKey.has(e.from) && byKey.has(e.to) && e.from !== e.to);
    const out = (k) => edges.filter((e) => e.from === k);
    const inc = (k) => edges.filter((e) => e.to === k);

    let facts = nodes.filter((n) => n.fact && (out(n.key).length || inc(n.key).length));
    if (!facts.length) {
      const best = Math.max(0, ...nodes.map((n) => (inc(n.key).length ? 0 : out(n.key).length)));
      facts = best >= 2 ? nodes.filter((n) => !inc(n.key).length && out(n.key).length === best) : [];
    }
    if (!facts.length) return layout(nodes, edges, opts);
    const factSet = new Set(facts.map((f) => f.key));

    // Centre column: facts stacked.
    const pos = new Map();
    let fy = 0;
    for (const f of facts) {
      pos.set(f.key, { x: 0, y: fy });
      fy += f.h + NODE_GAP * 2;
    }
    const portY = (key, port) => pos.get(key).y + (byKey.get(key).ports?.[port] ?? byKey.get(key).h / 2);

    // Ring 1: direct dimensions of the facts, ordered by the fact row they join.
    const ring1 = new Map(); // key -> desired y (mean of joining fact rows)
    for (const e of edges) {
      const [f, d, fp] = factSet.has(e.from) ? [e.from, e.to, e.fromPort] : factSet.has(e.to) ? [e.to, e.from, e.toPort] : [];
      if (!f || factSet.has(d)) continue;
      if (!ring1.has(d)) ring1.set(d, []);
      ring1.get(d).push(portY(f, fp));
    }
    const ordered = [...ring1].map(([k, ys]) => ({ key: k, want: ys.reduce((a, b) => a + b, 0) / ys.length })).sort((a, b) => a.want - b.want);
    const side = new Map();
    ordered.forEach((d, i) => side.set(d.key, i % 2 === 0 ? "right" : "left"));

    // Further rings: outriggers inherit the side of the dimension that reaches them first.
    const rings = [ordered.map((d) => d.key)];
    const seen = new Set([...factSet, ...rings[0]]);
    while (rings[rings.length - 1].length) {
      const next = [];
      for (const k of rings[rings.length - 1]) {
        for (const e of [...out(k), ...inc(k)]) {
          const o = e.from === k ? e.to : e.from;
          if (seen.has(o)) continue;
          seen.add(o);
          side.set(o, side.get(k));
          next.push(o);
        }
      }
      rings.push(next);
    }
    rings.pop();

    // Place ring by ring, each side as an ordered column pulled towards its connections.
    const factMidY = facts.reduce((t, f) => t + pos.get(f.key).y + f.h / 2, 0) / facts.length;
    // Outer edge of what is placed so far on each side; rings grow outwards from the facts.
    const factW = Math.max(...facts.map((f) => f.w));
    const edge = { right: factW, left: 0 };
    const gap = LAYER_GAP + 60;
    rings.forEach((ring) => {
      for (const s of ["right", "left"]) {
        const items = ring.filter((k) => side.get(k) === s).map((k) => byKey.get(k));
        if (!items.length) continue;
        const w = Math.max(...items.map((n) => n.w));
        const x = s === "right" ? edge.right + gap : edge.left - gap - w;
        edge[s] = s === "right" ? x + w : x;
        const desired = items.map((n) => {
          const ys = [];
          for (const e of [...out(n.key), ...inc(n.key)]) {
            const o = e.from === n.key ? e.to : e.from;
            if (!pos.has(o)) continue;
            const [myPort, otherPort] = e.from === n.key ? [e.fromPort, e.toPort] : [e.toPort, e.fromPort];
            ys.push(portY(o, otherPort) - (n.ports?.[myPort] ?? n.h / 2));
          }
          return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
        });
        const order = items.map((n, i) => ({ n, d: desired[i] })).sort((a, b) => a.d - b.d);
        const col = order.map((o) => ({ key: o.n.key, h: o.n.h, y: 0 }));
        // Short (compact) cards all want the same row height; give them room so the star reads.
        const avgH = col.reduce((t, c) => t + c.h, 0) / col.length;
        const vgap = avgH < 100 ? NODE_GAP * 2.5 : NODE_GAP;
        place(col, order.map((o) => o.d), () => vgap);
        // Arc: the further a card sits above or below the facts, the more it moves inwards.
        for (const c of col) {
          const dy = Math.abs(c.y + c.h / 2 - factMidY);
          const shift = Math.min(gap * 0.5, dy * 0.35);
          const bx = s === "right" ? x - shift : x + (w - byKey.get(c.key).w) + shift;
          pos.set(c.key, { x: bx, y: c.y });
        }
      }
    });

    // Normalise to the origin.
    const minX = Math.min(...[...pos.values()].map((p) => p.x));
    const minY = Math.min(...[...pos.values()].map((p) => p.y));
    const result = {};
    let maxX = -Infinity;
    for (const [k, p] of pos) {
      result[k] = { x: Math.round(origin.x + p.x - minX), y: Math.round(origin.y + p.y - minY) };
      maxX = Math.max(maxX, result[k].x + byKey.get(k).w);
    }
    const rest = nodes.filter((n) => !pos.has(n.key));
    if (rest.length) {
      const restKeys = new Set(rest.map((n) => n.key));
      Object.assign(result, layout(rest, edges.filter((e) => restKeys.has(e.from) && restKeys.has(e.to)), { ...opts, origin: { x: maxX + LAYER_GAP, y: origin.y } }));
    }
    return result;
  }

  // Data Vault "spine" layout: hubs in K columns, links in the columns between and beside them,
  // satellites next to their parent. Nodes may carry role "hub" | "link" | "sat"; without it the
  // role is inferred from the edges (child -> parent): only incoming = hub, 2+ outgoing = link,
  // one outgoing = satellite. Hubs are split into K balanced groups with as few links as possible
  // crossing between groups, so related hubs stay together; a link bridging two neighbouring hub
  // columns sits between them, a link within one group goes beside it on the emptier side.
  // Vertical order and placement come from the layered engine (layoutComponent).
  function spineLayout(nodes, edges, opts = {}) {
    return layout(nodes, edges, { ...opts, layering: spineLayers });
  }

  function spineLayers(ns, es) {
    const byKey = new Map(ns.map((n) => [n.key, n]));
    const outs = (k) => es.filter((e) => e.from === k).map((e) => e.to);
    const ins = (k) => es.filter((e) => e.to === k).map((e) => e.from);
    const role = new Map(
      ns.map((n) => [n.key, n.role || (!outs(n.key).length ? "hub" : outs(n.key).length >= 2 ? "link" : "sat")]),
    );
    const hubs = ns.filter((n) => role.get(n.key) === "hub").map((n) => n.key);
    if (!hubs.length) return null;
    const hubSet = new Set(hubs);
    const neighbours = (k) => [...new Set([...outs(k), ...ins(k)])];
    const links = ns
      .filter((n) => role.get(n.key) === "link")
      .map((n) => ({ key: n.key, hubs: neighbours(n.key).filter((o) => hubSet.has(o)) }))
      .filter((l) => l.hubs.length);

    // --- split hubs into K ordered groups ---
    const K = hubs.length <= 3 ? 1 : Math.max(2, Math.round(Math.sqrt(hubs.length / 3)));
    const cost = (g) => {
      let c = 0;
      for (const l of links) {
        const gs = l.hubs.map((h) => g.get(h));
        const span = Math.max(...gs) - Math.min(...gs);
        c += span === 0 ? 0 : span === 1 ? 1 : 4 * span;
      }
      const sizes = Array(K).fill(0);
      for (const h of hubs) sizes[g.get(h)]++;
      const avg = hubs.length / K;
      return c + 0.6 * sizes.reduce((t, s) => t + (s - avg) ** 2, 0);
    };
    const adj = new Map(hubs.map((h) => [h, new Set()]));
    for (const l of links) for (const a of l.hubs) for (const b of l.hubs) if (a !== b) adj.get(a).add(b);
    let best = null;
    let bestCost = Infinity;
    for (const root of hubs) {
      // BFS order keeps neighbours close; cut it into K contiguous chunks, then improve locally.
      const order = [];
      const seen = new Set();
      for (const start of [root, ...hubs]) {
        if (seen.has(start)) continue;
        const q = [start];
        seen.add(start);
        while (q.length) {
          const h = q.shift();
          order.push(h);
          for (const o of [...adj.get(h)].sort()) if (!seen.has(o)) (seen.add(o), q.push(o));
        }
      }
      const g = new Map(order.map((h, i) => [h, Math.min(K - 1, Math.floor((i * K) / order.length))]));
      let c = cost(g);
      for (let pass = 0, improved = true; improved && pass < 50; pass++) {
        improved = false;
        for (const h of hubs) {
          for (let t = 0; t < K; t++) {
            if (t === g.get(h)) continue;
            const old = g.get(h);
            g.set(h, t);
            const nc = cost(g);
            if (nc < c - 1e-9) (c = nc), (improved = true);
            else g.set(h, old);
          }
          for (const o of hubs) {
            if (g.get(o) === g.get(h)) continue;
            const [gh, go] = [g.get(h), g.get(o)];
            g.set(h, go), g.set(o, gh);
            const nc = cost(g);
            if (nc < c - 1e-9) (c = nc), (improved = true);
            else g.set(h, gh), g.set(o, go);
          }
        }
      }
      if (c < bestCost) (bestCost = c), (best = g);
    }

    // --- layers: hub group i -> 2i+1, links and satellites in the even layers around them ---
    const layer = new Map();
    const load = new Map();
    const put = (k, l) => {
      layer.set(k, l);
      load.set(l, (load.get(l) || 0) + (byKey.get(k).h || 40) + NODE_GAP);
    };
    for (const h of hubs) put(h, 2 * best.get(h) + 1);
    const centre = K; // middle layer index of 0..2K
    const pick = (a, b, preferOuter) => {
      const la = load.get(a) || 0, lb = load.get(b) || 0;
      if (la !== lb) return la < lb ? a : b;
      const da = Math.abs(a - centre), db = Math.abs(b - centre);
      return preferOuter ? (da >= db ? a : b) : da <= db ? a : b;
    };
    const span = (l) => {
      const gs = l.hubs.map((h) => best.get(h));
      return [Math.min(...gs), Math.max(...gs)];
    };
    // Bridging links first (their place is fixed).
    const internal = [];
    for (const l of links) {
      const [lo, hi] = span(l);
      if (hi === lo) internal.push(l);
      else put(l.key, 2 * Math.floor((lo + hi) / 2) + 2);
    }
    // Links within one group: the column between hub columns is the spine and takes them, up to
    // one more than the tallest hub column. Links to a leaf hub (a hub with no other link) and
    // wide links (3+ hubs) go on the outer side, where the branch has room.
    const hubDegree = new Map(hubs.map((h) => [h, links.filter((l) => l.hubs.includes(h)).length]));
    const bridging = new Set(links.filter((l) => span(l)[0] !== span(l)[1]).flatMap((l) => l.hubs));
    const count = new Map();
    for (const [k, l] of layer) count.set(l, (count.get(l) || 0) + (role.get(k) === "hub" ? 0 : 1));
    const groupSize = Array(K).fill(0);
    for (const h of hubs) groupSize[best.get(h)]++;
    const cap = Math.max(...groupSize) + 1;
    const spineScore = (l) => l.hubs.filter((h) => bridging.has(h)).length / l.hubs.length;
    const outward = (l) => l.hubs.length >= 3 || l.hubs.some((h) => hubDegree.get(h) === 1);
    internal.sort((a, b) => outward(a) - outward(b) || spineScore(b) - spineScore(a));
    for (const l of internal) {
      const g = best.get(l.hubs[0]);
      const sides = [2 * g, 2 * g + 2];
      const inner = sides.filter((x) => x > 0 && x < 2 * K);
      const outer = sides.filter((x) => x === 0 || x === 2 * K);
      const roomy = inner.filter((x) => (count.get(x) || 0) < cap);
      let target;
      if (!outward(l) && roomy.length) target = roomy.length > 1 ? pick(roomy[0], roomy[1], false) : roomy[0];
      else if (outer.length) target = outer[0];
      else target = pick(sides[0], sides[1], false);
      put(l.key, target);
      count.set(target, (count.get(target) || 0) + 1);
    }
    // Satellites and other single-parent nodes beside their parent; repeat for chains (sat of a link).
    for (let pass = 0, todo = ns.filter((n) => !layer.has(n.key)); todo.length && pass < 5; pass++) {
      for (const n of todo) {
        const parent = neighbours(n.key).find((o) => layer.has(o));
        if (parent !== undefined) put(n.key, pick(layer.get(parent) - 1, layer.get(parent) + 1, true));
      }
      todo = todo.filter((n) => !layer.has(n.key));
    }
    for (const n of ns) if (!layer.has(n.key)) put(n.key, 0);
    return layer;
  }

  const api = { layout, starLayout, spineLayout };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ModelLayout = api;
})(typeof window !== "undefined" ? window : globalThis);
