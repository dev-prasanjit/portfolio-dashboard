/**
 * Tradetron Portfolio Dashboard — Google Sheets Integration
 * Fetches all data live from a published Google Sheet.
 * No localStorage, no manual entry.
 */

const SHEET_ID = '1lEHKRDuOk2v9WCWRv4iuz7ib_FLdkYQRurmrGBO3e3I';
const DAILY_PNL_SHEET = 'Strategies Daily PNL';
const STRATEGIES_DB_SHEET = 'Strategies DB';
const OVERALL_DASHBOARD_SHEET = 'Overall Dashboard';
const AUTO_REFRESH_MS = 60 * 60 * 1000; // 60 minutes

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ===== State =====
let dailyPnlData = [];
let dailyPnlHeaders = [];
let strategyDbData = [];
let overallDashboardData = [];
let selectedMonth = null;
let sortCol = null;
let sortDir = 'desc';
let autoRefreshTimer = null;
let searchQuery = '';

// ===== DOM References =====
const $ = id => document.getElementById(id);

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    populateMonthSelector();
    bindEvents();
    fetchAllData();
    startAutoRefresh();
});

// ===== Clock =====
function initClock() {
    const update = () => {
        const now = new Date();
        $('liveClock').textContent = now.toLocaleString('en-IN', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });
    };
    update();
    setInterval(update, 1000);
}

// ===== Month Selector =====
function populateMonthSelector() {
    const sel = $('monthSelect');
    const now = new Date();
    const currentMonthIdx = now.getMonth();

    // Add months from Jan to Dec of 2026
    MONTH_NAMES.forEach((name, i) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `${name}-26`;
        if (i === currentMonthIdx) opt.selected = true;
        sel.appendChild(opt);
    });

    selectedMonth = MONTH_NAMES[currentMonthIdx];
}

// ===== Events =====
function bindEvents() {
    $('btnRefresh').addEventListener('click', () => {
        $('btnRefresh').classList.add('spinning');
        fetchAllData().finally(() => {
            setTimeout(() => $('btnRefresh').classList.remove('spinning'), 600);
        });
    });

    $('monthSelect').addEventListener('change', (e) => {
        selectedMonth = e.target.value;
        renderAll();
    });

    $('searchInput').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderTable();
    });

    $('btnExport').addEventListener('click', exportCSV);

    $('btnDismissError').addEventListener('click', () => {
        $('errorBanner').style.display = 'none';
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
            e.preventDefault();
            exportCSV();
        }
    });
}

// ===== Data Fetching =====
function buildCsvUrl(sheetName) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

function parseCSV(text) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"' && text[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                row.push(current.trim());
                current = '';
            } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
                row.push(current.trim());
                current = '';
                if (row.some(c => c !== '')) rows.push(row);
                row = [];
                if (ch === '\r') i++;
            } else {
                current += ch;
            }
        }
    }
    // Last row
    row.push(current.trim());
    if (row.some(c => c !== '')) rows.push(row);

    return rows;
}

function parseNum(val) {
    if (!val || val === '-' || val === '- ') return 0;
    return parseFloat(val.replace(/[₹,\s]/g, '')) || 0;
}

function formatINR(num) {
    if (num === 0) return '₹0';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 10000000) return sign + '₹' + (abs / 10000000).toFixed(2) + ' Cr';
    if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(2) + ' L';
    return sign + '₹' + abs.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

async function fetchSheet(sheetName) {
    const url = buildCsvUrl(sheetName);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${sheetName}: ${resp.status}`);
    const text = await resp.text();
    return parseCSV(text);
}

async function fetchAllData() {
    $('loadingOverlay').classList.remove('hidden');
    $('errorBanner').style.display = 'none';

    try {
        const [daily, db, overall] = await Promise.all([
            fetchSheet(DAILY_PNL_SHEET),
            fetchSheet(STRATEGIES_DB_SHEET),
            fetchSheet(OVERALL_DASHBOARD_SHEET),
        ]);

        // Parse Daily PNL
        if (daily.length > 0) {
            dailyPnlHeaders = daily[0];
            dailyPnlData = daily.slice(1);
        }

        strategyDbData = db;
        overallDashboardData = overall;

        $('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;

        renderAll();
        showToast('Data refreshed successfully', 'success');
    } catch (err) {
        console.error('Fetch error:', err);
        $('errorMessage').textContent = `Failed to load data: ${err.message}. Check network or sheet permissions.`;
        $('errorBanner').style.display = 'flex';
        showToast('Failed to fetch data', 'error');
    } finally {
        $('loadingOverlay').classList.add('hidden');
    }
}

// ===== Auto Refresh =====
function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(fetchAllData, AUTO_REFRESH_MS);
}

// ===== Rendering =====
function renderAll() {
    renderSummaryCards();
    renderStatsRow();
    renderDaywise();
    renderTable();
    renderHeatmap();
    $('selectedMonthName').textContent = `${selectedMonth}-26`;
}

// ===== Summary Cards =====
function renderSummaryCards() {
    const monthRows = dailyPnlData.filter(r => r[3] === selectedMonth);
    const allRows = dailyPnlData;

    // Today's PNL — column 4 (Total Daily PNL). Find last row with data for selected month
    let todayPnl = 0;
    let todayDate = '';
    for (let i = monthRows.length - 1; i >= 0; i--) {
        const val = parseNum(monthRows[i][4]);
        if (val !== 0) {
            todayPnl = val;
            todayDate = monthRows[i][0];
            break;
        }
    }

    // Monthly PNL — sum of column 4 for current month
    let monthlyPnl = 0;
    monthRows.forEach(r => { monthlyPnl += parseNum(r[4]); });

    // Yearly PNL — sum of column 4 for all rows
    let yearlyPnl = 0;
    allRows.forEach(r => { yearlyPnl += parseNum(r[4]); });

    // Capital — from Strategies DB, find the row for selected month
    let capitalDeployed = 0;
    const monthKey = `${selectedMonth}-26`;
    // Strategies DB rows 5+ have month capital data at column E (Monthly Capital)
    // Row format: [S.No, Client Name, Latest Capital, '', Monthly Capital, ...]
    // or monthly rows: ['', 'Jan-26', value, ...]
    // The monthly capital matrix: rows 6-9 have "Jan-26" to "Apr-26" in column E
    // Capital for current month = the "Monthly Total" column value for that month row
    const dbMonthRow = strategyDbData.find(r => r[4] === monthKey);
    if (dbMonthRow) {
        // Monthly Total is the last non-empty meaningful column. In our data, it's at the column labeled "Monthly Total"
        // From the DB header, find the index of Monthly Total
        if (strategyDbData.length > 0) {
            const dbHeader = strategyDbData[0];
            const totalIdx = dbHeader.findIndex(h => h.trim().toLowerCase().includes('monthly total'));
            if (totalIdx >= 0 && dbMonthRow[totalIdx]) {
                capitalDeployed = parseNum(dbMonthRow[totalIdx]);
            }
        }
    }

    // If no capital from DB month row, try the "Total Capital" from the bottom of DB
    if (capitalDeployed === 0) {
        const totalCapRow = strategyDbData.find(r => r[1] && r[1].trim() === 'Total Capital');
        if (totalCapRow) capitalDeployed = parseNum(totalCapRow[2]);
    }

    // Current Drawdown — from the last trading day recorded in the sheet (globally)
    let currentDD = 0;
    for (let i = allRows.length - 1; i >= 0; i--) {
        const totalPnl = parseNum(allRows[i][4]);
        if (totalPnl !== 0) {
            currentDD = parseNum(allRows[i][6]);
            break;
        }
    }
    // Max DD across all time
    let maxDD = 0;
    allRows.forEach(r => {
        const dd = parseNum(r[6]);
        if (dd < maxDD) maxDD = dd;
    });

    // Update cards
    setCardValue('todayPnl', todayPnl, formatINR(todayPnl));
    $('todayPnlSub').textContent = todayDate ? `on ${todayDate}` : 'No trading data';

    setCardValue('monthlyPnl', monthlyPnl, formatINR(monthlyPnl));
    $('monthlyPnlSub').textContent = capitalDeployed > 0 ? `${(monthlyPnl / capitalDeployed * 100).toFixed(2)}% of capital` : '';

    setCardValue('yearlyPnl', yearlyPnl, formatINR(yearlyPnl));
    $('yearlyPnlSub').textContent = `Jan to ${selectedMonth} 2026`;

    $('capitalDeployed').textContent = formatINR(capitalDeployed);
    $('capitalDeployed').className = 'card-value';

    // Count active strategies for current month
    const activeStrategies = getActiveStrategiesForMonth(selectedMonth);
    $('capitalSub').textContent = `${activeStrategies.length} active strategies`;

    // Get overall total capital for DD% calculation
    let overallCapital = capitalDeployed;
    if (overallCapital === 0) {
        // Fallback: scan Overall Dashboard for Total Capital
        overallDashboardData.forEach(row => {
            for (let i = 0; i < row.length - 1; i++) {
                if ((row[i] || '').trim() === 'Total Capital') {
                    for (let j = i + 1; j < row.length; j++) {
                        if (row[j] && row[j].trim()) { overallCapital = parseNum(row[j]); break; }
                    }
                }
            }
        });
    }

    const currentDDPct = overallCapital > 0 ? (currentDD / overallCapital * 100).toFixed(2) : '—';
    const maxDDPct = overallCapital > 0 ? (maxDD / overallCapital * 100).toFixed(2) : '—';

    setCardValue('currentDD', currentDD, `${formatINR(currentDD)} (${currentDDPct}%)`);
    $('ddSub').textContent = `Max DD: ${formatINR(maxDD)} (${maxDDPct}%)`;
}

function setCardValue(elId, num, text) {
    const el = $(elId);
    el.textContent = text;
    el.className = 'card-value ' + (num > 0 ? 'positive' : num < 0 ? 'negative' : '');
}

// ===== Stats Row =====
function renderStatsRow() {
    // Extract from Overall Dashboard
    // Row 6 (index 5 in data, 0-indexed after header): "Win Days" at col index 12 header mapping
    // The Overall Dashboard is complex — let's extract key metrics from known positions
    // Based on the CSV analysis:
    // Row 1 (data[0]): Total Capital at col ~18: 3,550,000 | Today's PNL at col ~32
    // Row 2 (data[1]): Current Equity at col ~18 | Last 5 Days at col ~32
    // Row 3 (data[2]): Overall PNL at col ~18 | Last 30 Days at col ~32 | Max DD at col ~50
    // Row 4 (data[3]): ROI at col ~18
    // Row 7 (data[6]): Win Days at col ~38: 35 | Loss Days at col ~32: 27

    let totalCapital = 0, currentEquity = 0, overallPnl = 0, roi = '';
    let winDays = 0, lossDays = 0;
    let maxDDVal = 0;

    if (overallDashboardData.length > 1) {
        // Parse from the known positions in Overall Dashboard
        const findVal = (rowIdx, searchTerm) => {
            if (rowIdx >= overallDashboardData.length) return '';
            const row = overallDashboardData[rowIdx];
            for (let i = 0; i < row.length; i++) {
                if (row[i] && row[i].trim().toLowerCase().includes(searchTerm.toLowerCase())) {
                    // Find next non-empty cell
                    for (let j = i + 1; j < row.length; j++) {
                        if (row[j] && row[j].trim()) return row[j].trim();
                    }
                }
            }
            return '';
        };

        // Scan all rows for key metrics
        overallDashboardData.forEach(row => {
            for (let i = 0; i < row.length - 1; i++) {
                const cell = (row[i] || '').trim();
                const nextNonEmpty = (() => {
                    for (let j = i + 1; j < row.length; j++) {
                        if (row[j] && row[j].trim()) return row[j].trim();
                    }
                    return '';
                })();

                if (cell === 'Total Capital') totalCapital = parseNum(nextNonEmpty);
                if (cell === 'Current Equity') currentEquity = parseNum(nextNonEmpty);
                if (cell === 'Overall PNL') overallPnl = parseNum(nextNonEmpty);
                if (cell === 'ROI') roi = nextNonEmpty;
                if (cell === 'Win Days') winDays = parseInt(nextNonEmpty) || 0;
                if (cell === 'Loss Days') lossDays = parseInt(nextNonEmpty) || 0;
                if (cell === 'Max Drawdown (MDD)') maxDDVal = parseNum(nextNonEmpty);
                if (cell === 'Win Ratio') {
                    // Already have winDays and lossDays
                }
            }
        });
    }

    $('winDays').textContent = winDays || '—';
    $('winDays').className = 'stat-value positive';
    $('lossDays').textContent = lossDays || '—';
    $('lossDays').className = 'stat-value negative';

    const totalDays = winDays + lossDays;
    $('winRatio').textContent = totalDays > 0 ? `${Math.round(winDays / totalDays * 100)}%` : '—';
    $('winRatio').className = 'stat-value ' + (winDays > lossDays ? 'positive' : 'negative');

    $('maxDD').textContent = maxDDVal ? formatINR(maxDDVal) : '—';
    $('maxDD').className = 'stat-value negative';

    $('roi').textContent = roi || '—';
    $('roi').className = 'stat-value ' + (parseFloat(roi) >= 0 ? 'positive' : 'negative');

    $('currentEquity').textContent = currentEquity ? formatINR(currentEquity) : '—';
    $('currentEquity').className = 'stat-value';
}

// ===== Day-wise PNL =====
function renderDaywise() {
    const grid = $('daywiseGrid');
    grid.innerHTML = '';

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const dayData = {};

    // Scan all rows of Overall Dashboard for day labels and their values
    overallDashboardData.forEach(row => {
        for (let i = 0; i < row.length - 1; i++) {
            const cell = (row[i] || '').trim();
            if (days.includes(cell)) {
                // Find the next non-empty cell as the PNL value
                for (let j = i + 1; j < row.length; j++) {
                    const val = (row[j] || '').trim();
                    if (val) {
                        dayData[cell] = parseNum(val);
                        break;
                    }
                }
            }
        }
    });

    // Find max absolute value for proportional bar sizing
    const values = days.map(d => dayData[d] || 0);
    const maxAbs = Math.max(...values.map(v => Math.abs(v)), 1);

    days.forEach(day => {
        const val = dayData[day] || 0;
        const cls = val > 0 ? 'profit' : val < 0 ? 'loss' : 'neutral';
        const barPct = Math.round(Math.abs(val) / maxAbs * 100);

        const card = document.createElement('div');
        card.className = `daywise-card ${cls}`;
        card.innerHTML = `
            <div class="daywise-day">${day}</div>
            <div class="daywise-value ${pnlClass(val)}">${val !== 0 ? formatINR(val) : '—'}</div>
            <div class="daywise-bar">
                <div class="daywise-bar-fill ${val >= 0 ? 'positive' : 'negative'}" style="width: ${barPct}%"></div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ===== Strategy Table =====
function getActiveStrategiesForMonth(month) {
    if (dailyPnlHeaders.length < 9) return [];

    // Strategy columns start at index 8 (column I onwards)
    const strategyStartIdx = 8;
    const monthRows = dailyPnlData.filter(r => r[3] === month);

    const activeStrategies = [];
    for (let col = strategyStartIdx; col < dailyPnlHeaders.length; col++) {
        const name = dailyPnlHeaders[col];
        if (!name || !name.trim() || name.trim() === 'Remarks') break;

        // Check if this strategy has any non-zero PNL this month
        const hasData = monthRows.some(r => {
            const val = parseNum(r[col]);
            return val !== 0;
        });

        if (hasData) {
            activeStrategies.push({ name: name.replace(/\s*Daily PNL\s*/gi, '').trim(), colIdx: col });
        }
    }

    return activeStrategies;
}

function renderTable() {
    const thead = $('tableHead');
    const tbody = $('tableBody');
    const monthRows = dailyPnlData.filter(r => r[3] === selectedMonth);
    const activeStrategies = getActiveStrategiesForMonth(selectedMonth);

    // Filter strategies by search
    const filteredStrategies = searchQuery
        ? activeStrategies.filter(s => s.name.toLowerCase().includes(searchQuery))
        : activeStrategies;

    // Build header: Date | Day | Total Daily PNL | Cumm P&L | DD Cal | ...strategy names
    thead.innerHTML = '';
    const headerRow = document.createElement('tr');

    const cols = [
        { key: 'date', label: 'Date' },
        { key: 'day', label: 'Day' },
        { key: 'totalPnl', label: 'Total P&L' },
        { key: 'cummPnl', label: 'Cumm P&L' },
        { key: 'dd', label: 'Drawdown' },
    ];

    filteredStrategies.forEach(s => {
        cols.push({ key: `strat_${s.colIdx}`, label: s.name });
    });

    cols.forEach((col, i) => {
        const th = document.createElement('th');
        th.textContent = col.label;
        th.dataset.key = col.key;
        if (col.key === sortCol) {
            th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        }
        th.addEventListener('click', () => {
            if (sortCol === col.key) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortCol = col.key;
                sortDir = 'desc';
            }
            renderTable();
        });
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    // Build rows
    let tableRows = monthRows.map(r => {
        const row = {
            date: r[0] || '',
            day: r[1] || '',
            totalPnl: parseNum(r[4]),
            cummPnl: parseNum(r[5]),
            dd: parseNum(r[6]),
            strategies: {}
        };
        filteredStrategies.forEach(s => {
            row.strategies[s.colIdx] = parseNum(r[s.colIdx]);
        });
        return row;
    });

    // Filter out rows with no trading activity (future dates with just carry-forward cummPnl)
    tableRows = tableRows.filter(r => {
        return r.totalPnl !== 0 || Object.values(r.strategies).some(v => v !== 0);
    });

    // Sort
    if (sortCol) {
        tableRows.sort((a, b) => {
            let va, vb;
            if (sortCol === 'date') {
                va = parseDate(a.date); vb = parseDate(b.date);
            } else if (sortCol.startsWith('strat_')) {
                const idx = parseInt(sortCol.split('_')[1]);
                va = a.strategies[idx] || 0; vb = b.strategies[idx] || 0;
            } else {
                va = a[sortCol] || 0; vb = b[sortCol] || 0;
            }
            return sortDir === 'asc' ? va - vb : vb - va;
        });
    }

    // Render rows
    tbody.innerHTML = '';

    if (tableRows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.textContent = 'No trading data for this month';
        td.style.textAlign = 'center';
        td.style.padding = '40px';
        td.style.color = 'var(--text-muted)';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    tableRows.forEach(r => {
        const tr = document.createElement('tr');

        // Date
        addCell(tr, r.date, '');
        // Day
        addCell(tr, r.day, '');
        // Total PNL
        addCell(tr, formatINR(r.totalPnl), pnlClass(r.totalPnl));
        // Cumm PNL
        addCell(tr, formatINR(r.cummPnl), pnlClass(r.cummPnl));
        // DD
        addCell(tr, r.dd !== 0 ? formatINR(r.dd) : '—', r.dd < 0 ? 'negative' : 'zero');

        // Strategies
        filteredStrategies.forEach(s => {
            const val = r.strategies[s.colIdx] || 0;
            addCell(tr, val !== 0 ? formatINR(val) : '—', val !== 0 ? pnlClass(val) : 'zero');
        });

        tbody.appendChild(tr);
    });

    // Total row
    const totalTr = document.createElement('tr');
    totalTr.className = 'total-row';
    addCell(totalTr, 'TOTAL', '');
    addCell(totalTr, `${tableRows.length} days`, '');

    const totalPnl = tableRows.reduce((s, r) => s + r.totalPnl, 0);
    addCell(totalTr, formatINR(totalPnl), pnlClass(totalPnl));

    // Last cumm PNL
    const lastCumm = tableRows.length > 0 ? tableRows[tableRows.length - 1].cummPnl : 0;
    addCell(totalTr, formatINR(lastCumm), pnlClass(lastCumm));

    // Min DD
    const minDD = Math.min(...tableRows.map(r => r.dd));
    addCell(totalTr, minDD < 0 ? formatINR(minDD) : '—', 'negative');

    // Strategy totals
    filteredStrategies.forEach(s => {
        const total = tableRows.reduce((sum, r) => sum + (r.strategies[s.colIdx] || 0), 0);
        addCell(totalTr, formatINR(total), pnlClass(total));
    });

    tbody.appendChild(totalTr);
}

function addCell(tr, text, cls) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td);
}

function pnlClass(val) {
    return val > 0 ? 'positive' : val < 0 ? 'negative' : 'zero';
}

function parseDate(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr + ' 2026');
    return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ===== Heatmap =====
function renderHeatmap() {
    const grid = $('heatmapGrid');
    grid.innerHTML = '';

    // Monthly PNL data from the Strategies DB (rows 36-47 in the CSV, these are the monthly summary rows)
    // Or calculate from Daily PNL data
    MONTH_NAMES.forEach(month => {
        const monthRows = dailyPnlData.filter(r => r[3] === month);
        let monthPnl = 0;
        monthRows.forEach(r => { monthPnl += parseNum(r[4]); });

        const cell = document.createElement('div');
        cell.className = `heatmap-cell ${monthPnl > 0 ? 'profit' : monthPnl < 0 ? 'loss' : 'neutral'}`;

        const label = document.createElement('div');
        label.className = 'heatmap-month';
        label.textContent = `${month}-26`;

        const value = document.createElement('div');
        value.className = `heatmap-value ${pnlClass(monthPnl)}`;
        value.textContent = monthPnl !== 0 ? formatINR(monthPnl) : '—';

        cell.appendChild(label);
        cell.appendChild(value);
        grid.appendChild(cell);
    });
}

// ===== Export =====
function exportCSV() {
    const monthRows = dailyPnlData.filter(r => r[3] === selectedMonth);
    const activeStrategies = getActiveStrategiesForMonth(selectedMonth);

    if (monthRows.length === 0) {
        showToast('No data to export', 'info');
        return;
    }

    const headers = ['Date', 'Day', 'Total P&L', 'Cumm P&L', 'Drawdown', ...activeStrategies.map(s => s.name)];
    const rows = monthRows.map(r => {
        return [
            r[0], r[1],
            parseNum(r[4]), parseNum(r[5]), parseNum(r[6]),
            ...activeStrategies.map(s => parseNum(r[s.colIdx]))
        ];
    });

    const csvContent = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tradetron_${selectedMonth}_2026.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${selectedMonth}-26 data`, 'success');
}

// ===== Toast =====
function showToast(message, type = 'info') {
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = '0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
