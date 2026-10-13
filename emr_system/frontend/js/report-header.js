/* ============================================================
   REPORT HEADER (shared)
   Iisang header para sa lahat ng report sa browser (preview + print):
   [Seal ng Valenzuela + Bagong Pilipinas] | District 1 Health Office / Pamagat /
   Barangay / Period / Generated on | [Valenzuelife]
   Kapareho ng header ng mga PDF mula sa backend (routers/reports.py).
   Mga logo: frontend/img/  (relative sa pages/dashboard.html → ../img/)
   ============================================================ */
(function () {
    'use strict';
    const IMG = '../img/';
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function barangay() {
        const t = (document.getElementById('barangayLabel')?.textContent || '').trim();
        if (t && t !== 'Loading...') return t;
        return sessionStorage.getItem('barangay_name') || '';
    }
    // "October 10, 2026 at 04:48 PM"  (kapareho ng PDF)
    function generatedOn() {
        const d = new Date();
        return d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }) + ' at ' +
               d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    /** @param {{title:string,start?:string,end?:string}} o  start/end = yyyy-mm-dd */
    function html(o) {
        const period = o.start && o.end ? `<div class="rh-meta">Period: ${esc(o.start)} to ${esc(o.end)}</div>` : '';
        return `<div class="rh">
            <div class="rh-side rh-left">
                <img src="${IMG}logo-valenzuela-seal.png" alt="Seal of the City Government of Valenzuela">
                <img src="${IMG}logo-bagong-pilipinas.png" alt="Bagong Pilipinas">
            </div>
            <div class="rh-center">
                <div class="rh-office">District 1 Health Office</div>
                <div class="rh-title">${esc(o.title)}</div>
                <div class="rh-brgy">${esc(barangay())}</div>
                ${period}
                <div class="rh-meta">Generated on: ${esc(generatedOn())}</div>
            </div>
            <div class="rh-side rh-right"><img src="${IMG}logo-valenzuelife.png" alt="Valenzuelife"></div>
        </div><div class="rh-rule"></div>`;
    }

    /** Hintayin munang ma-load ang lahat ng larawan (logo, chart) bago mag-print. */
    function ready(root, timeoutMs = 4000) {
        const imgs = [...root.querySelectorAll('img')].filter(i => !i.complete);
        if (!imgs.length) return Promise.resolve();
        return new Promise(resolve => {
            let left = imgs.length;
            const done = () => { if (--left <= 0) resolve(); };
            imgs.forEach(i => { i.addEventListener('load', done, { once: true }); i.addEventListener('error', done, { once: true }); });
            setTimeout(resolve, timeoutMs);
        });
    }

    /** I-print ang isang HTML report gamit ang #aiPrintReport (parehong print rules ng AI Insights). */
    function print(reportHtml) {
        let el = document.getElementById('aiPrintReport');
        if (!el) { el = document.createElement('div'); el.id = 'aiPrintReport'; document.body.appendChild(el); }
        el.innerHTML = reportHtml;
        return ready(el).then(() => new Promise(resolve => {
            setTimeout(() => {
                document.body.classList.add('ai-printing');
                const done = () => { document.body.classList.remove('ai-printing'); window.removeEventListener('afterprint', done); resolve(); };
                window.addEventListener('afterprint', done);
                window.print();
            }, 100);
        }));
    }

    window.ReportHeader = { html, ready, print, generatedOn };
})();
