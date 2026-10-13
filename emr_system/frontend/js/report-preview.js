/* ============================================================
   REPORT PREVIEW — "Generate Report {pangalan}" (Reports & Export tab)
   1) Piliin ang report  →  2) Preview sa modal  →  3) Print o i-save bilang PDF
   - Server reports (PDF mula sa routers/reports.py): ipinapakita sa iframe (blob),
     may Print, Download PDF, at Open in new tab.
   - AI Insights report: binubuo sa browser mula sa totoong findings
     (Disease + Resource Allocation) at ipinapakita bilang pahina; Print / Save as PDF.
   Depends on: api.js (apiFetch, showToast), report-header.js, dashboard globals
   (withReportDates, toYMD), at ai-insights.js (window.AIInsightsReport).
   ============================================================ */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // label = ginagamit sa button: "Generate Report {label}"
    const REPORTS = {
        'patients':         { label: 'Patient Records',      title: 'Patient Records Report',      route: '/api/reports/patients',         file: 'patients' },
        'disease-timeline': { label: 'Disease Timeline',     title: 'Disease Timeline Report',     route: '/api/reports/disease-timeline', file: 'disease_timeline' },
        'immunization':     { label: 'Immunization',         title: 'Immunization Records Report', route: '/api/reports/immunization',     file: 'immunization' },
        'ai-insights':      { label: 'AI Insights',          title: 'AI Data-Driven Insights Report', html: true,                            file: 'ai_insights' },
        'surveillance':     { label: 'Disease Surveillance', title: 'Disease Surveillance Report', route: '/api/reports/surveillance',     file: 'disease_surveillance' },
        'audit':            { label: 'Audit Trail',          title: 'System Audit Trail Report',   route: '/api/reports/audit-trail',      file: 'audit_trail' },
        'inventory':        { label: 'Inventory',            title: 'Inventory Report',            route: '/api/reports/inventory',        file: 'inventory' },
    };

    const P = { type: '', mode: '', url: '', html: '', filename: '', seq: 0 };

    function revoke() { if (P.url) { URL.revokeObjectURL(P.url); P.url = ''; } }
    function buttons({ print, download, tab, hint }) {
        $('rpPrint').disabled = !print;
        $('rpDownload').style.display = download ? '' : 'none';
        $('rpDownload').disabled = !download;
        $('rpNewTab').style.display = tab ? '' : 'none';
        $('rpHint').textContent = hint || '';
    }
    function showState(html, cls) {
        const b = $('rpBody'); b.classList.remove('is-pdf');
        b.innerHTML = `<div class="rp-state ${cls || ''}">${html}</div>`;
    }
    function showLoading(label) {
        buttons({ print: false, download: false, tab: false, hint: '' });
        showState(`<div class="rp-spin" aria-hidden="true"></div><div>Generating ${esc(label)}…</div>`);
    }
    function showError(msg, type) {
        buttons({ print: false, download: false, tab: false, hint: '' });
        showState(`<div class="rp-err">${esc(msg)}</div><button type="button" class="btn rp-btn" onclick="openReportPreview('${esc(type)}')">Try again</button>`);
    }

    // Isara at linisin ang preview (pati kapag isinara sa backdrop o Esc)
    function cleanup() {
        P.seq++;                                  // balewalain ang anumang nakabinbing response
        revoke(); P.html = ''; P.mode = '';
        const b = $('rpBody'); if (b) { b.innerHTML = ''; b.classList.remove('is-pdf'); }
    }
    window.closeReportPreview = function () { $('reportPreviewModal')?.classList.remove('show'); };
    (function watchClose() {
        const m = $('reportPreviewModal'); if (!m) return;
        new MutationObserver(() => { if (!m.classList.contains('show')) cleanup(); }).observe(m, { attributes: true, attributeFilter: ['class'] });
    })();

    window.openReportPreview = async function (type) {
        const cfg = REPORTS[type];
        if (!cfg) return;
        const from = $('reportStartDate')?.value || '', to = $('reportEndDate')?.value || '';
        if (from && to && from > to) { showToast('Start date must be on or before the end date.', 'error'); return; }
        if (cfg.html && (!from || !to)) { showToast('Select a start and end date for this report.', 'error'); return; }

        const seq = ++P.seq;
        revoke(); P.type = type; P.mode = cfg.html ? 'html' : 'pdf'; P.html = '';
        P.filename = `${cfg.file}_${toYMD(new Date())}.pdf`;
        $('rpTitle').textContent = `${cfg.title} — Preview`;
        $('reportPreviewModal').classList.add('show');
        showLoading(cfg.label + ' report');

        try {
            if (cfg.html) await previewHtml(cfg, from, to, seq);
            else await previewPdf(cfg, seq);
        } catch (e) {
            if (seq !== P.seq) return;
            showError(e && e.message ? e.message : 'The report could not be generated.', type);
        }
    };

    /* ---------- PDF mula sa server ---------- */
    async function previewPdf(cfg, seq) {
        const res = await apiFetch(withReportDates(cfg.route));
        if (seq !== P.seq) return;
        if (!res) throw new Error('The report could not be generated. Please sign in again or check your connection.');
        if (typeof res.blob !== 'function' || !res.ok) throw new Error('The server did not return a PDF for this report.');
        const blob = await res.blob();
        if (seq !== P.seq) return;
        P.url = URL.createObjectURL(blob);
        const b = $('rpBody'); b.classList.add('is-pdf');
        b.innerHTML = `<iframe class="rp-frame" id="rpFrame" title="${esc(cfg.title)} preview" src="${P.url}#view=FitH"></iframe>`;
        buttons({ print: true, download: true, tab: true,
                  hint: 'Preview of the PDF. Print it, or download it to save a copy.' });
    }

    /* ---------- AI Insights: binubuo sa browser ---------- */
    async function previewHtml(cfg, from, to, seq) {
        if (!window.AIInsightsReport) throw new Error('The AI Insights module is not loaded.');
        const html = await window.AIInsightsReport.build(from, to);
        if (seq !== P.seq) return;
        P.html = html;
        const b = $('rpBody'); b.classList.remove('is-pdf');
        b.innerHTML = `<div class="rp-paper"><div class="rp-doc">${html}</div></div>`;
        buttons({ print: true, download: false, tab: false,
                  hint: 'In the print window, choose “Save as PDF” as the destination to keep a copy.' });
    }

    /* ---------- mga button ng preview ---------- */
    window.rpPrint = function () {
        if (P.mode === 'html') { if (P.html) window.ReportHeader.print(P.html); return; }
        const f = $('rpFrame');
        try { f.contentWindow.focus(); f.contentWindow.print(); }
        catch (_) { window.rpNewTab(); showToast('Opened in a new tab. Use the print button there.', 'info'); }
    };
    window.rpDownload = function () {
        if (!P.url) return;
        const a = document.createElement('a');
        a.href = P.url; a.download = P.filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showToast('Report downloaded successfully!', 'success');
    };
    window.rpNewTab = function () { if (P.url) window.open(P.url, '_blank'); };

    window.REPORT_PREVIEW_TYPES = REPORTS;      // para sa mga test / ibang module
})();
