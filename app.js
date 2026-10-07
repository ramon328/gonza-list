(() => {
  'use strict';

  const STORAGE_KEY = 'lista-familiar:v1';
  const SHARE_PREFIX = '#lista=';
  const COLORS = ['#2f7d4f', '#c2562f', '#3a6ea5', '#a8467a', '#b07d12', '#6a4fb3', '#2b8a8a', '#5b6b2f'];
  const OTHER_CATEGORY = { id: 'otros', name: 'Otros', emoji: '🛍️', items: [] };

  const DEFAULT_CATALOG = [
    { id: 'frutas', name: 'Frutas y verduras', emoji: '🥑', items: ['Palta', 'Tomate', 'Lechuga', 'Limones', 'Pepino', 'Cebolla', 'Cilantro', 'Papa', 'Cibulete'] },
    { id: 'lacteos', name: 'Lácteos, fiambres y pan', emoji: '🧀', items: ['Huevo', 'Queso', 'Jamón', 'Mantequilla', 'Paté', 'Pan', 'Leche'] },
    { id: 'despensa', name: 'Despensa', emoji: '🫙', items: ['Arroz', 'Choclo', 'Palmito', 'Aceite oliva', 'Aceto', 'Sal normal', 'Sal parrillera', 'Mostaza', 'Mayonesa'] },
    { id: 'desayuno', name: 'Desayuno y bebidas', emoji: '☕', items: ['Café', 'Té', 'Endulzante', 'Cerveza', 'Coca Zero', 'Coca Light', 'Vino', 'Fernet', 'Jugos'] },
    { id: 'aseo', name: 'Aseo y hogar', emoji: '🧻', items: ['Papel higiénico', 'Toalla nova', 'Servilleta', 'Quix'] },
  ];

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => self.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
  const norm = (s) => String(s).trim().toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function defaultState() {
    return {
      catalog: DEFAULT_CATALOG.map((c) => ({ ...c, items: [...c.items] })),
      members: [],
      active: null,
    };
  }

  // ---------- persistence ----------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.catalog) || !Array.isArray(s.members)) return defaultState();
      return s;
    } catch {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      toast('No se pudo guardar en este navegador');
    }
  }

  function commit() {
    save();
    render();
  }

  let state = load();
  let editTarget = null;
  let catalogMode = false;
  let shareTarget = null;
  let pendingImport = null;

  // Ask the browser not to evict our data when storage is low.
  navigator.storage?.persist?.().catch(() => {});

  // ---------- queries ----------

  const catInfo = (id) => state.catalog.find((c) => c.id === id) ?? OTHER_CATEGORY;
  const memberById = (id) => state.members.find((m) => m.id === id);

  function currentView() {
    if (state.active === 'all' && state.members.length > 1) return 'all';
    return memberById(state.active) ?? state.members[0] ?? null;
  }

  function catalogIndex(catId, name) {
    const cat = state.catalog.find((c) => c.id === catId);
    const i = cat ? cat.items.findIndex((n) => norm(n) === norm(name)) : -1;
    return i === -1 ? Infinity : i;
  }

  // Groups rows by category in catalog order; pending items first, then catalog order.
  function groupRows(rows) {
    const order = new Map(state.catalog.map((c, i) => [c.id, i]));
    const groups = new Map();
    for (const row of rows) {
      const key = order.has(row.cat) ? row.cat : OTHER_CATEGORY.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
      .map(([catId, items]) => ({
        cat: catInfo(catId),
        items: items.sort((a, b) =>
          (a.done - b.done) ||
          (catalogIndex(a.cat, a.name) - catalogIndex(b.cat, b.name)) ||
          a.name.localeCompare(b.name, 'es')),
      }));
  }

  // Merges every member's items into one row per product.
  function combinedRows() {
    const map = new Map();
    for (const m of state.members) {
      for (const it of m.items) {
        const key = it.cat + '|' + norm(it.name);
        if (!map.has(key)) map.set(key, { key, name: it.name, cat: it.cat, qty: 0, who: [], doneCount: 0, total: 0 });
        const row = map.get(key);
        row.qty += it.qty;
        row.total += 1;
        row.doneCount += it.done ? 1 : 0;
        row.who.push(m);
      }
    }
    return [...map.values()].map((r) => ({ ...r, done: r.doneCount === r.total }));
  }

  // ---------- rendering ----------

  const tabsEl = $('#tabs');
  const listEl = $('#list');
  const editorEl = $('#editor');
  const editorBody = $('#editor-body');
  const shareEl = $('#share');
  const shareBody = $('#share-body');
  const importEl = $('#import');
  const importBody = $('#import-body');

  function render() {
    renderTabs();
    renderList();
    if (editorEl.open) renderEditor();
    if (shareEl.open) renderShare();
  }

  function renderTabs() {
    const view = currentView();
    $('#share-btn').hidden = state.members.length === 0;
    if (state.members.length === 0) {
      tabsEl.innerHTML = '';
      return;
    }
    const tabs = state.members.map((m) => {
      const pending = m.items.filter((i) => !i.done).length;
      const on = view && view !== 'all' && view.id === m.id;
      return `<button class="tab${on ? ' on' : ''}" style="--c:${m.color}" data-action="select-member" data-id="${m.id}" aria-pressed="${on}">
        <span class="dot"></span>${esc(m.name || 'Sin nombre')}${pending ? `<span class="badge">${pending}</span>` : ''}
      </button>`;
    });
    if (state.members.length > 1) {
      const on = view === 'all';
      tabs.push(`<button class="tab all${on ? ' on' : ''}" data-action="select-member" data-id="all" aria-pressed="${on}">Todos</button>`);
    }
    tabsEl.innerHTML = tabs.join('');
  }

  function renderList() {
    const view = currentView();

    if (!view) {
      listEl.style.removeProperty('--c');
      listEl.innerHTML = `
        <div class="empty">
          <div class="empty-art">🛒</div>
          <h2>Arma la lista de tu familia</h2>
          <p>Agrega a cada integrante y elige qué productos necesita. Todo queda guardado en este teléfono.</p>
          <form class="inline-form" data-form="add-member">
            <input name="name" placeholder="Nombre (ej: Gonza)" autocomplete="off" maxlength="40" required>
            <button class="btn primary">Agregar</button>
          </form>
        </div>`;
      return;
    }

    const isAll = view === 'all';
    const rows = isAll ? combinedRows() : view.items;
    listEl.style.setProperty('--c', isAll ? 'var(--ink)' : view.color);

    if (rows.length === 0) {
      listEl.innerHTML = `
        <div class="empty">
          <div class="empty-art">📝</div>
          <h2>${isAll ? 'No hay productos todavía' : `La lista de ${esc(view.name || 'este integrante')} está vacía`}</h2>
          <p>Toca <strong>Editar</strong> para elegir los productos.</p>
          <button class="btn primary" data-action="open-editor">Elegir productos</button>
        </div>`;
      return;
    }

    const done = rows.filter((r) => r.done).length;
    const pct = Math.round((done / rows.length) * 100);
    const title = isAll ? 'Lista de todos' : `Lista de ${esc(view.name || 'Sin nombre')}`;

    const groups = groupRows(rows).map(({ cat, items }) => {
      const catDone = items.filter((i) => i.done).length;
      return `
        <section class="group">
          <h3><span class="emoji">${esc(cat.emoji)}</span>${esc(cat.name)}<span class="count">${catDone}/${items.length}</span></h3>
          <ul>${items.map((it) => (isAll ? combinedRow(it) : itemRow(it))).join('')}</ul>
        </section>`;
    }).join('');

    listEl.innerHTML = `
      <section class="summary">
        <div class="summary-top">
          <h2>${title}</h2>
          <span class="summary-count">${done} de ${rows.length}</span>
        </div>
        <div class="bar"><span style="width:${pct}%"></span></div>
      </section>
      ${groups}
      ${done ? `
        <div class="list-actions">
          <button class="btn ghost" data-action="uncheck-all">Desmarcar todo</button>
          <button class="btn ghost danger" data-action="remove-done">Quitar comprados</button>
        </div>` : ''}`;
  }

  const checkSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function itemRow(it) {
    return `
      <li class="item${it.done ? ' done' : ''}">
        <button class="item-main" data-action="toggle-item" data-id="${it.id}" aria-pressed="${it.done}">
          <span class="check">${checkSvg}</span>
          <span class="name">${esc(it.name)}</span>
        </button>
        <div class="qty" aria-label="Cantidad">
          <button data-action="qty" data-id="${it.id}" data-delta="-1" aria-label="Menos">−</button>
          <span>${it.qty}</span>
          <button data-action="qty" data-id="${it.id}" data-delta="1" aria-label="Más">+</button>
        </div>
      </li>`;
  }

  function combinedRow(row) {
    const who = row.who.map((m) => `<span class="who-dot" style="--c:${m.color}" title="${esc(m.name)}">${esc((m.name || '?').charAt(0).toUpperCase())}</span>`).join('');
    return `
      <li class="item${row.done ? ' done' : ''}">
        <button class="item-main" data-action="toggle-combined" data-key="${esc(row.key)}" aria-pressed="${row.done}">
          <span class="check">${checkSvg}</span>
          <span class="name">${esc(row.name)}${row.qty > 1 ? ` <span class="times">×${row.qty}</span>` : ''}</span>
        </button>
        <div class="who">${who}</div>
      </li>`;
  }

  function renderEditor() {
    if (!memberById(editTarget)) {
      const view = currentView();
      editTarget = view && view !== 'all' ? view.id : state.members[0]?.id ?? null;
    }
    const target = memberById(editTarget);

    const membersHtml = state.members.map((m) => `
      <li>
        <button class="swatch" style="--c:${m.color}" data-action="cycle-color" data-id="${m.id}" aria-label="Cambiar color"></button>
        <input data-member-name="${m.id}" value="${esc(m.name)}" placeholder="Nombre" maxlength="40" autocomplete="off">
        <button class="icon-btn" data-action="delete-member" data-id="${m.id}" aria-label="Eliminar ${esc(m.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </li>`).join('');

    let productsHtml = '';
    if (target) {
      const picker = state.members.length > 1
        ? `<div class="picker">${state.members.map((m) => `
            <button class="tab${m.id === target.id ? ' on' : ''}" style="--c:${m.color}" data-action="edit-target" data-id="${m.id}">
              <span class="dot"></span><span data-name-of="${m.id}">${esc(m.name || 'Sin nombre')}</span>
            </button>`).join('')}</div>`
        : '';

      const cats = [...state.catalog];
      if (target.items.some((i) => !state.catalog.some((c) => c.id === i.cat))) cats.push(OTHER_CATEGORY);

      const catsHtml = cats.map((cat) => {
        const own = target.items.filter((i) => (cat === OTHER_CATEGORY ? !state.catalog.some((c) => c.id === i.cat) : i.cat === cat.id));
        const names = [...cat.items];
        for (const it of own) if (!names.some((n) => norm(n) === norm(it.name))) names.push(it.name);
        const has = (n) => own.some((i) => norm(i.name) === norm(n));
        const allOn = names.length > 0 && names.every(has);

        const chips = names.map((n) => {
          const on = has(n);
          const inCatalog = cat.items.some((x) => norm(x) === norm(n));
          if (catalogMode && inCatalog) {
            return `<button class="chip removable" data-action="remove-product" data-cat="${cat.id}" data-name="${esc(n)}" aria-label="Quitar ${esc(n)} del catálogo">${esc(n)}<span class="x">✕</span></button>`;
          }
          return `<button class="chip${on ? ' on' : ''}" data-action="toggle-product" data-cat="${cat.id}" data-name="${esc(n)}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(n)}</button>`;
        }).join('');

        const isOther = cat === OTHER_CATEGORY;
        return `
          <div class="cat-edit">
            <div class="cat-head">
              <h4><span class="emoji">${esc(cat.emoji)}</span>${esc(cat.name)}</h4>
              ${catalogMode && !isOther
                ? `<button class="link danger" data-action="delete-category" data-cat="${cat.id}">Eliminar categoría</button>`
                : names.length ? `<button class="link" data-action="toggle-category" data-cat="${cat.id}">${allOn ? 'Ninguno' : 'Todos'}</button>` : ''}
            </div>
            <div class="chips">${chips || '<span class="hint">Sin productos</span>'}</div>
            ${isOther ? '' : `
              <form class="inline-form small" data-form="add-product" data-cat="${cat.id}">
                <input name="name" placeholder="Agregar otro producto…" autocomplete="off" maxlength="60" required>
                <button class="btn ghost" aria-label="Agregar">＋</button>
              </form>`}
          </div>`;
      }).join('');

      productsHtml = `
        <section class="edit-section">
          <h3>Productos de <span data-name-of="${target.id}">${esc(target.name || 'Sin nombre')}</span></h3>
          ${picker}
          <p class="hint">${catalogMode ? 'Toca ✕ para quitar un producto del catálogo.' : 'Toca un producto para agregarlo o quitarlo de su lista.'}</p>
          ${catsHtml}
          ${catalogMode ? `
            <form class="inline-form" data-form="add-category">
              <input name="name" placeholder="Nueva categoría (ej: Mascotas)" autocomplete="off" maxlength="40" required>
              <button class="btn ghost">Crear</button>
            </form>` : ''}
          <button class="btn ghost wide" data-action="toggle-catalog-mode">${catalogMode ? 'Terminar de editar catálogo' : 'Editar catálogo de productos'}</button>
        </section>`;
    }

    editorBody.innerHTML = `
      <section class="edit-section">
        <h3>Integrantes de la familia</h3>
        ${membersHtml ? `<ul class="members-edit">${membersHtml}</ul>` : '<p class="hint">Todavía no hay integrantes.</p>'}
        <form class="inline-form" data-form="add-member">
          <input name="name" placeholder="Nombre (ej: Gonza)" autocomplete="off" maxlength="40" required>
          <button class="btn primary">Agregar</button>
        </form>
      </section>
      ${productsHtml}
      <section class="edit-section">
        <button class="btn ghost danger wide" data-action="reset-all">Borrar todos los datos</button>
      </section>`;
  }

  // ---------- sharing ----------

  function shareText(view) {
    const isAll = view === 'all';
    const rows = (isAll ? combinedRows() : view.items).filter((r) => !r.done);
    const title = isAll ? '🛒 Lista de compras de la familia' : `🛒 Lista de compras de ${view.name || 'Sin nombre'}`;
    if (rows.length === 0) return `${title}\n\n¡Todo comprado! ✅`;
    const lines = [title];
    for (const { cat, items } of groupRows(rows)) {
      lines.push('', `${cat.emoji} *${cat.name}*`);
      for (const it of items) {
        let line = `• ${it.name}${it.qty > 1 ? ` x${it.qty}` : ''}`;
        if (isAll && state.members.length > 1) line += ` (${it.who.map((m) => m.name).join(', ')})`;
        lines.push(line);
      }
    }
    return lines.join('\n');
  }

  function encodePayload(members) {
    const cats = [];
    const catIndex = (id) => {
      const c = catInfo(id);
      let i = cats.findIndex(([name]) => name === c.name);
      if (i === -1) i = cats.push([c.name, c.emoji]) - 1;
      return i;
    };
    const payload = {
      v: 1,
      k: cats,
      m: members.map((m) => ({ n: m.name, c: m.color, i: m.items.map((it) => [it.name, catIndex(it.cat), it.qty]) })),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (!p || p.v !== 1 || !Array.isArray(p.m) || !Array.isArray(p.k)) throw new Error('formato');
    return {
      members: p.m.slice(0, 20).map((m) => ({
        name: clean(m.n) || 'Sin nombre',
        color: COLORS.includes(m.c) ? m.c : COLORS[0],
        items: (Array.isArray(m.i) ? m.i : []).slice(0, 300).map(([name, k, qty]) => {
          const [catName, emoji] = Array.isArray(p.k[k]) ? p.k[k] : [OTHER_CATEGORY.name, OTHER_CATEGORY.emoji];
          return { name: clean(name), catName: clean(catName) || OTHER_CATEGORY.name, emoji: clean(emoji).slice(0, 4) || '🛍️', qty: Math.min(99, Math.max(1, Number(qty) || 1)) };
        }).filter((it) => it.name),
      })),
    };
  }

  function shareLink(view) {
    const members = view === 'all' ? state.members : [view];
    return location.href.split('#')[0] + SHARE_PREFIX + encodePayload(members);
  }

  function renderShare() {
    const view = shareTarget === 'all' ? 'all' : memberById(shareTarget);
    if (!view) {
      shareEl.close();
      return;
    }
    const text = shareText(view);
    $('#share-title').textContent = view === 'all' ? 'Compartir lista de todos' : `Compartir lista de ${view.name || 'Sin nombre'}`;
    shareBody.innerHTML = `
      <pre class="preview">${esc(text)}</pre>
      <div class="share-actions">
        <a class="btn whatsapp" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
        ${navigator.share ? '<button class="btn ghost" data-action="native-share">Compartir con otra app…</button>' : ''}
        <button class="btn ghost" data-action="copy-text">Copiar texto</button>
      </div>
      <div class="edit-section">
        <h3>Enlace para guardar la lista</h3>
        <p class="hint">Quien abra este enlace podrá guardar ${view === 'all' ? 'las listas' : 'la lista'} en su propio teléfono y usarla desde ahí.</p>
        <button class="btn ghost wide" data-action="copy-link">Copiar enlace</button>
      </div>`;
  }

  async function copy(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(okMsg);
  }

  // ---------- importing ----------

  function checkImport() {
    if (!location.hash.startsWith(SHARE_PREFIX)) return;
    try {
      pendingImport = decodePayload(location.hash.slice(SHARE_PREFIX.length));
    } catch {
      toast('El enlace de la lista no es válido');
      pendingImport = null;
    }
    history.replaceState(null, '', location.pathname + location.search);
    if (!pendingImport || pendingImport.members.length === 0) return;

    const rows = pendingImport.members.map((m) => {
      const exists = state.members.some((x) => norm(x.name) === norm(m.name));
      return `<li><span class="dot" style="--c:${m.color}"></span><strong>${esc(m.name)}</strong> · ${m.items.length} producto${m.items.length === 1 ? '' : 's'}${exists ? ' <em>(reemplaza la lista actual)</em>' : ''}</li>`;
    }).join('');
    importBody.innerHTML = `
      <p>Te compartieron ${pendingImport.members.length === 1 ? 'esta lista' : 'estas listas'}:</p>
      <ul class="import-list">${rows}</ul>
      <div class="share-actions">
        <button class="btn primary" data-action="confirm-import">Guardar en este teléfono</button>
        <button class="btn ghost" data-action="cancel-import">No, gracias</button>
      </div>`;
    importEl.showModal();
  }

  function applyImport() {
    let firstId = null;
    for (const incoming of pendingImport.members) {
      const items = incoming.items.map((it) => {
        let cat = state.catalog.find((c) => norm(c.name) === norm(it.catName));
        if (!cat) {
          cat = { id: 'c-' + uid(), name: it.catName, emoji: it.emoji, items: [] };
          state.catalog.push(cat);
        }
        if (!cat.items.some((n) => norm(n) === norm(it.name))) cat.items.push(it.name);
        return { id: uid(), name: it.name, cat: cat.id, qty: it.qty, done: false };
      });
      let member = state.members.find((m) => norm(m.name) === norm(incoming.name));
      if (member) {
        member.items = items;
      } else {
        member = { id: uid(), name: incoming.name, color: incoming.color, items };
        state.members.push(member);
      }
      firstId ??= member.id;
    }
    state.active = pendingImport.members.length > 1 ? 'all' : firstId;
    pendingImport = null;
    commit();
    toast('Lista guardada');
  }

  // ---------- mutations ----------

  function addMember(name) {
    const color = COLORS.find((c) => !state.members.some((m) => m.color === c)) ?? COLORS[state.members.length % COLORS.length];
    const member = { id: uid(), name, color, items: [] };
    state.members.push(member);
    state.active = member.id;
    editTarget = member.id;
    return member;
  }

  function toggleProduct(member, catId, name) {
    const i = member.items.findIndex((it) => norm(it.name) === norm(name));
    if (i === -1) member.items.push({ id: uid(), name, cat: catId, qty: 1, done: false });
    else member.items.splice(i, 1);
  }

  // ---------- events ----------

  const actions = {
    'select-member': (el) => { state.active = el.dataset.id; commit(); },
    'toggle-item': (el) => {
      const view = currentView();
      const it = view?.items?.find((i) => i.id === el.dataset.id);
      if (it) { it.done = !it.done; commit(); }
    },
    'toggle-combined': (el) => {
      const key = el.dataset.key;
      const matches = state.members.flatMap((m) => m.items).filter((it) => it.cat + '|' + norm(it.name) === key);
      const value = !matches.every((it) => it.done);
      matches.forEach((it) => { it.done = value; });
      commit();
    },
    'qty': (el) => {
      const view = currentView();
      const it = view?.items?.find((i) => i.id === el.dataset.id);
      if (!it) return;
      it.qty = Math.min(99, Math.max(1, it.qty + Number(el.dataset.delta)));
      commit();
    },
    'uncheck-all': () => {
      const view = currentView();
      const members = view === 'all' ? state.members : [view];
      members.forEach((m) => m.items.forEach((it) => { it.done = false; }));
      commit();
    },
    'remove-done': () => {
      const view = currentView();
      const members = view === 'all' ? state.members : [view];
      members.forEach((m) => { m.items = m.items.filter((it) => !it.done); });
      commit();
      toast('Comprados quitados de la lista');
    },
    'open-editor': () => {
      const view = currentView();
      editTarget = view && view !== 'all' ? view.id : state.members[0]?.id ?? null;
      catalogMode = false;
      renderEditor();
      editorEl.showModal();
      editorBody.scrollTop = 0;
    },
    'close-editor': () => editorEl.close(),
    'edit-target': (el) => { editTarget = el.dataset.id; renderEditor(); },
    'cycle-color': (el) => {
      const m = memberById(el.dataset.id);
      if (!m) return;
      m.color = COLORS[(COLORS.indexOf(m.color) + 1) % COLORS.length];
      commit();
    },
    'delete-member': (el) => {
      const m = memberById(el.dataset.id);
      if (!m || !confirm(`¿Eliminar a ${m.name || 'este integrante'} y su lista?`)) return;
      state.members = state.members.filter((x) => x.id !== m.id);
      if (state.active === m.id) state.active = state.members[0]?.id ?? null;
      commit();
    },
    'toggle-product': (el) => {
      const m = memberById(editTarget);
      if (!m) return;
      toggleProduct(m, el.dataset.cat, el.dataset.name);
      commit();
    },
    'toggle-category': (el) => {
      const m = memberById(editTarget);
      if (!m) return;
      const catId = el.dataset.cat;
      const isOther = catId === OTHER_CATEGORY.id;
      const cat = catInfo(catId);
      const inCat = (it) => (isOther ? !state.catalog.some((c) => c.id === it.cat) : it.cat === catId);
      const names = [...cat.items, ...m.items.filter(inCat).map((it) => it.name)];
      const allOn = names.every((n) => m.items.some((it) => norm(it.name) === norm(n)));
      if (allOn) {
        m.items = m.items.filter((it) => !inCat(it));
      } else {
        for (const n of cat.items) {
          if (!m.items.some((it) => norm(it.name) === norm(n))) m.items.push({ id: uid(), name: n, cat: catId, qty: 1, done: false });
        }
      }
      commit();
    },
    'toggle-catalog-mode': () => { catalogMode = !catalogMode; renderEditor(); },
    'remove-product': (el) => {
      const cat = state.catalog.find((c) => c.id === el.dataset.cat);
      if (!cat) return;
      cat.items = cat.items.filter((n) => norm(n) !== norm(el.dataset.name));
      commit();
    },
    'delete-category': (el) => {
      const cat = state.catalog.find((c) => c.id === el.dataset.cat);
      if (!cat || !confirm(`¿Eliminar la categoría "${cat.name}"? Los productos que ya están en las listas pasarán a "Otros".`)) return;
      state.catalog = state.catalog.filter((c) => c.id !== cat.id);
      commit();
    },
    'reset-all': () => {
      if (!confirm('¿Borrar todos los integrantes, listas y productos agregados? Esto no se puede deshacer.')) return;
      state = defaultState();
      editTarget = null;
      catalogMode = false;
      commit();
      editorEl.close();
    },
    'open-share': () => {
      const view = currentView();
      if (!view) return;
      shareTarget = view === 'all' ? 'all' : view.id;
      renderShare();
      shareEl.showModal();
    },
    'close-share': () => shareEl.close(),
    'native-share': async () => {
      const view = shareTarget === 'all' ? 'all' : memberById(shareTarget);
      try {
        await navigator.share({ text: shareText(view) });
      } catch { /* user cancelled */ }
    },
    'copy-text': () => {
      const view = shareTarget === 'all' ? 'all' : memberById(shareTarget);
      copy(shareText(view), 'Texto copiado');
    },
    'copy-link': () => {
      const view = shareTarget === 'all' ? 'all' : memberById(shareTarget);
      copy(shareLink(view), 'Enlace copiado');
    },
    'confirm-import': () => { importEl.close(); applyImport(); },
    'cancel-import': () => { pendingImport = null; importEl.close(); },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    actions[el.dataset.action](el);
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const name = clean(new FormData(form).get('name'));
    if (!name) return;
    const kind = form.dataset.form;

    if (kind === 'add-member') {
      addMember(name);
    } else if (kind === 'add-product') {
      const cat = state.catalog.find((c) => c.id === form.dataset.cat);
      if (!cat) return;
      if (!cat.items.some((n) => norm(n) === norm(name))) cat.items.push(name);
      const m = memberById(editTarget);
      if (m && !m.items.some((it) => norm(it.name) === norm(name))) toggleProduct(m, cat.id, name);
    } else if (kind === 'add-category') {
      if (state.catalog.some((c) => norm(c.name) === norm(name))) return toast('Esa categoría ya existe');
      state.catalog.push({ id: 'c-' + uid(), name, emoji: '🛍️', items: [] });
    }
    commit();

    // Keep the keyboard open on the same field for quick consecutive entries.
    const selector = `form[data-form="${kind}"]${form.dataset.cat ? `[data-cat="${form.dataset.cat}"]` : ''} input`;
    (editorEl.open ? editorBody : document).querySelector(selector)?.focus();
  });

  // Renaming updates the list live without re-rendering the editor (keeps the cursor in place).
  editorBody.addEventListener('input', (e) => {
    const id = e.target.dataset.memberName;
    const m = id && memberById(id);
    if (!m) return;
    m.name = clean(e.target.value);
    save();
    renderTabs();
    renderList();
    editorBody.querySelectorAll(`[data-name-of="${id}"]`).forEach((el) => { el.textContent = m.name || 'Sin nombre'; });
  });

  // Close sheets by tapping the backdrop.
  for (const dlg of [editorEl, shareEl]) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  importEl.addEventListener('close', () => { pendingImport = null; });

  // Keep several open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    state = load();
    render();
  });
  window.addEventListener('hashchange', checkImport);

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  render();
  checkImport();
})();
