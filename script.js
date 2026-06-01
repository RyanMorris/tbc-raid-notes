const map              = document.getElementById('map');
const imageWrapper     = document.getElementById('imageWrapper');
const zoomPercentDisplay = document.getElementById('zoomPercent');
const zoomInBtn        = document.getElementById('zoomIn');
const zoomOutBtn       = document.getElementById('zoomOut');
const resetZoomBtn     = document.getElementById('resetZoom');

// ── Zoom & pan ─────────────────────────────────────────────────────────────────
let scale    = 1;
const minScale  = 0.25;
const maxScale  = 2.5;
const zoomStep  = 0.1;

let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let scrollLeft = 0, scrollTop  = 0;

function updateZoomDisplay() {
    zoomPercentDisplay.textContent = Math.round(scale * 100);
}

function applyZoom() {
    map.style.transform = `scale(${scale})`;
    updateZoomDisplay();
    requestAnimationFrame(() => updateAllPinPositions());
}

zoomInBtn.addEventListener('click',  () => { scale = Math.min(scale + zoomStep, maxScale); applyZoom(); });
zoomOutBtn.addEventListener('click', () => { scale = Math.max(scale - zoomStep, minScale); applyZoom(); });
resetZoomBtn.addEventListener('click', () => {
    scale = 1;
    imageWrapper.scrollLeft = 0;
    imageWrapper.scrollTop  = 0;
    applyZoom();
});

imageWrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect     = imageWrapper.getBoundingClientRect();
    const x        = e.clientX - rect.left;
    const y        = e.clientY - rect.top;
    const oldScale = scale;
    scale = e.deltaY < 0 ? Math.min(scale + zoomStep, maxScale) : Math.max(scale - zoomStep, minScale);
    const diff = scale - oldScale;
    imageWrapper.scrollLeft += x * diff;
    imageWrapper.scrollTop  += y * diff;
    applyZoom();
});

imageWrapper.addEventListener('mousedown', (e) => {
    if (isDroppingPin || e.target.closest('.pin')) return;
    isDragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    scrollLeft = imageWrapper.scrollLeft; scrollTop = imageWrapper.scrollTop;
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    imageWrapper.scrollLeft = scrollLeft - (e.clientX - dragStartX);
    imageWrapper.scrollTop  = scrollTop  - (e.clientY - dragStartY);
    imageWrapper.style.cursor = 'grabbing';
});

document.addEventListener('mouseup', () => {
    if (isDragging) imageWrapper.style.cursor = 'grab';
    isDragging = false;
});

imageWrapper.addEventListener('scroll', () => updateAllPinPositions());

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDroppingPin) {
        isDroppingPin = false;
        imageWrapper.style.cursor = 'grab';
        imageWrapper.title = '';
    }
});

// ── Map definitions ────────────────────────────────────────────────────────────
const MAP_CONFIG = {
    ssc: { src: 'assets/ssc-map.png', label: 'SSC Map',  pinFile: 'ssc-pins.json' },
    tk:  { src: 'assets/tk-map.jpg',  label: 'TK Map',   pinFile: 'tk-pins.json'  },
};

// Per-map pin storage: { ssc: [...], tk: [...] }
const allPins = { ssc: [], tk: [] };

let activeMap      = 'ssc';   // currently visible map key
let selectedPinType = 'notes';
let currentPopup   = null;
let isDroppingPin  = false;
let lastDropTime   = 0;

// Convenience: pins for the active map
function activePins()         { return allPins[activeMap]; }
function setActivePins(arr)   { allPins[activeMap] = arr;  }

// ── Map tab switching ──────────────────────────────────────────────────────────
const mapTabs = document.querySelectorAll('.map-tab');

mapTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const key = tab.dataset.map;
        if (key === activeMap) return;
        switchMap(key);
    });
});

function switchMap(key) {
    // Hide all pins for the current map
    allPins[activeMap].forEach(pin => {
        const el = document.querySelector(`[data-pin-id="${pin.id}"]`);
        if (el) el.style.display = 'none';
    });

    hidePopup();
    activeMap = key;

    // Swap the map image
    map.src = MAP_CONFIG[key].src;

    // Update tab active state
    mapTabs.forEach(t => t.classList.toggle('active', t.dataset.map === key));

    // Show pins for the new map (wait for image to be ready)
    if (map.complete && map.naturalWidth > 0) {
        showActivePins();
        updateAllPinPositions();
    } else {
        map.onload = () => {
            showActivePins();
            updateAllPinPositions();
            map.onload = null;
        };
    }
}

function showActivePins() {
    allPins[activeMap].forEach(pin => {
        let el = document.querySelector(`[data-pin-id="${pin.id}"]`);
        if (!el) {
            renderPin(pin); // render if not yet in DOM
        } else {
            el.style.display = '';
        }
    });
}

// ── Pin type selection ─────────────────────────────────────────────────────────
const pinTypeButtons = document.querySelectorAll('.pin-type-btn');

pinTypeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pinTypeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPinType = btn.dataset.pinType;
        isDroppingPin   = true;
        imageWrapper.style.cursor = 'crosshair';
        imageWrapper.title = 'Click on the map to place a pin';
    });
});

// ── Place pin on click ─────────────────────────────────────────────────────────
imageWrapper.addEventListener('click', (e) => {
    if (!isDroppingPin || e.target.closest('.pin')) return;

    const now = Date.now();
    if (now - lastDropTime < 300) return;
    lastDropTime = now;

    e.stopPropagation();

    const mapRect  = map.getBoundingClientRect();
    const percentX = ((e.clientX - mapRect.left) / scale / map.naturalWidth)  * 100;
    const percentY = ((e.clientY - mapRect.top)  / scale / map.naturalHeight) * 100;

    if (percentX < 0 || percentX > 100 || percentY < 0 || percentY > 100) return;

    isDroppingPin = false;
    imageWrapper.style.cursor = 'grab';
    imageWrapper.title = '';

    const pin = {
        id: Date.now(), type: selectedPinType,
        x: percentX, y: percentY,
        title: '', message: '', warning: '',
        map: activeMap   // store which map this pin belongs to
    };

    allPins[activeMap].push(pin);
    renderPin(pin);
    showPinEditor(pin, true);
});

// ── Render & position ──────────────────────────────────────────────────────────
function renderPin(pin) {
    const pinEl = document.createElement('div');
    pinEl.className       = `pin ${pin.type}`;
    pinEl.dataset.pinId   = pin.id;
    pinEl.dataset.pinMap  = pin.map;
    pinEl.textContent     = pin.type === 'warning' ? '⚠️' : pin.type === 'boss' ? '💀' : '📌';

    pinEl.addEventListener('mouseenter', () => showPopup(pin));
    pinEl.addEventListener('mouseleave', () => hidePopup());
    pinEl.addEventListener('click', (e) => {
        e.stopPropagation();
        hidePopup();
        showPinEditor(pin, false);
    });

    document.body.appendChild(pinEl);
    updatePinPosition(pin);
}

function updatePinPosition(pin) {
    const pinEl = document.querySelector(`[data-pin-id="${pin.id}"]`);
    if (!pinEl || pinEl.style.display === 'none') return;

    const mapRect   = map.getBoundingClientRect();
    const viewportX = mapRect.left + (pin.x / 100) * map.naturalWidth  * scale;
    const viewportY = mapRect.top  + (pin.y / 100) * map.naturalHeight * scale;

    pinEl.style.position  = 'fixed';
    pinEl.style.left      = viewportX + 'px';
    pinEl.style.top       = viewportY + 'px';
    pinEl.style.transform = 'translate(-50%, -50%)';
}

function updateAllPinPositions() {
    // Only reposition visible (active map) pins
    allPins[activeMap].forEach(pin => updatePinPosition(pin));
}

// ── Pin editor modal ───────────────────────────────────────────────────────────
function showPinEditor(pin, isNew) {
    const existing = document.getElementById('pinEditorModal');
    if (existing) existing.remove();

    const isWarning = pin.type === 'warning' || pin.type === 'boss';
    const pinIcon   = pin.type === 'warning' ? '⚠️' : pin.type === 'boss' ? '💀' : '📌';
    const pinLabel  = pin.type === 'warning' ? 'Warning Pin' : pin.type === 'boss' ? 'Boss Pin' : 'Notes Pin';

    const modal = document.createElement('div');
    modal.id        = 'pinEditorModal';
    modal.className = 'pin-editor-overlay';

    modal.innerHTML = `
        <div class="pin-editor-modal">
            <div class="pin-editor-header">
                <span class="pin-editor-icon">${pinIcon}</span>
                <h2>${pinLabel}</h2>
            </div>
            <div class="pin-editor-body">
                <div class="pin-editor-field">
                    <label for="pinTitleInput">Title</label>
                    <input id="pinTitleInput" type="text" placeholder="Enter pin title…" autocomplete="off" value="${escapeAttr(pin.title)}" />
                </div>
                <div class="pin-editor-field">
                    <label for="pinMessageInput">Message</label>
                    <textarea id="pinMessageInput" placeholder="Enter notes or description…" rows="4">${escapeHtml(pin.message)}</textarea>
                </div>
                ${isWarning ? `
                <div class="pin-editor-field">
                    <label for="pinWarningInput">Warning Note</label>
                    <textarea id="pinWarningInput" placeholder="Describe the warning…" rows="3">${escapeHtml(pin.warning)}</textarea>
                </div>` : ''}
            </div>
            <div class="pin-editor-footer">
                <button class="pin-editor-delete" id="pinEditorDelete">Delete Pin</button>
                <div class="pin-editor-footer-right">
                    <button class="pin-editor-cancel" id="pinEditorCancel">Cancel</button>
                    <button class="pin-editor-save"   id="pinEditorSave">Save Pin</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    requestAnimationFrame(() => document.getElementById('pinTitleInput').focus());

    const titleInput   = document.getElementById('pinTitleInput');
    const messageInput = document.getElementById('pinMessageInput');
    const warningInput = document.getElementById('pinWarningInput');

    function savePin() {
        pin.title   = titleInput.value.trim();
        pin.message = messageInput.value.trim();
        if (isWarning && warningInput) pin.warning = warningInput.value.trim();
        modal.remove();
    }

    function cancelPin() {
        if (isNew) {
            allPins[activeMap] = allPins[activeMap].filter(p => p.id !== pin.id);
            const pinEl = document.querySelector(`[data-pin-id="${pin.id}"]`);
            if (pinEl) pinEl.remove();
        }
        modal.remove();
    }

    function deletePin() {
        const mapKey = pin.map || activeMap;
        allPins[mapKey] = allPins[mapKey].filter(p => p.id !== pin.id);
        const pinEl = document.querySelector(`[data-pin-id="${pin.id}"]`);
        if (pinEl) pinEl.remove();
        modal.remove();
    }

    document.getElementById('pinEditorSave').addEventListener('click', savePin);
    document.getElementById('pinEditorCancel').addEventListener('click', cancelPin);
    document.getElementById('pinEditorDelete').addEventListener('click', deletePin);

    modal.addEventListener('click',   (e) => { if (e.target === modal) cancelPin(); });
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); savePin(); }
        if (e.key === 'Escape') cancelPin();
    });
}

// ── Hover popup ────────────────────────────────────────────────────────────────
function showPopup(pin) {
    hidePopup();
    const popup = document.createElement('div');
    popup.className = 'popup active';
    popup.id        = `popup-${pin.id}`;

    let content = `<h3>${escapeHtml(pin.title) || '(untitled)'}</h3>`;
    if (pin.message) {
        content += `<div class="section">
            <div class="section-label">Notes</div>
            <div class="section-content">${escapeHtml(pin.message)}</div>
        </div>`;
    }
    if ((pin.type === 'warning' || pin.type === 'boss') && pin.warning) {
        const warningLabel = pin.type === 'boss' ? '💀 Beware' : '⚠️ Warning';
        content += `<div class="section">
            <div class="section-label">${warningLabel}</div>
            <div class="section-content">${escapeHtml(pin.warning)}</div>
        </div>`;
    }
    content += `<div class="popup-hint">Click pin to edit</div>`;

    popup.innerHTML = content;
    document.body.appendChild(popup);

    const pinEl = document.querySelector(`[data-pin-id="${pin.id}"]`);
    if (pinEl) {
        const rect = pinEl.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.left     = (rect.left + 30) + 'px';
        popup.style.top      = (rect.top  - 10) + 'px';
    }
    currentPopup = popup;
}

function hidePopup() {
    if (currentPopup) { currentPopup.remove(); currentPopup = null; }
}

// ── Export: write both map pin files and matching JS loader files ───────────
document.getElementById('exportPinsBtn').addEventListener('click', () => {
    Object.entries(allPins).forEach(([key, pins]) => {
        const jsonBlob = new Blob([JSON.stringify(pins, null, 2)], { type: 'application/json' });
        const jsonUrl  = URL.createObjectURL(jsonBlob);
        const jsonLink = Object.assign(document.createElement('a'), {
            href:     jsonUrl,
            download: MAP_CONFIG[key].pinFile
        });
        jsonLink.click();
        URL.revokeObjectURL(jsonUrl);

        const varName = key === 'ssc' ? 'SSC_PINS' : 'TK_PINS';
        const jsContent = `var ${varName} = ${JSON.stringify(pins, null, 2)};\n`;
        const jsBlob = new Blob([jsContent], { type: 'application/javascript' });
        const jsUrl  = URL.createObjectURL(jsBlob);
        const jsLink = Object.assign(document.createElement('a'), {
            href:     jsUrl,
            download: MAP_CONFIG[key].pinFile.replace(/\.json$/, '.js')
        });
        jsLink.click();
        URL.revokeObjectURL(jsUrl);
    });
});

// ── Import: load a single pin file into the correct map ───────────────────────
// Clicking "Import Pins" imports both files sequentially via two file pickers.
// We track which file we're on with a simple state machine.
let importQueue = [];

document.getElementById('importPinsBtn').addEventListener('click', () => {
    // Trigger import for both maps in order: ssc first, then tk
    importQueue = ['ssc', 'tk'];
    promptNextImport();
});

function promptNextImport() {
    if (importQueue.length === 0) return;
    const key = importQueue[0];
    const input = document.getElementById('importFileInput');
    input._targetMap = key;
    input.value = '';
    // Show a small hint so user knows which file to pick
    input._hintShown = true;
    // Brief visual cue in the button label
    const btn = document.getElementById('importPinsBtn');
    btn.textContent = `⬇ Pick ${MAP_CONFIG[key].pinFile}`;
    input.click();
}

document.getElementById('importFileInput').addEventListener('change', (e) => {
    const file      = e.target.files[0];
    const targetMap = e.target._targetMap;
    if (!file || !targetMap) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const imported = JSON.parse(ev.target.result);
            if (!Array.isArray(imported)) throw new Error('Expected a JSON array');

            // Remove existing DOM elements for this map
            allPins[targetMap].forEach(pin => {
                const el = document.querySelector(`[data-pin-id="${pin.id}"]`);
                if (el) el.remove();
            });
            allPins[targetMap] = [];

            imported.forEach(pin => {
                if (typeof pin.x !== 'number' || typeof pin.y !== 'number') return;
                pin.id      = pin.id      ?? (Date.now() + Math.random());
                pin.type    = pin.type    ?? 'notes';
                pin.title   = pin.title   ?? '';
                pin.message = pin.message ?? '';
                pin.warning = pin.warning ?? '';
                pin.map     = targetMap;
                allPins[targetMap].push(pin);

                // Only render immediately if this is the active map
                if (targetMap === activeMap) {
                    renderPin(pin);
                }
            });

        } catch (err) {
            alert(`Failed to import ${MAP_CONFIG[targetMap].pinFile}:\n${err.message}`);
        }

        // Advance the queue
        importQueue.shift();
        const btn = document.getElementById('importPinsBtn');
        if (importQueue.length > 0) {
            promptNextImport();
        } else {
            btn.textContent = '⬇ Import Pins';
        }
    };
    reader.readAsText(file);
});

// ── Auto-load pins on startup ──────────────────────────────────────────────────
// Load pin data from local JS globals when opening via file://, with fetch() fallback.
function loadPinsFromArray(key, imported) {
    if (!Array.isArray(imported)) return;
    imported.forEach(pin => {
        if (typeof pin.x !== 'number' || typeof pin.y !== 'number') return;
        pin.id      = pin.id      ?? (Date.now() + Math.random());
        pin.type    = pin.type    ?? 'notes';
        pin.title   = pin.title   ?? '';
        pin.message = pin.message ?? '';
        pin.warning = pin.warning ?? '';
        pin.map     = key;
        allPins[key].push(pin);
        if (key === activeMap) renderPin(pin);
    });
}

async function tryLoadPins(key) {
    const globalVar = key === 'ssc' ? window.SSC_PINS : window.TK_PINS;
    if (Array.isArray(globalVar)) {
        loadPinsFromArray(key, globalVar);
        return;
    }

    try {
        const res = await fetch(MAP_CONFIG[key].pinFile);
        if (!res.ok) return;
        const imported = await res.json();
        loadPinsFromArray(key, imported);
    } catch (_) {
        // File not found or not on a server — silently skip
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(str) {
    return String(str ?? '').replace(/"/g, '&quot;');
}

// ── Init ───────────────────────────────────────────────────────────────────────
applyZoom();

// Try to load saved pins for both maps on start
Promise.all([tryLoadPins('ssc'), tryLoadPins('tk')]).then(() => {
    // After loading, ensure active map pins are positioned correctly
    if (map.complete && map.naturalWidth > 0) {
        updateAllPinPositions();
    } else {
        map.addEventListener('load', updateAllPinPositions, { once: true });
    }
});
