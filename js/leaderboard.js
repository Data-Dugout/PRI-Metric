(function () {
  var DATA_URL = 'data/players.csv';
  var REQUIRED = ['Name','Year','PA','PRI','BA','xBA','BA_Diff','SLG','xSLG','SLG_Diff','wOBA','xwOBA','OBA_Diff','BABIP'];
  var NUMERIC_COLS = ['PA','PRI','BA','xBA','BA_Diff','SLG','xSLG','SLG_Diff','wOBA','xwOBA','OBA_Diff','BABIP'];
  var DECIMAL_COLS = ['BA','xBA','BA_Diff','SLG','xSLG','SLG_Diff','wOBA','xwOBA','OBA_Diff','BABIP'];
  var TABLE_COLS = ['Name','Team','PA','PRI','BA','xBA','BA_Diff','SLG','xSLG','SLG_Diff','wOBA','xwOBA','OBA_Diff','BABIP'];

  var YEARS = ['2026','2025','2024','2023','2022','2021'];
  var TEAMS = [
    ['ARI','Arizona Diamondbacks'],['ATL','Atlanta Braves'],['BAL','Baltimore Orioles'],['BOS','Boston Red Sox'],
    ['CHC','Chicago Cubs'],['CWS','Chicago White Sox'],['CIN','Cincinnati Reds'],['CLE','Cleveland Guardians'],
    ['COL','Colorado Rockies'],['DET','Detroit Tigers'],['HOU','Houston Astros'],['KC','Kansas City Royals'],
    ['LAA','Los Angeles Angels'],['LAD','Los Angeles Dodgers'],['MIA','Miami Marlins'],['MIL','Milwaukee Brewers'],
    ['MIN','Minnesota Twins'],['NYM','New York Mets'],['NYY','New York Yankees'],['ATH','Athletics'],
    ['PHI','Philadelphia Phillies'],['PIT','Pittsburgh Pirates'],['SD','San Diego Padres'],['SF','San Francisco Giants'],
    ['SEA','Seattle Mariners'],['STL','St. Louis Cardinals'],['TB','Tampa Bay Rays'],['TEX','Texas Rangers'],
    ['TOR','Toronto Blue Jays'],['WSH','Washington Nationals']
  ];
  var POSITIONS = ['C','1B','2B','3B','SS','LF','CF','RF','OF','DH'];
  // Common alternate abbreviations so either style in the data file works.
  var TEAM_ALIASES = {OAK:'ATH',ARI:'ARI',AZ:'ARI',CHW:'CWS',CHA:'CWS',CHN:'CHC',KCR:'KC',KCA:'KC',LAN:'LAD',NYA:'NYY',NYN:'NYM',SDP:'SD',SDN:'SD',SFG:'SF',SFN:'SF',SLN:'STL',TBR:'TB',TBA:'TB',WAS:'WSH',WSN:'WSH',ANA:'LAA',FLA:'MIA'};
  var allRows = [];
  var lastFilteredRows = [];
  var sortKey = 'PRI';
  var sortDir = 'desc';
  var hasTeam = false;
  var hasPos = false;

  // Splits one CSV line, honouring "quoted, fields".
  function splitLine(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else { inQ = false; }
        } else { cur += ch; }
      } else if (ch === '"') { inQ = true; }
      else if (ch === ',') { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    var lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
    var headers = splitLine(lines[0]).map(function (h) { return h.trim(); });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var cells = splitLine(lines[i]);
      var row = {};
      headers.forEach(function (h, idx) {
        var raw = cells[idx] !== undefined ? cells[idx].trim() : '';
        row[h] = NUMERIC_COLS.indexOf(h) !== -1 ? (raw === '' ? NaN : parseFloat(raw)) : raw;
      });
      if (row.Team) row.Team = normTeam(row.Team);
      rows.push(row);
    }
    return { headers: headers, rows: rows };
  }

  // Safety net: checks the file before it reaches the table and reports problems on the page.
  function validate(parsed) {
    var warnings = [];
    var missing = REQUIRED.filter(function (c) { return parsed.headers.indexOf(c) === -1; });
    if (missing.length) {
      warnings.push('The data file is missing column(s): ' + missing.join(', ') + '.');
      return { rows: [], warnings: warnings };
    }
    var good = [], badPRI = 0, badPA = 0, noName = 0, seen = {}, dupes = 0;
    parsed.rows.forEach(function (r) {
      if (!r.Name) { noName++; return; }
      if (isNaN(r.PRI) || r.PRI < 0 || r.PRI > 100) { badPRI++; return; }
      if (isNaN(r.PA) || r.PA < 0) { badPA++; return; }
      var key = r.Name + '|' + r.Year + '|' + r.PA;
      if (seen[key]) { dupes++; return; }
      seen[key] = true;
      good.push(r);
    });
    if (noName) warnings.push(noName + ' row(s) with no player name were skipped.');
    if (badPRI) warnings.push(badPRI + ' row(s) with a missing or out-of-range PRI (must be 0 to 100) were skipped.');
    if (badPA) warnings.push(badPA + ' row(s) with a missing or invalid PA were skipped.');
    if (dupes) warnings.push(dupes + ' duplicate row(s) were skipped.');
    if (!good.length) warnings.push('No valid player rows were found in the data file.');
    return { rows: good, warnings: warnings };
  }

  function showWarnings(warnings) {
    if (!warnings.length) return;
    var el = document.createElement('div');
    el.className = 'data-warning';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'background:#FBE9E6; border:1px solid #B93A30; color:#7A1F17; border-radius:8px; padding:12px 16px; margin:0 0 16px; font-size:.9rem; line-height:1.5;';
    el.innerHTML = '<strong>Data check:</strong> ' + warnings.join(' ') +
      ' The table below may be incomplete &mdash; the site owner has been flagged to fix the data file.';
    var bar = document.querySelector('#leaderboard').closest('.wrap-lb').querySelector('.filterbar');
    bar.parentNode.insertBefore(el, bar);
  }

  function uniqueSorted(rows, key) {
    var set = {};
    rows.forEach(function (r) { if (r[key]) set[r[key]] = true; });
    return Object.keys(set).sort();
  }

  function populateFilter(selectEl, values) {
    values.forEach(function (v) {
      var value = Array.isArray(v) ? v[0] : v;
      var label = Array.isArray(v) ? v[1] : v;
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      selectEl.appendChild(opt);
    });
  }

  function normTeam(t) {
    var u = String(t || '').trim().toUpperCase();
    return TEAM_ALIASES[u] || u;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatCell(key, value) {
    if (value === undefined || value === null || value === '' || (typeof value === 'number' && isNaN(value))) return '&mdash;';
    if (key === 'PRI') return Number(value).toFixed(1);
    if (DECIMAL_COLS.indexOf(key) !== -1) {
      var s = Number(value).toFixed(3);
      return (value >= 0 && key.indexOf('Diff') !== -1 ? '+' : '') + s;
    }
    return esc(value);
  }

  function priStyle(value) {
    if (value === undefined || value === null || isNaN(value)) return '';
    var bg, color = '#1B2430';
    if (value >= 90)      { bg = '#1B7A3D'; color = '#FAF7EF'; }
    else if (value >= 80) { bg = '#4C9950'; color = '#FAF7EF'; }
    else if (value >= 65) { bg = '#8FC17E'; }
    else if (value >= 55) { bg = '#C7E2A4'; }
    else if (value >= 45) { bg = '#F0D670'; }
    else if (value >= 35) { bg = '#F0A79C'; }
    else if (value >= 20) { bg = '#E0655A'; color = '#FAF7EF'; }
    else                  { bg = '#B93A30'; color = '#FAF7EF'; }
    return 'background-color:' + bg + '; color:' + color + ';';
  }

  function exportToCSV() {
    var cols = ['Name','Year'].concat(hasTeam ? ['Team'] : []).concat(['PA','PRI','BA','xBA','BA_Diff','SLG','xSLG','SLG_Diff','wOBA','xwOBA','OBA_Diff','BABIP']);
    var labels = { BA_Diff: 'BA Diff', SLG_Diff: 'SLG Diff', OBA_Diff: 'OBA Diff' };
    var headerLabels = cols.map(function (c) { return labels[c] || c; });

    function csvEscape(val) {
      var s = (val === undefined || val === null) ? '' : String(val);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        s = '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    var rows = lastFilteredRows.map(function (r) {
      return cols.map(function (c) {
        var v = r[c];
        if (typeof v === 'number' && isNaN(v)) v = '';
        return csvEscape(v);
      }).join(',');
    });

    var csv = headerLabels.map(csvEscape).join(',') + '\r\n' + rows.join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'pri-leaderboard-' + stamp + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function applyFiltersAndSort() {
    var year = document.getElementById('f-year').value;
    var team = document.getElementById('f-team').value;
    var pos = document.getElementById('f-pos').value;
    var minPA = parseInt(document.getElementById('f-pa').value, 10) || 0;
    var search = document.getElementById('f-search').value.trim().toLowerCase();

    var teamFilterOn = team && hasTeam;
    var posFilterOn = pos && hasPos;
    var notes = [];
    if (team && !hasTeam) notes.push('Team data is not in the data file yet, so the team filter is not applied');
    if (pos && !hasPos) notes.push('Position data is not in the data file yet, so the position filter is not applied');

    var filtered = allRows.filter(function (r) {
      if (year && String(r.Year) !== String(year)) return false;
      if (teamFilterOn && r.Team !== team) return false;
      if (posFilterOn && String(r.Position).toUpperCase().split(/[\/,]/).indexOf(pos) === -1) return false;
      if ((r.PA || 0) < minPA) return false;
      if (search && (!r.Name || r.Name.toLowerCase().indexOf(search) === -1)) return false;
      return true;
    });

    filtered.sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      var cmp;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    lastFilteredRows = filtered;
    renderRows(filtered, !year);
    document.getElementById('rowcount').textContent =
      filtered.length + (filtered.length === 1 ? ' player shown' : ' players shown') +
      ' (out of ' + allRows.length + ' total)' + (notes.length ? ' \u2014 ' + notes.join('; ') + '.' : '');
  }

  function renderRows(rows, showYear) {
    var tbody = document.getElementById('leaderboard-body');
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (hasTeam ? 14 : 13) + '" style="text-align:center; opacity:.6; padding:24px;">No players match these filters.</td></tr>';
      return;
    }
    var html = rows.map(function (r) {
      var cells = TABLE_COLS.map(function (c) {
        if (c === 'Name') {
          var yr = showYear ? ' <span style="opacity:.55; font-size:.78em;">' + esc(r.Year) + '</span>' : '';
          return '<td class="name">' + formatCell(c, r[c]) + yr + '</td>';
        }
        if (c === 'PRI') return '<td style="' + priStyle(r.PRI) + '">' + formatCell(c, r[c]) + '</td>';
        return '<td>' + formatCell(c, r[c]) + '</td>';
      }).join('');
      return '<tr>' + cells + '</tr>';
    }).join('');
    tbody.innerHTML = html;
  }

  function updateSortHeaders() {
    document.querySelectorAll('#leaderboard th[data-key]').forEach(function (th) {
      th.classList.toggle('sorted', th.dataset.key === sortKey);
      var arrow = th.querySelector('.arrow');
      if (!arrow) return;
      if (th.dataset.key === sortKey) {
        arrow.innerHTML = sortDir === 'asc' ? '&uarr;' : '&darr;';
      } else {
        arrow.innerHTML = '&#8597;';
      }
    });
  }

  // Team / Position are optional: when the data file has none, hide their column and filters.
  function applyOptionalColumns(rows) {
    hasTeam = rows.some(function (r) { return r.Team; });
    hasPos = rows.some(function (r) { return r.Position; });
    var table = document.getElementById('leaderboard');
    if (!hasTeam) {
      var style = document.createElement('style');
      style.textContent = '#leaderboard thead tr:not(.grouprow) th:nth-child(2), #leaderboard td:nth-child(2){display:none;} #leaderboard td.name{white-space:nowrap;}';
      document.head.appendChild(style);
      var col = table.querySelector('colgroup col:nth-child(2)');
      if (col) col.parentNode.removeChild(col);
      var blank = table.querySelector('.grouprow th.blank');
      if (blank) blank.setAttribute('colspan', '3');
    }
  }

  function init(rows) {
    allRows = rows;
    applyOptionalColumns(rows);
    var years = YEARS.slice();
    uniqueSorted(rows, 'Year').forEach(function (y) { if (years.indexOf(y) === -1) years.push(y); });
    years.sort(function (a, b) { return b - a; });
    var known = {}; TEAMS.forEach(function (t) { known[t[0]] = true; });
    var teams = TEAMS.slice();
    uniqueSorted(rows, 'Team').forEach(function (t) { if (!known[t]) teams.push([t, t]); });
    var positions = POSITIONS.slice();
    uniqueSorted(rows, 'Position').forEach(function (p) { if (positions.indexOf(p) === -1 && !/[\/,]/.test(p)) positions.push(p); });
    populateFilter(document.getElementById('f-year'), years);
    populateFilter(document.getElementById('f-team'), teams);
    populateFilter(document.getElementById('f-pos'), positions);

    document.getElementById('f-year').addEventListener('change', applyFiltersAndSort);
    document.getElementById('f-team').addEventListener('change', applyFiltersAndSort);
    document.getElementById('f-pos').addEventListener('change', applyFiltersAndSort);
    document.getElementById('f-pa').addEventListener('change', applyFiltersAndSort);
    document.getElementById('f-search').addEventListener('input', applyFiltersAndSort);

    var priOnly = document.getElementById('f-poronly');
    priOnly.addEventListener('change', function () {
      document.getElementById('leaderboard').classList.toggle('por-only', priOnly.checked);
    });

    // default Year to the newest season in the data file
    var DEFAULT_YEAR = years.length ? years[0] : '';
    var yearSelect = document.getElementById('f-year');
    yearSelect.value = DEFAULT_YEAR;

    document.getElementById('reset-filters').addEventListener('click', function () {
      document.getElementById('f-year').value = DEFAULT_YEAR;
      document.getElementById('f-team').value = '';
      document.getElementById('f-pos').value = '';
      document.getElementById('f-pa').value = '0';
      document.getElementById('f-search').value = '';
      priOnly.checked = false;
      document.getElementById('leaderboard').classList.remove('por-only');
      applyFiltersAndSort();
    });

    document.querySelectorAll('#leaderboard th[data-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.key;
        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDir = 'desc';
        }
        updateSortHeaders();
        applyFiltersAndSort();
      });
    });

    document.getElementById('export-csv').addEventListener('click', exportToCSV);

    updateSortHeaders();
    applyFiltersAndSort();
  }

  fetch(DATA_URL)
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then(function (text) {
      var result = validate(parseCSV(text));
      showWarnings(result.warnings);
      if (!result.rows.length) {
        document.getElementById('rowcount').textContent = 'No player data could be loaded.';
        return;
      }
      init(result.rows);
    })
    .catch(function (err) {
      document.getElementById('rowcount').textContent = 'Could not load player data (' + err + ').';
      console.error(err);
    });
})();
