/* Token Radar dashboard: renders window.RADAR (written by main.ts into ../data.js), sorts and
   filters the board, and opens a detail drawer with the radar-2 arithmetic and the farm plan.
   No framework, no network: the whole dataset ships in data.js beside the page.
   URL modes for deterministic renders: ?shot=board, ?shot=detail&slug=<slug>, ?shot=filtered&category=<c> */

(function () {
  'use strict';

  var data = window.RADAR;
  if (!data || !data.rows) return;

  var params = new URLSearchParams(window.location.search);
  var shot = params.get('shot');

  var state = {
    query: '',
    category: 'all',
    scope: 'all',
    sortKey: 'rank',
    sortDir: 'asc',
    selected: null
  };

  if (shot === 'detail') {
    var wanted = params.get('slug') || (data.rows[0] && data.rows[0].slug);
    var hit = data.rows.filter(function (r) { return r.slug === wanted; })[0];
    if (hit) state.selected = hit.slug;
    document.body.classList.add('no-anim');
  }
  if (shot === 'filtered') {
    var cat = params.get('category');
    if (cat && data.rows.some(function (r) { return r.category === cat; })) state.category = cat;
  }

  /* ----------------------------- helpers ------------------------------ */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fmtMoney(v) {
    if (v === null || v === undefined) return '—';
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }

  function fmtFull(v) {
    if (v === null || v === undefined) return '—';
    return '$' + v.toLocaleString('en-US');
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return s;
  }

  function fmtAge(age, listed) {
    if (age === null || age === undefined) return listed ? 'unknown' : '—';
    if (age < 60) return age + 'd';
    if (age < 730) return Math.round(age / 30) + 'mo';
    return (age / 365).toFixed(1) + 'y';
  }

  var tableBody = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var searchEl = document.getElementById('search');
  var categoryEl = document.getElementById('category');
  var scopeEl = document.getElementById('scope');

  /* ----------------------------- filtering ---------------------------- */

  function visibleRows() {
    var q = state.query.trim().toLowerCase();
    return data.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) !== -1;
    });
  }

  function sortedRows(rows) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var av, bv;
      if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); return av < bv ? -dir : av > bv ? dir : 0; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'change') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'chains') { av = a.chains.length; bv = b.chains.length; }
      else { av = a.rank; bv = b.rank; }
      if (av === bv) return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
      return av < bv ? -dir : dir;
    });
    return copy;
  }

  /* ------------------------------ csv export --------------------------- */

  /** One CSV field: quoted only when it carries a comma, a quote or a newline, quotes doubled. */
  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** The current view — same filter, same sort as the table — as a CSV document with the model's inputs. */
  function csvText(rows) {
    var head = ['rank', 'name', 'slug', 'category', 'watchlist', 'implied_value_usd', 'tvl_usd', 'change_7d',
      'age_days', 'listed_at', 'chains', 'base', 'growth_pct', 'growth_multiplier', 'maturity_multiplier',
      'breadth_multiplier', 'farm_plan'];
    var lines = [head.join(',')];
    rows.forEach(function (r) {
      lines.push([
        r.rank, r.name, r.slug, r.category || '', r.watchlist ? 'yes' : 'no',
        r.implied_value_usd, r.tvl_usd, r.change_7d === null ? '' : r.change_7d,
        r.age_days === null ? '' : r.age_days, r.listed_at || '', r.chains.join(' '),
        r.base, r.growthPct, r.growthMultiplier, r.maturityMultiplier, r.breadthMultiplier,
        r.farm_steps.join(' | ')
      ].map(csvCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  /** Hand the visible rows to the browser as a downloaded file, then release the object URL. */
  function downloadCsv() {
    var rows = sortedRows(visibleRows());
    if (rows.length === 0) return;
    var blob = new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = el('a');
    link.href = url;
    link.download = 'token-radar-' + data.as_of + '-' + rows.length + '-rows.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ------------------------------ rendering --------------------------- */

  function renderCategories() {
    var cats = {};
    data.rows.forEach(function (r) { if (r.category) cats[r.category] = true; });
    var names = Object.keys(cats).sort();
    categoryEl.textContent = '';
    categoryEl.appendChild(el('option', null, 'All categories')).value = 'all';
    names.forEach(function (c) {
      var opt = el('option', null, c);
      opt.value = c;
      categoryEl.appendChild(opt);
    });
    categoryEl.value = state.category;
  }

  function render() {
    var rows = sortedRows(visibleRows());
    tableBody.textContent = '';
    if (rows.length === 0) {
      var tr = el('tr', null);
      var td = el('td', 'empty', 'No protocols match the filters — clear the search to see the board.');
      td.colSpan = 8;
      tr.appendChild(td);
      tableBody.appendChild(tr);
      countEl.textContent = '0 shown';
      return;
    }
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.tabIndex = 0;
      tr.addEventListener('click', function () { openDrawer(r.slug); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug); }
      });

      var rank = el('td', 'num');
      rank.appendChild(el('span', 'rank' + (r.rank <= 3 ? ' top' : ''), String(r.rank)));
      tr.appendChild(rank);

      var nameTd = el('td', 'cell-name');
      var line = el('div', 'name-line');
      line.appendChild(el('span', 'pname', r.name));
      line.appendChild(el('span', 'slug', r.slug));
      if (r.category) line.appendChild(el('span', 'tag', r.category));
      nameTd.appendChild(line);
      tr.appendChild(nameTd);

      tr.appendChild(el('td', 'num val', fmtMoney(r.implied_value_usd)));
      tr.appendChild(el('td', 'num tvl', fmtMoney(r.tvl_usd)));
      var chgTd = el('td', 'num');
      var chgCls = 'chg ' + (r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : 'down');
      chgTd.appendChild(el('span', chgCls, fmtPct(r.change_7d)));
      tr.appendChild(chgTd);

      tr.appendChild(el('td', 'num age-cell', fmtAge(r.age_days, r.listed_at)));
      tr.appendChild(el('td', 'num chains-cell', String(r.chains.length)));
      var badgeTd = el('td', 'badge-col');
      badgeTd.appendChild(el('span', 'tag ' + (r.watchlist ? 'watch' : 'early'), r.watchlist ? 'watch' : 'early'));
      tr.appendChild(badgeTd);

      tableBody.appendChild(tr);
    });
    countEl.textContent = rows.length + ' of ' + data.rows.length + ' shown';
  }

  function renderHeaders() {
    var ths = document.querySelectorAll('#board thead th[data-key]');
    Array.prototype.forEach.call(ths, function (th) {
      var key = th.getAttribute('data-key');
      var arr = th.querySelector('.arr');
      if (arr) arr.remove();
      if (key === state.sortKey) {
        var a = el('span', 'arr', state.sortDir === 'asc' ? '▲' : '▼');
        th.appendChild(a);
      }
    });
  }

  function renderStats() {
    var stats = document.getElementById('stats');
    stats.textContent = '';
    stats.appendChild(chipWith('', String(data.board_size), 'pre-token ranked'));
    stats.appendChild(chipWith('teal', String(data.watchlist_size), 'watchlist'));
    stats.appendChild(chipWith('violet', String(data.early_size), 'early below $50M floor'));
    stats.appendChild(modelChip());
    stats.appendChild(el('span', 'chip', 'as of ' + data.as_of));

    document.getElementById('foot-note').textContent =
      'Snapshot: ' + data.source + '. Implied value is this radar\'s own claim of what a token would be worth if the record stayed as it is — a model, not a promise, and never one make.fun makes. Watchlist coverage: ' +
      data.watchlist_size + ' of ' + data.watchlist_size + '.';
  }

  function chipWith(cls, value, label) {
    var chip = el('span', 'chip' + (cls ? ' ' + cls : ''));
    chip.appendChild(el('span', 'dot', ''));
    chip.appendChild(el('b', null, value));
    chip.appendChild(el('span', null, ' ' + label));
    return chip;
  }

  function modelChip() {
    var chip = el('span', 'chip');
    chip.appendChild(el('span', null, 'model '));
    chip.appendChild(el('b', null, data.model_version));
    return chip;
  }

  /* ------------------------------- drawer ----------------------------- */

  var drawer = document.getElementById('drawer');
  var backdrop = document.getElementById('backdrop');

  function closeDrawer() {
    drawer.hidden = true;
    backdrop.hidden = true;
    state.selected = null;
  }

  function openDrawer(slug) {
    var r = data.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    state.selected = slug;
    drawer.textContent = '';
    backdrop.hidden = false;

    var head = el('div', 'drawer-head');
    var headText = el('div');
    headText.appendChild(el('h2', null, r.name));
    headText.appendChild(el('p', 'slugline', r.slug));
    var close = el('button', 'close', '\u00d7');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeDrawer);
    head.appendChild(headText);
    head.appendChild(close);
    drawer.appendChild(head);

    var tagrow = el('div', 'tagrow');
    tagrow.appendChild(el('span', 'tag ' + (r.watchlist ? 'watch' : 'early'), r.watchlist ? 'watchlist' : 'early'));
    if (r.category) tagrow.appendChild(el('span', 'tag', r.category));
    tagrow.appendChild(el('span', 'tag', 'pre-token'));
    drawer.appendChild(tagrow);

    var kv = el('div', 'kv');
    kv.appendChild(kvCell('TVL', fmtFull(r.tvl_usd)));
    kv.appendChild(kvCell('7d change', fmtPct(r.change_7d), r.change_7d !== null && r.change_7d > 0 ? 'up' : r.change_7d !== null && r.change_7d < 0 ? 'down' : ''));
    kv.appendChild(kvCell('Age', r.age_days === null ? 'unknown' : r.age_days + ' days' + (r.listed_at ? ' · listed ' + r.listed_at : '')));
    kv.appendChild(kvCell('Chains', String(r.chains.length) + ' · ' + (r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? '…' : ''))));
    drawer.appendChild(kv);

    drawer.appendChild(el('div', 'section-title', 'How the implied value is derived — radar-2'));

    var math = el('div', 'math');
    math.appendChild(mathRow('base', 'TVL × 0.30', fmtFull(r.base)));
    math.appendChild(mathRow('growth', growthFormula(r), '\u00d7 ' + r.growthMultiplier.toFixed(4)));
    math.appendChild(mathRow('maturity', '0.55 + 0.45(1 − e^(−age/540))', '\u00d7 ' + r.maturityMultiplier.toFixed(4)));
    math.appendChild(mathRow('breadth', '1 + 0.03·min(chains−1, 5)', '\u00d7 ' + r.breadthMultiplier.toFixed(4)));
    math.appendChild(mathRow('implied', 'round(base·growth·maturity·breadth)', fmtFull(r.implied_value_usd), true));
    drawer.appendChild(math);

    var planHead = el('div', 'section-head');
    planHead.appendChild(el('div', 'section-title', 'Farm plan — what each step costs and how long it takes'));
    var copyBtn = el('button', 'ghost-btn', 'Copy plan');
    copyBtn.setAttribute('type', 'button');
    copyBtn.setAttribute('aria-label', 'Copy the numbered farm plan for ' + r.name + ' to the clipboard');
    copyBtn.addEventListener('click', function () { copyPlan(r, copyBtn); });
    planHead.appendChild(copyBtn);
    drawer.appendChild(planHead);

    var plan = el('ol', 'plan');
    r.farm_steps.forEach(function (step, i) {
      var li = el('li');
      var no = el('span', 'step-no', String(i + 1));
      li.appendChild(no);
      li.appendChild(document.createTextNode(step));
      plan.appendChild(li);
    });
    drawer.appendChild(plan);

    var notice = el('div', 'notice',
      'Figures that are not snapshot values (gas, fees, rewards) are estimates. A protocol on this list may still have a token its DefiLlama record does not carry; the board ranks records, not certainties.');
    drawer.appendChild(notice);

    drawer.hidden = false;
    drawer.scrollTop = 0;
  }

  function kvCell(k, v, accent) {
    var cell = el('div', 'cell');
    cell.appendChild(el('div', 'k', k));
    cell.appendChild(el('div', 'v' + (accent ? ' ' + accent : ''), v));
    return cell;
  }

  function growthFormula(r) {
    var weight = r.growthPct < 0 ? '0.75' : '0.50';
    var term = r.growthPct < 0 ? '\u2212 ' + Math.abs(r.growthPct) + '%' : '+ ' + r.growthPct + '%';
    var clamped = r.change_7d !== null && r.growthPct !== r.change_7d ? ' (clamped from ' + r.change_7d + '%)' : '';
    return '1 ' + term + ' × ' + weight + clamped;
  }

  function mathRow(label, formula, answer, total) {
    var row = el('div', 'math-row' + (total ? ' total' : ''));
    var f = el('div', 'formula');
    f.appendChild(el('span', null, label + ' — '));
    f.appendChild(el('span', 'mono', formula));
    row.appendChild(f);
    row.appendChild(el('div', 'answer', answer));
    return row;
  }

  /* ------------------------------ events ------------------------------ */

  searchEl.addEventListener('input', function () { state.query = searchEl.value; render(); });
  categoryEl.addEventListener('change', function () { state.category = categoryEl.value; render(); });
  scopeEl.addEventListener('change', function () { state.scope = scopeEl.value; render(); });
  document.getElementById('export').addEventListener('click', downloadCsv);

  var ths = document.querySelectorAll('#board thead th[data-key]');
  Array.prototype.forEach.call(ths, function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-key');
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = key === 'name' ? 'asc' : 'desc';
      }
      renderHeaders();
      render();
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
  });
  backdrop.addEventListener('click', closeDrawer);

  /* ------------------------------ live view ---------------------------- */

  function renderLive() {
    var body = document.getElementById('live-rows');
    body.textContent = '';
    (data.live || []).forEach(function (l, i) {
      var tr = el('tr');
      tr.appendChild(el('td', 'num', String(i + 1)));
      var name = el('td');
      name.appendChild(el('span', 'pname', l.name));
      name.appendChild(el('span', ' slug', ' ' + l.slug));
      tr.appendChild(name);
      tr.appendChild(el('td', 'num', fmtMoney(l.tvl_usd)));
      tr.appendChild(el('td', 'num', fmtMoney(l.mcap_usd)));
      tr.appendChild(el('td', 'num', fmtPct(l.change_7d)));
      body.appendChild(tr);
    });
  }

  /* -------------------------------- boot ------------------------------ */

  renderCategories();
  renderStats();
  renderHeaders();
  render();
  renderLive();

  if (state.selected) openDrawer(state.selected);
})();