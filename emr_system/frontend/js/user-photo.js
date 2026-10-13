/* ============================================================
   user-photo.js — staff photos (JPG only), shared by every page.

   Needs only:  <link ... user-photo.css>  and  <script src="../js/user-photo.js">
   (after api.js). It finds these on the page by itself:
     #sbAvatar, #profModalAvatar   -> shows YOUR photo (initials if none)
     #editProfileModal             -> photo section: "Upload photo" / "Use camera" / "Remove"
                                      (only on pages that define saveProfile)
     #editStaffModal (admin)       -> centered photo block (upload only); page calls UserPhoto.bindStaff(user)
     .up-thumb[data-up-user]       -> staff list thumbnails (filled in automatically)

   A photo chosen in a window is only a PREVIEW. It is uploaded when the
   window's "Save Changes" succeeds, and thrown away if the window is closed.
   Server rules are enforced again by the API (JPG only, 2 MB, re-encoded).
   ============================================================ */
(function () {
    'use strict';
    if (window.UserPhoto) return;

    const SRC_MAX = 5 * 1024 * 1024;     // largest original the user may pick
    const SEND_MAX = 2 * 1024 * 1024;    // must match the server limit
    const SIDE = 800, MIN_SIDE = 64;
    const OWN_IDS = ['sbAvatar', 'profModalAvatar'];

    const $ = id => document.getElementById(id);
    const token = () => sessionStorage.getItem('access_token');
    const authH = () => ({ 'Authorization': 'Bearer ' + token() });
    const url = p => `${window.location.origin}/api/users/${p}`;

    const cache = new Map();             // "uid:v" -> blob URL
    let me = null;                       // { user_id, has_photo, photo_v }  (saved state of the logged-in user)
    let staff = { id: null, has: false, v: null, name: '' };   // saved state of the staff member being edited
    const staged = { own: null, staff: null };      // null | { blob, url } | { remove: true }   (not saved yet)
    const applying = { own: null, staff: null };
    let guard = false;                   // true while WE change an avatar, so the observer ignores it

    const statusId = who => who === 'own' ? 'upOwnStatus' : 'upStaffStatus';
    const savedHas = who => who === 'own' ? !!(me && me.has_photo) : !!staff.has;

    /* ---------- visible, non-disappearing error ---------- */
    function problem(msg) {
        console.error('Staff photo problem:', msg);
        let b = $('photoProblem');
        if (!b) {
            b = document.createElement('div'); b.id = 'photoProblem'; b.setAttribute('role', 'alert');
            b.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100002;max-width:min(640px,92vw);background:#fff1f0;color:#8a1c1c;border:1px solid #f1b5b0;border-radius:10px;padding:12px 40px 12px 14px;font-size:13px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.18)';
            const x = document.createElement('button'); x.type = 'button'; x.textContent = '\u2715'; x.setAttribute('aria-label', 'Dismiss');
            x.style.cssText = 'position:absolute;top:6px;right:8px;border:0;background:none;font-size:15px;cursor:pointer;color:#8a1c1c';
            x.onclick = () => b.remove();
            const t = document.createElement('div'); t.id = 'photoProblemText';
            b.appendChild(t); b.appendChild(x); document.body.appendChild(b);
        }
        $('photoProblemText').textContent = msg;
    }

    function setStatus(id, text, isErr) {
        const s = $(id); if (!s) return;
        s.textContent = text || ''; s.classList.toggle('err', !!isErr);
    }

    /* ---------- validation + resize (the server re-checks everything) ---------- */
    async function validate(file) {
        if (!/\.jpe?g$/i.test(file.name) || file.type !== 'image/jpeg') return 'Only JPG images are allowed.';
        if (file.size === 0) return 'The file is empty.';
        if (file.size > SRC_MAX) return 'Photo is too large. Please choose an image under 5 MB.';
        const h = new Uint8Array(await file.slice(0, 3).arrayBuffer());
        if (!(h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF)) return 'The file is not a valid JPEG image.';
        return null;
    }

    async function resize(file) {
        let bmp;
        try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (_) { try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('Unable to read this image.'); } }
        if (Math.min(bmp.width, bmp.height) < MIN_SIDE) { bmp.close && bmp.close(); throw new Error(`The image is too small (minimum ${MIN_SIDE} px).`); }
        const k = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
        bmp.close && bmp.close();
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));    // re-encoding also drops EXIF/GPS
        if (!blob) throw new Error('Unable to process the image.');
        if (blob.size > SEND_MAX) throw new Error('Photo is still too large after resizing.');
        return blob;
    }

    async function prepare(file) {
        const err = await validate(file);
        if (err) throw new Error(err);
        return resize(file);
    }

    /* ---------- network ---------- */
    function sessionEnded() { sessionStorage.clear(); window.location.href = '/'; }

    async function detailOf(res, fallback) {
        let d = ''; try { d = (await res.json()).detail; } catch (_) {}
        return (typeof d === 'string' && d ? d : fallback) + ' (HTTP ' + res.status + ')';
    }

    async function upload(uid, blob) {
        const fd = new FormData(); fd.append('file', blob, 'photo.jpg');
        const res = await fetch(url(`${uid}/photo`), { method: 'POST', headers: authH(), body: fd });
        if (res.status === 401) { sessionEnded(); throw new Error('Session expired.'); }
        if (!res.ok) throw new Error(await detailOf(res, 'Upload failed.'));
        return res.json();
    }

    async function remove(uid) {
        const res = await fetch(url(`${uid}/photo`), { method: 'DELETE', headers: authH() });
        if (res.status === 401) { sessionEnded(); throw new Error('Session expired.'); }
        if (!res.ok) throw new Error(await detailOf(res, 'Could not remove the photo.'));
        return res.json();
    }

    // Photos are protected, so <img src> cannot load them: fetch with the token and use a blob URL.
    async function fetchUrl(uid, v) {
        const key = uid + ':' + (v || '');
        if (cache.has(key)) return cache.get(key);
        const fail = (status, detail) => { console.warn('Staff photo not loaded: user', uid, 'HTTP', status, detail); return null; };
        try {
            const res = await fetch(url(`${uid}/photo`), { headers: authH(), cache: 'no-store' });
            if (!res.ok) { let d = ''; try { d = (await res.json()).detail || ''; } catch (_) {} return fail(res.status, d); }
            const blob = await res.blob();
            if (!blob.size || !/^image\/jpeg/.test(blob.type)) return fail(res.status, 'Unexpected response (' + (blob.type || 'unknown type') + ')');
            if (cache.size >= 100) { const k = cache.keys().next().value; URL.revokeObjectURL(cache.get(k)); cache.delete(k); }
            const u = URL.createObjectURL(blob); cache.set(key, u); return u;
        } catch (e) { return fail(0, e.message); }
    }

    /* ---------- painting avatars ---------- */
    const initialOf = el => {
        if (el.dataset.upInitial) return el.dataset.upInitial;
        const t = (el.textContent || '').trim();
        if (t && t.length <= 2 && !el.querySelector('img')) return t;
        return ((sessionStorage.getItem('user_name') || 'U').trim().charAt(0) || 'U').toUpperCase();
    };

    function showImage(el, blobUrl) {
        guard = true; el._upT = (el._upT || 0) + 1;
        el.textContent = '';
        const img = document.createElement('img');
        img.className = 'up-av-img'; img.alt = ''; img.src = blobUrl;
        el.appendChild(img);
        el.style.overflow = 'hidden';
        el.dataset.upShown = '1'; el.dataset.upUrl = blobUrl;
        guard = false; observer.takeRecords();
    }

    function showInitial(el, text) {
        guard = true; el._upT = (el._upT || 0) + 1;
        el.textContent = text;
        el.dataset.upShown = '0'; delete el.dataset.upUrl;
        guard = false; observer.takeRecords();
    }

    async function paint(el, o) {
        if (!el) return;
        const ini = o.initial || initialOf(el);
        el.dataset.upInitial = ini;
        if (!o.has) { showInitial(el, ini); return; }
        const t = (el._upT = (el._upT || 0) + 1);
        const u = await fetchUrl(o.uid, o.v);
        if (el._upT !== t) return;                 // something newer (e.g. a preview) was painted meanwhile
        if (u) showImage(el, u); else showInitial(el, ini);
    }

    const previewEl = who => who === 'own' ? $('profModalAvatar') : $('upStaffPrev');

    // Draw what the window should show: the chosen-but-unsaved photo if there is one, else the saved photo.
    function renderPreview(who) {
        const el = previewEl(who); if (!el) return;
        const s = staged[who];
        const ini = who === 'own' ? initialOf(el) : ((staff.name || '?').trim().charAt(0).toUpperCase() || '?');
        el.dataset.upInitial = ini;
        if (s && s.blob) { showImage(el, s.url); return; }
        if (s && s.remove) { showInitial(el, ini); return; }
        if (who === 'own') { if (me) paint(el, { uid: me.user_id, has: me.has_photo, v: me.photo_v, initial: ini }); }
        else paint(el, { uid: staff.id, has: staff.has, v: staff.v, initial: ini });
    }

    // The sidebar only ever shows the SAVED photo.
    function paintOwn() {
        if (!me) return;
        paint($('sbAvatar'), { uid: me.user_id, has: me.has_photo, v: me.photo_v });
        renderPreview('own');
    }

    // If the page's own code rewrites an avatar back to a letter (e.g. after saving the name), put the photo back.
    const observer = new MutationObserver(() => {
        if (guard) return;
        OWN_IDS.forEach(id => {
            const el = $(id);
            if (el && el.dataset.upShown === '1' && el.dataset.upUrl && !el.querySelector('img')) showImage(el, el.dataset.upUrl);
        });
    });

    /* ---------- list thumbnails (<span class="up-thumb" data-up-user=".." data-up-v=".." data-up-has="1">X</span>) ---------- */
    let hydrateTimer = null;
    function hydrate() {
        document.querySelectorAll('.up-thumb[data-up-user]').forEach(el => {
            const uid = el.dataset.upUser, v = el.dataset.upV || '';
            if (el.dataset.upDone === v + '|' + el.dataset.upHas) return;
            el.dataset.upDone = v + '|' + el.dataset.upHas;
            paint(el, { uid, has: el.dataset.upHas === '1', v, initial: el.dataset.upInitial || (el.textContent || '').trim().charAt(0).toUpperCase() });
        });
    }
    const hydrateSoon = () => { clearTimeout(hydrateTimer); hydrateTimer = setTimeout(hydrate, 60); };

    /* ---------- staging: choose now, save later ---------- */
    function clearStaged(who) {
        const s = staged[who];
        if (s && s.url) URL.revokeObjectURL(s.url);
        staged[who] = null;
    }

    function syncControls(who) {
        const btn = $(who === 'own' ? 'upOwnRemove' : 'upStaffRemove'); if (!btn) return;
        const s = staged[who];
        btn.style.display = (s ? !!s.blob : savedHas(who)) ? '' : 'none';
    }

    function stage(who, blob) {
        clearStaged(who);
        staged[who] = { blob, url: URL.createObjectURL(blob) };
        renderPreview(who); syncControls(who);
        setStatus(statusId(who), 'New photo selected. Press Save Changes to apply it.');
    }

    function stageRemove(who) {
        clearStaged(who);
        staged[who] = { remove: true };
        renderPreview(who); syncControls(who);
        setStatus(statusId(who), 'The photo will be removed when you press Save Changes.');
    }

    function removeClick(who) { if (savedHas(who)) stageRemove(who); else discard(who); }

    function discard(who) {
        if (applying[who]) return;                   // a save is in progress: leave it alone
        clearStaged(who); renderPreview(who); syncControls(who); setStatus(statusId(who), '');
    }

    // Called after "Save Changes" succeeded: now the chosen photo really goes to the server.
    function apply(who) {
        if (applying[who]) return applying[who];
        const s = staged[who];
        if (!s) return Promise.resolve(false);
        applying[who] = (async () => {
            const uid = who === 'own' ? (me && me.user_id) : staff.id;
            const sid = statusId(who);
            if (!uid) { problem('Cannot tell which account this photo is for. Please reopen the window.'); return false; }
            try {
                setStatus(sid, 'Saving photo\u2026');
                if (s.remove) {
                    await remove(uid);
                    if (who === 'own') { me.has_photo = false; me.photo_v = null; } else { staff.has = false; staff.v = null; }
                } else {
                    const r = await upload(uid, s.blob);
                    if (!r.has_photo) throw new Error('The server did not record the photo. Restart the server and check models.py has photo_filename on User.');
                    if (who === 'own') { me.has_photo = true; me.photo_v = r.photo_v; } else { staff.has = true; staff.v = r.photo_v; }
                }
                clearStaged(who);
                if (who === 'own') paintOwn(); else renderPreview('staff');
                syncControls(who);
                setStatus(sid, 'Photo saved.');
                if (who === 'staff' && typeof UserPhoto.onStaffChange === 'function') UserPhoto.onStaffChange();
                return true;
            } catch (e) { setStatus(sid, ''); problem(e.message || 'Could not save the photo.'); return false; }
            finally { applying[who] = null; }
        })();
        return applying[who];
    }

    async function pick(input, who) {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        try { stage(who, await prepare(file)); }
        catch (e) { problem(e.message || 'Could not use this photo.'); }
    }

    /* ---------- camera (My Profile only) ---------- */
    let cam = null;     // { stream, shotBlob, shotUrl, onKey }

    function closeCamera() {
        if (!cam) return;
        if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
        if (cam.shotUrl) URL.revokeObjectURL(cam.shotUrl);
        document.removeEventListener('keydown', cam.onKey, true);
        const d = $('upCam'); if (d) d.remove();
        cam = null;
    }

    function camMessage(text, isErr) {
        const m = $('upCamMsg'); if (!m) return;
        m.textContent = text || ''; m.style.display = text ? '' : 'none'; m.classList.toggle('err', !!isErr);
    }

    function camButtons(state) {   // state: 'live' | 'shot' | 'error'
        const show = (id, on) => { const b = $(id); if (b) b.hidden = !on; };
        show('upCamTake', state === 'live'); show('upCamUse', state === 'shot'); show('upCamRetake', state === 'shot');
    }

    async function openCamera() {
        if (cam) return;
        if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            problem('The camera needs a secure connection (HTTPS or localhost) and a browser that supports it. You can still use "Upload photo".');
            return;
        }
        const d = document.createElement('div');
        d.id = 'upCam'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Take a photo');
        d.innerHTML =
            '<div class="up-cam-card">' +
            '<div class="up-cam-title">Take a photo</div>' +
            '<div class="up-cam-stage"><video id="upCamVideo" autoplay playsinline muted></video>' +
            '<img id="upCamShot" alt="Captured photo" hidden><div class="up-cam-msg" id="upCamMsg">Starting camera\u2026</div></div>' +
            '<div class="up-cam-actions">' +
            '<button type="button" class="up-btn" id="upCamTake" hidden>Take photo</button>' +
            '<button type="button" class="up-btn" id="upCamUse" hidden>Use this photo</button>' +
            '<button type="button" class="up-btn light" id="upCamRetake" hidden>Retake</button>' +
            '<button type="button" class="up-btn light" id="upCamCancel">Cancel</button></div></div>';
        document.body.appendChild(d);
        // Escape closes only the camera, not the profile window behind it.
        const onKey = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closeCamera(); } };
        document.addEventListener('keydown', onKey, true);
        cam = { stream: null, shotBlob: null, shotUrl: null, onKey };

        $('upCamCancel').onclick = closeCamera;
        $('upCamRetake').onclick = () => {
            if (cam.shotUrl) { URL.revokeObjectURL(cam.shotUrl); cam.shotUrl = null; cam.shotBlob = null; }
            $('upCamShot').hidden = true; $('upCamVideo').hidden = false; camButtons('live');
        };
        $('upCamTake').onclick = () => {
            const v = $('upCamVideo'); if (!v.videoWidth) return;
            const k = Math.min(1, SIDE / Math.max(v.videoWidth, v.videoHeight));
            const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);          // saved un-mirrored (true image)
            c.toBlob(b => {
                if (!b) { camMessage('Could not capture the photo. Please try again.', true); return; }
                cam.shotBlob = b; cam.shotUrl = URL.createObjectURL(b);
                $('upCamShot').src = cam.shotUrl; $('upCamShot').hidden = false; v.hidden = true; camButtons('shot');
            }, 'image/jpeg', 0.85);
        };
        $('upCamUse').onclick = () => {
            const b = cam && cam.shotBlob; if (!b) return;
            if (b.size > SEND_MAX) { camMessage('The photo is too large. Please retake it.', true); return; }
            closeCamera(); stage('own', b);
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
            if (!cam) { stream.getTracks().forEach(t => t.stop()); return; }        // cancelled while waiting for permission
            cam.stream = stream;
            const v = $('upCamVideo'); v.srcObject = stream;
            try { await v.play(); } catch (_) {}
            camMessage(''); camButtons('live'); $('upCamTake').focus();
        } catch (e) {
            const why = {
                NotAllowedError: 'Camera permission was denied. Allow camera access in your browser (address bar), then try again.',
                SecurityError: 'Camera permission was denied. Allow camera access in your browser (address bar), then try again.',
                NotFoundError: 'No camera was found on this device.',
                NotReadableError: 'The camera is being used by another app. Close it and try again.',
                OverconstrainedError: 'This camera is not supported.'
            }[e && e.name] || 'Could not start the camera.';
            camMessage(why, true); camButtons('error');
        }
    }

    /* ---------- building the controls ---------- */
    function centerOwnCard() {
        const av = $('profModalAvatar');
        if (!av || !av.parentElement) return;
        av.classList.add('up-av-lg');
        av.parentElement.classList.add('up-card-center');
        // The name / role / barangay text under the avatar repeats what the form fields already show: hide it.
        const nm = $('profModalName');
        if (nm && nm.parentElement && nm.parentElement !== av.parentElement) nm.parentElement.classList.add('up-hide');
    }

    function injectOwnControls() {
        const av = $('profModalAvatar');
        if (!av || $('upOwnFile')) return;
        // Only on pages where "Save Changes" really works; otherwise a chosen photo could never be saved.
        if (typeof window.saveProfile !== 'function') return;
        const g = document.createElement('div'); g.className = 'up-photo-group'; g.id = 'upOwnGroup';
        g.innerHTML =
            '<div class="up-ctrl center">' +
            '<button type="button" class="up-btn" id="upOwnUpload"><i class="fa-solid fa-upload"></i> Upload photo</button>' +
            '<button type="button" class="up-btn" id="upOwnCam"><i class="fa-solid fa-camera"></i> Use camera</button>' +
            '<button type="button" class="up-btn light" id="upOwnRemove" style="display:none">Remove</button>' +
            '<input type="file" id="upOwnFile" accept="image/jpeg,.jpg,.jpeg" hidden></div>' +
            '<div class="up-hint">JPG only &middot; up to 5 MB &middot; applied when you press <b>Save Changes</b></div>' +
            '<div class="up-status" id="upOwnStatus" role="status"></div>';
        // Put the buttons right under the avatar, in the same card, so they belong to the picture.
        av.parentElement.insertBefore(g, av.nextSibling);
        $('upOwnUpload').addEventListener('click', () => $('upOwnFile').click());
        $('upOwnFile').addEventListener('change', e => pick(e.target, 'own'));
        $('upOwnCam').addEventListener('click', openCamera);
        $('upOwnRemove').addEventListener('click', () => removeClick('own'));
        syncControls('own');
    }

    function injectStaffControls() {
        const body = document.querySelector('#editStaffModal .modal-body');
        if (!body || $('upStaffFile')) return;
        const box = document.createElement('div'); box.className = 'up-staff';
        box.innerHTML =
            '<div class="up-prev" id="upStaffPrev">?</div>' +
            '<div class="up-ctrl center">' +
            '<button type="button" class="up-btn" id="upStaffUpload"><i class="fa-solid fa-upload"></i> Upload photo</button>' +
            '<button type="button" class="up-btn light" id="upStaffRemove" style="display:none">Remove</button>' +
            '<input type="file" id="upStaffFile" accept="image/jpeg,.jpg,.jpeg" hidden></div>' +
            '<div class="up-hint">JPG only &middot; up to 5 MB &middot; applied when you press <b>Save Changes</b></div>' +
            '<div class="up-status" id="upStaffStatus" role="status"></div>';
        body.insertBefore(box, body.firstChild);
        $('upStaffUpload').addEventListener('click', () => $('upStaffFile').click());
        $('upStaffFile').addEventListener('change', e => pick(e.target, 'staff'));
        $('upStaffRemove').addEventListener('click', () => removeClick('staff'));
    }

    // Save succeeded (the page shows a "✅ …" message) -> upload the chosen photo.
    function watchSaveMessage(msgId, who) {
        const el = $(msgId); if (!el) return;
        new MutationObserver(() => { if ((el.textContent || '').indexOf('\u2705') !== -1) apply(who); })
            .observe(el, { childList: true, characterData: true, subtree: true });
    }

    // Window closed or opened -> forget any photo that was chosen but not saved.
    function watchModal(modalId, who) {
        const m = $(modalId); if (!m) return;
        let was = m.classList.contains('show');
        new MutationObserver(() => {
            const now = m.classList.contains('show');
            if (now === was) return;
            was = now;
            if (!now) closeCamera();
            discard(who);
        }).observe(m, { attributes: true, attributeFilter: ['class'] });
    }

    /* ---------- start ---------- */
    async function loadMe() {
        if (!token()) return;
        try {
            const res = await fetch(url('me/photo-info'), { headers: authH() });
            if (!res.ok) { console.warn('Staff photo info not loaded: HTTP', res.status); return; }
            me = await res.json();
            paintOwn(); syncControls('own');
        } catch (e) { console.warn('Staff photo info not loaded:', e.message); }
    }

    function init() {
        if (!token()) return;                       // login page: nothing to do
        OWN_IDS.forEach(id => { const el = $(id); if (el) observer.observe(el, { childList: true, characterData: true, subtree: true }); });
        centerOwnCard();
        injectOwnControls();
        injectStaffControls();
        watchSaveMessage('profSaveMsg', 'own'); watchSaveMessage('esSaveMsg', 'staff');
        watchModal('editProfileModal', 'own');  watchModal('editStaffModal', 'staff');
        new MutationObserver(hydrateSoon).observe(document.body, { childList: true, subtree: true });
        window.addEventListener('pagehide', closeCamera);
        hydrate();
        loadMe();
    }

    window.UserPhoto = {
        // admin: call when the Edit Staff window is filled in (u = the user object from /api/users/{id})
        bindStaff(u) {
            injectStaffControls();
            clearStaged('staff');
            staff = { id: u.user_id, has: !!u.has_photo, v: u.photo_v || null, name: u.name || '' };
            renderPreview('staff'); syncControls('staff'); setStatus('upStaffStatus', '');
        },
        // Optional explicit hooks (they are also triggered automatically by the "✅" save message):
        applyOwn: () => apply('own'),
        applyStaff: () => apply('staff'),
        refreshOwn: loadMe,
        hydrate,
        onStaffChange: null        // optional callback, e.g. reload the staff list
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();