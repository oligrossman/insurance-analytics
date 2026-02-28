/**
 * Insurance Analytics Dashboard
 * 
 * Reads long-format data and renders:
 *   1. A-vs-E flight path chart with ultimate distribution band (left)
 *   2. Incurred % of Ultimate chart (right)
 *   3. Method scores table with filtering (below)
 *
 * The Projection Quality slider filters the distribution of ultimates:
 *   - Band on flight path narrows as low-quality methods are excluded
 *   - Table dims filtered-out rows
 *   - Right chart uses the selected method (independent of filter)
 *
 * Best Practices:
 *   - Single responsibility functions
 *   - Data transformation separated from rendering
 *   - Constants extracted to top level
 *   - Defensive checks throughout
 */

/* ============================================================
   Global state
   ============================================================ */
var dashboardData      = null;
var currentClass       = null;
var currentMethod      = null;
var selectedCohort     = null;            // null = show all, string = filter to one cohort
var qualityThreshold   = 0;      // 0–1, controlled by slider
var chartViewMode      = 'flight-path';   // 'flight-path' | 'comparison'
var tableSortCol       = 'Proj_Quality';  // current sort column
var tableSortAsc       = false;           // false = descending (default)
var trendHighlight     = true;            // trend-highlighting toggle

/* ============================================================
   Constants
   ============================================================ */
var MAX_DEV_PERIOD = 12;
var TOTAL_METHODS  = 27;

var COHORT_COLORS = [
    '#00cfff', '#34d399', '#fbbf24', '#f87171',
    '#a78bfa', '#60a5fa', '#fb7185', '#4ade80',
    '#38bdf8', '#e879f9', '#facc15', '#2dd4bf',
    '#f472b6',
];

// Lighter versions for band fills (same hues, lower opacity)
var BAND_OPACITY = 0.12;

var CHART_CONFIG = {
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
    var path = window.location.pathname;
    if (path === '/' || path === '/index.html' || window.location.protocol === 'file:') {
        return '';
    }
    if (path.endsWith('/')) return path.slice(0, -1);
    return path.split('/').slice(0, -1).join('/');
}

function scoreClass(val) {
    if (val >= 0.8) return 'score-high';
    if (val >= 0.6) return 'score-mid';
    return 'score-low';
}

/** Reversed colouring: high = bad (red), low = good (green). Used for Reserve Det. */
function scoreClassReversed(val) {
    if (val >= 0.8) return 'score-low';   // high res det → red
    if (val >= 0.6) return 'score-mid';
    return 'score-high';                  // low res det → green
}

function pillHtml(val) {
    var cls = 'pill pill-' + val.toLowerCase();
    return '<span class="' + cls + '">' + val + '</span>';
}

/**
 * Convert a hex colour to rgba with given alpha.
 */
function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/**
 * Cumulative development fraction at a given development period.
 * Uses a front-loaded concave curve typical of insurance lines:
 *   f(d) = 1 − (1 − d/MAX)²
 *
 * Examples (MAX_DEV_PERIOD = 12):
 *   DP 0 → 0%   DP 3 → 44%   DP 6 → 75%
 *   DP 9 → 94%  DP 12 → 100%
 *
 * This is used in the comparison chart to estimate what was
 * expected to be incurred by a given period, rather than the
 * full E2U.
 */
function developmentFraction(dp) {
    var t = dp / MAX_DEV_PERIOD;
    if (t >= 1) return 1;
    if (t <= 0) return 0;
    return 1 - Math.pow(1 - t, 2);
}

/**
 * Read which legend groups are currently hidden (toggled off) in a
 * Plotly chart.  Returns a Set of legendgroup strings.
 */
function getHiddenLegendGroups(divId) {
    var div    = document.getElementById(divId);
    var hidden = new Set();
    if (div && div.data) {
        div.data.forEach(function (trace) {
            if (trace.visible === 'legendonly' && trace.legendgroup) {
                hidden.add(trace.legendgroup);
            }
        });
    }
    return hidden;
}

/**
 * Dim traces whose legendgroup doesn't match the selected cohort.
 * If no cohort is selected, all traces are left at full opacity.
 */
function applyCohortHighlight(traces) {
    if (!selectedCohort) return;
    traces.forEach(function (trace) {
        if (!trace.legendgroup) return;
        if (trace.legendgroup !== selectedCohort) {
            trace.opacity = 0.15;
        }
    });
}

/**
 * Apply saved legend visibility state to new traces so legend
 * toggles survive a re-render.
 */
function applyLegendState(traces, hiddenGroups) {
    if (hiddenGroups.size === 0) return;
    traces.forEach(function (trace) {
        if (trace.legendgroup && hiddenGroups.has(trace.legendgroup)) {
            trace.visible = 'legendonly';
        }
    });
}

/* ============================================================
   Boot
   ============================================================ */
async function initDashboard() {
    try {
        var basePath = getBasePath();
        var dataPath = basePath ? basePath + '/data/analytics.json' : 'data/analytics.json';
        var res = await fetch(dataPath + '?v=' + Date.now());
        if (!res.ok) throw new Error(res.statusText);
        dashboardData = await res.json();

        renderHeader();
        populateClassSelector();
        populateMethodSelector();
        initQualitySlider();
        initViewToggle();
        initRHSPanelToggle();
        initTrendToggle();
        initTableSort();
        initClaimsClearBtn();
        initClaimsSort();
        initDecisionTableRowClicks();
        renderAll();
        
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        document.querySelector('main').innerHTML =
            '<section class="card" style="padding:40px;text-align:center;color:var(--red)">' +
            '<h2>Failed to load data</h2>' +
            '<p>' + err.message + '</p>' +
            '</section>';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
} else {
    initDashboard();
}

/* ============================================================
   Render everything
   ============================================================ */
function renderAll() {
    renderLHSChart();
    renderPctChart();
    renderNormChart();
    renderShapBar();
    renderScoresTable();
    renderScoreDistributions();
    renderSelectedMethodStrip();
    renderClaimsTable();
    renderDecisionTable();
    updateMethodsCount();
}

/* ============================================================
   Header (no-op — header removed for compact layout)
   ============================================================ */
function renderHeader() { /* intentionally empty */ }

/* ============================================================
   Class selector
   ============================================================ */
function populateClassSelector() {
    var select  = document.getElementById('class-select');
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
        selectedCohort = null;
        renderAll();
    });
}

/* ============================================================
   Method selector
   ============================================================ */
function populateMethodSelector() {
    var select  = document.getElementById('method-select');
    var methods = dashboardData.methods || [];

    methods.forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
    });

    currentMethod = methods[0] || null;
    select.value = currentMethod;

    select.addEventListener('change', function () {
        currentMethod = this.value;
        renderLHSChart();
        renderPctChart();
        renderShapBar();
        renderSelectedMethodStrip();
        renderScoreDistributions();
        renderDecisionTable();
        highlightActiveRow();
    });
}

/* ============================================================
   Quality threshold slider
   ============================================================ */
function initQualitySlider() {
    var slider = document.getElementById('quality-slider');
    var label  = document.getElementById('quality-value');

    slider.addEventListener('input', function () {
        qualityThreshold = parseInt(this.value) / 100;
        label.textContent = this.value + '%';
        renderAll();
    });
}

function updateMethodsCount() {
    var passing = getPassingMethods(currentClass);
    var badge   = document.getElementById('methods-count');
    badge.textContent = passing.length + ' / ' + TOTAL_METHODS;
}

/* ============================================================
   Select a method (from table click or dropdown)
   ============================================================ */
function selectMethod(methodKey) {
    currentMethod = methodKey;
    document.getElementById('method-select').value = methodKey;
    renderLHSChart();
    renderPctChart();
    renderShapBar();
    renderSelectedMethodStrip();
    renderScoreDistributions();
    renderDecisionTable();
    highlightActiveRow();
}

/* ============================================================
   Data helpers
   ============================================================ */
function getGroupedData(className) {
    var records = dashboardData.records || [];
    var grouped = {};

    records.forEach(function (r) {
        if (r.Class !== className) return;
        if (!grouped[r.Cohort]) grouped[r.Cohort] = { Actual: [], Expected: [] };
        grouped[r.Cohort][r.Type].push({ dp: r.Development_Period, val: r.Value });
    });

    Object.keys(grouped).forEach(function (cohort) {
        grouped[cohort].Actual.sort(function (a, b)   { return a.dp - b.dp; });
        grouped[cohort].Expected.sort(function (a, b) { return a.dp - b.dp; });
    });

    return grouped;
}

function getUltimate(className, cohort, method) {
    var ultimates = dashboardData.ultimates || [];
    for (var i = 0; i < ultimates.length; i++) {
        var u = ultimates[i];
        if (u.Class === className && u.Cohort === cohort && u.Method === method) {
            return u.Ultimate;
        }
    }
    return null;
}

function getPriorUltimate(className, cohort, method) {
    var priors = dashboardData.prior_ultimates || [];
    for (var i = 0; i < priors.length; i++) {
        var p = priors[i];
        if (p.Class === className && p.Cohort === cohort && p.Method === method) {
            return p.Ultimate;
        }
    }
    return null;
}

/**
 * Return the total (sum) ultimate across all cohorts for a given class + method.
 */
function getTotalUltimate(className, method) {
    var ultimates = dashboardData.ultimates || [];
    var total = 0;
    for (var i = 0; i < ultimates.length; i++) {
        var u = ultimates[i];
        if (u.Class === className && u.Method === method) {
            total += u.Ultimate;
        }
    }
    return total;
}

function getMethodAEAndUltChange(className, method) {
    var grouped = getGroupedData(className);
    var cohorts = Object.keys(grouped).sort();
    var totalA = 0, totalE = 0, totalCurUlt = 0, totalPriUlt = 0;
    cohorts.forEach(function (cohort) {
        var data = grouped[cohort];
        if (data.Actual.length === 0) return;
        var lastDP = data.Actual[data.Actual.length - 1].dp;
        var lastActual = data.Actual[data.Actual.length - 1].val;
        var e2u = data.Expected.length > 0 ? data.Expected[0].val : null;
        if (e2u) {
            var expectedAtDP = e2u * developmentFraction(lastDP);
            if (expectedAtDP) { totalA += lastActual; totalE += expectedAtDP; }
        }
        var cur = getUltimate(className, cohort, method);
        var pri = getPriorUltimate(className, cohort, method);
        if (cur != null && pri != null && pri !== 0) {
            totalCurUlt += cur;
            totalPriUlt += pri;
        }
    });
    var aeRatio = totalE !== 0 ? (totalA - totalE) / totalE : null;
    var ultChg = totalPriUlt !== 0 ? (totalCurUlt - totalPriUlt) / totalPriUlt : null;
    return { aeRatio: aeRatio, ultChg: ultChg };
}

/**
 * Format a number with commas as thousands separator.
 */
function formatNumber(n) {
    if (n == null) return '—';
    return Math.round(n).toLocaleString();
}

/**
 * Format cohort for display: "2022Q1" -> "2022 Q1".
 */
function formatCohort(cohort) {
    if (cohort == null) return '';
    return String(cohort).replace(/(\d{4})(Q\d)/i, '$1 $2');
}

/**
 * Cohorts in display order: most recent first (same as chart).
 */
function getCohortsMostRecentFirst(grouped) {
    return Object.keys(grouped).sort().reverse();
}

function getGlobalYMax(grouped) {
    var yMax = 0;
    Object.keys(grouped).forEach(function (cohort) {
        grouped[cohort].Actual.forEach(function (d)   { if (d.val > yMax) yMax = d.val; });
        grouped[cohort].Expected.forEach(function (d) { if (d.val > yMax) yMax = d.val; });
    });
    return yMax;
}

/**
 * Get method keys that pass the current projection quality threshold
 * for a given class.
 */
function getPassingMethods(className) {
    var scores = dashboardData.method_scores || [];
    return scores
        .filter(function (s) {
            return s.Class === className && s.Proj_Quality >= qualityThreshold;
        })
        .map(function (s) { return s.Method; });
}

/**
 * For a given class + cohort, get the min and max ultimates
 * across all methods that pass the quality filter.
 */
function getUltimateBand(className, cohort, passingMethods) {
    var ultimates = dashboardData.ultimates || [];
    var vals = [];

    ultimates.forEach(function (u) {
        if (u.Class === className && u.Cohort === cohort &&
            passingMethods.indexOf(u.Method) >= 0) {
            vals.push(u.Ultimate);
        }
    });

    if (vals.length === 0) return null;

    return {
        min: Math.min.apply(null, vals),
        max: Math.max.apply(null, vals),
        count: vals.length,
    };
}

/**
 * Get the large loss threshold for a given class.
 */
function getLargeThreshold(className) {
    var thresholds = dashboardData.large_loss_thresholds || {};
    return thresholds[className] || 100000;
}

/**
 * Get Reserve_Det and Proj_Quality for a class + method.
 */
function getMethodScoresRow(className, method) {
    var scores = dashboardData.method_scores || [];
    for (var i = 0; i < scores.length; i++) {
        var s = scores[i];
        if (s.Class === className && s.Method === method) {
            return { Reserve_Det: s.Reserve_Det, Proj_Quality: s.Proj_Quality };
        }
    }
    return null;
}

/**
 * Get method type (Claims-based / Premium-based) for a method key.
 */
function getMethodType(method) {
    var ultimates = dashboardData.ultimates || [];
    for (var i = 0; i < ultimates.length; i++) {
        if (ultimates[i].Method === method && ultimates[i].Method_Type) {
            return ultimates[i].Method_Type;
        }
    }
    return null;
}

/**
 * Get premium change (Earned vs Prior_Earned) for a class/cohort.
 * Returns { earned, priorEarned, changePct } or null.
 */
function getPremiumChange(className, cohort) {
    var premiums = dashboardData.premiums || [];
    for (var i = 0; i < premiums.length; i++) {
        var p = premiums[i];
        if (p.Class === className && p.Cohort === cohort) {
            var prior = p.Prior_Earned || 0;
            if (!prior) return null;
            var chg = (p.Earned - prior) / prior;
            return { earned: p.Earned, priorEarned: prior, changePct: chg };
        }
    }
    return null;
}

/**
 * Get claim count current and prior for a class/cohort.
 * Returns { countCurrent, countPrior, changePct } or null.
 */
function getClaimCountChange(className, cohort) {
    var counts = dashboardData.cohort_claim_counts || [];
    for (var i = 0; i < counts.length; i++) {
        var c = counts[i];
        if (c.Class === className && c.Cohort === cohort) {
            var prior = c.Count_Prior || 0;
            if (prior === 0) return { countCurrent: c.Count_Current, countPrior: 0, changePct: 0 };
            var chg = (c.Count_Current - prior) / prior;
            return { countCurrent: c.Count_Current, countPrior: prior, changePct: chg };
        }
    }
    return null;
}

/**
 * Max ultimate among claims-based methods for this class/cohort.
 */
function getMaxClaimsBasedUltimate(className, cohort) {
    var ultimates = dashboardData.ultimates || [];
    var maxVal = null;
    ultimates.forEach(function (u) {
        if (u.Class === className && u.Cohort === cohort && u.Method_Type === 'Claims-based') {
            if (maxVal == null || u.Ultimate > maxVal) maxVal = u.Ultimate;
        }
    });
    return maxVal;
}

/** DAG thresholds (configurable). */
var DAG_AE_THRESHOLD = 0.05;
var DAG_CLAIM_COUNT_THRESHOLD = 0.15;
var DAG_LARGE_LOSS_PCT_THRESHOLD = 50;
var DAG_PREMIUM_CHANGE_THRESHOLD = 0.10;

/**
 * Run the reserving decision DAG for one cohort.
 * Only produces a suggestion when |A-E/E| > 5%.
 * Returns { driver: string, suggestion: string }.
 */
function runDecisionDAG(className, cohort, opts) {
    var aeOverThreshold = opts.aeOverThreshold;
    var fanningOutBoth = opts.fanningOutBoth;
    var claimCountUp15 = opts.claimCountUp15;
    var largeLossPct = opts.largeLossPct;
    var premiumChangePct = opts.premiumChangePct;
    var methodType = opts.methodType;
    var currentUltimate = opts.currentUltimate;
    var maxClaimsBasedUltimate = opts.maxClaimsBasedUltimate;

    if (!aeOverThreshold) {
        return { driver: '', suggestion: '' };
    }

    if (fanningOutBoth) {
        return {
            driver: 'Trend acceleration',
            suggestion: 'Check if the pattern is speeding up.',
        };
    }

    if (claimCountUp15) {
        return {
            driver: 'Claim frequency',
            suggestion: 'Check if the pattern was slowing down — movement may be driven by more claims than expected.',
        };
    }

    if (largeLossPct >= DAG_LARGE_LOSS_PCT_THRESHOLD) {
        return {
            driver: 'Large losses',
            suggestion: 'Keep pattern as-is but treat large losses separately.',
        };
    }

    if (premiumChangePct >= DAG_PREMIUM_CHANGE_THRESHOLD) {
        return {
            driver: 'Premium growth',
            suggestion: 'Move toward premium-based method.',
        };
    }

    if (methodType === 'Premium-based' && maxClaimsBasedUltimate != null && currentUltimate != null && maxClaimsBasedUltimate > currentUltimate) {
        return {
            driver: 'Method mismatch',
            suggestion: 'Switch to claims-based method.',
        };
    }

    return {
        driver: 'Unclear',
        suggestion: 'Manual review of cohort experience.',
    };
}

/**
 * Compute the A-E movement attribution split for a cohort:
 * how much of the total claim movement is from large losses vs attritional.
 */
function getAEAttribution(className, cohort) {
    var claims = dashboardData.claims || [];
    var threshold = getLargeThreshold(className);
    var cohortClaims = claims.filter(function (c) {
        return c.Class === className && c.Cohort === cohort;
    });

    var totalMovement = 0, largeLossMovement = 0, attritionalMovement = 0;
    var largeLossCount = 0, attritionalCount = 0;

    cohortClaims.forEach(function (c) {
        var mov = c.Incurred_Current - c.Incurred_Prior;
        totalMovement += mov;
        if (c.Incurred_Current >= threshold) {
            largeLossMovement += mov;
            largeLossCount++;
        } else {
            attritionalMovement += mov;
            attritionalCount++;
        }
    });

    var largePct = (totalMovement !== 0)
        ? (largeLossMovement / totalMovement) * 100
        : 0;

    return {
        total: totalMovement,
        large: largeLossMovement,
        attritional: attritionalMovement,
        largePct: largePct,
        largeLossCount: largeLossCount,
        attritionalCount: attritionalCount,
        totalCount: cohortClaims.length,
        threshold: threshold,
    };
}

/**
 * Select / deselect a cohort for the claims drill-down.
 */
function selectCohort(cohort) {
    if (selectedCohort === cohort) {
        selectedCohort = null;
    } else {
        selectedCohort = cohort;
        showClaimsPanel();
    }
    renderClaimsTable();
    renderLHSChart();
}

/**
 * Attach a Plotly click handler that detects which cohort was clicked
 * by inspecting the trace's legendgroup.
 */
function attachCohortClickHandler(divId, cohorts) {
    var div = document.getElementById(divId);
    if (!div) return;

    div.removeAllListeners && div.removeAllListeners('plotly_click');
    div.on('plotly_click', function (eventData) {
        if (!eventData || !eventData.points || eventData.points.length === 0) return;
        var point = eventData.points[0];
        var cohort = null;

        if (point.data && point.data.legendgroup) {
            var lg = point.data.legendgroup;
            if (cohorts.indexOf(lg) >= 0) {
                cohort = lg;
            }
        }

        if (!cohort && point.y && cohorts.indexOf(point.y) >= 0) {
            cohort = point.y;
        }

        if (cohort) {
            selectCohort(cohort);
        }
    });
}

/* ============================================================
   View toggle
   ============================================================ */
function initViewToggle() {
    var toggle = document.getElementById('view-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', function (e) {
        var btn = e.target.closest('.toggle-btn');
        if (!btn) return;

        var view = btn.getAttribute('data-view');
        if (view === chartViewMode) return;          // already active

        chartViewMode = view;

        // Update button states
        toggle.querySelectorAll('.toggle-btn').forEach(function (b) {
            b.classList.toggle('active', b === btn);
        });

        renderLHSChart();
    });
}

/* ============================================================
   RHS panel toggle (dev charts ↔ claims table)
   ============================================================ */
var rhsPanelView = 'charts';   // 'charts' | 'claims'

function initRHSPanelToggle() {
    var nav = document.querySelector('.rhs-panel-nav');
    if (!nav) return;

    nav.addEventListener('click', function (e) {
        var btn = e.target.closest('.rhs-nav-btn');
        if (!btn) return;

        var panel = btn.getAttribute('data-panel');
        if (panel === rhsPanelView) return;

        rhsPanelView = panel;

        nav.querySelectorAll('.rhs-nav-btn').forEach(function (b) {
            b.classList.toggle('active', b === btn);
        });

        document.getElementById('rhs-view-charts').classList.toggle('active', panel === 'charts');
        document.getElementById('rhs-view-claims').classList.toggle('active', panel === 'claims');

        if (panel === 'charts') {
            renderShapBar();
            renderPctChart();
            renderNormChart();
        } else {
            renderClaimsTable();
        }
    });
}

/**
 * Programmatically switch to the claims panel (e.g. when a cohort is clicked).
 */
function showClaimsPanel() {
    if (rhsPanelView === 'claims') return;
    rhsPanelView = 'claims';

    document.querySelectorAll('.rhs-nav-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-panel') === 'claims');
    });
    document.getElementById('rhs-view-charts').classList.remove('active');
    document.getElementById('rhs-view-claims').classList.add('active');
    renderClaimsTable();
}

/* ============================================================
   Trend highlighting toggle
   ============================================================ */
function initTrendToggle() {
    var cb = document.getElementById('trend-toggle-cb');
    if (!cb) return;

    cb.checked = trendHighlight;
    cb.addEventListener('change', function () {
        trendHighlight = cb.checked;
        renderPctChart();
        renderNormChart();
    });
}

/* ============================================================
   LHS chart dispatcher — picks the right renderer
   ============================================================ */
function renderLHSChart() {
    if (chartViewMode === 'comparison') {
        renderComparisonChart();
    } else {
        renderFlightPathChartInner();
    }
}

/* ============================================================
   Chart 1a — Flight Path with Ultimate Bands
   ============================================================ */
function renderFlightPathChartInner() {
    if (!dashboardData || !currentClass) return;

    // ── Save legend toggle state before re-render ────────
    var hiddenGroups = getHiddenLegendGroups('flight-path-chart');

    var grouped        = getGroupedData(currentClass);
    var cohorts        = getCohortsMostRecentFirst(grouped);
    var traces         = [];
    var passingMethods = getPassingMethods(currentClass);
    var yMax           = getGlobalYMax(grouped);

    // Also consider band ultimates for Y range
    cohorts.forEach(function (cohort) {
        var band = getUltimateBand(currentClass, cohort, passingMethods);
        if (band && band.max > yMax) yMax = band.max;
    });

    // ── Pass 1: Draw bands (behind everything) ──────────────
    cohorts.forEach(function (cohort, idx) {
        var color = COHORT_COLORS[idx % COHORT_COLORS.length];
        var data  = grouped[cohort];
        if (data.Actual.length === 0) return;

        var band = getUltimateBand(currentClass, cohort, passingMethods);
        if (!band) return;

        var lastActual = data.Actual[data.Actual.length - 1];
        var fillColor  = hexToRgba(color, BAND_OPACITY);
        var lineColor  = hexToRgba(color, 0.25);

        // Lower bound trace
        traces.push({
            x: [lastActual.dp, MAX_DEV_PERIOD],
            y: [lastActual.val, band.min],
            type: 'scatter', mode: 'lines',
            line: { color: lineColor, width: 0.5 },
            legendgroup: cohort,
            showlegend: false,
            hoverinfo: 'skip',
        });

        // Upper bound trace with fill to lower
        traces.push({
            x: [lastActual.dp, MAX_DEV_PERIOD],
            y: [lastActual.val, band.max],
            type: 'scatter', mode: 'lines',
            fill: 'tonexty',
            fillcolor: fillColor,
            line: { color: lineColor, width: 0.5 },
            legendgroup: cohort,
            showlegend: false,
            hovertemplate:
                '<b>' + formatCohort(cohort) + ' Ultimate Range</b><br>' +
                'Min: $' + band.min.toLocaleString(undefined, {maximumFractionDigits: 0}) +
                '<br>Max: $' + band.max.toLocaleString(undefined, {maximumFractionDigits: 0}) +
                '<br>Methods: ' + band.count +
                '<extra></extra>',
        });
    });

    // ── Pass 2: Actual lines ────────────────────────────────
    cohorts.forEach(function (cohort, idx) {
        var color = COHORT_COLORS[idx % COHORT_COLORS.length];
        var data  = grouped[cohort];

        if (data.Actual.length > 0) {
            traces.push({
                x: data.Actual.map(function (d) { return d.dp; }),
                y: data.Actual.map(function (d) { return d.val; }),
                type: 'scatter', mode: 'lines+markers',
                name: formatCohort(cohort) + ' Actual', legendgroup: cohort,
                line:   { color: color, width: 2.5 },
                marker: { size: 5, color: color },
                hovertemplate:
                    '<b>' + formatCohort(cohort) + ' Actual</b><br>' +
                    'Dev Period: %{x}<br>Cumulative: $%{y:,.0f}<extra></extra>',
            });
        }

        // Expected projection (original E2U)
        if (data.Expected.length > 0 && data.Actual.length > 0) {
            var lastActual  = data.Actual[data.Actual.length - 1];
            var expectedUlt = data.Expected[0].val;
            traces.push({
                x: [lastActual.dp, MAX_DEV_PERIOD],
                y: [lastActual.val, expectedUlt],
                type: 'scatter', mode: 'lines+markers',
                name: formatCohort(cohort) + ' Expected', legendgroup: cohort,
                line:   { color: color, width: 1.8, dash: 'dash' },
                marker: { size: [0, 8], symbol: ['circle', 'diamond'], color: color },
                hovertemplate:
                    '<b>' + formatCohort(cohort) + ' Expected</b><br>' +
                    'Dev Period: %{x}<br>E2U: $%{y:,.0f}<extra></extra>',
                showlegend: true,
            });
        }
    });

    // ── Pass 3: Prior ultimate (grey) + Current ultimate (white) ─
    var fpAnnotations = [];

    cohorts.forEach(function (cohort, idx) {
        var color = COHORT_COLORS[idx % COHORT_COLORS.length];
        var data  = grouped[cohort];
        if (data.Actual.length === 0) return;

        var selUlt   = getUltimate(currentClass, cohort, currentMethod);
        var priorUlt = getPriorUltimate(currentClass, cohort, currentMethod);

        if (priorUlt !== null) {
            if (priorUlt > yMax) yMax = priorUlt;

            traces.push({
                x: [MAX_DEV_PERIOD],
                y: [priorUlt],
                type: 'scatter', mode: 'markers',
                name: formatCohort(cohort) + ' Prior Ult',
                legendgroup: cohort,
                showlegend: false,
                marker: {
                    size: 9,
                    symbol: 'asterisk',
                    color: '#888888',
                    line: { color: '#888888', width: 1.5 },
                },
                hovertemplate:
                    '<b>' + formatCohort(cohort) + ' Prior Ultimate</b><br>' +
                    'Method: ' + currentMethod + '<br>' +
                    'Prior: $%{y:,.0f}<extra></extra>',
            });
        }

        if (selUlt === null) return;
        if (selUlt > yMax) yMax = selUlt;

        traces.push({
            x: [MAX_DEV_PERIOD],
            y: [selUlt],
            type: 'scatter', mode: 'markers',
            name: formatCohort(cohort) + ' Sel Ult',
            legendgroup: cohort,
            showlegend: false,
            marker: {
                size: 10,
                symbol: 'asterisk',
                color: '#ffffff',
                line: { color: '#ffffff', width: 1.5 },
            },
            hovertemplate:
                '<b>' + formatCohort(cohort) + ' Selected Ultimate</b><br>' +
                'Method: ' + currentMethod + '<br>' +
                'Ultimate: $%{y:,.0f}<extra></extra>',
        });

        if (priorUlt !== null && priorUlt !== 0) {
            var pctChg = ((selUlt - priorUlt) / priorUlt) * 100;
            var chgColor = pctChg > 0 ? '#f87171' : '#34d399';
            var chgText = (pctChg >= 0 ? '+' : '') + pctChg.toFixed(1) + '%';

            fpAnnotations.push({
                x: MAX_DEV_PERIOD,
                y: selUlt,
                text: chgText,
                showarrow: false,
                font: { size: 9, color: chgColor, family: 'Inter, sans-serif' },
                xanchor: 'left',
                xshift: 8,
                yanchor: 'middle',
            });
        }
    });

    // ── Restore legend toggle state + cohort highlight ─────
    applyCohortHighlight(traces);
    applyLegendState(traces, hiddenGroups);

    var layout = {
        title: { text: currentClass + ' — Actual vs Expected to Ultimate', font: { size: 16, color: '#e8ecf1' }, x: 0.5, xanchor: 'center' },
        annotations: fpAnnotations,
        xaxis: {
            title: { text: 'Development Period (Quarters)', font: { size: 12, color: '#7b8ba3' } },
            gridcolor: '#2d2d2d', zeroline: false,
            tickfont: { color: '#7b8ba3', size: 11 }, dtick: 1,
            range: [-0.3, MAX_DEV_PERIOD + 0.5], autorange: false,
        },
        yaxis: {
            title: { text: 'Cumulative Claims ($)', font: { size: 12, color: '#7b8ba3' } },
            gridcolor: '#2d2d2d', zeroline: false,
            tickformat: '$,.0f', tickfont: { color: '#7b8ba3', size: 11 },
            range: [0, yMax * 1.12], autorange: false,
        },
        plot_bgcolor: '#181818', paper_bgcolor: '#181818',
        font: { color: '#e8ecf1', family: 'Inter, sans-serif' },
        legend: {
            x: 1.02, xanchor: 'left', y: 1,
            bgcolor: 'rgba(24,24,24,0.9)',
            bordercolor: '#2d2d2d', borderwidth: 1,
            font: { size: 10, color: '#7b8ba3' },
        },
        hovermode: 'closest',
        margin: { l: 70, r: 160, t: 50, b: 55 },
    };

    document.getElementById('chart-title').textContent = currentClass + ' — A vs E Flight Path';
    document.getElementById('chart-desc').textContent  = 'Actual vs Expected to Ultimate by Cohort';
    Plotly.newPlot('flight-path-chart', traces, layout, CHART_CONFIG);
    attachCohortClickHandler('flight-path-chart', cohorts);
}

/* ============================================================
   Chart 1b — A vs E Comparison (dumbbell / lollipop)
   Cohort on Y-axis (most recent at top), values on X-axis.
   Shows: ultimate band → A-E gap bar → Actual · Expected · Star
   ============================================================ */
function renderComparisonChart() {
    if (!dashboardData || !currentClass) return;

    var hiddenGroups   = getHiddenLegendGroups('flight-path-chart');
    var grouped        = getGroupedData(currentClass);
    var cohorts        = getCohortsMostRecentFirst(grouped);
    var passingMethods = getPassingMethods(currentClass);
    var traces         = [];
    var annotations    = [];
    var xMax           = 0;

    // ── Collect per-cohort data ──────────────────────────────
    // "Expected" here = what was expected to be incurred by the
    // CURRENT development period (not the full E2U).  Derived as:
    //   Expected_at_d = E2U × developmentFraction(d)
    // This makes (A-E)/E a genuine comparison at the same point
    // in time, and Expected < Ultimate for immature cohorts.

    var rows = [];

    cohorts.forEach(function (cohort, idx) {
        var data  = grouped[cohort];
        if (data.Actual.length === 0) return;

        var color       = COHORT_COLORS[idx % COHORT_COLORS.length];
        var lastDP      = data.Actual[data.Actual.length - 1].dp;
        var lastActual  = data.Actual[data.Actual.length - 1].val;
        var e2u         = data.Expected.length > 0 ? data.Expected[0].val : null;
        var expectedAtDP = (e2u != null) ? e2u * developmentFraction(lastDP) : null;
        var selUlt      = getUltimate(currentClass, cohort, currentMethod);
        var priorUlt    = getPriorUltimate(currentClass, cohort, currentMethod);
        var band        = getUltimateBand(currentClass, cohort, passingMethods);

        var dev = null;
        if (expectedAtDP && expectedAtDP !== 0) {
            dev = (lastActual - expectedAtDP) / expectedAtDP;
        }

        rows.push({
            cohort: cohort, actual: lastActual, expectedAtDP: expectedAtDP,
            e2u: e2u, lastDP: lastDP,
            selUlt: selUlt, priorUlt: priorUlt, band: band, dev: dev, color: color,
        });

        if (lastActual   > xMax) xMax = lastActual;
        if (expectedAtDP && expectedAtDP > xMax) xMax = expectedAtDP;
        if (selUlt       && selUlt > xMax) xMax = selUlt;
        if (priorUlt     && priorUlt > xMax) xMax = priorUlt;
        if (band         && band.max > xMax) xMax = band.max;
    });

    // ── Build per-cohort traces so highlight + click works ─────
    var isFirstRow = true;
    rows.forEach(function (r) {
        var lg = r.cohort;

        // Band
        if (r.band) {
            traces.push({
                x: [r.band.min, r.band.max],
                y: [r.cohort, r.cohort],
                type: 'scatter', mode: 'lines',
                line: { color: 'rgba(255,255,255,0.10)', width: 18 },
                legendgroup: lg,
                showlegend: false,
                hovertemplate:
                    '<b>' + formatCohort(r.cohort) + ' Ultimate Range</b><br>' +
                    'Min: $%{x:,.0f}<br>Max: $' +
                    r.band.max.toLocaleString(undefined, { maximumFractionDigits: 0 }) +
                    '<br>Methods: ' + r.band.count + '<extra></extra>',
            });
        }

        // A-E gap bar
        if (r.actual != null && r.expectedAtDP != null) {
            var isAdverse = r.dev !== null && r.dev > 0.05;
            var gapColor  = isAdverse
                ? 'rgba(248,113,113,0.55)'
                : 'rgba(52,211,153,0.45)';

            traces.push({
                x: [r.actual, r.expectedAtDP],
                y: [r.cohort, r.cohort],
                type: 'scatter', mode: 'lines',
                line: { color: gapColor, width: 7 },
                legendgroup: lg,
                showlegend: false,
                hoverinfo: 'skip',
            });

            if (r.dev !== null) {
                r._aeText  = (r.dev >= 0 ? '+' : '') + (r.dev * 100).toFixed(1) + '%';
                r._aeColor = isAdverse ? '#f87171' : '#34d399';
                r._aeX     = Math.max(r.actual, r.expectedAtDP);
            }
        }

        // Actual marker
        traces.push({
            x: [r.actual],
            y: [r.cohort],
            type: 'scatter', mode: 'markers',
            name: isFirstRow ? 'Actual' : '',
            legendgroup: lg,
            showlegend: false,
            marker: {
                size: 10, color: '#00cfff', symbol: 'circle',
                line: { color: '#ffffff', width: 1 },
            },
            hovertemplate: '<b>' + formatCohort(r.cohort) + ' — Actual</b><br>$%{x:,.0f}<extra></extra>',
        });

        // Expected marker
        if (r.expectedAtDP != null) {
            traces.push({
                x: [r.expectedAtDP],
                y: [r.cohort],
                type: 'scatter', mode: 'markers',
                name: isFirstRow ? 'Expected @ DP' : '',
                legendgroup: lg,
                showlegend: false,
                marker: {
                    size: 10, color: '#fbbf24', symbol: 'diamond',
                    line: { color: '#ffffff', width: 1 },
                },
                hovertemplate:
                    '<b>' + formatCohort(r.cohort) + ' — Expected @ DP ' + r.lastDP + '</b><br>' +
                    '$' + r.expectedAtDP.toLocaleString(undefined, { maximumFractionDigits: 0 }) +
                    '<br>(' + (developmentFraction(r.lastDP) * 100).toFixed(0) + '% of E2U $' +
                    r.e2u.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ')' +
                    '<extra></extra>',
            });
        }

        // Prior ultimate star (grey)
        if (r.priorUlt != null) {
            traces.push({
                x: [r.priorUlt],
                y: [r.cohort],
                type: 'scatter', mode: 'markers',
                name: isFirstRow ? 'Prior Ult' : '',
                legendgroup: lg,
                showlegend: false,
                marker: {
                    size: 9, color: '#888888', symbol: 'asterisk',
                    line: { color: '#888888', width: 1.5 },
                },
                hovertemplate:
                    '<b>' + formatCohort(r.cohort) + ' — Prior Ultimate</b><br>' +
                    'Method: ' + currentMethod + '<br>' +
                    '$%{x:,.0f}<extra></extra>',
            });
        }

        // Selected ultimate star (white)
        if (r.selUlt != null) {
            traces.push({
                x: [r.selUlt],
                y: [r.cohort],
                type: 'scatter', mode: 'markers',
                name: isFirstRow ? 'Selected Ult' : '',
                legendgroup: lg,
                showlegend: false,
                marker: {
                    size: 10, color: '#ffffff', symbol: 'asterisk',
                    line: { color: '#ffffff', width: 1.5 },
                },
                hovertemplate:
                    '<b>' + formatCohort(r.cohort) + ' — Selected Ultimate</b><br>' +
                    'Method: ' + currentMethod + '<br>' +
                    '$%{x:,.0f}<extra></extra>',
            });
        }

        isFirstRow = false;
    });

    // ── Combined annotations: A-E + Ult movement per row ───
    var compAnnotations = [];
    rows.forEach(function (r) {
        var parts = [];
        var rightmostX = 0;

        if (r._aeText) {
            parts.push('<span style="color:' + r._aeColor + '">A-E ' + r._aeText + '</span>');
            if (r._aeX > rightmostX) rightmostX = r._aeX;
        }

        if (r.selUlt != null && r.priorUlt != null && r.priorUlt !== 0) {
            var pctChg = ((r.selUlt - r.priorUlt) / r.priorUlt) * 100;
            var chgColor = pctChg > 0 ? '#f87171' : '#34d399';
            var chgText = (pctChg >= 0 ? '+' : '') + pctChg.toFixed(1) + '%';
            parts.push('<span style="color:' + chgColor + '">Ult ' + chgText + '</span>');
            var ultRightX = Math.max(r.selUlt, r.priorUlt || 0);
            if (ultRightX > rightmostX) rightmostX = ultRightX;
        }

        if (parts.length > 0) {
            compAnnotations.push({
                x: rightmostX,
                y: r.cohort,
                text: parts.join('&nbsp;&nbsp;'),
                showarrow: false,
                font: { size: 9, color: '#e8ecf1', family: 'Inter, sans-serif' },
                xanchor: 'left',
                xshift: 10,
            });
        }
    });

    // ── Compute summary totals ────────────────────────────
    var totalA = 0, totalE = 0;
    rows.forEach(function (r) {
        if (r.actual != null)       totalA += r.actual;
        if (r.expectedAtDP != null) totalE += r.expectedAtDP;
    });
    var totalAE     = totalA - totalE;
    var totalAEPct  = (totalE !== 0) ? totalAE / totalE : null;
    var isAdverseTot = totalAEPct !== null && totalAEPct > 0.05;
    var summaryColor = isAdverseTot ? '#f87171' : '#34d399';

    var summaryText =
        'Total A−E: <b>' + (totalAE >= 0 ? '+' : '') + '$' +
        Math.round(totalAE).toLocaleString() + '</b>   |   ' +
        '(A−E)/E: <b>' +
        (totalAEPct !== null
            ? (totalAEPct >= 0 ? '+' : '') + (totalAEPct * 100).toFixed(1) + '%'
            : 'N/A') +
        '</b>';

    // ── Restore legend toggle state + cohort highlight ─────
    applyCohortHighlight(traces);
    applyLegendState(traces, hiddenGroups);

    // ── Layout ──────────────────────────────────────────────
    var layout = {
        title: {
            text: currentClass + ' — A vs E by Cohort',
            font: { size: 16, color: '#e8ecf1' },
            x: 0.5, xanchor: 'center',
        },
        xaxis: {
            title: { text: 'Cumulative Claims ($)', font: { size: 12, color: '#7b8ba3' } },
            gridcolor: '#2d2d2d', zeroline: false,
            tickformat: '$,.0f',
            tickfont: { color: '#7b8ba3', size: 11 },
            range: [0, xMax * 1.15], autorange: false,
        },
        yaxis: {
            type: 'category',
            categoryorder: 'array',
            categoryarray: cohorts.slice().reverse(),   // oldest at bottom, most recent at top (matches table)
            tickvals: cohorts.slice().reverse(),
            ticktext: cohorts.slice().reverse().map(formatCohort),
            tickfont: { color: '#e8ecf1', size: 11 },
            gridcolor: 'rgba(45,45,45,0.5)',
        },
        plot_bgcolor: '#181818', paper_bgcolor: '#181818',
        font: { color: '#e8ecf1', family: 'Inter, sans-serif' },
        legend: {
            x: 1.02, xanchor: 'left', y: 1,
            bgcolor: 'rgba(24,24,24,0.9)',
            bordercolor: '#2d2d2d', borderwidth: 1,
            font: { size: 10, color: '#7b8ba3' },
        },
        annotations: annotations.concat(compAnnotations),
        hovermode: 'closest',
        margin: { l: 80, r: 160, t: 40, b: 55 },
    };

    document.getElementById('chart-title').textContent = currentClass + ' — A vs E Comparison';
    document.getElementById('chart-desc').innerHTML =
        '<span style="color:' + summaryColor + ';font-weight:700">' +
        'Total A−E: ' + (totalAE >= 0 ? '+' : '') + '$' +
        Math.round(totalAE).toLocaleString() +
        '&nbsp;&nbsp;|&nbsp;&nbsp;(A−E)/E: ' +
        (totalAEPct !== null
            ? (totalAEPct >= 0 ? '+' : '') + (totalAEPct * 100).toFixed(1) + '%'
            : 'N/A') +
        '</span>';
    Plotly.newPlot('flight-path-chart', traces, layout, CHART_CONFIG);
    attachCohortClickHandler('flight-path-chart', cohorts);
}

/* ============================================================
   SHAP Feature Contribution bar — Reserve Determination
   ============================================================ */
function getShapData(className, method) {
    var scores = dashboardData.method_scores || [];
    for (var i = 0; i < scores.length; i++) {
        var s = scores[i];
        if (s.Class === className && s.Method === method && s.SHAP) {
            return { resDet: s.Reserve_Det, shap: s.SHAP };
        }
    }
    return null;
}

function renderShapBar() {
    var container = document.getElementById('shap-bar-container');
    var scoreEl = document.getElementById('shap-score');
    var titleEl = document.getElementById('shap-title');
    if (!container || !dashboardData || !currentClass || !currentMethod) return;

    var data = getShapData(currentClass, currentMethod);
    if (!data || !data.shap) {
        container.innerHTML = '<span style="color:var(--text-dim);font-size:0.8rem">No SHAP data</span>';
        if (scoreEl) scoreEl.textContent = '';
        return;
    }

    if (titleEl) titleEl.textContent = 'Reserve Det. — Feature Contributions';
    if (scoreEl) scoreEl.textContent = 'Score: ' + data.resDet.toFixed(3);

    var features = Object.keys(data.shap);
    var vals = features.map(function (f) { return data.shap[f]; });
    var maxAbs = Math.max.apply(null, vals.map(function (v) { return Math.abs(v); }));
    if (maxAbs === 0) maxAbs = 0.01;

    var html = '';
    features.forEach(function (feat, i) {
        var val = vals[i];
        var isPos = val >= 0;
        var pct = (Math.abs(val) / maxAbs) * 45;   // 45% of track width max
        var sign = isPos ? 'positive' : 'negative';
        var left, width;

        if (isPos) {
            left = '50%';
            width = pct + '%';
        } else {
            left = (50 - pct) + '%';
            width = pct + '%';
        }

        var valText = (isPos ? '+' : '') + val.toFixed(3);

        html +=
            '<div class="shap-row">' +
                '<span class="shap-label" title="' + feat + '">' + feat + '</span>' +
                '<div class="shap-track">' +
                    '<div class="shap-zero-line" style="left:50%"></div>' +
                    '<div class="shap-fill ' + sign + '" style="left:' + left + ';width:' + width + '"></div>' +
                '</div>' +
                '<span class="shap-value ' + sign + '">' + valText + '</span>' +
            '</div>';
    });

    container.innerHTML = html;
}

/* ============================================================
   Chart 2 — Incurred % of Ultimate (right)
   ============================================================ */
function renderPctChart() {
    if (!dashboardData || !currentClass || !currentMethod) return;

    var hiddenGroups = getHiddenLegendGroups('pct-ultimate-chart');
    var grouped = getGroupedData(currentClass);
    var cohorts = Object.keys(grouped).sort();

    // Build series + detect fanning
    var pctSeries      = buildPctSeries(grouped, cohorts, currentClass, currentMethod);
    var fanningCohorts = detectFanningCohorts(pctSeries);
    var showTrend      = trendHighlight;

    var result = buildDevTraces(pctSeries, cohorts, fanningCohorts, showTrend, {
        showLegend: true,
        hoverLabel: 'Incurred / Ult',
    });
    var traces = result.traces.reverse();   // most recent cohort first in legend

    var layout = {
        title: {
            text: currentClass + ' — Incurred % of Ult',
            font: { size: 13, color: '#e8ecf1' },
            x: 0.5, xanchor: 'center',
        },
        xaxis: {
            title: { text: 'Dev Period', font: { size: 10, color: '#7b8ba3' } },
            gridcolor: '#2d2d2d', zeroline: false,
            tickfont: { color: '#7b8ba3', size: 10 }, dtick: 2,
            range: [-0.3, MAX_DEV_PERIOD + 0.5], autorange: false,
        },
        yaxis: {
            title: { text: 'Incurred / Ult (%)', font: { size: 10, color: '#7b8ba3' } },
            gridcolor: '#2d2d2d', zeroline: false,
            ticksuffix: '%', tickfont: { color: '#7b8ba3', size: 10 },
            range: [0, 115], autorange: false,
        },
        shapes: [{ type: 'line', x0: -0.3, x1: MAX_DEV_PERIOD + 0.5, y0: 100, y1: 100, line: { color: '#f87171', width: 1.5, dash: 'dot' } }],
        showlegend: true,
        legend: { orientation: 'v', x: 1.02, xanchor: 'left', y: 1, font: { size: 9, color: '#7b8ba3' } },
        autosize: true,
        plot_bgcolor: '#181818', paper_bgcolor: '#181818',
        font: { color: '#e8ecf1', family: 'Inter, sans-serif' },
        hovermode: 'closest',
        margin: { l: 50, r: 110, t: 35, b: 40 },
    };

    document.getElementById('pct-chart-title').textContent =
        currentClass + ' — Incurred % of Ult (' + currentMethod + ')';
    Plotly.newPlot('pct-ultimate-chart', traces, layout, CHART_CONFIG);
}

/* ============================================================
   Chart 3 — Incurred / Year 1 (%) — Normalised development
   ============================================================ */

/**
 * Detect "fanning out" — a more recent cohort fans upward if,
 * at each common DP, it sits ABOVE the average of all older cohorts
 * that have data at that DP.  We require the deviation to exceed a
 * threshold (10pp) at the last common DP.
 *
 * cohortSeriesData is an array of { cohort, dpMap: {dp → value} }
 * sorted chronologically (oldest first).  Values can be normalised
 * percentages or raw — the logic only cares about relative position.
 */
function detectFanningCohorts(cohortSeriesData) {
    if (cohortSeriesData.length < 3) return [];

    var FAN_THRESHOLD = 10;   // percentage-point deviation from older avg
    var fanning = [];

    // For each cohort, compare its values at common DPs against the
    // average of all OLDER cohorts at those DPs.
    for (var i = 1; i < cohortSeriesData.length; i++) {
        var current = cohortSeriesData[i];
        var dps = Object.keys(current.dpMap).map(Number).sort(function (a, b) { return a - b; });
        if (dps.length < 2) continue;

        // Build average of all older cohorts at each DP
        var olderAvg = {};
        for (var j = 0; j < i; j++) {
            var older = cohortSeriesData[j];
            dps.forEach(function (dp) {
                if (older.dpMap[dp] != null) {
                    if (!olderAvg[dp]) olderAvg[dp] = { sum: 0, n: 0 };
                    olderAvg[dp].sum += older.dpMap[dp];
                    olderAvg[dp].n += 1;
                }
            });
        }

        // Check at the last DP whether current > older average + threshold
        var lastDP = dps[dps.length - 1];
        if (!olderAvg[lastDP] || olderAvg[lastDP].n === 0) continue;
        var avg = olderAvg[lastDP].sum / olderAvg[lastDP].n;
        var val = current.dpMap[lastDP];

        if (val - avg > FAN_THRESHOLD) {
            fanning.push(current.cohort);
        }
    }
    return fanning;
}

/**
 * Build normalised series data for the Incurred / Year 1 chart.
 * Returns [ { cohort, dpVals: [{dp, pct}], dpMap: {dp→pct} } ]
 * sorted chronologically.
 */
function buildNormSeries(grouped, cohorts) {
    var BASE_DP = 4;   // 4 quarters = 1 year
    var series = [];
    cohorts.forEach(function (cohort) {
        var data = grouped[cohort];
        if (data.Actual.length === 0) return;

        var baseVal = null;
        for (var i = 0; i < data.Actual.length; i++) {
            if (data.Actual[i].dp === BASE_DP) {
                baseVal = data.Actual[i].val;
                break;
            }
        }
        if (!baseVal || baseVal === 0) return;

        var dpVals = [];
        var dpMap  = {};
        data.Actual.forEach(function (d) {
            var pct = (d.val / baseVal) * 100;
            dpVals.push({ dp: d.dp, pct: pct });
            dpMap[d.dp] = pct;
        });
        series.push({ cohort: cohort, dpVals: dpVals, dpMap: dpMap });
    });
    return series;
}

/**
 * Build series data for Incurred % of Ultimate chart.
 * Returns [ { cohort, dpVals: [{dp, pct}], dpMap: {dp→pct} } ]
 */
function buildPctSeries(grouped, cohorts, className, method) {
    var series = [];
    cohorts.forEach(function (cohort) {
        var data = grouped[cohort];
        var ult  = getUltimate(className, cohort, method);
        if (!ult || ult === 0 || data.Actual.length === 0) return;

        var dpVals = [];
        var dpMap  = {};
        data.Actual.forEach(function (d) {
            var pct = (d.val / ult) * 100;
            dpVals.push({ dp: d.dp, pct: pct });
            dpMap[d.dp] = pct;
        });
        series.push({ cohort: cohort, dpVals: dpVals, dpMap: dpMap });
    });
    return series;
}

/**
 * Helper: build Plotly traces for a development chart with optional
 * fanning-trend highlighting.
 *
 * seriesData: [ { cohort, dpVals: [{dp,pct}] } ]  (sorted chronologically)
 * fanningCohorts: [ cohortName, … ]
 * opts: { showLegend, yLabel, hoverLabel }
 */
function buildDevTraces(seriesData, cohortsSorted, fanningCohorts, showTrend, opts) {
    var traces = [];
    var yMax   = 0;

    seriesData.forEach(function (c) {
        var cohortIdx = cohortsSorted.indexOf(c.cohort);
        var baseColor = COHORT_COLORS[cohortIdx % COHORT_COLORS.length];
        var isFanning = fanningCohorts.indexOf(c.cohort) >= 0;

        var lineColor = baseColor;
        var lineWidth = 2;
        if (showTrend && isFanning) {
            lineColor = '#f87171';
            lineWidth = 3;
        }

        var lastPct = c.dpVals[c.dpVals.length - 1].pct;
        if (lastPct > yMax) yMax = lastPct;

        traces.push({
            x: c.dpVals.map(function (d) { return d.dp; }),
            y: c.dpVals.map(function (d) { return d.pct; }),
            type: 'scatter', mode: 'lines+markers',
            name: formatCohort(c.cohort),
            legendgroup: c.cohort,
            showlegend: opts.showLegend !== false,
            line:   { color: lineColor, width: lineWidth },
            marker: { size: 4, color: lineColor },
            hovertemplate:
                '<b>' + formatCohort(c.cohort) + '</b><br>' +
                'Dev Period: %{x}<br>' + (opts.hoverLabel || 'Value') + ': %{y:.1f}%' +
                (showTrend && isFanning ? '<br><b style="color:#f87171">⚠ Fanning</b>' : '') +
                '<extra></extra>',
        });
    });

    return { traces: traces, yMax: yMax };
}

function renderNormChart() {
    if (!dashboardData || !currentClass) return;

    var hiddenGroups = getHiddenLegendGroups('norm-chart');
    var grouped = getGroupedData(currentClass);
    var cohorts = Object.keys(grouped).sort();

    var normSeries     = buildNormSeries(grouped, cohorts);
    var fanningCohorts = detectFanningCohorts(normSeries);
    var showTrend      = trendHighlight;

    var result = buildDevTraces(normSeries, cohorts, fanningCohorts, showTrend, {
        showLegend: true,
        hoverLabel: 'Incurred / Yr 1',
    });
    var traces = result.traces.reverse();   // most recent cohort first in legend
    var yMax   = result.yMax;

    var layout = {
        title: {
            text: currentClass + ' — Incurred / Year 1 (%)',
            font: { size: 13, color: '#e8ecf1' },
            x: 0.5, xanchor: 'center',
        },
        xaxis: {
            title: { text: 'Dev Period', font: { size: 10, color: '#7b8ba3' } },
            gridcolor: '#2d2d2d', zeroline: false,
            tickfont: { color: '#7b8ba3', size: 10 }, dtick: 2,
            range: [-0.3, MAX_DEV_PERIOD + 0.5], autorange: false,
        },
        yaxis: {
            title: { text: 'Incurred / Yr 1 (%)', font: { size: 10, color: '#7b8ba3' } },
            gridcolor: '#2d2d2d', zeroline: false,
            ticksuffix: '%', tickfont: { color: '#7b8ba3', size: 10 },
            range: [0, Math.max(yMax * 1.1, 120)], autorange: false,
        },
        shapes: [
            { type: 'line', x0: -0.3, x1: MAX_DEV_PERIOD + 0.5, y0: 100, y1: 100,
              line: { color: 'rgba(255,255,255,0.2)', width: 1, dash: 'dot' } },
        ],
        showlegend: true,
        legend: { orientation: 'v', x: 1.02, xanchor: 'left', y: 1, font: { size: 9, color: '#7b8ba3' } },
        autosize: true,
        plot_bgcolor: '#181818', paper_bgcolor: '#181818',
        font: { color: '#e8ecf1', family: 'Inter, sans-serif' },
        hovermode: 'closest',
        margin: { l: 50, r: 110, t: 35, b: 40 },
    };

    document.getElementById('norm-chart-title').textContent =
        currentClass + ' — Incurred / Year 1 (%)';
    Plotly.newPlot('norm-chart', traces, layout, CHART_CONFIG);
}

/* ============================================================
   Claims Movements Table
   ============================================================ */
var claimsSortCol = 'Incurred_Current';
var claimsSortAsc = false;

function initDecisionTableRowClicks() {
    var tbody = document.getElementById('decision-tbody');
    if (!tbody) return;
    tbody.addEventListener('click', function (e) {
        var tr = e.target.closest('tr[data-cohort]');
        if (!tr) return;
        var cohort = tr.getAttribute('data-cohort');
        if (!cohort) return;
        selectCohort(cohort);
        showClaimsPanel();
        renderClaimsTable();
        renderLHSChart();
        renderDecisionTable();   // re-render so selected row is highlighted
    });
}

function initClaimsClearBtn() {
    var btn = document.getElementById('claims-clear-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
        selectedCohort = null;
        renderClaimsTable();
        renderLHSChart();
        renderDecisionTable();
    });
}

function initClaimsSort() {
    var headers = document.querySelectorAll('#claims-table th.claims-sortable');
    headers.forEach(function (th) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', function () {
            var col = th.getAttribute('data-sort');
            if (claimsSortCol === col) {
                claimsSortAsc = !claimsSortAsc;
            } else {
                claimsSortCol = col;
                claimsSortAsc = col === 'Cohort';
            }
            renderClaimsTable();
            updateClaimsSortArrows();
        });
    });
    updateClaimsSortArrows();
}

function updateClaimsSortArrows() {
    var headers = document.querySelectorAll('#claims-table th.claims-sortable');
    headers.forEach(function (th) {
        var arrow = th.querySelector('.sort-arrow');
        if (!arrow) return;
        var col = th.getAttribute('data-sort');
        if (col === claimsSortCol) {
            arrow.textContent = claimsSortAsc ? ' ▲' : ' ▼';
        } else {
            arrow.textContent = '';
        }
    });
}

function renderClaimsTable() {
    var tbody = document.getElementById('claims-tbody');
    if (!tbody || !dashboardData || !currentClass) return;

    var claims = dashboardData.claims || [];
    var threshold = getLargeThreshold(currentClass);
    var clearBtn = document.getElementById('claims-clear-btn');
    var attrDiv  = document.getElementById('claims-attribution');
    var descEl   = document.getElementById('claims-desc');

    // Filter to class, optionally to selected cohort
    var displayClaims = claims.filter(function (c) {
        if (c.Class !== currentClass) return false;
        if (selectedCohort && c.Cohort !== selectedCohort) return false;
        return true;
    });

    displayClaims.forEach(function (c) {
        c._movement = c.Incurred_Current - c.Incurred_Prior;
        c._absMovement = Math.abs(c._movement);
        c._pctMovement = (c.Incurred_Prior !== 0)
            ? (c._movement / c.Incurred_Prior) * 100
            : (c.Incurred_Current > 0 ? 100 : 0);
        c._isLarge = c.Incurred_Current >= threshold;
    });

    var sortDir = claimsSortAsc ? 1 : -1;
    displayClaims.sort(function (a, b) {
        var va, vb;
        if (claimsSortCol === 'Movement') {
            va = a._absMovement;
            vb = b._absMovement;
        } else if (claimsSortCol === 'Cohort') {
            va = a.Cohort;
            vb = b.Cohort;
            if (va < vb) return -1 * sortDir;
            if (va > vb) return 1 * sortDir;
            return 0;
        } else {
            va = a[claimsSortCol];
            vb = b[claimsSortCol];
        }
        return (va - vb) * sortDir;
    });

    // Show/hide clear button
    if (clearBtn) {
        clearBtn.style.display = selectedCohort ? 'inline-block' : 'none';
    }

    // Attribution summary
    if (attrDiv) {
        if (selectedCohort) {
            var attr = getAEAttribution(currentClass, selectedCohort);
            var largePctClamped = Math.min(Math.max(attr.largePct, 0), 100);
            var attPct = 100 - largePctClamped;

            var sign = attr.total >= 0 ? '+' : '-';
            var totalFmt = sign + '$' + Math.round(Math.abs(attr.total)).toLocaleString();
            var largeSign = attr.large >= 0 ? '+' : '-';
            var largeFmt = largeSign + '$' + Math.round(Math.abs(attr.large)).toLocaleString();

            attrDiv.innerHTML =
                '<div class="claims-attr-bar">' +
                    '<div class="claims-attr-large" style="width:' + largePctClamped + '%"></div>' +
                    '<div class="claims-attr-attritional" style="width:' + attPct + '%"></div>' +
                '</div>' +
                '<div class="claims-attr-labels">' +
                    '<span><strong style="color:var(--red)">Large (&ge;$' + threshold.toLocaleString() + '):</strong> ' +
                        largeFmt + ' · ' + attr.largeLossCount + ' claims · ' + Math.round(largePctClamped) + '% of movement</span>' +
                    '<span><strong style="color:var(--accent)">Attritional:</strong> ' + attr.attritionalCount + ' claims</span>' +
                '</div>';
        } else {
            attrDiv.innerHTML = '';
        }
    }

    // Title + description
    if (selectedCohort) {
        document.getElementById('claims-title').textContent =
            currentClass + ' — ' + formatCohort(selectedCohort) + ' Claims';
        if (descEl) descEl.textContent = 'Showing ' + displayClaims.length + ' claims for selected cohort';
    } else {
        document.getElementById('claims-title').textContent =
            currentClass + ' — Claim Movements';
        if (descEl) descEl.textContent = 'Click a cohort on the chart to drill down';
    }

    // Render rows
    tbody.innerHTML = '';

    displayClaims.forEach(function (c) {
        var tr = document.createElement('tr');
        if (c._isLarge) tr.classList.add('claim-large-mover');

        var movClass = c._movement > 0 ? 'claim-movement-up' : 'claim-movement-down';
        if (c._movement === 0) movClass = '';

        var movSign = c._movement >= 0 ? '+' : '';
        var movText = movSign + '$' + Math.round(c._absMovement).toLocaleString();
        if (c._movement < 0) movText = '-$' + Math.round(c._absMovement).toLocaleString();
        var pctText = '<br><span style="font-size:0.68rem;opacity:0.7">' + movSign + c._pctMovement.toFixed(0) + '%</span>';

        var statusClass = 'claim-status-' + c.Status.toLowerCase();

        tr.innerHTML =
            '<td>' + formatCohort(c.Cohort) + '</td>' +
            '<td style="font-size:0.72rem">' + c.Claim_ID + '</td>' +
            '<td><span class="claim-status-pill ' + statusClass + '">' + c.Status + '</span></td>' +
            '<td>$' + Math.round(c.Incurred_Current).toLocaleString() + '</td>' +
            '<td>$' + Math.round(c.Incurred_Prior).toLocaleString() + '</td>' +
            '<td class="' + movClass + '">' + movText + pctText + '</td>';

        tbody.appendChild(tr);
    });
}

/* ============================================================
   Reserving Decisions table — by cohort, DAG suggestions
   ============================================================ */
function bucketResDet(val) {
    if (val == null) return '—';
    if (val >= 0.7) return 'HIGH';
    if (val >= 0.4) return 'MED';
    return 'LOW';
}

function bucketPQ(val) {
    if (val == null) return '—';
    if (val >= 0.7) return 'High';
    if (val >= 0.4) return 'Med';
    return 'Low';
}

function renderDecisionTable() {
    var tbody = document.getElementById('decision-tbody');
    var titleEl = document.getElementById('decision-table-title');
    if (!tbody || !titleEl || !dashboardData || !currentClass || !currentMethod) return;

    var grouped = getGroupedData(currentClass);
    var cohortsChronological = Object.keys(grouped).sort();
    var cohorts = getCohortsMostRecentFirst(grouped);
    var pctSeries  = buildPctSeries(grouped, cohortsChronological, currentClass, currentMethod);
    var normSeries = buildNormSeries(grouped, cohortsChronological);
    var pctFanning  = detectFanningCohorts(pctSeries);
    var normFanning = detectFanningCohorts(normSeries);
    var bothFanning = pctFanning.filter(function (c) { return normFanning.indexOf(c) >= 0; });

    var methodScores = getMethodScoresRow(currentClass, currentMethod);
    var resDetLabel = bucketResDet(methodScores ? methodScores.Reserve_Det : null);
    var pqLabel = bucketPQ(methodScores ? methodScores.Proj_Quality : null);
    var methodType = getMethodType(currentMethod) || '—';

    var rows = [];
    cohorts.forEach(function (cohort) {
        var data = grouped[cohort];
        if (data.Actual.length === 0) return;

        var lastDP = data.Actual[data.Actual.length - 1].dp;
        var lastActual = data.Actual[data.Actual.length - 1].val;
        var e2u = data.Expected.length > 0 ? data.Expected[0].val : null;
        if (!e2u) return;

        var expectedAtDP = e2u * developmentFraction(lastDP);
        if (!expectedAtDP || expectedAtDP === 0) return;
        var aeRatio = (lastActual - expectedAtDP) / expectedAtDP;

        var currentUlt = getUltimate(currentClass, cohort, currentMethod);
        var priorUlt = getPriorUltimate(currentClass, cohort, currentMethod);
        var ultChgPct = (priorUlt && priorUlt !== 0 && currentUlt != null)
            ? (currentUlt - priorUlt) / priorUlt
            : null;

        var inFO = bothFanning.indexOf(cohort) >= 0;
        var attribution = getAEAttribution(currentClass, cohort);
        var premiumChg = getPremiumChange(currentClass, cohort);
        var claimCountChg = getClaimCountChange(currentClass, cohort);
        var maxClaimsUlt = getMaxClaimsBasedUltimate(currentClass, cohort);

        var opts = {
            aeOverThreshold: Math.abs(aeRatio) > DAG_AE_THRESHOLD,
            fanningOutBoth: inFO,
            claimCountUp15: claimCountChg ? claimCountChg.changePct >= DAG_CLAIM_COUNT_THRESHOLD : false,
            largeLossPct: attribution ? attribution.largePct : 0,
            premiumChangePct: premiumChg ? premiumChg.changePct : 0,
            methodType: methodType,
            currentUltimate: currentUlt,
            maxClaimsBasedUltimate: maxClaimsUlt,
        };
        var dag = runDecisionDAG(currentClass, cohort, opts);

        var aeClass = aeRatio > DAG_AE_THRESHOLD ? 'dec-ae-adverse' : (aeRatio < -DAG_AE_THRESHOLD ? 'dec-ae-favourable' : '');
        var aeText = (aeRatio * 100).toFixed(1) + '%';
        var aeCell = '<span class="' + aeClass + '">' + aeText + '</span>';

        var ultChgText = '—';
        var ultChgClass = '';
        if (ultChgPct != null) {
            ultChgClass = ultChgPct > 0 ? 'dec-ae-adverse' : (ultChgPct < 0 ? 'dec-ae-favourable' : '');
            ultChgText = '<span class="' + ultChgClass + '">' + (ultChgPct * 100).toFixed(1) + '%</span>';
        }

        var foCell = inFO ? '<span class="dec-fo-y">Y</span>' : 'N';
        var driverCell = dag.driver ? '<span class="dec-driver">' + escapeHtml(dag.driver) + '</span>' : '';
        var suggestionCell = dag.suggestion ? '<span class="dec-suggestion">' + escapeHtml(dag.suggestion) + '</span>' : '';

        var dimmedClass = Math.abs(aeRatio) <= DAG_AE_THRESHOLD ? 'dimmed' : '';
        var selectedClass = selectedCohort === cohort ? ' selected-cohort' : '';
        var rowClass = (dimmedClass ? 'dimmed ' : '') + 'decision-row-clickable' + selectedClass;
        rows.push(
            '<tr class="' + rowClass + '" data-cohort="' + escapeHtml(cohort) + '">' +
            '<td>' + escapeHtml(formatCohort(cohort)) + '</td>' +
            '<td>' + aeCell + '</td>' +
            '<td>' + ultChgText + '</td>' +
            '<td>' + resDetLabel + '</td>' +
            '<td>' + pqLabel + '</td>' +
            '<td>' + foCell + '</td>' +
            '<td>' + escapeHtml(methodType) + '</td>' +
            '<td>' + driverCell + '</td>' +
            '<td>' + suggestionCell + '</td>' +
            '</tr>'
        );
    });

    titleEl.textContent = 'Reserving Decisions — ' + currentClass;
    tbody.innerHTML = rows.join('');
}

function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

/* ============================================================
   Score Distribution Charts (RHS of table)
   ============================================================ */

/**
 * Render a single score distribution histogram into `containerId`.
 *
 * @param {string}   containerId  - DOM id of the chart container
 * @param {number[]} allValues    - all method scores for this metric
 * @param {string[]} allMethods   - corresponding method names
 * @param {number|null} selectedVal - score of the currently selected method
 * @param {string}   selectedName - name of the currently selected method
 * @param {string}   label        - axis / title label
 * @param {boolean}  reversed     - if true, high = bad (red), low = good (green)
 */
function renderScoreDist(containerId, allValues, allMethods, selectedVal, selectedName, label, reversed) {
    var BIN_SIZE = 0.05;
    var NUM_BINS = Math.ceil(1 / BIN_SIZE);
    var counts = new Array(NUM_BINS).fill(0);
    var binCentres = [];

    for (var b = 0; b < NUM_BINS; b++) {
        binCentres.push(b * BIN_SIZE + BIN_SIZE / 2);
    }

    allValues.forEach(function (v) {
        var idx = Math.min(Math.floor(v / BIN_SIZE), NUM_BINS - 1);
        counts[idx]++;
    });

    function binColor(centre) {
        if (reversed) {
            if (centre >= 0.8) return 'rgba(248,113,113,0.65)';
            if (centre >= 0.6) return 'rgba(251,191,36,0.60)';
            return 'rgba(52,211,153,0.65)';
        }
        if (centre >= 0.8) return 'rgba(52,211,153,0.65)';
        if (centre >= 0.6) return 'rgba(251,191,36,0.60)';
        return 'rgba(248,113,113,0.65)';
    }

    var barColors = binCentres.map(binColor);

    var traces = [{
        x: binCentres,
        y: counts,
        type: 'bar',
        width: BIN_SIZE * 0.92,
        marker: {
            color: barColors,
            line: { color: 'rgba(255,255,255,0.25)', width: 1 },
        },
        hovertemplate: label + ': %{x:.0%}<br>Count: %{y}<extra></extra>',
        name: 'All Methods',
        showlegend: false,
    }];

    var shapes = [];
    var annotations = [];

    if (selectedVal != null) {
        shapes.push({
            type: 'line',
            x0: selectedVal, x1: selectedVal,
            y0: 0, y1: 1, yref: 'paper',
            line: { color: '#00cfff', width: 3, dash: 'solid' },
        });

        var shortName = selectedName || '';
        if (shortName.length > 25) shortName = shortName.substring(0, 22) + '…';

        annotations.push({
            x: selectedVal, y: 1, yref: 'paper',
            text: '<b>' + (selectedVal * 100).toFixed(0) + '%</b>',
            showarrow: true,
            arrowhead: 0, arrowwidth: 2, arrowcolor: '#00cfff',
            ax: selectedVal > 0.5 ? -40 : 40, ay: -30,
            font: { size: 13, color: '#00cfff', family: 'Inter, sans-serif' },
            bgcolor: 'rgba(0,12,24,0.85)',
            bordercolor: '#00cfff', borderwidth: 1, borderpad: 4,
        });

        annotations.push({
            x: selectedVal, y: 0, yref: 'paper',
            text: shortName,
            showarrow: false,
            font: { size: 10, color: '#a0c4ff', family: 'Inter, sans-serif' },
            yanchor: 'top', yshift: -6,
            xanchor: selectedVal > 0.5 ? 'right' : 'left',
            xshift: selectedVal > 0.5 ? -8 : 8,
        });
    }

    var layout = {
        xaxis: {
            title: { text: label, font: { size: 11, color: '#7b8ba3' } },
            range: [0, 1.05],
            tickformat: '.0%',
            tickfont: { color: '#7b8ba3', size: 10 },
            gridcolor: '#2d2d2d', zeroline: false,
            dtick: 0.1,
        },
        yaxis: {
            title: { text: 'Methods', font: { size: 11, color: '#7b8ba3' } },
            tickfont: { color: '#7b8ba3', size: 10 },
            gridcolor: '#2d2d2d', zeroline: false,
        },
        shapes: shapes,
        annotations: annotations,
        plot_bgcolor: '#181818', paper_bgcolor: '#181818',
        font: { color: '#e8ecf1', family: 'Inter, sans-serif' },
        margin: { l: 45, r: 30, t: 45, b: 55 },
        bargap: 0.06,
    };

    Plotly.newPlot(containerId, traces, layout, {
        displayModeBar: false, responsive: true,
    });
}

function renderScoreDistributions() {
    if (!dashboardData || !currentClass) return;

    var scores = dashboardData.method_scores || [];
    var classScores = scores.filter(function (s) { return s.Class === currentClass; });

    var resDets   = classScores.map(function (s) { return s.Reserve_Det; });
    var projQuals = classScores.map(function (s) { return s.Proj_Quality; });
    var methods   = classScores.map(function (s) { return s.Method; });

    // Find selected method's scores
    var selRes = null, selProj = null;
    for (var i = 0; i < classScores.length; i++) {
        if (classScores[i].Method === currentMethod) {
            selRes  = classScores[i].Reserve_Det;
            selProj = classScores[i].Proj_Quality;
            break;
        }
    }

    renderScoreDist('res-det-dist',   resDets,   methods, selRes,  currentMethod, 'Reserve Det',  true);
    renderScoreDist('proj-qual-dist', projQuals, methods, selProj, currentMethod, 'Proj Quality', false);
}

/* ============================================================
   Selected method summary strip (below controls)
   ============================================================ */
function renderSelectedMethodStrip() {
    var tbody = document.getElementById('strip-tbody');
    if (!tbody || !dashboardData || !currentClass || !currentMethod) return;

    var scores = dashboardData.method_scores || [];
    var row = null;
    for (var i = 0; i < scores.length; i++) {
        if (scores[i].Class === currentClass && scores[i].Method === currentMethod) {
            row = scores[i];
            break;
        }
    }

    if (!row) {
        tbody.innerHTML = '';
        return;
    }

    var resClass  = scoreClassReversed(row.Reserve_Det);
    var priorResClass = scoreClassReversed(row.Prior_Reserve_Det);
    var projClass = scoreClass(row.Proj_Quality);
    var totalUlt  = getTotalUltimate(currentClass, currentMethod);
    var aeUlt = getMethodAEAndUltChange(currentClass, currentMethod);

    var aeText = aeUlt.aeRatio != null ? (aeUlt.aeRatio * 100).toFixed(1) + '%' : '—';
    var aeClass = aeUlt.aeRatio != null && aeUlt.aeRatio > 0.05 ? 'dec-ae-adverse' : (aeUlt.aeRatio != null && aeUlt.aeRatio < -0.05 ? 'dec-ae-favourable' : '');
    var ultChgText = aeUlt.ultChg != null ? (aeUlt.ultChg * 100).toFixed(1) + '%' : '—';
    var ultChgClass = aeUlt.ultChg != null && aeUlt.ultChg > 0 ? 'dec-ae-adverse' : (aeUlt.ultChg != null && aeUlt.ultChg < 0 ? 'dec-ae-favourable' : '');

    tbody.innerHTML =
        '<tr>' +
            '<td class="method-name">' + row.Method + '</td>' +
            '<td>' + pillHtml(row.Pattern) + '</td>' +
            '<td>' + pillHtml(row.IE) + '</td>' +
            '<td>' + pillHtml(row.Approach) + '</td>' +
            '<td class="ultimate-value">' + formatNumber(totalUlt) + '</td>' +
            '<td><span class="' + aeClass + '">' + aeText + '</span></td>' +
            '<td><span class="' + ultChgClass + '">' + ultChgText + '</span></td>' +
            '<td>' +
                '<div class="score-cell ' + resClass + '">' +
                    '<div class="score-bar"><div class="score-bar-fill" style="width:' + (row.Reserve_Det * 100) + '%"></div></div>' +
                    '<span class="score-value">' + (row.Reserve_Det * 100).toFixed(1) + '%</span>' +
                '</div>' +
            '</td>' +
            '<td>' +
                '<div class="score-cell ' + priorResClass + '">' +
                    '<div class="score-bar"><div class="score-bar-fill" style="width:' + (row.Prior_Reserve_Det * 100) + '%"></div></div>' +
                    '<span class="score-value">' + (row.Prior_Reserve_Det * 100).toFixed(1) + '%</span>' +
                '</div>' +
            '</td>' +
            '<td>' +
                '<div class="score-cell ' + projClass + '">' +
                    '<div class="score-bar"><div class="score-bar-fill" style="width:' + (row.Proj_Quality * 100) + '%"></div></div>' +
                    '<span class="score-value">' + (row.Proj_Quality * 100).toFixed(1) + '%</span>' +
                '</div>' +
            '</td>' +
        '</tr>';
}

/* ============================================================
   Scores Table
   ============================================================ */

/** Initialise sortable column headers (call once on page load). */
function initTableSort() {
    var headers = document.querySelectorAll('#scores-table th.sortable');
    headers.forEach(function (th) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', function () {
            var col = th.getAttribute('data-sort');
            if (tableSortCol === col) {
                tableSortAsc = !tableSortAsc;          // toggle direction
            } else {
                tableSortCol = col;
                tableSortAsc = false;                  // default descending
            }
            renderScoresTable();
            updateSortArrows();
        });
    });
    updateSortArrows();
}

/** Show ▲ / ▼ on the currently sorted column header. */
function updateSortArrows() {
    var headers = document.querySelectorAll('#scores-table th.sortable');
    headers.forEach(function (th) {
        var arrow = th.querySelector('.sort-arrow');
        if (!arrow) return;
        var col = th.getAttribute('data-sort');
        if (col === tableSortCol) {
            arrow.textContent = tableSortAsc ? ' ▲' : ' ▼';
        } else {
            arrow.textContent = '';
        }
    });
}

function renderScoresTable() {
    if (!dashboardData || !currentClass) return;

    var scores         = dashboardData.method_scores || [];
    var tbody          = document.getElementById('scores-tbody');
    var passingMethods = getPassingMethods(currentClass);
    tbody.innerHTML    = '';

    // Filter to current class, sort dynamically
    var sortCol = tableSortCol;
    var sortDir = tableSortAsc ? 1 : -1;

    var classScores = scores
        .filter(function (s) { return s.Class === currentClass; })
        .sort(function (a, b) {
            var va, vb;
            if (sortCol === 'Ultimate') {
                va = getTotalUltimate(currentClass, a.Method);
                vb = getTotalUltimate(currentClass, b.Method);
            } else {
                va = a[sortCol];
                vb = b[sortCol];
            }
            return (va - vb) * sortDir;
        });

    classScores.forEach(function (s) {
        var tr = document.createElement('tr');
        tr.setAttribute('data-method', s.Method);

        // Active row
        if (s.Method === currentMethod) {
            tr.classList.add('active-row');
        }

        // Filtered out (below threshold)
        if (passingMethods.indexOf(s.Method) < 0) {
            tr.classList.add('filtered-out');
        }

        // Click to select
        tr.addEventListener('click', function () {
            selectMethod(s.Method);
        });

        var resClass  = scoreClassReversed(s.Reserve_Det);
        var priorResClass = scoreClassReversed(s.Prior_Reserve_Det);
        var projClass = scoreClass(s.Proj_Quality);
        var totalUlt  = getTotalUltimate(currentClass, s.Method);
        var aeUlt = getMethodAEAndUltChange(currentClass, s.Method);

        var aeText = aeUlt.aeRatio != null ? (aeUlt.aeRatio * 100).toFixed(1) + '%' : '—';
        var aeColorClass = aeUlt.aeRatio != null && aeUlt.aeRatio > 0.05 ? 'dec-ae-adverse' : (aeUlt.aeRatio != null && aeUlt.aeRatio < -0.05 ? 'dec-ae-favourable' : '');
        var ultText = aeUlt.ultChg != null ? (aeUlt.ultChg * 100).toFixed(1) + '%' : '—';
        var ultColorClass = aeUlt.ultChg != null && aeUlt.ultChg > 0 ? 'dec-ae-adverse' : (aeUlt.ultChg != null && aeUlt.ultChg < 0 ? 'dec-ae-favourable' : '');

        tr.innerHTML =
            '<td class="method-name">' + s.Method + '</td>' +
            '<td>' + pillHtml(s.Pattern) + '</td>' +
            '<td>' + pillHtml(s.IE) + '</td>' +
            '<td>' + pillHtml(s.Approach) + '</td>' +
            '<td class="ultimate-value">' + formatNumber(totalUlt) + '</td>' +
            '<td><span class="' + aeColorClass + '">' + aeText + '</span></td>' +
            '<td><span class="' + ultColorClass + '">' + ultText + '</span></td>' +
            '<td>' +
                '<div class="score-cell ' + resClass + '">' +
                    '<div class="score-bar"><div class="score-bar-fill" style="width:' + (s.Reserve_Det * 100) + '%"></div></div>' +
                    '<span class="score-value">' + (s.Reserve_Det * 100).toFixed(1) + '%</span>' +
                '</div>' +
            '</td>' +
            '<td>' +
                '<div class="score-cell ' + priorResClass + '">' +
                    '<div class="score-bar"><div class="score-bar-fill" style="width:' + (s.Prior_Reserve_Det * 100) + '%"></div></div>' +
                    '<span class="score-value">' + (s.Prior_Reserve_Det * 100).toFixed(1) + '%</span>' +
                '</div>' +
            '</td>' +
            '<td>' +
                '<div class="score-cell ' + projClass + '">' +
                    '<div class="score-bar"><div class="score-bar-fill" style="width:' + (s.Proj_Quality * 100) + '%"></div></div>' +
                    '<span class="score-value">' + (s.Proj_Quality * 100).toFixed(1) + '%</span>' +
                '</div>' +
            '</td>';

        tbody.appendChild(tr);
    });

    document.getElementById('table-title').textContent =
        currentClass + ' — Method Comparison';
}

/**
 * Highlight the active row matching currentMethod.
 */
function highlightActiveRow() {
    var tbody = document.getElementById('scores-tbody');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('tr');
    rows.forEach(function (tr) {
        if (tr.getAttribute('data-method') === currentMethod) {
            tr.classList.add('active-row');
            tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            tr.classList.remove('active-row');
        }
    });
}
