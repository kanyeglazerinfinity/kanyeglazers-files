import { createIcons, icons } from 'lucide';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    createIcons({ icons });
    initializeApp();
});

// --- STATE MANAGEMENT ---
const state = {
    view: 'all',
    // viewMode: 'grid' | 'list' | 'details'
    viewMode: localStorage.getItem('gallery_viewMode') || 'grid',
    thumbSize: parseInt(localStorage.getItem('gallery_thumbSize') || '180', 10),
    currentAlbum: null,
    files: JSON.parse(localStorage.getItem('gallery_files') || '[]'),
    albums: JSON.parse(localStorage.getItem('gallery_albums') || '[]'),
    theme: JSON.parse(localStorage.getItem('gallery_theme') || '{ "mode": "light" }'),
    isAdmin: false,
    currentTrack: null,
    isPlaying: false
};

// --- AUDIO ENGINE ---
const audio = new Audio();
audio.volume = 0.7;

// --- UTILS ---
const hashPassword = async (password) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const _cfg_token = "Kanye2312#!"; // admin secret (kept as a less obvious variable name)

// --- CORE FUNCTIONS ---
/* Remove any uploaded WAV files from state, persist change, and free object URLs */
function removeWavFiles() {
    const before = state.files.length;
    // Revoke any object URLs for removed files to free memory
    const remaining = [];
    state.files.forEach(f => {
        if (f.ext === 'wav') {
            if (f._objectUrl && f.url) {
                try { URL.revokeObjectURL(f.url); } catch (e) {}
            }
        } else {
            remaining.push(f);
        }
    });
    state.files = remaining;
    if (state.files.length !== before) {
        saveState();
        console.info(`Removed ${before - state.files.length} .wav file(s) from gallery.`);
    }
}

function removeTestAlbums() {
    // remove any albums whose name includes "test" (case-insensitive)
    const beforeCount = state.albums.length;
    const removedAlbumIds = new Set();
    state.albums = state.albums.filter(a => {
        if (typeof a.name === 'string' && a.name.toLowerCase().includes('test')) {
            removedAlbumIds.add(a.id);
            // if artwork is an object URL, try to revoke it (best-effort)
            if (a.artwork && typeof a.artwork === 'string' && a.artwork.startsWith('blob:')) {
                try { URL.revokeObjectURL(a.artwork); } catch (e) {}
            }
            return false; // filter out (remove)
        }
        return true;
    });

    if (removedAlbumIds.size > 0) {
        // clear album references from files that pointed to removed albums
        state.files.forEach(f => {
            if (f.albumId && removedAlbumIds.has(f.albumId)) {
                f.albumId = null;
                f.album = f.album || 'Unknown';
            }
        });
        saveState();
        console.info(`Removed ${beforeCount - state.albums.length} test album(s) from gallery.`);
    }
}

function initializeApp() {
    // initialize UI with saved view settings
    document.documentElement.style.setProperty('--thumb-size', state.thumbSize + 'px');
    applyViewModeToDOM(state.viewMode);

    // Remove uploaded .wav files on startup (user requested)
    removeWavFiles();

    // Remove any test albums left in storage and clear references
    removeTestAlbums();

    renderFiles();
    renderAlbums();
    applyTheme(state.theme);
    setupEventListeners();
}

function applyTheme(theme) {
    document.body.className = `theme-${theme.mode}`;
    if (theme.accent) document.documentElement.style.setProperty('--accent', theme.accent);
    if (theme.font) document.documentElement.style.setProperty('--font', theme.font);
}

function renderFiles() {
    const contentArea = document.querySelector('.content-area');
    const grid = document.getElementById('media-grid');
    grid.innerHTML = '';
    // ensure content area classes reflect view mode
    contentArea.classList.remove('list-view', 'details-view');
    if (state.viewMode === 'list') contentArea.classList.add('list-view');
    if (state.viewMode === 'details') contentArea.classList.add('details-view');

    let filtered = state.files;

    // type filters
    if (state.view === 'music') filtered = filtered.filter(f => ['mp3', 'wav', 'flac', 'm4a'].includes(f.ext));
    if (state.view === 'images') filtered = filtered.filter(f => ['png', 'jpg', 'jpeg'].includes(f.ext));

    // album filter (if an album is selected)
    if (state.currentAlbum) {
        filtered = filtered.filter(f => f.albumId === state.currentAlbum);
    }

    filtered.forEach(file => {
        const card = document.createElement('div');
        card.className = 'media-card';
        const isImage = ['png', 'jpg', 'jpeg'].includes(file.ext);

        // Adjust card markup for list/details to include extra metadata when in those modes
        let previewHTML = isImage ? `<img src="${file.url}" alt="${file.name}">` : `<div class="file-icon"><i data-lucide="music"></i></div>`;
        let metaHTML = `<div class="title">${file.title || file.name}</div><div class="subtitle">${file.artist || 'Unknown'}</div>`;
        if (state.viewMode === 'list') {
            card.innerHTML = `${previewHTML}<div style="flex:1">${metaHTML}</div>`;
        } else if (state.viewMode === 'details') {
            card.innerHTML = `${previewHTML}<div style="flex:1"><div class="title">${file.title || file.name}</div><div class="subtitle">${file.artist || 'Unknown'}</div><div style="color:var(--text-secondary);margin-top:8px;font-size:0.85rem">Type: ${file.ext.toUpperCase()} • ${file.name}</div></div>`;
        } else {
            card.innerHTML = `
                ${previewHTML}
                ${metaHTML}
                ${state.isAdmin ? `<button class="edit-meta-btn icon-btn" style="position:absolute;top:5px;right:5px;"><i data-lucide="more-vertical"></i></button>` : ''}
            `;
        }

        // Click behavior: open file info modal (shows bigger preview + details)
        card.addEventListener('click', () => {
            showFileInfo(file, isImage);
        });

        if (state.isAdmin) {
            const editBtn = card.querySelector('.edit-meta-btn');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openMetadataEditor(file);
                });
            }
        }

        grid.appendChild(card);
    });

    // ensure lucide icons are (re)rendered
    createIcons({ icons });
}

/* File info modal: show larger image preview + dimensions or audio details + download action */
function showFileInfo(file, isImage) {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('file-info-modal');
    const body = document.getElementById('info-body');
    const title = document.getElementById('info-title');
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');
    title.innerText = file.title || file.name;

    // clear previous
    body.innerHTML = '';

    if (isImage) {
        // create preview and get dimensions
        const previewWrap = document.createElement('div');
        previewWrap.className = 'file-info-row';
        const left = document.createElement('div');
        left.className = 'file-info-preview';
        const img = document.createElement('img');
        img.src = file.url;
        img.alt = file.title || file.name;
        left.appendChild(img);

        const meta = document.createElement('div');
        meta.className = 'file-info-meta';
        meta.innerHTML = `<div class="info-list"><div class="info-size">Loading dimensions...</div><div>Name: ${file.name}</div><div>Type: ${file.ext.toUpperCase()}</div></div>`;

        const actions = document.createElement('div');
        actions.className = 'info-actions';
        const download = document.createElement('a');
        download.className = 'action-btn';
        download.innerText = 'Download';
        download.href = file.url;
        download.download = file.name;
        actions.appendChild(download);
        meta.appendChild(actions);

        previewWrap.appendChild(left);
        previewWrap.appendChild(meta);
        body.appendChild(previewWrap);

        // measure actual size
        const measureImg = new Image();
        measureImg.onload = () => {
            const sizeNode = meta.querySelector('.info-size');
            sizeNode.innerText = `${measureImg.naturalWidth} x ${measureImg.naturalHeight}`;
        };
        measureImg.src = file.url;

        // clicking the preview opens the full lightbox
        left.addEventListener('click', () => {
            // open the existing lightbox for larger view
            openImageLightbox(file.url, file.title || file.name);
            // hide the info modal
            modal.classList.add('hidden');
        });
    } else {
        // audio file: show quick player, duration, and download
        const audioRow = document.createElement('div');
        audioRow.className = 'file-info-row';
        const left = document.createElement('div');
        left.className = 'file-info-preview';
        left.innerHTML = `<div style="padding:20px;text-align:center;"><i data-lucide="music" style="font-size:48px;"></i></div>`;
        const meta = document.createElement('div');
        meta.className = 'file-info-meta';
        meta.innerHTML = `<div class="info-list"><div>Title: ${file.title || file.name}</div><div>Artist: ${file.artist || 'Unknown'}</div><div>Type: ${file.ext.toUpperCase()}</div><div class="info-duration">Duration: loading…</div></div>`;

        const actions = document.createElement('div');
        actions.className = 'info-actions';
        const playBtn = document.createElement('button');
        playBtn.className = 'action-btn';
        playBtn.innerText = 'Play';
        const download = document.createElement('a');
        download.className = 'action-btn';
        download.innerText = 'Download';
        download.href = file.url;
        download.download = file.name;
        actions.appendChild(playBtn);
        actions.appendChild(download);
        meta.appendChild(actions);

        audioRow.appendChild(left);
        audioRow.appendChild(meta);
        body.appendChild(audioRow);

        // load duration via a temporary audio element
        const tempAudio = document.createElement('audio');
        tempAudio.src = file.url;
        tempAudio.preload = 'metadata';
        tempAudio.onloadedmetadata = () => {
            const durNode = meta.querySelector('.info-duration');
            const sec = Math.floor(tempAudio.duration || 0);
            const m = Math.floor(sec / 60);
            const s = String(sec % 60).padStart(2, '0');
            durNode.innerText = `Duration: ${m}:${s}`;
        };

        playBtn.onclick = () => {
            // use main audio engine for consistent UI
            playTrack(file);
            // keep modal open but allow user to control via player bar
        };
        // render icons inside preview
        createIcons({ icons });
    }

    // close hook for file-info modal
    document.getElementById('close-file-info').onclick = () => {
        modal.classList.add('hidden');
        overlay.classList.add('hidden');
    };

    // clicking overlay closes
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.classList.add('hidden');
            Array.from(overlay.children).forEach(m => m.classList.add('hidden'));
        }
    };

    // re-render icons for any newly-inserted lucide tags
    createIcons({ icons });
}

/* Image lightbox helper */
function openImageLightbox(src, title = '') {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden'); // keep overlay visible so clicking outside closes everything
    const lightbox = document.getElementById('image-lightbox');
    const img = document.getElementById('lightbox-img');
    img.src = src;
    img.alt = title;
    lightbox.classList.remove('hidden');
    // lock scrolling
    document.body.style.overflow = 'hidden';

    // close handlers
    const closeBtn = lightbox.querySelector('.close-lightbox');
    const closeFn = () => {
        lightbox.classList.add('hidden');
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
        img.src = '';
        closeBtn.removeEventListener('click', closeFn);
    };

    closeBtn.addEventListener('click', closeFn);

    // allow clicking overlay outside modals to close lightbox
    overlay.onclick = (e) => {
        // if click landed on overlay (not on any modal), close lightbox
        if (e.target === overlay) closeFn();
    };
}

function playTrack(file) {
    const playerBar = document.getElementById('player-bar');
    playerBar.classList.remove('hidden');
    
    if (state.currentTrack?.id !== file.id) {
        audio.src = file.url;
        state.currentTrack = file;
        document.getElementById('player-title').innerText = file.title || file.name;
        document.getElementById('player-artist').innerText = file.artist || 'Unknown';
        document.getElementById('player-thumb').src = 'https://placehold.co/48x48/000000/FFFFFF?text=' + (file.title?.[0] || 'M');
    }
    
    audio.play();
    state.isPlaying = true;
    updatePlayBtn();
}

function updatePlayBtn() {
    const btn = document.getElementById('play-btn');
    btn.innerHTML = state.isPlaying ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
    createIcons({ icons });
}

/* ---------- Album rendering & utilities ---------- */
function renderAlbums() {
    const list = document.getElementById('album-list');
    if (!list) return;
    list.innerHTML = '';
    // "All" pseudo-entry
    const allBtn = document.createElement('button');
    allBtn.className = 'nav-item';
    allBtn.innerText = 'All Albums';
    allBtn.onclick = () => {
        state.currentAlbum = null;
        renderFiles();
    };
    list.appendChild(allBtn);

    state.albums.forEach(a => {
        const b = document.createElement('button');
        b.className = 'nav-item';
        // create thumbnail if artwork provided
        if (a.artwork) {
            const img = document.createElement('img');
            img.src = a.artwork;
            img.alt = a.name;
            img.style.width = '36px';
            img.style.height = '36px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '6px';
            img.style.marginRight = '8px';
            b.appendChild(img);
        }
        const span = document.createElement('span');
        span.innerText = a.name;
        b.appendChild(span);

        b.onclick = () => {
            // set current album filter
            state.currentAlbum = a.id;
            renderFiles();
        };
        list.appendChild(b);
    });
}

/* ---------- Event listeners ---------- */
// --- EVENT LISTENERS ---
function setupEventListeners() {
    // UI Modals
    const settingsBtn = document.getElementById('settings-btn');
    const overlay = document.getElementById('modal-overlay');
    const settingsModal = document.getElementById('settings-modal');
    
    settingsBtn.onclick = () => {
        overlay.classList.remove('hidden');
        settingsModal.classList.remove('hidden');
    };

    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.classList.add('hidden');
            Array.from(overlay.children).forEach(m => m.classList.add('hidden'));
        }
    };

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => {
            overlay.classList.add('hidden');
            Array.from(overlay.children).forEach(m => m.classList.add('hidden'));
        };
    });

    // Theme Switches
    document.getElementById('light-mode-btn').onclick = () => {
        state.theme.mode = 'light';
        applyTheme(state.theme);
        localStorage.setItem('gallery_theme', JSON.stringify(state.theme));
        document.getElementById('light-mode-btn').classList.add('active');
        document.getElementById('dark-mode-btn').classList.remove('active');
    };

    document.getElementById('dark-mode-btn').onclick = () => {
        state.theme.mode = 'dark';
        applyTheme(state.theme);
        localStorage.setItem('gallery_theme', JSON.stringify(state.theme));
        document.getElementById('dark-mode-btn').classList.add('active');
        document.getElementById('light-mode-btn').classList.remove('active');
    };

    // Secret Admin Login: toggle a simple dropdown for the admin password (no secret code)
    const revealBtn = document.getElementById('reveal-login-btn');
    revealBtn.onclick = () => {
        const login = document.getElementById('login-container');
        if (login.classList.contains('hidden')) {
            login.classList.remove('hidden');
            login.classList.add('show');
            revealBtn.textContent = 'Admin Login ▲';
        } else {
            login.classList.add('hidden');
            login.classList.remove('show');
            revealBtn.textContent = 'Admin Login ▼';
        }
    };

    const loginBtn = document.getElementById('login-btn');
    loginBtn.onclick = () => {
        const passInput = document.getElementById('admin-pass');
        if (passInput.value.trim() === _cfg_token) {
            state.isAdmin = true;
            document.getElementById('admin-controls').classList.remove('hidden');
            document.getElementById('login-container').classList.add('hidden');
            renderFiles();
        } else {
            alert("Incorrect password");
        }
    };

    // allow Enter key to submit password from the password field
    document.getElementById('admin-pass').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });

    // Admin Upload Logic
    const uploadBtn = document.getElementById('upload-btn');
    uploadBtn.onclick = () => {
        settingsModal.classList.add('hidden');
        document.getElementById('upload-modal').classList.remove('hidden');
    };

    /* ---------- View controls (grid / list / details) ---------- */
    const viewGrid = document.getElementById('view-grid');
    const viewList = document.getElementById('view-list');
    const viewDetails = document.getElementById('view-details');
    const thumbSize = document.getElementById('thumb-size');

    // apply initial UI state
    updateViewButtons();

    viewGrid.onclick = () => { setViewMode('grid'); };
    viewList.onclick = () => { setViewMode('list'); };
    viewDetails.onclick = () => { setViewMode('details'); };

    thumbSize.value = state.thumbSize;
    thumbSize.oninput = (e) => {
        const v = parseInt(e.target.value, 10);
        state.thumbSize = v;
        document.documentElement.style.setProperty('--thumb-size', v + 'px');
        localStorage.setItem('gallery_thumbSize', String(v));
    };

    function setViewMode(mode) {
        state.viewMode = mode;
        localStorage.setItem('gallery_viewMode', mode);
        applyViewModeToDOM(mode);
        renderFiles();
        updateViewButtons();
    }

    function updateViewButtons() {
        [viewGrid, viewList, viewDetails].forEach(b => b.classList.remove('active'));
        if (state.viewMode === 'grid') viewGrid.classList.add('active');
        if (state.viewMode === 'list') viewList.classList.add('active');
        if (state.viewMode === 'details') viewDetails.classList.add('active');
    }

    const fileInput = document.getElementById('file-input');
    const startUpload = document.getElementById('start-upload');
    startUpload.onclick = () => {
        const files = Array.from(fileInput.files);
        files.forEach(f => {
            const ext = f.name.split('.').pop().toLowerCase();

            // create a blob/object URL instead of embedding base64 into localStorage
            const blobUrl = URL.createObjectURL(f);

            const newFile = {
                id: Date.now() + Math.random(),
                name: f.name,
                ext: ext,
                url: blobUrl,            // lightweight object URL
                title: f.name,
                artist: 'Unknown',
                album: 'Unknown',
                albumId: null,
                _objectUrl: true        // mark as object URL so we don't try to persist raw binary
            };
            state.files.push(newFile);
            saveState();
            renderFiles();

            // If uploaded file is an image, apply it as page background (uses object URL)
            if (['png','jpg','jpeg'].includes(ext)) {
                document.documentElement.style.setProperty('--page-bg', `url(${blobUrl})`);
            }
        });
        overlay.classList.add('hidden');
    };

    // Player Controls
    document.getElementById('play-btn').onclick = () => {
        if (state.isPlaying) audio.pause();
        else audio.play();
        state.isPlaying = !state.isPlaying;
        updatePlayBtn();
    };

    audio.ontimeupdate = () => {
        const prog = document.getElementById('progress');
        prog.value = (audio.currentTime / audio.duration) * 100 || 0;
    };

    document.getElementById('progress').oninput = (e) => {
        audio.currentTime = (e.target.value / 100) * audio.duration;
    };

    document.getElementById('volume').oninput = (e) => {
        audio.volume = e.target.value;
    };

    // Search
    document.getElementById('search-input').oninput = (e) => {
        const q = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.media-card');
        cards.forEach(c => {
            const text = c.innerText.toLowerCase();
            // respect list/details which use block layout
            c.style.display = text.includes(q) ? '' : 'none';
        });
    };

    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.view = btn.dataset.view;
            // clear album selection when switching main view
            state.currentAlbum = null;
            renderFiles();
        };
    });

    // hook album creation button (supports optional artwork upload)
    const createAlbumBtn = document.getElementById('create-album-btn');

    // create a hidden file input for album artwork selection (images only)
    let albumArtInput = document.getElementById('album-art-input');
    if (!albumArtInput) {
        albumArtInput = document.createElement('input');
        albumArtInput.type = 'file';
        albumArtInput.accept = '.png,.jpg,.jpeg';
        albumArtInput.id = 'album-art-input';
        albumArtInput.style.display = 'none';
        document.body.appendChild(albumArtInput);
    }

    createAlbumBtn.onclick = () => {
        const name = prompt('Album name:');
        if (!name || !name.trim()) return;

        // ask if admin wants to add artwork
        const addArt = confirm('Would you like to add album artwork? (Cancel = no)');
        if (addArt) {
            // when artwork selected, create album with artwork URL
            albumArtInput.onchange = async (e) => {
                const f = e.target.files && e.target.files[0];
                let artworkUrl = null;
                if (f) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        artworkUrl = ev.target.result;
                        const alb = { id: 'alb_' + Date.now(), name: name.trim(), artwork: artworkUrl };
                        state.albums.push(alb);
                        saveState();
                        renderAlbums();
                        // clear input for next use
                        albumArtInput.value = '';
                    };
                    reader.readAsDataURL(f);
                } else {
                    // fallback: create without artwork
                    const alb = { id: 'alb_' + Date.now(), name: name.trim() };
                    state.albums.push(alb);
                    saveState();
                    renderAlbums();
                }
            };
            // trigger file picker
            albumArtInput.click();
        } else {
            const alb = { id: 'alb_' + Date.now(), name: name.trim() };
            state.albums.push(alb);
            saveState();
            renderAlbums();
        }
    };
}

/* helper to apply view mode classes to DOM top-level content area */
function applyViewModeToDOM(mode) {
    const contentArea = document.querySelector('.content-area');
    contentArea.classList.remove('list-view', 'details-view');
    if (mode === 'list') contentArea.classList.add('list-view');
    if (mode === 'details') contentArea.classList.add('details-view');
}

function openMetadataEditor(file) {
    const modal = document.getElementById('metadata-modal');
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');
    
    document.getElementById('meta-title').value = file.title || '';
    document.getElementById('meta-artist').value = file.artist || '';
    document.getElementById('meta-album').value = file.album || '';

    // inject album selector dynamically below existing album input for convenience
    let albumSelect = document.getElementById('meta-album-select');
    if (!albumSelect) {
        albumSelect = document.createElement('select');
        albumSelect.id = 'meta-album-select';
        albumSelect.style.width = '100%';
        albumSelect.style.marginTop = '8px';
        albumSelect.style.padding = '8px';
        const container = document.querySelector('#metadata-modal .modal-body');
        container.querySelector('.form-group:last-child').appendChild(albumSelect);
    }

    // populate album options
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.innerText = 'No album';
    albumSelect.innerHTML = '';
    albumSelect.appendChild(noneOpt);
    state.albums.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.innerText = a.name;
        albumSelect.appendChild(opt);
    });
    albumSelect.value = file.albumId || '';

    document.getElementById('save-metadata').onclick = () => {
        file.title = document.getElementById('meta-title').value;
        file.artist = document.getElementById('meta-artist').value;
        file.album = document.getElementById('meta-album').value;
        const sel = document.getElementById('meta-album-select');
        file.albumId = sel && sel.value ? sel.value : null;
        saveState();
        renderFiles();
        overlay.classList.add('hidden');
        modal.classList.add('hidden');
    };
}

function saveState() {
    try {
        // Try to save the full state first
        localStorage.setItem('gallery_files', JSON.stringify(state.files));
        localStorage.setItem('gallery_albums', JSON.stringify(state.albums));
    } catch (err) {
        // If quota exceeded, attempt a graceful fallback: strip heavy binary/object URLs before retrying.
        if (err && err.name === 'QuotaExceededError' || err instanceof DOMException) {
            console.warn('LocalStorage quota exceeded. Falling back to lightweight state save.');

            // Create lightweight copies that remove large data (object URLs / data URLs)
            const lightweightFiles = state.files.map(f => {
                // keep metadata but avoid persisting actual blob/object URLs
                const copy = {
                    id: f.id,
                    name: f.name,
                    ext: f.ext,
                    url: null,          // drop the heavy URL reference so it won't blow quota
                    title: f.title,
                    artist: f.artist,
                    album: f.album,
                    albumId: f.albumId
                };
                return copy;
            });

            try {
                localStorage.setItem('gallery_files', JSON.stringify(lightweightFiles));
                localStorage.setItem('gallery_albums', JSON.stringify(state.albums));
                // Informive flag (optional) so UI can warn user later if needed
                localStorage.setItem('gallery_save_mode', 'lightweight');
            } catch (err2) {
                console.error('Failed lightweight save to localStorage', err2);
                // As a last resort, clear files from storage to avoid repeated failures
                try { localStorage.removeItem('gallery_files'); } catch(e){}
            }
        } else {
            console.error('Failed saving state:', err);
        }
    }
}