/**
 * Insurance Analytics Dashboard
 *
 * Reads long-format data (Class | Cohort | Development_Period | Type | Value)
 * and renders an A-vs-E flight path chart using Plotly.js.
 *
 * Best Practices:
 *   - Single responsibility functions
 *   - Data transformation separated from rendering
 *   - Constants extracted to top level
 *   - Defensive checks throughout
 * - asasasa

/* ============================================================
   Global state
   ============================================================ */
let dashboardData = null;   // full JSON payload
let currentClass  = null;   // currently selected class

/* ============================================================
   Constants
   ============================================================ */
const COHORT_COLORS = [
    '#00cfff', '#34d399', '#fbbf24', '#f87171',
    '#a78bfa', '#60a5fa', '#fb7185', '#4ade80',
    '#38bdf8', '#e879f9', '#facc15', '#2dd4bf',
    '#f472b6',
];

const CHART_CONFIG = {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    responsive: true,
    toImageButtonOptions: {
        format: 'png',
        filename: 'flight-path-chart',
        height: 800,
        width: 1200,
        scale: 2,
    },
};

/* ============================================================
   Utility Functions
   ============================================================ */
function getBasePath() {
    const path = window.location.pathname;
    if (path.endsWith('/')) return path.slice(0, -1);
    return path.split('/').slice(0, -1).join('/');
}

/* ============================================================
   Boot
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const basePath = getBasePath();
        const res = await fetch(`${basePath}/data/analytics.json?v=${Date.now()}`);
        if (!res.ok) throw new Error(res.statusText);
        dashboardData = await res.json();

        renderHeader();
        populateClassSelector();
        renderChart();

    } catch (err) {
        console.error('Failed to load dashboard:', err);
        document.querySelector('main').innerHTML =
            '<section class="card" style="padding:40px;text-align:center;color:var(--red)">' +
            '<h2>Failed to load data</h2>' +
            '<p>' + err.message + '</p>' +
            '</section>';
    }
});

/* ============================================================
   Header
   ============================================================ */
function renderHeader() {
    document.getElementById('dashboard-title').textContent =
        dashboardData.title || 'Insurance Analytics Dashboard';
    document.getElementById('subtitle').textContent =
        dashboardData.subtitle || '';
    document.getElementById('last-updated').textContent =
        dashboardData.last_updated || new Date().toLocaleString();
}

/* ============================================================
   Class selector
   ============================================================ */
function populateClassSelector() {
    var select = document.getElementById('class-select');
    var classes = dashboardData.classes || [];

    classes.forEach(function (cls) {
        var opt = document.createElement('option');
        opt.value = cls;
        opt.textContent = cls;
        select.appendChild(opt);
    });

    currentClass = classes[0] || null;
    select.value = currentClass;

    select.addEventListener('change', function () {
        currentClass = this.value;
        renderChart();
    });
}

/* ============================================================
   Data helpers
   ============================================================ */

/**
 * Filter records to a specific class, then group by Cohort + Type.
 * Returns: { cohort: { Actual: [{dp, val}...], Expected: [{dp, val}...] } }
 */
function getGroupedData(className) {
    var records = dashboardData.records || [];
    var grouped = {};

    records.forEach(function (r) {
        if (r.Class !== className) return;
        if (!grouped[r.Cohort]) grouped[r.Cohort] = { Actual: [], Expected: [] };
        grouped[r.Cohort][r.Type].push({
            dp: r.Development_Period,
            val: r.Value,
        });
    });

    // Sort each array by development period
    Object.keys(grouped).forEach(function (cohort) {
        grouped[cohort].Actual.sort(function (a, b) { return a.dp - b.dp; });
        grouped[cohort].Expected.sort(function (a, b) { return a.dp - b.dp; });
    });

    return grouped;
}

/* ============================================================
   Chart rendering
   ============================================================ */
function renderChart() {
    if (!dashboardData || !currentClass) return;

    var grouped = getGroupedData(currentClass);
    var cohorts = Object.keys(grouped).sort();
    var traces = [];

    cohorts.forEach(function (cohort, idx) {
        var color = COHORT_COLORS[idx % COHORT_COLORS.length];
        var data  = grouped[cohort];

        // Actual line — solid with markers
        if (data.Actual.length > 0) {
            traces.push({
                x: data.Actual.map(function (d) { return d.dp; }),
                y: data.Actual.map(function (d) { return d.val; }),
                type: 'scatter',
                mode: 'lines+markers',
                name: cohort + ' Actual',
                legendgroup: cohort,
                line: { color: color, width: 2.5 },
                marker: { size: 5, color: color },
                hovertemplate:
                    '<b>' + cohort + ' Actual</b><br>' +
                    'Dev Period: %{x}<br>' +
                    'Cumulative: $%{y:,.0f}<extra></extra>',
            });
        }

        // Expected line — dashed
        if (data.Expected.length > 0) {
            traces.push({
                x: data.Expected.map(function (d) { return d.dp; }),
                y: data.Expected.map(function (d) { return d.val; }),
                type: 'scatter',
                mode: 'lines',
                name: cohort + ' Expected',
                legendgroup: cohort,
                line: { color: color, width: 1.8, dash: 'dash' },
                hovertemplate:
                    '<b>' + cohort + ' Expected</b><br>' +
                    'Dev Period: %{x}<br>' +
                    'E2U: $%{y:,.0f}<extra></extra>',
                showlegend: true,
            });
        }
    });

    var layout = {
        title: {
            text: currentClass + ' — Actual vs Expected to Ultimate',
            font: { size: 18, color: '#e8ecf1' },
            x: 0.5, xanchor: 'center',
        },
        xaxis: {
            title: { text: 'Development Period (Quarters)', font: { size: 13, color: '#7b8ba3' } },
            gridcolor: '#1e293b', zeroline: false,
            tickfont: { color: '#7b8ba3', size: 11 },
            dtick: 1,
        },
        yaxis: {
            title: { text: 'Cumulative Claims ($)', font: { size: 13, color: '#7b8ba3' } },
            gridcolor: '#1e293b', zeroline: false,
            tickformat: '$,.0f',
            tickfont: { color: '#7b8ba3', size: 11 },
        },
        plot_bgcolor: '#0f1629',
        paper_bgcolor: '#0f1629',
        font: { color: '#e8ecf1', family: 'Inter, sans-serif' },
        legend: {
            x: 1.02, xanchor: 'left', y: 1,
            bgcolor: 'rgba(15,22,41,0.8)',
            bordercolor: '#1e293b', borderwidth: 1,
            font: { size: 11, color: '#7b8ba3' },
        },
        hovermode: 'closest',
        margin: { l: 80, r: 200, t: 60, b: 60 },
    };

    document.getElementById('chart-title').textContent =
        currentClass + ' — A vs E Flight Path';

    Plotly.newPlot('flight-path-chart', traces, layout, CHART_CONFIG);
}
