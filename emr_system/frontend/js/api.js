/* ============================================================
   api.js - API Communication Utility
   Lahat ng fetch calls sa backend API ay narito
   May automatic na token injection at error handling
   ============================================================ */

const API_BASE = window.location.origin;

/**
 * Base fetch function na may JWT token at error handling.
 * Ginagamit ito ng lahat ng API calls para consistent ang behavior.
 * Awtomatikong nag-a-add ng Authorization header.
 */
async function apiFetch(endpoint, options = {}) {
    const token = sessionStorage.getItem('access_token');

    // I-set ang default headers
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    // Mag-add ng Authorization header kung may token
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });

        // Kung 401, ibig sabihin expired na ang token - i-redirect sa login
        if (response.status === 401) {
            sessionStorage.clear();
            showToast('Session expired. Please login again.', 'warning');
            setTimeout(() => window.location.href = '/', 1500);
            return null;
        }

        // Kung 403, walang permission
        if (response.status === 403) {
            showToast('Access denied. Insufficient permissions.', 'error');
            return null;
        }

        // Para sa non-JSON responses (PDF downloads)
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('application/pdf')) {
            return response;
        }

        const data = await response.json();

        // I-throw ang error kung hindi successful ang response
        if (!response.ok) {
            throw new Error(data.detail || 'An error occurred. Please try again.');
        }

        return data;

    } catch (error) {
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showToast('Cannot connect to server. Please check your connection.', 'error');
        } else {
            throw error; // I-re-throw para ma-handle ng caller
        }
        return null;
    }
}

/* --- Convenience methods para sa bawat HTTP method --- */

/** GET request */
async function apiGet(endpoint) {
    return apiFetch(endpoint, { method: 'GET' });
}

/** POST request na may JSON body */
async function apiPost(endpoint, body) {
    return apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
    });
}

/** PUT request para sa updates */
async function apiPut(endpoint, body) {
    return apiFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
}

/** DELETE request */
async function apiDelete(endpoint) {
    return apiFetch(endpoint, { method: 'DELETE' });
}

/* ============================================================
   TOAST NOTIFICATION SYSTEM
   Nagpapakita ng notification messages sa kanan-itaas
   ============================================================ */

/**
 * Magpakita ng toast notification.
 * @param {string} message - Mensahe na ipapakita
 * @param {string} type - 'success', 'error', 'warning', o 'info'
 * @param {number} duration - Oras bago mawala (milliseconds)
 */
function showToast(message, type = 'info', duration = 4000) {
    // The pages use id="toast-container"; older markup used "toastContainer". Support both so toasts actually show.
    const container = document.getElementById('toast-container') || document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
        success: '✅',
        error:   '❌',
        warning: '⚠️',
        info:    'ℹ️'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span style="font-size:18px;">${icons[type] || 'ℹ️'}</span>
        <span style="flex:1;">${message}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:16px;padding:2px 4px;">✕</button>
    `;

    container.appendChild(toast);

    // Awtomatikong mawawala pagkatapos ng duration
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// CSS para sa toast out animation
const toastStyle = document.createElement('style');
toastStyle.textContent = `
@keyframes toastOut {
    to { opacity: 0; transform: translateX(30px); }
}`;
document.head.appendChild(toastStyle);

/* ============================================================
   MODAL UTILITIES
   ============================================================ */

/** Buksan ang isang modal */
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        // I-focus ang unang input sa modal
        setTimeout(() => {
            const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
            if (firstInput) firstInput.focus();
        }, 100);
    }
}

/** Isara ang isang modal */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
}

// I-close ang modal kung nag-click sa overlay (labas ng modal box)
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('show');
    }
});

// I-close ang modal sa Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    }
});

/* ============================================================
   HELPER UTILITIES
   ============================================================ */

/**
 * I-format ang date para sa display (MM/DD/YYYY).
 * @param {string} dateString - ISO date string
 */
function formatDate(dateString) {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return d.toLocaleDateString('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

/**
 * I-format ang datetime para sa display.
 */
function formatDateTime(dateString) {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return d.toLocaleString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/**
 * Kalkulahin ang edad mula sa birthdate.
 */
function calculateAge(birthdate) {
    const today = new Date();
    const birth = new Date(birthdate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

/**
 * Gumawa ng debounced na function para sa search input.
 * Hihintayin ng 400ms bago mag-execute para hindi sobrang daming API calls.
 */
function debounce(func, delay = 400) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

let searchDebounceTimer = null;
function debounceSearch() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => loadPatients(), 400);
}

/**
 * Mag-download ng PDF file mula sa API response.
 */
async function downloadPDF(url, filename) {
    try {
        const response = await apiFetch(url);
        if (!response || !response.ok) {
            showToast('Failed to generate report.', 'error');
            return;
        }

        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);

        showToast('Report downloaded successfully!', 'success');
    } catch (error) {
        showToast('Error generating report: ' + error.message, 'error');
    }
}

/**
 * I-confirm ang isang aksyon bago i-execute.
 * Nagbabalik ng Promise<boolean>.
 */
function confirmAction(message) {
    return new Promise((resolve) => {
        // Simple confirm dialog (sa production, gawing custom modal)
        resolve(confirm(message));
    });
}

/**
 * Validate email format.
 */
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * I-sanitize ang input para sa display (para sa XSS prevention).
 * Ginagamit bago i-insert ang user input sa HTML.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text)));
    return div.innerHTML;
}

/* ============================================================
   AUTH UTILITIES
   ============================================================ */

/** Kunin ang current user info mula sa sessionStorage */
function getCurrentUser() {
    return {
        user_id:       sessionStorage.getItem('user_id'),
        name:          sessionStorage.getItem('user_name'),
        role:          sessionStorage.getItem('user_role'),
        barangay_id:   sessionStorage.getItem('barangay_id'),
        barangay_name: sessionStorage.getItem('barangay_name')
    };
}

/** Suriin kung Admin ang kasalukuyang user */
function isAdmin() {
    return sessionStorage.getItem('user_role') === 'admin';
}

/** I-redirect sa login kung walang session */
function requireAuth() {
    const token = sessionStorage.getItem('access_token');
    const expires = parseInt(sessionStorage.getItem('token_expires') || '0');

    if (!token || Date.now() > expires) {
        sessionStorage.clear();
        window.location.href = '/';
        return false;
    }
    return true;
}