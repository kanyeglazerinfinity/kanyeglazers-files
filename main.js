import { createIcons, icons } from 'lucide';

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    createIcons({ icons });
    init();
});

const state = {
    files: JSON.parse(localStorage.getItem('gallery_files') || '[]'),
    view: 'all'
};

const audio = new Audio();

// --- INIT APP ---
function init() {
    renderFiles();
    setupEvents();
}

// --- FILE HANDLER ---
function handleFiles(files) {
    files.forEach(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        const url = URL.createObjectURL(file);

        const newFile = {
            id: Date.now() + Math.random(),
            name: file.name,
            ext,
            url,

            // metadata
            title: file.name.replace(/\.[^/.]+$/, ""),
            artist: "Unknown",
            album: "Unknown",
            size: file.size,
            type: file.type,
            created: new Date().toISOString(),
            duration: null,
            dimensions: null,

            _objectUrl: true
        };

        state.files.push(newFile);

        // detect metadata
        if (isImage(ext)) {
            const img = new Image();
            img.onload = () => {
                newFile.dimensions = `${img.naturalWidth}x${img.naturalHeight}`;
                save();
            };
            img.src = url;
        }

        if (isAudio(ext)) {
            const a = document.createElement('audio');
            a.src = url;
            a.onloadedmetadata = () => {
                newFile.duration = Math.floor(a.duration);
                save();
            };
        }
    });

    save();
    renderFiles();
}

// --- HELPERS ---
const isImage = (ext) => ['png','jpg','jpeg'].includes(ext);
const isAudio = (ext) => ['mp3','wav','flac','m4a'].includes(ext);

// --- RENDER ---
function renderFiles() {
    const grid = document.getElementById('media-grid');
    grid.innerHTML = '';

    state.files.forEach(file => {
        const card = document.createElement('div');
        card.className = 'media-card';

        const preview = isImage(file.ext)
            ? `<img src="${file.url}">`
            : `<div class="file-icon"><i data-lucide="music"></i></div>`;

        card.innerHTML = `
            ${preview}
            <div class="title">${file.title}</div>
            <div class="subtitle">${file.artist}</div>
            <button class="edit-btn"><i data-lucide="edit"></i></button>
        `;

        card.onclick = () => openViewer(file);

        card.querySelector('.edit-btn').onclick = (e) => {
            e.stopPropagation();
            editMetadata(file);
        };

        grid.appendChild(card);
    });

    createIcons({ icons });
}

// --- VIEWER ---
function openViewer(file) {
    if (isImage(file.ext)) {
        openImage(file);
    } else {
        playAudio(file);
    }
}

function openImage(file) {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('modal-img');

    img.src = file.url;
    modal.classList.remove('hidden');
}

function playAudio(file) {
    audio.src = file.url;
    audio.play();

    document.getElementById('player').classList.remove('hidden');
    document.getElementById('track-title').innerText = file.title;
}

// --- METADATA EDIT ---
function editMetadata(file) {
    const title = prompt("Title:", file.title);
    if (title !== null) file.title = title;

    const artist = prompt("Artist:", file.artist);
    if (artist !== null) file.artist = artist;

    save();
    renderFiles();
}

// --- SAVE ---
function save() {
    localStorage.setItem('gallery_files', JSON.stringify(state.files));
}

// --- EVENTS ---
function setupEvents() {

    // drag & drop
    document.body.addEventListener('dragover', e => e.preventDefault());

    document.body.addEventListener('drop', e => {
        e.preventDefault();
        handleFiles([...e.dataTransfer.files]);
    });

    // double click upload
    document.body.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;

        input.onchange = () => handleFiles([...input.files]);
        input.click();
    });

    // close modal
    document.getElementById('image-modal').onclick = () => {
        document.getElementById('image-modal').classList.add('hidden');
    };
}
