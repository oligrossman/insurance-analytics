/**
 * Insurance Analytics Dashboard
 *
 * Main dashboard logic and predictive models
 *
 * Best Practices Applied:
 * - Separation of concerns: data loading, rendering, and chart logic are separated
 * - Error handling: try-catch blocks with user-friendly error messages
 * - DRY principle: reusable color generation and data transformation functions
 * - Clear function naming: descriptive names that explain purpose
 * - Constants: color palette and configuration extracted to top level
 */

/* ============================================================
   Global state
   ============================================================ */
let data = null;

/* ============================================================
   Constants & Configuration
   ============================================================ */
const CHART_COLORS = [
    '#00cfff', // accent cyan
    '#34d399', // green
    '#fbbf24', // amber
    '#f87171', // red
    '#a78bfa', // purple
    '#60a5fa', // blue
    '#fb7185', // pink
    '#4ade80'  // emerald
];

const CHART_CONFIG = {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    responsive: true,
    toImageButtonOptions: {
        format: 'png',
        filename: 'insurance-analytics-flight-path',
        height: 800,
        width: 1200,
        scale: 2
    }
};

/* ============================================================
   Utility Functions
   ============================================================ */
/**
 * Get base path for GitHub Pages compatibility.
 * Returns '' for local dev, or '/repo-name' for GitHub Pages.
 */
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
        data = await res.json();
        console.log('Data loaded:', data);

        renderHeader();
        renderFlightPathChart();

    } catch (e) {
        console.error('Failed to load dashboard:', e);
        document.querySelector('main').innerHTML =
            `<section class="card" style="padding:40px;text-align:center;color:var(--red)">
                <h2>Failed to load data</h2>
                <p>${e.message}</p>
                <p style="margin-top:12px;color:var(--text-dim);font-size:.9rem">
                    Make sure <code>data/analytics.json</code> exists and is valid JSON.
                </p>
            </section>`;
    }
});

/* ============================================================
   Header
   ============================================================ */
function renderHeader() {
    if (!data) return;
    document.getElementById('dashboard-title').textContent = data.title || 'Insurance Analytics Dashboard';
    document.getElementById('subtitle').textContent = data.subtitle || '';
    document.getElementById('last-updated').textContent = data.last_updated || new Date().toLocaleString();
}

/* ============================================================
   Flight Path Chart (A vs Z)
   ============================================================ */
function renderFlightPathChart() {
    if (!data || !data.cohorts || data.cohorts.length === 0) {
        console.warn('No cohort data available for chart');
        return;
    }

    const traces = [];

    data.cohorts.forEach((cohort, index) => {
        const color = CHART_COLORS[index % CHART_COLORS.length];

        // Actual line (solid)
        const actualDevPeriods = cohort.actuals.map(a => a.dev_period);
        const actualValues = cohort.actuals.map(a => a.cumulative);

        traces.push({
            x: actualDevPeriods,
            y: actualValues,
            type: 'scatter',
            mode: 'lines+markers',
            name: `${cohort.cohort_name} - Actual`,
            line: { color: color, width: 2.5 },
            marker: { size: 6, color: color },
            hovertemplate:
                `<b>${cohort.cohort_name} - Actual</b><br>` +
                `Development Period: %{x}<br>` +
                `Cumulative: \$%{y:,.0f}<extra></extra>`
        });

        // Expected to Ultimate line (dashed horizontal at E2U value)
        const cohortMaxDev = Math.max(...actualDevPeriods);
        traces.push({
            x: [0, cohortMaxDev],
            y: [cohort.expected_to_ultimate, cohort.expected_to_ultimate],
            type: 'scatter',
            mode: 'lines',
            name: `${cohort.cohort_name} - Expected to Ultimate`,
            line: { color: color, width: 2, dash: 'dash' },
            hovertemplate:
                `<b>${cohort.cohort_name} - Expected to Ultimate</b><br>` +
                `Development Period: %{x}<br>` +
                `E2U: \$%{y:,.0f}<extra></extra>`,
            showlegend: true
        });
    });

    const layout = {
        title: {
            text: 'A vs Z Flight Path: Actual vs Expected to Ultimate',
            font: { size: 18, color: '#e8ecf1' },
            x: 0.5,
            xanchor: 'center'
        },
        xaxis: {
            title: { text: 'Development Period (Months)', font: { size: 13, color: '#7b8ba3' } },
            gridcolor: '#1e293b',
            gridwidth: 1,
            zeroline: false,
            tickfont: { color: '#7b8ba3', size: 11 }
        },
        yaxis: {
            title: { text: 'Cumulative Claims ($)', font: { size: 13, color: '#7b8ba3' } },
            gridcolor: '#1e293b',
            gridwidth: 1,
            zeroline: false,
            tickformat: '$,.0f',
            tickfont: { color: '#7b8ba3', size: 11 }
        },
        plot_bgcolor: '#0f1629',
        paper_bgcolor: '#0f1629',
        font: { color: '#e8ecf1', family: 'Inter, sans-serif' },
        legend: {
            x: 1.02,
            xanchor: 'left',
            y: 1,
            bgcolor: 'rgba(15, 22, 41, 0.8)',
            bordercolor: '#1e293b',
            borderwidth: 1,
            font: { size: 11, color: '#7b8ba3' }
        },
        hovermode: 'closest',
        margin: { l: 70, r: 150, t: 60, b: 60 }
    };

    Plotly.newPlot('flight-path-chart', traces, layout, CHART_CONFIG);
}
