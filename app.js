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
let compactView = false;
let saveTimer     = null;
let storageLoadFailed = false;

/* ── DOM refs ── */
const board = document.getElementById('board');


/* ════════════════════════════════════════════
   UTILS
   ════════════════════════════════════════════ */


function normalizeFrame(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid frame');
  return {
    ...data,
    id: typeof data.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(data.id) ? data.id : genId(),
    scene: String(data.scene ?? ''), dialogue: String(data.dialogue ?? ''),
    desc: String(data.desc ?? ''), imagePrompt: String(data.imagePrompt ?? ''),
    videoPrompt: String(data.videoPrompt ?? ''), cameraMovement: String(data.cameraMovement ?? ''),
    imageData: typeof data.imageData === 'string' ? data.imageData : null,
    camera: Array.isArray(data.camera) ? data.camera.map(String) : [],
    duration: validDuration(data.duration),
  };
}
function validDuration(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 3;
}
function normalizeFrames(items) {
  if (!Array.isArray(items)) throw new Error('Invalid frames');
  const ids = new Set();
  return items.map(item => {
    const frame = normalizeFrame(item);
    if (ids.has(frame.id)) frame.id = genId();
    ids.add(frame.id);
    return frame;
  });
}
function ratioValue() {
  return ({'ratio-film':16/9, 'ratio-square':1, 'ratio-vertical':9/16, 'ratio-classic':4/3})[currentRatio] || 16/9;
}
async function copyPrompt(id, field, button) {
  const value = frames.find(f => f.id === id)?.[field] || '';
  const label = field === 'imagePrompt' ? 'คัดลอก Image Prompt' : 'คัดลอก Video Prompt';
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = 'คัดลอกแล้ว ✓';
    button.setAttribute('aria-live', 'polite');
    setTimeout(() => button.textContent = label, 1500);
  } catch {
    window.prompt(`คัดลอก ${field === 'imagePrompt' ? 'Image Prompt' : 'Video Prompt'}`, value);
  }
}

function genId() {
  return 'f' + Date.now() + Math.random().toString(36).slice(2, 6);
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/* ════════════════════════════════════════════
   FRAME MANAGEMENT
   ════════════════════════════════════════════ */

function addFrame(data) {
  const frame = normalizeFrame(data || {});
  frames.push(frame);
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
  frame[field] = field === 'duration' ? validDuration(value) : value;
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
  el.setAttribute('aria-pressed', frame.camera.includes(tag));
  updateCameraSummary(id);
  scheduleSave();
}

function updateCameraSummary(id) {
  const frame = frames.find(f => f.id === id);
  const summary = document.getElementById(`camera-summary-${id}`);
  if (!frame || !summary) return;
  const selections = [...frame.camera, frame.cameraMovement].filter(Boolean);
  summary.textContent = selections.length ? selections.join(' · ') : 'ยังไม่ได้ตั้งค่า';
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

function removeImage(id) {
  updateField(id, 'imageData', null);
  renderAll();
}

// Paste image from clipboard (Ctrl+V anywhere on page)
document.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;

  // Find image item
  const imageItem = Array.from(items).find(item => item.type.startsWith('image/'));
  if (!imageItem) return;

  const file = imageItem.getAsFile();
  if (!file) return;

  // If preview is open — ignore
  if (document.getElementById('preview-overlay').classList.contains('open')) return;

  // Find which frame card is focused/hovered, fallback to last frame
  const hovered = document.querySelector('.frame-card:hover');
  let targetId = null;

  if (hovered) {
    targetId = hovered.dataset.id;
  } else if (frames.length > 0) {
    // paste into last frame that has no image, or just the last frame
    const empty = frames.find(f => !f.imageData);
    targetId = empty ? empty.id : frames[frames.length - 1].id;
  }

  if (!targetId) return;
  showPasteToast(targetId);
  readImage(targetId, file);
});

function showPasteToast(id) {
  const existing = document.getElementById('paste-toast');
  if (existing) existing.remove();

  const frame = frames.find(f => f.id === id);
  const idx   = frames.findIndex(f => f.id === id);
  const toast = document.createElement('div');
  toast.id = 'paste-toast';
  toast.textContent = `📋 วางรูปในเฟรม ${String(idx + 1).padStart(2, '0')}${frame?.scene ? ' · ' + frame.scene : ''}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
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
  card.classList.toggle('vertical-frame', currentRatio === 'ratio-vertical');
  card.dataset.id  = f.id;
  card.dataset.idx = i;
  card.draggable   = true;

  // Drag events
  card.addEventListener('dragstart', e => {
    dragSrcIdx = i;
    if (e.target.closest('input, textarea, button') || document.activeElement?.matches('input, textarea')) { e.preventDefault(); return; }
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend',   () => { card.classList.remove('dragging'); dragSrcIdx = null; });
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
      <span class="compact-duration">⏱ ${f.duration}s</span>
      <div class="frame-actions">
        <button class="icon-btn" type="button" title="ทำสำเนา" aria-label="ทำสำเนาเฟรม ${i + 1}" onclick="duplicateFrame('${f.id}')">⧉</button>
        <button class="icon-btn" type="button" title="ขึ้นก่อน" aria-label="ย้ายเฟรม ${i + 1} ขึ้นก่อน" onclick="moveFrame('${f.id}', -1)">↑</button>
        <button class="icon-btn" type="button" title="ลงหลัง" aria-label="ย้ายเฟรม ${i + 1} ลงหลัง" onclick="moveFrame('${f.id}', 1)">↓</button>
        <button class="icon-btn red" type="button" title="ลบ" aria-label="ลบเฟรม ${i + 1}" onclick="deleteFrame('${f.id}')">✕</button>
      </div>
    </div>

    <div class="frame-scene-label">
      <input type="text"
        placeholder="ชื่อฉาก / Scene label"
        value="${escHtml(f.scene)}"
        oninput="updateField('${f.id}', 'scene', this.value)">
    </div>

    <div class="frame-image-area ${currentRatio}" ${!f.imageData ? `onclick="triggerUpload('${f.id}', this)"` : ''}>
      ${f.imageData
        ? `<img src="${escHtml(f.imageData)}" alt="frame">
           <div class="image-action-overlay">
             <button class="img-action-btn" onclick="triggerUpload('${f.id}', this.closest('.frame-image-area'))">🔄 เปลี่ยน</button>
             <button class="img-action-btn danger" onclick="removeImage('${f.id}')">🗑 ลบ</button>
           </div>`
        : `<div class="upload-prompt">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <p>คลิกเพื่ออัปโหลดรูปภาพ<br>หรือลากไฟล์มาวาง</p>
          </div>`
      }
      <input type="file" onclick="event.stopPropagation()" accept="image/*" onchange="loadImage('${f.id}', this)" style="display:none;">
    </div>

    <div class="frame-body">
      <div class="field-label">บทพูด / Dialogue</div>
      <textarea class="dialogue"
        placeholder='"บทพูดของตัวละคร..."'
        oninput="updateField('${f.id}', 'dialogue', this.value)">${escHtml(f.dialogue)}</textarea>

      <div class="field-label" style="margin-top:8px;">คำอธิบายฉาก / Action</div>
      <textarea class="desc"
        placeholder="อธิบายภาพ, การเคลื่อนไหว, แสง..."
        oninput="updateField('${f.id}', 'desc', this.value)">${escHtml(f.desc)}</textarea>

      <details class="camera-details">
        <summary>
          <span>รายละเอียดกล้อง</span>
          <span class="camera-summary-value" id="camera-summary-${f.id}">${escHtml([...f.camera, f.cameraMovement].filter(Boolean).join(' · ') || 'ยังไม่ได้ตั้งค่า')}</span>
        </summary>
        <div class="field-label">Camera Shot</div>
        <div class="camera-notes" id="cam-${f.id}">
          ${CAMERA_TAGS.map(t =>
            `<button type="button" aria-pressed="${f.camera.includes(t)}" class="camera-tag${f.camera.includes(t) ? ' active' : ''}"
              onclick="toggleCamera('${f.id}', '${t}', this)">${t}</button>`
          ).join('')}
        </div>
        <label class="field-label camera-movement-label" for="cameraMovement-${f.id}">Camera Movement</label>
        <textarea class="desc" id="cameraMovement-${f.id}"
          oninput="updateField('${f.id}', 'cameraMovement', this.value); updateCameraSummary('${f.id}')">${escHtml(f.cameraMovement)}</textarea>
      </details>

      ${['imagePrompt', 'videoPrompt'].map((field, index) => `
        <label class="field-label prompt-label" for="${field}-${f.id}">${['Image Prompt', 'Video Prompt'][index]}</label>
        <textarea class="desc" id="${field}-${f.id}"
          oninput="updateField('${f.id}', '${field}', this.value)">${escHtml(f[field])}</textarea>
        ${index < 2 ? `<button class="btn copy-prompt" aria-label="คัดลอก ${['Image Prompt', 'Video Prompt'][index]}" onclick="copyPrompt('${f.id}', '${field}', this)">คัดลอก ${['Image Prompt', 'Video Prompt'][index]}</button>` : ''}
      `).join('')}
      <div class="duration-row">
        <label>⏱ ระยะเวลา</label>
        <input type="number" min="0.1" max="999" step="0.1"
          value="${f.duration}"
          oninput="updateField('${f.id}', 'duration', +this.value)">
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
  board.style.gridTemplateColumns = '';
  board.classList.remove('cols-2', 'cols-3', 'cols-4');
  board.classList.add('cols-' + n);
  scheduleSave();
}

function setRatio(r) {
  currentRatio = r;
  renderAll();
}

function setCardSize(px) {
  px = Number(px);
  board.style.gridTemplateColumns = `repeat(auto-fill, minmax(min(100%, ${px}px), 1fr))`;
  document.getElementById('card-size-label').textContent = px + 'px';
  // sync slider in case called from loadFromLocal
  const slider = document.getElementById('card-size');
  if (slider) slider.value = px;
  scheduleSave();
}

function toggleCompactView() {
  compactView = !compactView;
  board.classList.toggle('board-compact', compactView);
  const button = document.getElementById('toggle-compact-view');
  button.setAttribute('aria-pressed', String(compactView));
  button.textContent = compactView ? '▤ ออกจากมุมมองย่อ' : '▤ มุมมองย่อ';
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
  if (storageLoadFailed) { setSaveStatus('error'); return; }
  const data = {
    title:    document.getElementById('project-title').value,
    frames,
    ratio:    currentRatio,
    cols:     document.getElementById('col-select').value,
    cardSize: Number(document.getElementById('card-size').value),
    compactView,
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
    if (data.title !== undefined) document.getElementById('project-title').value = String(data.title);
    frames = normalizeFrames(data.frames);
    if (['ratio-film', 'ratio-classic', 'ratio-square', 'ratio-vertical'].includes(data.ratio)) {
      currentRatio = data.ratio;
      document.getElementById('ratio-select').value = data.ratio;
    }
    if (data.cols) {
      document.getElementById('col-select').value = data.cols;
      board.classList.remove('cols-2', 'cols-3', 'cols-4');
      board.classList.add('cols-' + data.cols);
    }
    if (data.cardSize) {
      setCardSize(data.cardSize);
    }
    if (data.compactView === true) {
      compactView = true;
      board.classList.add('board-compact');
      const button = document.getElementById('toggle-compact-view');
      button.setAttribute('aria-pressed', 'true');
      button.textContent = '▤ ออกจากมุมมองย่อ';
    }
    return true;
  } catch (e) {
    storageLoadFailed = true;
    alert('อ่านข้อมูลเดิมไม่สำเร็จ ระบบจะไม่เขียนทับข้อมูลเดิม กรุณาสำรองข้อมูลก่อน');
    return false;
  }
}

function clearLocalData() {
  if (!confirm('ล้างข้อมูลที่บันทึกไว้ทั้งหมด และเริ่มใหม่ใช่ไหมครับ?')) return;
  storageLoadFailed = false;
  localStorage.removeItem(LS_KEY);
  frames = [];
  document.getElementById('project-title').value = 'ชื่อโปรเจกต์';
  loadDefaults();
}

function setSaveStatus(status) {
  const dot   = document.getElementById('save-dot');
  const label = document.getElementById('save-label');
  const indicator = document.getElementById('save-indicator');
  indicator.dataset.state = status;
  if (status === 'saved') {
    dot.style.background = '#4caf50';
    const now = new Date();
    label.textContent = `บันทึกแล้ว ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    indicator.title = 'ข้อมูลถูกบันทึกไว้ในอุปกรณ์นี้แล้ว';
  } else if (status === 'saving') {
    dot.style.background = 'var(--accent2)';
    label.textContent = 'กำลังบันทึก...';
    indicator.title = 'กำลังบันทึกการเปลี่ยนแปลง';
  } else {
    dot.style.background = 'var(--danger)';
    label.textContent = 'บันทึกไม่ได้';
    indicator.title = 'บันทึกข้อมูลในอุปกรณ์นี้ไม่สำเร็จ';
  }
}


/* ════════════════════════════════════════════
   EXPORT / IMPORT
   ════════════════════════════════════════════ */

function openExport()  { document.getElementById('export-overlay').classList.add('open'); }
function closeExport() { document.getElementById('export-overlay').classList.remove('open'); }

/* Export JSON */
function exportJSON() {
  saveToLocal();
  const data = { title: document.getElementById('project-title').value, frames, ratio: currentRatio, cols: document.getElementById('col-select').value, cardSize: Number(document.getElementById('card-size').value), compactView };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (data.title || 'storyboard') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* Import JSON */
function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const imported = normalizeFrames(data.frames);
      if (data.title !== undefined) document.getElementById('project-title').value = String(data.title);
      frames = imported;
      if (['ratio-film', 'ratio-classic', 'ratio-square', 'ratio-vertical'].includes(data.ratio)) {
        currentRatio = data.ratio;
        document.getElementById('ratio-select').value = currentRatio;
      }
      if (['2', '3', '4'].includes(String(data.cols))) {
        document.getElementById('col-select').value = data.cols;
        setCols(data.cols);
      }
      if (Number(data.cardSize) >= 200 && Number(data.cardSize) <= 600) setCardSize(data.cardSize);
      compactView = data.compactView === true;
      board.classList.toggle('board-compact', compactView);
      const compactButton = document.getElementById('toggle-compact-view');
      compactButton.setAttribute('aria-pressed', String(compactView));
      compactButton.textContent = compactView ? '▤ ออกจากมุมมองย่อ' : '▤ มุมมองย่อ';
      renderAll();
      saveToLocal();
    } catch {
      alert('ไฟล์ไม่ถูกต้อง');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
  closeExport();
}

/* Print */
async function exportPrint() {
  closeExport();
  const title     = document.getElementById('project-title').value;
  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <h1 style="font-family:serif;margin-bottom:20px;">${escHtml(title)}</h1>
    ${frames.map((f, i) => `
      <div class="print-frame" style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:16px;display:flex;gap:16px;">
        <div style="flex:0 0 280px;">
          ${f.imageData
            ? `<img src="${escHtml(f.imageData)}" style="width:100%;border-radius:4px;">`
            : `<div style="width:100%;aspect-ratio:${ratioValue()};background:#eee;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px;">ไม่มีรูปภาพ</div>`
          }
        </div>
        <div style="flex:1;">
          <div style="font-family:monospace;font-size:11px;color:#999;">FRAME ${String(i + 1).padStart(2, '0')} ${f.scene ? '· ' + escHtml(f.scene) : ''}</div>
          ${f.camera.length ? `<div style="margin-top:4px;font-size:11px;color:#555;">${escHtml(f.camera.join(' · '))}</div>` : ''}
          ${f.dialogue ? `<blockquote style="border-left:2px solid #aaa;padding-left:8px;margin:8px 0;font-style:italic;font-size:13px;">"${escHtml(f.dialogue)}"</blockquote>` : ''}
          ${f.desc ? `<p style="font-size:12px;color:#444;line-height:1.6;">${escHtml(f.desc)}</p>` : ''}
${[['Image Prompt', f.imagePrompt], ['Video Prompt', f.videoPrompt], ['Camera Movement', f.cameraMovement]].filter(([,v]) => v).map(([label,value]) => `<p style="white-space:pre-wrap;overflow-wrap:anywhere;">${label}: ${escHtml(value)}</p>`).join('')}
          <p style="font-size:11px;color:#999;margin-top:6px;">⏱ ${f.duration} วินาที</p>
        </div>
      </div>
    `).join('')}
  `;
  await document.fonts.ready;
  await Promise.all(Array.from(printArea.querySelectorAll('img')).map(img => img.decode().catch(() => {})));
  window.print();
}

/* Export PDF */

async function captureElement(element) {
  if (!window.html2canvas) throw new Error('โหลดเครื่องมือส่งออกไม่สำเร็จ กรุณาลองใหม่');
  await document.fonts.ready;
  await Promise.all(Array.from(element.querySelectorAll('img')).filter(img => img.getAttribute('src')).map(img => img.decode()));
  return html2canvas(element, { backgroundColor: '#161616', scale: 2, logging: false });
}
async function savePreview() {
  const button = document.getElementById('btn-save-preview');
  button.disabled = true;
  try {
    saveToLocal();
    const canvas = await captureElement(document.getElementById('preview-image-box'));
    const link = document.createElement('a');
    link.download = (document.getElementById('project-title').value || 'storyboard') + '-frame-' + (previewIdx + 1) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) { alert('บันทึก Preview ไม่สำเร็จ: ' + error.message); }
  finally { button.disabled = false; }
}

async function exportPDF() {
  if (!frames.length) { alert('ยังไม่มีเฟรม'); return; }
  const button = document.getElementById('btn-export-pdf');
  button.disabled = true;
  const host = document.createElement('div');
  host.className = 'pdf-host';
  document.body.appendChild(host);
  try {
    saveToLocal();
    if (!window.jspdf?.jsPDF) throw new Error('โหลดเครื่องมือ PDF ไม่สำเร็จ กรุณาลองใหม่');
    const title = document.getElementById('project-title').value || 'storyboard';
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    let firstPage = true;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      host.innerHTML = `
        <article class="pdf-frame">
          <h1>${escHtml(title)}</h1>
          <h2>FRAME ${String(i + 1).padStart(2, '0')} · ${escHtml(f.scene)}</h2>
          <div class="pdf-image" style="aspect-ratio:${ratioValue()}">
            ${f.imageData ? `<img src="${escHtml(f.imageData)}" alt="">` : 'ไม่มีรูปภาพ'}
          </div>
          <p>Camera Shot: ${escHtml(f.camera.join(' · '))} · Duration: ${f.duration}s</p>
          ${[['บทพูด / Dialogue', f.dialogue], ['คำอธิบายฉาก / Action', f.desc],
              ['Image Prompt', f.imagePrompt], ['Video Prompt', f.videoPrompt],
              ['Camera Movement', f.cameraMovement]]
            .filter(([,value]) => value).map(([label,value]) =>
              `<section><h3>${label}</h3><p>${escHtml(value)}</p></section>`).join('')}
        </article>`;
      const canvas = await captureElement(host.firstElementChild);
      const width = pageW - 20;
      const pixelsPerMM = canvas.width / width;
      const sliceHeight = Math.floor((pageH - 20) * pixelsPerMM);
      for (let top = 0; top < canvas.height; top += sliceHeight) {
        if (!firstPage) pdf.addPage();
        firstPage = false;
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = Math.min(sliceHeight, canvas.height - top);
        slice.getContext('2d').drawImage(canvas, 0, top, canvas.width, slice.height, 0, 0, slice.width, slice.height);
        pdf.addImage(slice.toDataURL('image/png'), 'PNG', 10, 10, width, slice.height / pixelsPerMM, undefined, 'FAST');
      }
    }
    pdf.save(title + '.pdf');
    closeExport();
  } catch (error) { alert('ส่งออก PDF ไม่สำเร็จ: ' + error.message); }
  finally { host.remove(); button.disabled = false; }
}


/* ════════════════════════════════════════════
   MUSIC
   ════════════════════════════════════════════ */

let audioEl       = null;
let musicLoaded   = false;
let seekRafId     = null;

function toggleMusicPanel() {
  const panel = document.getElementById('music-panel');
  const btn   = document.getElementById('btn-music-toggle');
  const open  = panel.classList.toggle('open');
  btn.classList.toggle('active', open);
}

function loadMusicFile(input) {
  const file = input.files[0];
  if (!file) return;

  // Create / replace audio element
  if (audioEl) { audioEl.pause(); audioEl.src = ''; }
  audioEl = new Audio();
  audioEl.src    = URL.createObjectURL(file);
  audioEl.volume = parseFloat(document.getElementById('music-volume').value);
  audioEl.loop   = false;

  audioEl.addEventListener('loadedmetadata', () => {
    musicLoaded = true;
    document.getElementById('music-name').textContent = file.name.replace(/\.[^/.]+$/, '');
    document.getElementById('btn-play-music').disabled = false;
    document.getElementById('btn-play-music').textContent = '⏵';
    document.getElementById('music-time').textContent =
      `0:00 / ${formatTime(audioEl.duration)}`;

    // Show controls, hide drop area
    document.getElementById('music-drop-area').classList.add('has-file');
    document.getElementById('music-controls').classList.add('visible');
    startSeekUpdate();
  });

  audioEl.addEventListener('ended', () => {
    document.getElementById('btn-play-music').textContent = '⏵';
  });
}

function changeMusic() {
  document.getElementById('music-change-input').click();
}

function removeMusic() {
  if (!audioEl) return;
  audioEl.pause();
  audioEl.src = '';
  audioEl = null;
  musicLoaded = false;
  cancelAnimationFrame(seekRafId);

  // Reset UI back to drop state
  document.getElementById('music-drop-area').classList.remove('has-file');
  document.getElementById('music-controls').classList.remove('visible');
  document.getElementById('music-name').textContent = '—';
  document.getElementById('music-time').textContent = '0:00 / 0:00';
  document.getElementById('music-seek-fill').style.width = '0%';
  document.getElementById('btn-play-music').disabled = true;
  document.getElementById('btn-play-music').textContent = '⏵';
  document.getElementById('music-file-input').value = '';
  document.getElementById('music-change-input').value = '';
}

function toggleMusic() {
  if (!audioEl || !musicLoaded) return;
  if (audioEl.paused) {
    audioEl.play();
    document.getElementById('btn-play-music').textContent = '⏸';
    startSeekUpdate();
  } else {
    audioEl.pause();
    document.getElementById('btn-play-music').textContent = '⏵';
  }
}

function setMusicVolume(val) {
  if (audioEl) audioEl.volume = parseFloat(val);
}

function seekMusic(e) {
  if (!audioEl || !musicLoaded) return;
  const bar  = document.getElementById('music-seek-bar');
  const rect = bar.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audioEl.currentTime = pct * audioEl.duration;
}

function startSeekUpdate() {
  cancelAnimationFrame(seekRafId);
  function tick() {
    if (!audioEl) return;
    const pct = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
    document.getElementById('music-seek-fill').style.width = pct + '%';
    document.getElementById('music-time').textContent =
      `${formatTime(audioEl.currentTime)} / ${formatTime(audioEl.duration)}`;
    seekRafId = requestAnimationFrame(tick);
  }
  seekRafId = requestAnimationFrame(tick);
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Stop music when preview is closed
const _origClosePreview = closePreview;
closePreview = function() {
  _origClosePreview();
  if (audioEl && !audioEl.paused) {
    audioEl.pause();
    document.getElementById('btn-play-music').textContent = '⏵';
  }
};

// Drag-and-drop audio file onto music panel
document.addEventListener('DOMContentLoaded', () => {
  const dropArea = document.getElementById('music-drop-area');
  dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.style.background = 'var(--surface3)'; });
  dropArea.addEventListener('dragleave', () => { dropArea.style.background = ''; });
  dropArea.addEventListener('drop', e => {
    e.preventDefault();
    dropArea.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      const dt = new DataTransfer();
      dt.items.add(file);
      document.getElementById('music-file-input').files = dt.files;
      loadMusicFile(document.getElementById('music-file-input'));
    }
  });
});


/* ════════════════════════════════════════════
   PREVIEW MODE
   ════════════════════════════════════════════ */

let previewIdx      = 0;
let autoplayTimer   = null;
let isAutoplaying   = false;
let progressTimer   = null;
let progressStart   = null;
let progressDur     = 0;

function openPreview() {
  if (!frames.length) { alert('ยังไม่มีเฟรมครับ'); return; }
  saveToLocal();
  stopAutoplay();
  previewIdx = 0;
  document.getElementById('preview-overlay').classList.add('open');
  document.getElementById('preview-project-title').textContent =
    document.getElementById('project-title').value || 'StoryFrame';
  buildFilmstrip();
  showPreviewFrame(0);
}

function closePreview() {
  document.getElementById('preview-overlay').classList.remove('open');
  stopAutoplay();
}

function showPreviewFrame(idx) {
  previewIdx = Math.max(0, Math.min(idx, frames.length - 1));
  const f = frames[previewIdx];

  // Image
  const img   = document.getElementById('preview-img');
  const noImg = document.getElementById('preview-no-image');
  if (f.imageData) {
    img.src = f.imageData;
    img.classList.add('visible');
    noImg.style.display = 'none';
  } else {
    img.classList.remove('visible');
    noImg.style.display = 'block';
  }

  // Counter
  document.getElementById('preview-frame-counter').textContent =
    `FRAME ${String(previewIdx + 1).padStart(2, '0')} / ${String(frames.length).padStart(2, '0')}`;

  // Scene
  document.getElementById('preview-scene').textContent =
    f.scene ? `฿ ${f.scene}` : '';

  // Camera tags
  const camEl = document.getElementById('preview-camera-tags');
  camEl.innerHTML = [...f.camera, f.cameraMovement].filter(Boolean).map(t => `<span>${escHtml(t)}</span>`).join('');

  // Dialogue & desc
  document.getElementById('preview-dialogue').textContent =
    f.dialogue ? `"${f.dialogue}"` : '';
  document.getElementById('preview-desc').textContent = f.desc || '';

  // Duration
  document.getElementById('preview-duration-label').textContent =
    `⏱ ${f.duration} วินาที`;

  // Arrows
  document.getElementById('arrow-prev').disabled = previewIdx === 0;
  document.getElementById('arrow-next').disabled = previewIdx === frames.length - 1;

  // Filmstrip highlight
  document.querySelectorAll('.filmstrip-thumb').forEach((el, i) => {
    el.classList.toggle('active', i === previewIdx);
  });

  // Scroll filmstrip thumb into view
  const thumb = document.querySelector(`.filmstrip-thumb[data-idx="${previewIdx}"]`);
  if (thumb) thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  // Progress bar
  stopProgress();
  document.getElementById('preview-image-box').style.aspectRatio = ratioValue();
  document.getElementById('preview-frame-wrap').style.maxWidth = `min(900px, calc(100vw - 80px), ${ratioValue() * 45}dvh)`;
  if (isAutoplaying) scheduleNextFrame();
}

function prevFrame() {
  if (previewIdx > 0) showPreviewFrame(previewIdx - 1);
}

function nextFrame() {
  if (previewIdx < frames.length - 1) showPreviewFrame(previewIdx + 1);
  else if (isAutoplaying) stopAutoplay();
}

/* Filmstrip */
function buildFilmstrip() {
  const strip = document.getElementById('preview-filmstrip');
  strip.innerHTML = frames.map((f, i) => `
    <div class="filmstrip-thumb" style="aspect-ratio:${ratioValue()}" data-idx="${i}" onclick="showPreviewFrame(${i})">
      ${f.imageData
        ? `<img src="${escHtml(f.imageData)}" alt="frame ${i+1}">`
        : `<span class="thumb-empty">—</span>`
      }
      <span class="thumb-num">${String(i+1).padStart(2,'0')}</span>
    </div>
  `).join('');
}

/* Autoplay */
function toggleAutoplay() {
  isAutoplaying ? stopAutoplay() : startAutoplay();
}

function startAutoplay() {
  isAutoplaying = true;
  document.getElementById('btn-autoplay').classList.add('active');
  document.getElementById('btn-autoplay').textContent = '⏸ หยุด';
  scheduleNextFrame();
}

function stopAutoplay() {
  isAutoplaying = false;
  clearTimeout(autoplayTimer);
  stopProgress();
  const btn = document.getElementById('btn-autoplay');
  if (btn) {
    btn.classList.remove('active');
    btn.textContent = '⏵ Auto';
  }
}

function scheduleNextFrame() {
  clearTimeout(autoplayTimer);
  const dur = validDuration(frames[previewIdx]?.duration) * 1000;
  startProgress(dur);
  autoplayTimer = setTimeout(() => {
    if (previewIdx < frames.length - 1) {
      showPreviewFrame(previewIdx + 1);
    } else {
      stopAutoplay();
    }
  }, dur);
}

/* Progress bar animation */
function startProgress(durationMs) {
  cancelAnimationFrame(progressTimer);
  progressDur   = durationMs;
  progressStart = performance.now();
  const fill    = document.getElementById('preview-progress-fill');
  fill.style.transition = 'none';
  fill.style.width = '0%';
  progressTimer = requestAnimationFrame(animateProgress);
}

function stopProgress() {
  clearTimeout(autoplayTimer);
  cancelAnimationFrame(progressTimer);
  progressStart = null;
  const fill = document.getElementById('preview-progress-fill');
  if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
}

function animateProgress(now) {
  if (!progressStart) return;
  const elapsed = now - progressStart;
  const pct     = Math.min((elapsed / progressDur) * 100, 100);
  document.getElementById('preview-progress-fill').style.width = pct + '%';
  if (pct < 100) progressTimer = requestAnimationFrame(animateProgress);
}

/* Keyboard navigation */
document.addEventListener('keydown', e => {
  const overlay = document.getElementById('preview-overlay');
  if (!overlay.classList.contains('open')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { stopAutoplay(); nextFrame(); }
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { stopAutoplay(); prevFrame(); }
  if (e.key === ' ') { e.preventDefault(); toggleAutoplay(); }
  if (e.key === 'Escape') closePreview();
});


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
if (loaded) {
  renderAll();
  setSaveStatus('saved');
} else {
  loadDefaults();
}

window.addEventListener('pagehide', saveToLocal);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveToLocal(); });
