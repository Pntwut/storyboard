/* ══════════════════════════════════════════
   StoryFrame — app.js
   ══════════════════════════════════════════ */

/* ── Constants ── */
const LS_KEY     = 'storyframe_data';
const CAMERA_TAGS = ['CU', 'WS', 'MS', 'OTS', 'POV', 'ECU', 'LS', 'MCU'];

/* ── State ── */
let frames        = [];
let dragSrcIdx    = null;
let currentRatio  = 'ratio-film';
let currentCardSize = 380;
let saveTimer     = null;

/* ── DOM refs ── */
const board = document.getElementById('board');


/* ════════════════════════════════════════════
   UTILS
   ════════════════════════════════════════════ */

function genId() {
  return 'f' + Date.now() + Math.random().toString(36).slice(2, 6);
}

function escHtml(s) {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/* ════════════════════════════════════════════
   FRAME MANAGEMENT
   ════════════════════════════════════════════ */

function addFrame(data) {
  const frame = data || {
    id:       genId(),
    scene:    '',
    imageData: null,
    dialogue: '',
    desc:     '',
    camera:   [],
    duration: 3,
  };
  if (!data) frames.push(frame);
  renderAll();
}

function deleteFrame(id) {
  frames = frames.filter(f => f.id !== id);
  renderAll();
}

function duplicateFrame(id) {
  const original = frames.find(f => f.id === id);
  if (!original) return;
  const copy = { ...JSON.parse(JSON.stringify(original)), id: genId() };
  const idx = frames.findIndex(f => f.id === id);
  frames.splice(idx + 1, 0, copy);
  renderAll();
}

function moveFrame(id, dir) {
  const idx    = frames.findIndex(f => f.id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= frames.length) return;
  [frames[idx], frames[newIdx]] = [frames[newIdx], frames[idx]];
  renderAll();
}

function updateField(id, field, value) {
  const frame = frames.find(f => f.id === id);
  if (!frame) return;
  frame[field] = value;
  if (field === 'duration') updateDuration();
  scheduleSave();
}

function toggleCamera(id, tag, el) {
  const frame = frames.find(f => f.id === id);
  if (!frame) return;
  if (frame.camera.includes(tag)) {
    frame.camera = frame.camera.filter(t => t !== tag);
    el.classList.remove('active');
  } else {
    frame.camera.push(tag);
    el.classList.add('active');
  }
  scheduleSave();
}


/* ════════════════════════════════════════════
   IMAGE HANDLING
   ════════════════════════════════════════════ */

function triggerUpload(id, area) {
  area.querySelector('input[type=file]').click();
}

function loadImage(id, input) {
  const file = input.files[0];
  if (file) readImage(id, file);
}

function readImage(id, file) {
  const reader = new FileReader();
  reader.onload = e => {
    updateField(id, 'imageData', e.target.result);
    renderAll();
  };
  reader.readAsDataURL(file);
}


/* ════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════ */

function renderAll() {
  board.innerHTML = '';
  frames.forEach((frame, i) => board.appendChild(createCard(frame, i)));

  // Add frame button
  const addBtn = document.createElement('button');
  addBtn.id = 'add-frame-btn';
  addBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    <span>เพิ่มเฟรมใหม่</span>
  `;
  addBtn.onclick = () => addFrame();
  board.appendChild(addBtn);

  document.getElementById('frame-count').textContent = frames.length + ' เฟรม';
  updateDuration();
  scheduleSave();
}

function createCard(f, i) {
  const card = document.createElement('div');
  card.className   = 'frame-card';
  card.dataset.id  = f.id;
  card.dataset.idx = i;
  card.draggable   = true;

  // Drag events
  card.addEventListener('dragstart', e => {
    dragSrcIdx = i;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend',   () => card.classList.remove('dragging'));
  card.addEventListener('dragover',  e => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (dragSrcIdx === null || dragSrcIdx === i) return;
    const moved = frames.splice(dragSrcIdx, 1)[0];
    frames.splice(i, 0, moved);
    dragSrcIdx = null;
    renderAll();
  });

  card.innerHTML = `
    <div class="frame-header">
      <span class="frame-number">FRAME ${String(i + 1).padStart(2, '0')}</span>
      <div class="frame-actions">
        <button class="icon-btn" title="ทำสำเนา"  onclick="duplicateFrame('${f.id}')">⧉</button>
        <button class="icon-btn" title="ขึ้นก่อน"  onclick="moveFrame('${f.id}', -1)">↑</button>
        <button class="icon-btn" title="ลงหลัง"   onclick="moveFrame('${f.id}', 1)">↓</button>
        <button class="icon-btn red" title="ลบ"   onclick="deleteFrame('${f.id}')">✕</button>
      </div>
    </div>

    <div class="frame-scene-label">
      <input type="text"
        placeholder="ชื่อฉาก / Scene label"
        value="${escHtml(f.scene)}"
        onchange="updateField('${f.id}', 'scene', this.value)">
    </div>

    <div class="frame-image-area ${currentRatio}" onclick="triggerUpload('${f.id}', this)">
      ${f.imageData
        ? `<img src="${f.imageData}" alt="frame">`
        : `<div class="upload-prompt">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <p>คลิกเพื่ออัปโหลดรูปภาพ<br>หรือลากไฟล์มาวาง</p>
          </div>`
      }
      <div class="upload-overlay"><span>เปลี่ยนรูปภาพ</span></div>
      <input type="file" accept="image/*" onchange="loadImage('${f.id}', this)">
    </div>

    <div class="frame-body">
      <div class="field-label">บทพูด / Dialogue</div>
      <textarea class="dialogue"
        placeholder='"บทพูดของตัวละคร..."'
        onchange="updateField('${f.id}', 'dialogue', this.value)">${escHtml(f.dialogue)}</textarea>

      <div class="field-label" style="margin-top:8px;">คำบรรยาย / Action</div>
      <textarea class="desc"
        placeholder="อธิบายภาพ, การเคลื่อนไหว, แสง..."
        onchange="updateField('${f.id}', 'desc', this.value)">${escHtml(f.desc)}</textarea>

      <div class="field-label" style="margin-top:8px;">Camera Shot</div>
      <div class="camera-notes" id="cam-${f.id}">
        ${CAMERA_TAGS.map(t =>
          `<span class="camera-tag${f.camera.includes(t) ? ' active' : ''}"
            onclick="toggleCamera('${f.id}', '${t}', this)">${t}</span>`
        ).join('')}
      </div>

      <div class="duration-row">
        <label>⏱ ระยะเวลา</label>
        <input type="number" min="1" max="999"
          value="${f.duration}"
          onchange="updateField('${f.id}', 'duration', +this.value)">
        <label>วินาที</label>
      </div>
    </div>
  `;

  // Image drag-and-drop
  const imgArea = card.querySelector('.frame-image-area');
  imgArea.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  imgArea.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) readImage(f.id, file);
  });

  return card;
}


/* ════════════════════════════════════════════
   TOOLBAR CONTROLS
   ════════════════════════════════════════════ */

function setCols(n) {
  board.style.gridTemplateColumns = ''; // clear slider override
  board.className = 'cols-' + n;
  scheduleSave();
}

function setRatio(r) {
  currentRatio = r;
  renderAll();
}

function setCardSize(px) {
  px = Number(px);
  board.style.gridTemplateColumns = `repeat(auto-fill, minmax(${px}px, 1fr))`;
  document.getElementById('card-size-label').textContent = px + 'px';
  // sync slider in case called from loadFromLocal
  const slider = document.getElementById('card-size');
  if (slider) slider.value = px;
  scheduleSave();
}

function updateDuration() {
  const total = frames.reduce((sum, f) => sum + (Number(f.duration) || 0), 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  document.getElementById('total-duration').textContent =
    m > 0 ? `รวม: ${m}น ${s}ว` : `รวม: ${total} วิ`;
}


/* ════════════════════════════════════════════
   LOCAL STORAGE — Auto Save
   ════════════════════════════════════════════ */

function scheduleSave() {
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToLocal, 800);
}

function saveToLocal() {
  const data = {
    title:    document.getElementById('project-title').value,
    frames,
    ratio:    currentRatio,
    cols:     document.getElementById('col-select').value,
    cardSize: Number(document.getElementById('card-size').value),
    savedAt:  new Date().toISOString(),
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    setSaveStatus('saved');
  } catch (e) {
    setSaveStatus('error');
  }
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.title)  document.getElementById('project-title').value = data.title;
    if (data.frames?.length) frames = data.frames;
    if (data.ratio) {
      currentRatio = data.ratio;
      document.getElementById('ratio-select').value = data.ratio;
    }
    if (data.cols) {
      document.getElementById('col-select').value = data.cols;
      board.className = 'cols-' + data.cols;
    }
    if (data.cardSize) {
      setCardSize(data.cardSize);
    }
    return true;
  } catch (e) {
    return false;
  }
}

function clearLocalData() {
  if (!confirm('ล้างข้อมูลที่บันทึกไว้ทั้งหมด และเริ่มใหม่ใช่ไหมครับ?')) return;
  localStorage.removeItem(LS_KEY);
  frames = [];
  document.getElementById('project-title').value = 'ชื่อโปรเจกต์';
  loadDefaults();
}

function setSaveStatus(status) {
  const dot   = document.getElementById('save-dot');
  const label = document.getElementById('save-label');
  if (status === 'saved') {
    dot.style.background = '#4caf50';
    const now = new Date();
    label.textContent = `บันทึกแล้ว ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  } else if (status === 'saving') {
    dot.style.background = 'var(--accent2)';
    label.textContent = 'กำลังบันทึก...';
  } else {
    dot.style.background = 'var(--danger)';
    label.textContent = 'บันทึกไม่ได้';
  }
}


/* ════════════════════════════════════════════
   EXPORT / IMPORT
   ════════════════════════════════════════════ */

function openExport()  { document.getElementById('export-overlay').classList.add('open'); }
function closeExport() { document.getElementById('export-overlay').classList.remove('open'); }

/* Export JSON */
function exportJSON() {
  const data = { title: document.getElementById('project-title').value, frames };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (data.title || 'storyboard') + '.json';
  a.click();
}

/* Import JSON */
function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.title)  document.getElementById('project-title').value = data.title;
      if (data.frames) { frames = data.frames; renderAll(); }
    } catch {
      alert('ไฟล์ไม่ถูกต้อง');
    }
  };
  reader.readAsText(file);
  closeExport();
}

/* Print */
function exportPrint() {
  closeExport();
  const title     = document.getElementById('project-title').value;
  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <h1 style="font-family:serif;margin-bottom:20px;">${escHtml(title)}</h1>
    ${frames.map((f, i) => `
      <div class="print-frame" style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:16px;display:flex;gap:16px;">
        <div style="flex:0 0 280px;">
          ${f.imageData
            ? `<img src="${f.imageData}" style="width:100%;border-radius:4px;">`
            : `<div style="width:100%;aspect-ratio:16/9;background:#eee;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px;">ไม่มีรูปภาพ</div>`
          }
        </div>
        <div style="flex:1;">
          <div style="font-family:monospace;font-size:11px;color:#999;">FRAME ${String(i + 1).padStart(2, '0')} ${f.scene ? '· ' + f.scene : ''}</div>
          ${f.camera.length ? `<div style="margin-top:4px;font-size:11px;color:#555;">${f.camera.join(' · ')}</div>` : ''}
          ${f.dialogue ? `<blockquote style="border-left:2px solid #aaa;padding-left:8px;margin:8px 0;font-style:italic;font-size:13px;">"${escHtml(f.dialogue)}"</blockquote>` : ''}
          ${f.desc ? `<p style="font-size:12px;color:#444;line-height:1.6;">${escHtml(f.desc)}</p>` : ''}
          <p style="font-size:11px;color:#999;margin-top:6px;">⏱ ${f.duration} วินาที</p>
        </div>
      </div>
    `).join('')}
  `;
  setTimeout(() => window.print(), 100);
}

/* Export PDF */
async function exportPDF() {
  closeExport();
  const title    = document.getElementById('project-title').value || 'storyboard';
  const { jsPDF } = window.jspdf;
  const pdf      = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pw       = pdf.internal.pageSize.getWidth();
  const ph       = pdf.internal.pageSize.getHeight();
  const cols     = 2;
  const margin   = 10;
  const colW     = (pw - margin * (cols + 1)) / cols;
  const imgH     = colW * 9 / 16;
  const rowH     = imgH + 38;

  // Cover page background
  pdf.setFillColor(13, 13, 13);
  pdf.rect(0, 0, pw, ph, 'F');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(232, 213, 163);
  pdf.text(title, margin, 12);
  pdf.setFontSize(8);
  pdf.setTextColor(90, 84, 80);
  pdf.text(`${frames.length} frames · Total: ${frames.reduce((s, f) => s + f.duration, 0)}s`, margin, 18);

  let startY = 22;

  for (let i = 0; i < frames.length; i++) {
    const col = i % cols;
    const x   = margin + col * (colW + margin);
    const row = Math.floor(i / cols);
    const y   = startY + row * (rowH + 8);

    if (y + rowH > ph - margin) {
      pdf.addPage();
      pdf.setFillColor(13, 13, 13);
      pdf.rect(0, 0, pw, ph, 'F');
      startY = margin;
    }

    const fy = startY + (Math.floor(i / cols) % Math.floor((ph - startY - margin) / (rowH + 8))) * (rowH + 8);
    const f  = frames[i];

    pdf.setFillColor(22, 22, 22);
    pdf.roundedRect(x, fy, colW, rowH, 2, 2, 'F');
    pdf.setDrawColor(46, 46, 46);
    pdf.roundedRect(x, fy, colW, rowH, 2, 2, 'S');

    if (f.imageData) {
      try { pdf.addImage(f.imageData, 'JPEG', x, fy, colW, imgH); } catch (e) {}
    } else {
      pdf.setFillColor(31, 31, 31);
      pdf.rect(x, fy, colW, imgH, 'F');
    }

    const textY = fy + imgH + 5;

    pdf.setFontSize(7);
    pdf.setTextColor(90, 84, 80);
    pdf.setFont('helvetica', 'normal');
    pdf.text(
      `FRAME ${String(i + 1).padStart(2, '0')}${f.scene ? '  ·  ' + f.scene : ''}${f.camera.length ? '  ·  ' + f.camera.join(' ') : ''}`,
      x + 2, textY
    );

    if (f.dialogue) {
      pdf.setFontSize(8);
      pdf.setTextColor(200, 185, 145);
      pdf.setFont('helvetica', 'italic');
      const lines = pdf.splitTextToSize(`"${f.dialogue}"`, colW - 4);
      pdf.text(lines.slice(0, 2), x + 2, textY + 5);
    }

    if (f.desc) {
      pdf.setFontSize(7.5);
      pdf.setTextColor(160, 152, 144);
      pdf.setFont('helvetica', 'normal');
      const lines = pdf.splitTextToSize(f.desc, colW - 4);
      pdf.text(lines.slice(0, 2), x + 2, textY + (f.dialogue ? 14 : 5));
    }

    pdf.setFontSize(7);
    pdf.setTextColor(60, 58, 56);
    pdf.text(`⏱ ${f.duration}s`, x + colW - 14, fy + rowH - 3);
  }

  pdf.save(title + '.pdf');
}


/* ════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════ */

function loadDefaults() {
  addFrame({ id: genId(), scene: 'Opening', imageData: null, dialogue: '',                              desc: 'กล้องค่อยๆ ซูมออกจากฉากเปิดเรื่อง',          camera: ['WS'],         duration: 4 });
  addFrame({ id: genId(), scene: 'Intro',   imageData: null, dialogue: '"เราจะเริ่มต้นใหม่อีกครั้ง"', desc: 'ตัดภาพมาที่ใบหน้าตัวละครหลัก',              camera: ['MCU'],        duration: 3 });
  addFrame({ id: genId(), scene: 'Action',  imageData: null, dialogue: '',                              desc: 'ตัวละครหยิบสิ่งของขึ้นมา — แสงจากหน้าต่าง', camera: ['CU', 'OTS'],  duration: 5 });
}

// Listen for project title changes
document.getElementById('project-title').addEventListener('input', scheduleSave);

// Boot
const loaded = loadFromLocal();
if (loaded && frames.length) {
  renderAll();
  setSaveStatus('saved');
} else {
  loadDefaults();
}
