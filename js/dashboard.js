/**
 * Insurance Analytics Dashboard
 * 
 * Main dashboard logic and predictive models
 */

/* ============================================================
   Global state
   ============================================================ */
let data = null;

/* ============================================================
   Boot
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('data/analytics.json?v=' + Date.now());
        if (!res.ok) throw new Error(res.statusText);
        data = await res.json();
        console.log('Data loaded:', data);

        renderHeader();
        // Add your dashboard rendering logic here
        
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
   Add your dashboard functions here
   ============================================================ */
