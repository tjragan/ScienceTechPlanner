// app.js – Science Tech Planner frontend
'use strict';

// ── API client ─────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  const token = localStorage.getItem('stp_token');
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`/api/${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── State ──────────────────────────────────────────────────────────────────

const S = {
  teachers:    [],
  rooms:       [],
  schedule:    [],
  experiments: [],
};

function today() {
  return new Date().toISOString().split('T')[0];
}

// ── Toast ──────────────────────────────────────────────────────────────────

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.classList.remove('bg-success', 'bg-danger', 'bg-warning');
  el.classList.add(type === 'success' ? 'bg-success' : type === 'warning' ? 'bg-warning' : 'bg-danger');
  document.getElementById('toast-body').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 3000 }).show();
}

function showError(msg) { toast(msg, 'danger'); }

// ── Bootstrap modal helpers ────────────────────────────────────────────────

function getModal(id) {
  return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
}
function openModal(id)  { getModal(id).show(); }
function closeModal(id) { getModal(id).hide(); }

// ── Item-row builder (equipment / reagent tables) ──────────────────────────

function makeEqRow(item = {}) {
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  tr.innerHTML = `
    <td><input type="text"   class="form-control form-control-sm eq-name" value="${escHtml(item.name || '')}" placeholder="Item name" /></td>
    <td><input type="number" class="form-control form-control-sm eq-qpc"  value="${item.quantity_per_class   ?? 0}" min="0" /></td>
    <td><input type="number" class="form-control form-control-sm eq-qps"  value="${item.quantity_per_student ?? 0}" min="0" /></td>
    <td><button type="button" class="btn btn-sm btn-outline-danger del-row-btn"><i class="bi bi-trash"></i></button></td>`;
  tr.querySelector('.del-row-btn').addEventListener('click', () => tr.remove());
  return tr;
}

function makeRgRow(item = {}) {
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  tr.innerHTML = `
    <td><input type="text"   class="form-control form-control-sm rg-name" value="${escHtml(item.name || '')}" placeholder="Reagent name" /></td>
    <td><input type="number" class="form-control form-control-sm rg-qpc"  value="${item.quantity_per_class   ?? 0}" min="0" /></td>
    <td><input type="number" class="form-control form-control-sm rg-qps"  value="${item.quantity_per_student ?? 0}" min="0" /></td>
    <td><input type="text"   class="form-control form-control-sm rg-unit" value="${escHtml(item.unit || '')}" placeholder="ml, g…" /></td>
    <td><button type="button" class="btn btn-sm btn-outline-danger del-row-btn"><i class="bi bi-trash"></i></button></td>`;
  tr.querySelector('.del-row-btn').addEventListener('click', () => tr.remove());
  return tr;
}

function readEqRows(tbodyId) {
  return [...document.getElementById(tbodyId).querySelectorAll('tr.item-row')]
    .map(tr => ({
      name:               tr.querySelector('.eq-name').value.trim(),
      quantity_per_class:   Number(tr.querySelector('.eq-qpc').value) || 0,
      quantity_per_student: Number(tr.querySelector('.eq-qps').value) || 0,
    })).filter(i => i.name);
}

function readRgRows(tbodyId) {
  return [...document.getElementById(tbodyId).querySelectorAll('tr.item-row')]
    .map(tr => ({
      name:               tr.querySelector('.rg-name').value.trim(),
      quantity_per_class:   Number(tr.querySelector('.rg-qpc').value) || 0,
      quantity_per_student: Number(tr.querySelector('.rg-qps').value) || 0,
      unit:               tr.querySelector('.rg-unit').value.trim(),
    })).filter(i => i.name);
}

function populateEqBody(tbodyId, items = []) {
  const el = document.getElementById(tbodyId);
  el.innerHTML = '';
  items.forEach(i => el.appendChild(makeEqRow(i)));
}

function populateRgBody(tbodyId, items = []) {
  const el = document.getElementById(tbodyId);
  el.innerHTML = '';
  items.forEach(i => el.appendChild(makeRgRow(i)));
}

// ── Escape HTML ────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ─────────────────────────────────────────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('d-none'));
  document.querySelectorAll('#main-tabs .nav-link').forEach(a => a.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.remove('d-none');
  document.querySelector(`#main-tabs [data-tab="${name}"]`)?.classList.add('active');
  loadTab(name);
}

async function loadTab(name) {
  try {
    switch (name) {
      case 'teachers':    await loadTeachers();    break;
      case 'rooms':       await loadRooms();       break;
      case 'schedule':
        await Promise.all([
          S.teachers.length ? Promise.resolve() : loadTeachers(),
          S.rooms.length    ? Promise.resolve() : loadRooms(),
        ]);
        await loadSchedule();
        break;
      case 'experiments': await loadExperiments(); break;
      case 'requests':    await loadRequests();    break;
      case 'report':      /* manual refresh */     break;
    }
  } catch (e) { showError(e.message); }
}

// ─────────────────────────────────────────────────────────────────────────
// TEACHERS
// ─────────────────────────────────────────────────────────────────────────

async function loadTeachers() {
  S.teachers = await api('GET', 'teachers');
  renderTeachers();
}

function renderTeachers() {
  const el = document.getElementById('teachers-list');
  if (!S.teachers.length) { el.innerHTML = '<p class="text-muted">No teachers yet.</p>'; return; }
  el.innerHTML = S.teachers.map(t => `
    <div class="entity-card d-flex justify-content-between align-items-center">
      <div>
        <strong>${escHtml(t.name)}</strong>
        ${t.email ? `<span class="text-muted ms-2 small">${escHtml(t.email)}</span>` : ''}
      </div>
      <div class="card-actions d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" onclick="openTeacherModal(${t.id})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger"    onclick="deleteTeacher(${t.id})"><i class="bi bi-trash"></i></button>
      </div>
    </div>`).join('');
}

function openTeacherModal(id = null) {
  const t = id ? S.teachers.find(x => x.id === id) : null;
  document.getElementById('modal-teacher-title').textContent = t ? 'Edit Teacher' : 'Add Teacher';
  document.getElementById('teacher-id').value    = t?.id    ?? '';
  document.getElementById('teacher-name').value  = t?.name  ?? '';
  document.getElementById('teacher-email').value = t?.email ?? '';
  openModal('modal-teacher');
}

async function saveTeacher() {
  const id    = document.getElementById('teacher-id').value;
  const name  = document.getElementById('teacher-name').value.trim();
  const email = document.getElementById('teacher-email').value.trim();
  if (!name) { showError('Name is required'); return; }
  try {
    if (id) {
      await api('PUT', `teachers/${id}`, { name, email });
      toast('Teacher updated');
    } else {
      await api('POST', 'teachers', { name, email });
      toast('Teacher added');
    }
    closeModal('modal-teacher');
    await loadTeachers();
  } catch (e) { showError(e.message); }
}

async function deleteTeacher(id) {
  if (!confirm('Delete this teacher?')) return;
  try {
    await api('DELETE', `teachers/${id}`);
    toast('Teacher deleted');
    await loadTeachers();
  } catch (e) { showError(e.message); }
}

// ─────────────────────────────────────────────────────────────────────────
// ROOMS
// ─────────────────────────────────────────────────────────────────────────

async function loadRooms() {
  S.rooms = await api('GET', 'rooms');
  renderRooms();
}

function renderRooms() {
  const el = document.getElementById('rooms-list');
  if (!S.rooms.length) { el.innerHTML = '<p class="text-muted">No rooms yet.</p>'; return; }
  el.innerHTML = S.rooms.map(r => `
    <div class="entity-card">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <strong>${escHtml(r.name)}</strong>
          ${r.description ? `<span class="text-muted ms-2 small">${escHtml(r.description)}</span>` : ''}
        </div>
        <div class="card-actions d-flex gap-2">
          <button class="btn btn-sm btn-outline-info"      title="Standing equipment" onclick="openRoomEqModal(${r.id}, '${escHtml(r.name)}')"><i class="bi bi-box-seam"></i></button>
          <button class="btn btn-sm btn-outline-secondary" onclick="openRoomModal(${r.id})"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger"    onclick="deleteRoom(${r.id})"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </div>`).join('');
}

function openRoomModal(id = null) {
  const r = id ? S.rooms.find(x => x.id === id) : null;
  document.getElementById('modal-room-title').textContent = r ? 'Edit Room' : 'Add Room';
  document.getElementById('room-id').value   = r?.id          ?? '';
  document.getElementById('room-name').value = r?.name        ?? '';
  document.getElementById('room-desc').value = r?.description ?? '';
  openModal('modal-room');
}

async function saveRoom() {
  const id   = document.getElementById('room-id').value;
  const name = document.getElementById('room-name').value.trim();
  const desc = document.getElementById('room-desc').value.trim();
  if (!name) { showError('Room name is required'); return; }
  try {
    if (id) {
      await api('PUT', `rooms/${id}`, { name, description: desc });
      toast('Room updated');
    } else {
      await api('POST', 'rooms', { name, description: desc });
      toast('Room added');
    }
    closeModal('modal-room');
    await loadRooms();
  } catch (e) { showError(e.message); }
}

async function deleteRoom(id) {
  if (!confirm('Delete this room? This will also remove its schedule slots.')) return;
  try {
    await api('DELETE', `rooms/${id}`);
    toast('Room deleted');
    await loadRooms();
  } catch (e) { showError(e.message); }
}

// Room equipment modal

async function openRoomEqModal(roomId, roomName) {
  document.getElementById('modal-room-eq-title').textContent = `Standing Equipment – ${roomName}`;
  document.getElementById('eq-room-id').value = roomId;
  await refreshRoomEqTable(roomId);
  openModal('modal-room-eq');
}

async function refreshRoomEqTable(roomId) {
  const items = await api('GET', `rooms/${roomId}/equipment`);
  const tbody = document.getElementById('eq-table-body');
  tbody.innerHTML = items.length
    ? items.map(e => `
        <tr>
          <td>${escHtml(e.name)}</td>
          <td>${e.quantity}</td>
          <td>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteRoomEq(${roomId},${e.id})"><i class="bi bi-trash"></i></button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="text-muted small">No equipment</td></tr>';
}

async function addRoomEq() {
  const roomId = document.getElementById('eq-room-id').value;
  const name   = document.getElementById('new-eq-name').value.trim();
  const qty    = Number(document.getElementById('new-eq-qty').value) || 1;
  if (!name) { showError('Enter an equipment name'); return; }
  try {
    await api('POST', `rooms/${roomId}/equipment`, { name, quantity: qty });
    document.getElementById('new-eq-name').value = '';
    document.getElementById('new-eq-qty').value  = '1';
    await refreshRoomEqTable(roomId);
    toast('Equipment added');
  } catch (e) { showError(e.message); }
}

async function deleteRoomEq(roomId, eqId) {
  try {
    await api('DELETE', `rooms/${roomId}/equipment/${eqId}`);
    await refreshRoomEqTable(roomId);
  } catch (e) { showError(e.message); }
}

// ─────────────────────────────────────────────────────────────────────────
// SCHEDULE
// ─────────────────────────────────────────────────────────────────────────

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

async function loadSchedule() {
  S.schedule = await api('GET', 'schedule');
  renderSchedule();
}

function renderSchedule() {
  const el = document.getElementById('schedule-list');
  if (!S.schedule.length) { el.innerHTML = '<p class="text-muted">No schedule slots yet.</p>'; return; }

  // Group by day
  const byDay = {};
  DAY_ORDER.forEach(d => byDay[d] = []);
  S.schedule.forEach(s => { if (byDay[s.day]) byDay[s.day].push(s); });

  el.innerHTML = DAY_ORDER.filter(d => byDay[d].length).map(day => `
    <h6 class="mt-3 mb-2 text-primary fw-bold">${day}</h6>
    <div class="table-responsive">
    <table class="table table-sm table-bordered schedule-table">
      <thead class="table-light">
        <tr><th>Period</th><th>Teacher</th><th>Room</th><th>Class</th><th>Students</th><th></th></tr>
      </thead>
      <tbody>
        ${byDay[day].sort((a,b) => a.period - b.period).map(s => `
          <tr>
            <td class="text-center fw-bold">${s.period}</td>
            <td>${escHtml(s.teacher_name)}</td>
            <td>${escHtml(s.room_name)}</td>
            <td>${escHtml(s.class_name)}</td>
            <td class="text-center">${s.student_count}</td>
            <td>
              <button class="btn btn-sm btn-outline-secondary me-1" onclick="openSlotModal(${s.id})"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteSlot(${s.id})"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`).join('');
}

function openSlotModal(id = null) {
  const s = id ? S.schedule.find(x => x.id === id) : null;
  document.getElementById('modal-slot-title').textContent = s ? 'Edit Schedule Slot' : 'Add Schedule Slot';
  document.getElementById('slot-id').value       = s?.id            ?? '';
  document.getElementById('slot-day').value      = s?.day           ?? '';
  document.getElementById('slot-period').value   = s?.period        ?? '';
  document.getElementById('slot-class').value    = s?.class_name    ?? '';
  document.getElementById('slot-students').value = s?.student_count ?? 0;

  // Populate teacher/room selects
  const tSel = document.getElementById('slot-teacher');
  tSel.innerHTML = '<option value="">Select…</option>' +
    S.teachers.map(t => `<option value="${t.id}" ${s?.teacher_id === t.id ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('');

  const rSel = document.getElementById('slot-room');
  rSel.innerHTML = '<option value="">Select…</option>' +
    S.rooms.map(r => `<option value="${r.id}" ${s?.room_id === r.id ? 'selected' : ''}>${escHtml(r.name)}</option>`).join('');

  openModal('modal-slot');
}

async function saveSlot() {
  const id      = document.getElementById('slot-id').value;
  const payload = {
    teacher_id:    Number(document.getElementById('slot-teacher').value),
    room_id:       Number(document.getElementById('slot-room').value),
    day:           document.getElementById('slot-day').value,
    period:        Number(document.getElementById('slot-period').value),
    class_name:    document.getElementById('slot-class').value.trim(),
    student_count: Number(document.getElementById('slot-students').value) || 0,
  };
  if (!payload.teacher_id || !payload.room_id || !payload.day || !payload.period || !payload.class_name)
    { showError('All fields except Students are required'); return; }
  try {
    if (id) {
      await api('PUT', `schedule/${id}`, payload);
      toast('Slot updated');
    } else {
      await api('POST', 'schedule', payload);
      toast('Slot added');
    }
    closeModal('modal-slot');
    await loadSchedule();
  } catch (e) { showError(e.message); }
}

async function deleteSlot(id) {
  if (!confirm('Delete this schedule slot?')) return;
  try {
    await api('DELETE', `schedule/${id}`);
    toast('Slot deleted');
    await loadSchedule();
  } catch (e) { showError(e.message); }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPERIMENTS
// ─────────────────────────────────────────────────────────────────────────

async function loadExperiments() {
  S.experiments = await api('GET', 'experiments');
  renderExperiments();
}

function renderExperiments() {
  const el = document.getElementById('experiments-list');
  if (!S.experiments.length) { el.innerHTML = '<p class="text-muted">No experiments yet.</p>'; return; }
  el.innerHTML = S.experiments.map(e => `
    <div class="entity-card">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <span class="badge bg-primary me-2">${escHtml(e.id)}</span>
          <strong>${escHtml(e.name)}</strong>
          ${e.description ? `<div class="text-muted small mt-1">${escHtml(e.description)}</div>` : ''}
          <div class="mt-1 small text-secondary">
            <i class="bi bi-tools me-1"></i>${e.equipment.length} equipment item(s)
            &nbsp;|&nbsp;
            <i class="bi bi-droplet me-1"></i>${e.reagents.length} reagent(s)
          </div>
        </div>
        <div class="card-actions d-flex gap-2 flex-wrap justify-content-end">
          <button class="btn btn-sm btn-outline-info"      title="Notes &amp; variances" onclick="openExpDetail('${escHtml(e.id)}')"><i class="bi bi-card-text me-1"></i>Detail</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="openExpModal('${escHtml(e.id)}')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger"    onclick="deleteExp('${escHtml(e.id)}')"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </div>`).join('');
}

function openExpModal(id = null) {
  const e = id ? S.experiments.find(x => x.id === id) : null;
  document.getElementById('modal-exp-title').textContent = e ? `Edit – ${e.id}` : 'Add Experiment';
  document.getElementById('exp-id').value   = e?.id          ?? '';
  document.getElementById('exp-id').disabled = !!e;
  document.getElementById('exp-name').value = e?.name        ?? '';
  document.getElementById('exp-desc').value = e?.description ?? '';
  populateEqBody('exp-eq-body', e?.equipment ?? []);
  populateRgBody('exp-rg-body', e?.reagents  ?? []);
  openModal('modal-exp');
}

async function saveExp() {
  const id   = document.getElementById('exp-id').value.trim();
  const name = document.getElementById('exp-name').value.trim();
  const desc = document.getElementById('exp-desc').value.trim();
  if (!id || !name) { showError('ID and name are required'); return; }
  const equipment = readEqRows('exp-eq-body');
  const reagents  = readRgRows('exp-rg-body');
  try {
    const existing = S.experiments.find(x => x.id === id);
    if (existing) {
      await api('PUT', `experiments/${id}`, { name, description: desc, equipment, reagents });
      toast('Experiment updated');
    } else {
      await api('POST', 'experiments', { id, name, description: desc, equipment, reagents });
      toast('Experiment added');
    }
    closeModal('modal-exp');
    await loadExperiments();
  } catch (e) { showError(e.message); }
}

async function deleteExp(id) {
  if (!confirm(`Delete experiment ${id}?`)) return;
  try {
    await api('DELETE', `experiments/${id}`);
    toast('Experiment deleted');
    await loadExperiments();
  } catch (e) { showError(e.message); }
}

// ── Experiment detail (notes + variances) ─────────────────────────────────

async function openExpDetail(expId) {
  document.getElementById('detail-exp-id').value = expId;
  document.getElementById('modal-exp-detail-title').textContent =
    `Detail – ${expId}`;
  // reset to notes tab
  showDetailPanel('notes');
  document.querySelectorAll('#detail-tabs .nav-link').forEach(a =>
    a.classList.toggle('active', a.dataset.detail === 'notes'));
  await loadNotes(expId);
  openModal('modal-exp-detail');
}

function showDetailPanel(name) {
  document.getElementById('detail-notes').classList.toggle('d-none', name !== 'notes');
  document.getElementById('detail-variances').classList.toggle('d-none', name !== 'variances');
}

async function loadNotes(expId) {
  const notes = await api('GET', `experiments/${expId}/notes`);
  const el = document.getElementById('notes-list');
  el.innerHTML = notes.length
    ? notes.map(n => `
        <div class="d-flex justify-content-between align-items-start mb-2 border rounded p-2">
          <div class="small">${escHtml(n.note)}<br/><span class="text-muted" style="font-size:.75rem">${n.created_at}</span></div>
          <button class="btn btn-sm btn-outline-danger ms-2" onclick="deleteNote('${expId}',${n.id})"><i class="bi bi-trash"></i></button>
        </div>`).join('')
    : '<p class="text-muted small">No notes yet.</p>';
}

async function addNote() {
  const expId = document.getElementById('detail-exp-id').value;
  const note  = document.getElementById('new-note-text').value.trim();
  if (!note) return;
  try {
    await api('POST', `experiments/${expId}/notes`, { note });
    document.getElementById('new-note-text').value = '';
    await loadNotes(expId);
    toast('Note added');
  } catch (e) { showError(e.message); }
}

async function deleteNote(expId, noteId) {
  try {
    await api('DELETE', `experiments/${expId}/notes/${noteId}`);
    await loadNotes(expId);
  } catch (e) { showError(e.message); }
}

async function loadVariances(expId) {
  const vars = await api('GET', `experiments/${expId}/variances`);
  const el = document.getElementById('variances-list');
  el.innerHTML = vars.length
    ? vars.map(v => `
        <div class="entity-card d-flex justify-content-between align-items-center">
          <div>
            <strong>${escHtml(v.teacher_name)}</strong>
            ${v.notes ? `<div class="text-muted small">${escHtml(v.notes)}</div>` : ''}
            <div class="small text-secondary mt-1">
              ${v.equipment ? `Eq: ${v.equipment.length} item(s)` : 'Eq: default'}
              &nbsp;|&nbsp;
              ${v.reagents  ? `Rg: ${v.reagents.length} item(s)` : 'Rg: default'}
            </div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-secondary" onclick="openVarianceModal('${expId}',${v.id})"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger"    onclick="deleteVariance('${expId}',${v.id})"><i class="bi bi-trash"></i></button>
          </div>
        </div>`).join('')
    : '<p class="text-muted small">No variances yet.</p>';
}

function openVarianceModal(expId, varId = null) {
  document.getElementById('var-exp-id').value = expId;
  document.getElementById('var-id').value     = varId ?? '';
  document.getElementById('modal-variance-title').textContent =
    varId ? 'Edit Teacher Variance' : 'Add Teacher Variance';

  // Populate teacher select
  const tSel = document.getElementById('var-teacher');
  tSel.innerHTML = '<option value="">Select…</option>' +
    S.teachers.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');

  populateEqBody('var-eq-body', []);
  populateRgBody('var-rg-body', []);
  document.getElementById('var-notes').value = '';

  if (varId) {
    // Load existing variance
    api('GET', `experiments/${expId}/variances`).then(vars => {
      const v = vars.find(x => x.id === varId);
      if (!v) return;
      tSel.value = v.teacher_id;
      document.getElementById('var-notes').value = v.notes ?? '';
      if (v.equipment) populateEqBody('var-eq-body', v.equipment);
      if (v.reagents)  populateRgBody('var-rg-body', v.reagents);
    });
  }

  openModal('modal-variance');
}

async function saveVariance() {
  const expId     = document.getElementById('var-exp-id').value;
  const varId     = document.getElementById('var-id').value;
  const teacherId = Number(document.getElementById('var-teacher').value);
  const notes     = document.getElementById('var-notes').value.trim();
  const equipment = readEqRows('var-eq-body');
  const reagents  = readRgRows('var-rg-body');
  if (!teacherId) { showError('Teacher is required'); return; }
  try {
    if (varId) {
      await api('PUT', `experiments/${expId}/variances/${varId}`,
        { teacher_id: teacherId, equipment: equipment.length ? equipment : null,
          reagents: reagents.length ? reagents : null, notes });
      toast('Variance updated');
    } else {
      await api('POST', `experiments/${expId}/variances`,
        { teacher_id: teacherId, equipment: equipment.length ? equipment : null,
          reagents: reagents.length ? reagents : null, notes });
      toast('Variance added');
    }
    closeModal('modal-variance');
    await loadVariances(expId);
  } catch (e) { showError(e.message); }
}

async function deleteVariance(expId, varId) {
  if (!confirm('Delete this variance?')) return;
  try {
    await api('DELETE', `experiments/${expId}/variances/${varId}`);
    toast('Variance deleted');
    await loadVariances(expId);
  } catch (e) { showError(e.message); }
}

// ─────────────────────────────────────────────────────────────────────────
// PRACTICAL REQUESTS
// ─────────────────────────────────────────────────────────────────────────

async function loadRequests() {
  const date = document.getElementById('req-date').value || today();
  document.getElementById('req-date').value = date;
  const requests = await api('GET', `requests?date=${date}`);
  renderRequests(requests, date);
}

function renderRequests(requests, date) {
  const el = document.getElementById('requests-list');
  if (!requests.length) {
    el.innerHTML = `<p class="text-muted text-center py-4">No practical requests for ${date}.</p>`;
    return;
  }
  // Sort by period
  requests.sort((a,b) => a.period - b.period);
  el.innerHTML = requests.map(r => `
    <div class="entity-card">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <span class="badge bg-secondary me-1">Period ${r.period}</span>
          <span class="badge bg-primary me-1">${escHtml(r.experiment_id)}</span>
          <strong>${escHtml(r.experiment_name)}</strong>
          <div class="text-muted small mt-1">
            ${escHtml(r.teacher_name)} &bull; ${escHtml(r.room_name)} &bull; ${escHtml(r.class_name)} &bull; ${r.student_count} students
          </div>
          ${r.notes ? `<div class="small mt-1"><em>${escHtml(r.notes)}</em></div>` : ''}
          ${r.override_equipment || r.override_reagents
            ? '<span class="badge bg-warning text-dark mt-1"><i class="bi bi-exclamation-triangle me-1"></i>Override active</span>'
            : ''}
        </div>
        <div class="card-actions d-flex gap-2 flex-wrap justify-content-end">
          <button class="btn btn-sm btn-outline-warning" title="One-time override" onclick="openOverrideModal(${r.id})"><i class="bi bi-sliders me-1"></i>Override</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="openReqModal(${r.id})"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger"    onclick="deleteRequest(${r.id})"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </div>`).join('');
}

function populateReqModal(req = null) {
  const date = document.getElementById('req-date').value || today();
  document.getElementById('modal-req-title').textContent = req ? 'Edit Request' : 'Add Request';
  document.getElementById('req-id').value            = req?.id    ?? '';
  document.getElementById('req-modal-date').value    = req?.date  ?? date;
  document.getElementById('req-notes').value         = req?.notes ?? '';

  const expSel = document.getElementById('req-experiment');
  expSel.innerHTML = '<option value="">Select experiment…</option>' +
    S.experiments.map(e =>
      `<option value="${escHtml(e.id)}" ${req?.experiment_id === e.id ? 'selected' : ''}>${escHtml(e.id)} – ${escHtml(e.name)}</option>`
    ).join('');

  const slotSel = document.getElementById('req-slot');
  slotSel.innerHTML = '<option value="">Select schedule slot…</option>' +
    S.schedule.map(s =>
      `<option value="${s.id}" ${req?.schedule_slot_id === s.id ? 'selected' : ''}>${s.day} P${s.period} – ${escHtml(s.teacher_name)} – ${escHtml(s.room_name)} – ${escHtml(s.class_name)}</option>`
    ).join('');
}

async function openReqModal(id = null) {
  // Ensure we have fresh data
  if (!S.experiments.length) await loadExperiments();
  if (!S.schedule.length)    await loadSchedule();

  let req = null;
  if (id) {
    const all = await api('GET', 'requests');
    req = all.find(r => r.id === id);
  }
  populateReqModal(req);
  openModal('modal-req');
}

async function saveRequest() {
  const id              = document.getElementById('req-id').value;
  const experiment_id   = document.getElementById('req-experiment').value;
  const schedule_slot_id = Number(document.getElementById('req-slot').value);
  const date            = document.getElementById('req-modal-date').value;
  const notes           = document.getElementById('req-notes').value.trim();
  if (!experiment_id || !schedule_slot_id || !date)
    { showError('Experiment, schedule slot and date are required'); return; }
  try {
    if (id) {
      await api('PUT',  `requests/${id}`, { experiment_id, schedule_slot_id, date, notes });
      toast('Request updated');
    } else {
      await api('POST', 'requests', { experiment_id, schedule_slot_id, date, notes });
      toast('Request added');
    }
    closeModal('modal-req');
    await loadRequests();
  } catch (e) { showError(e.message); }
}

async function deleteRequest(id) {
  if (!confirm('Delete this request?')) return;
  try {
    await api('DELETE', `requests/${id}`);
    toast('Request deleted');
    await loadRequests();
  } catch (e) { showError(e.message); }
}

// ── One-time override ──────────────────────────────────────────────────────

async function openOverrideModal(reqId) {
  document.getElementById('ov-req-id').value = reqId;
  populateEqBody('ov-eq-body', []);
  populateRgBody('ov-rg-body', []);
  document.getElementById('ov-notes').value = '';

  try {
    const existing = await api('GET', `requests/${reqId}/override`);
    if (existing) {
      document.getElementById('ov-notes').value = existing.notes ?? '';
      if (existing.equipment) populateEqBody('ov-eq-body', existing.equipment);
      if (existing.reagents)  populateRgBody('ov-rg-body', existing.reagents);
    }
  } catch (_) { /* no existing override */ }

  openModal('modal-override');
}

async function saveOverride() {
  const reqId     = document.getElementById('ov-req-id').value;
  const notes     = document.getElementById('ov-notes').value.trim();
  const equipment = readEqRows('ov-eq-body');
  const reagents  = readRgRows('ov-rg-body');
  try {
    await api('PUT', `requests/${reqId}/override`, {
      equipment: equipment.length ? equipment : null,
      reagents:  reagents.length  ? reagents  : null,
      notes,
    });
    toast('Override saved');
    closeModal('modal-override');
    await loadRequests();
  } catch (e) { showError(e.message); }
}

async function removeOverride() {
  if (!confirm('Remove this one-time override?')) return;
  const reqId = document.getElementById('ov-req-id').value;
  try {
    await api('DELETE', `requests/${reqId}/override`);
    toast('Override removed');
    closeModal('modal-override');
    await loadRequests();
  } catch (e) { showError(e.message); }
}

// ─────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────

async function loadReport() {
  const date = document.getElementById('rpt-date').value;
  if (!date) { showError('Please select a date'); return; }
  try {
    const report = await api('GET', `report?date=${date}`);
    renderReport(report);
  } catch (e) { showError(e.message); }
}

function renderReport(report) {
  const el = document.getElementById('report-content');
  if (!report.periods.length) {
    el.innerHTML = `<p class="text-muted text-center py-4">No practical requests found for ${report.date} (${report.day}).</p>`;
    return;
  }

  const html = `
    <div class="mb-3 d-flex align-items-center gap-2">
      <h4 class="mb-0">${report.day}, ${report.date}</h4>
      <span class="badge bg-secondary">${report.periods.length} period(s)</span>
    </div>
    ${report.periods.map(p => `
      <div class="report-period">
        <div class="report-period-header">Period ${p.period}</div>
        ${p.items.map(item => `
          <div class="report-slot">
            <div class="slot-header d-flex flex-wrap align-items-center gap-2">
              <span>${escHtml(item.room)}</span>
              <span class="text-muted fw-normal">·</span>
              <span>${escHtml(item.teacher)}</span>
              <span class="text-muted fw-normal">·</span>
              <span>${escHtml(item.class)}</span>
              <span class="badge bg-light text-dark border report-badge">${item.students} students</span>
              <span class="badge bg-primary report-badge">${escHtml(item.experiment_id)}</span>
              <span class="fw-normal">${escHtml(item.experiment_name)}</span>
              ${item.override_active ? '<span class="badge bg-warning text-dark report-badge"><i class="bi bi-exclamation-triangle me-1"></i>Override</span>' : ''}
              ${item.variance_active ? '<span class="badge bg-info text-dark report-badge"><i class="bi bi-shuffle me-1"></i>Variance</span>' : ''}
            </div>
            ${item.request_notes  ? `<div class="text-muted small mt-1">Note: ${escHtml(item.request_notes)}</div>` : ''}
            ${item.override_notes ? `<div class="text-warning small mt-1">Override note: ${escHtml(item.override_notes)}</div>` : ''}

            ${item.delivery.equipment.length ? `
              <table class="table table-sm delivery-table">
                <thead><tr><th colspan="4" class="text-secondary">Equipment</th></tr>
                  <tr class="table-light"><th>Item</th><th>Needed</th><th>In room</th><th>To deliver</th></tr>
                </thead>
                <tbody>
                  ${item.delivery.equipment.map(e => `
                    <tr ${e.to_deliver > 0 ? '' : 'class="text-muted"'}>
                      <td>${escHtml(e.name)}</td>
                      <td>${e.needed}</td>
                      <td>${e.in_room}</td>
                      <td><strong>${e.to_deliver > 0 ? e.to_deliver : '–'}</strong></td>
                    </tr>`).join('')}
                </tbody>
              </table>` : ''}

            ${item.delivery.reagents.length ? `
              <table class="table table-sm delivery-table">
                <thead><tr><th colspan="3" class="text-secondary">Reagents</th></tr>
                  <tr class="table-light"><th>Reagent</th><th>Amount</th><th>Unit</th></tr>
                </thead>
                <tbody>
                  ${item.delivery.reagents.map(r => `
                    <tr>
                      <td>${escHtml(r.name)}</td>
                      <td><strong>${r.to_deliver}</strong></td>
                      <td>${escHtml(r.unit)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>` : ''}

            ${!item.delivery.equipment.length && !item.delivery.reagents.length
              ? '<p class="text-muted small mt-1 mb-0">Nothing to deliver (all equipment in room / no items defined).</p>'
              : ''}
          </div>`).join('')}
      </div>`).join('')}`;

  el.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────

async function initAuth() {
  // Init DB (idempotent)
  try { await fetch('/api/init', { method: 'POST' }); } catch (_) {}

  const status = await api('GET', 'auth/status');
  if (!status.setup) {
    // First-time setup
    document.getElementById('setup-banner').classList.remove('d-none');
    document.getElementById('pw-confirm-group').classList.remove('d-none');
    document.getElementById('pw-label').textContent = 'Create password';
    document.getElementById('login-btn').textContent = 'Set Password & Login';
  }
  document.getElementById('login-screen').classList.remove('d-none');
}

async function handleLogin(e) {
  e.preventDefault();
  const pw      = document.getElementById('pw-input').value;
  const confirm = document.getElementById('pw-confirm').value;
  const isSetup = !document.getElementById('setup-banner').classList.contains('d-none');

  document.getElementById('login-error').classList.add('d-none');

  if (isSetup) {
    if (pw !== confirm) {
      document.getElementById('login-error').textContent = 'Passwords do not match';
      document.getElementById('login-error').classList.remove('d-none');
      return;
    }
    try {
      const res = await api('POST', 'auth/setup', { password: pw });
      localStorage.setItem('stp_token', res.token);
      showApp();
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
      document.getElementById('login-error').classList.remove('d-none');
    }
  } else {
    try {
      const res = await api('POST', 'auth/login', { password: pw });
      localStorage.setItem('stp_token', res.token);
      showApp();
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
      document.getElementById('login-error').classList.remove('d-none');
    }
  }
}

function showApp() {
  document.getElementById('login-screen').classList.add('d-none');
  document.getElementById('app-screen').classList.remove('d-none');
  showTab('requests');
}

function logout() {
  localStorage.removeItem('stp_token');
  location.reload();
}

// ─────────────────────────────────────────────────────────────────────────
// WIRING
// ─────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  // Tab navigation
  document.querySelectorAll('#main-tabs .nav-link').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); showTab(a.dataset.tab); });
  });

  // Auth
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Teachers
  document.getElementById('add-teacher-btn').addEventListener('click', () => openTeacherModal());
  document.getElementById('save-teacher-btn').addEventListener('click', saveTeacher);

  // Rooms
  document.getElementById('add-room-btn').addEventListener('click', () => openRoomModal());
  document.getElementById('save-room-btn').addEventListener('click', saveRoom);
  document.getElementById('add-eq-btn').addEventListener('click', addRoomEq);

  // Schedule
  document.getElementById('add-slot-btn').addEventListener('click', async () => {
    if (!S.teachers.length) await loadTeachers().catch(() => {});
    if (!S.rooms.length)    await loadRooms().catch(() => {});
    if (!S.teachers.length || !S.rooms.length) {
      showError('Add at least one teacher and one room first');
      return;
    }
    openSlotModal();
  });
  document.getElementById('save-slot-btn').addEventListener('click', saveSlot);

  // Experiments
  document.getElementById('add-exp-btn').addEventListener('click', () => openExpModal());
  document.getElementById('save-exp-btn').addEventListener('click', saveExp);
  document.getElementById('add-eq-row-btn').addEventListener('click', () =>
    document.getElementById('exp-eq-body').appendChild(makeEqRow()));
  document.getElementById('add-rg-row-btn').addEventListener('click', () =>
    document.getElementById('exp-rg-body').appendChild(makeRgRow()));

  // Experiment detail tabs
  document.querySelectorAll('#detail-tabs .nav-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('#detail-tabs .nav-link').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      const panel = a.dataset.detail;
      showDetailPanel(panel);
      const expId = document.getElementById('detail-exp-id').value;
      if (panel === 'variances') loadVariances(expId);
    });
  });
  document.getElementById('add-note-btn').addEventListener('click', addNote);
  document.getElementById('add-variance-btn').addEventListener('click', () => {
    const expId = document.getElementById('detail-exp-id').value;
    openVarianceModal(expId);
  });

  // Variance modal
  document.getElementById('save-variance-btn').addEventListener('click', saveVariance);
  document.getElementById('add-var-eq-btn').addEventListener('click', () =>
    document.getElementById('var-eq-body').appendChild(makeEqRow()));
  document.getElementById('add-var-rg-btn').addEventListener('click', () =>
    document.getElementById('var-rg-body').appendChild(makeRgRow()));

  // Requests
  document.getElementById('req-date').value = today();
  document.getElementById('req-date').addEventListener('change', loadRequests);
  document.getElementById('add-req-btn').addEventListener('click', () => openReqModal());
  document.getElementById('save-req-btn').addEventListener('click', saveRequest);

  // Override modal
  document.getElementById('save-override-btn').addEventListener('click', saveOverride);
  document.getElementById('remove-override-btn').addEventListener('click', removeOverride);
  document.getElementById('add-ov-eq-btn').addEventListener('click', () =>
    document.getElementById('ov-eq-body').appendChild(makeEqRow()));
  document.getElementById('add-ov-rg-btn').addEventListener('click', () =>
    document.getElementById('ov-rg-body').appendChild(makeRgRow()));

  // Report
  document.getElementById('rpt-date').value = today();
  document.getElementById('rpt-date').addEventListener('change', loadReport);
  document.getElementById('refresh-report-btn').addEventListener('click', loadReport);
  document.getElementById('print-report-btn').addEventListener('click', () => window.print());

  // Check if already logged in
  const token = localStorage.getItem('stp_token');
  if (token) {
    try {
      // Quick validation: try fetching teachers
      await api('GET', 'teachers');
      showApp();
      return;
    } catch (_) {
      localStorage.removeItem('stp_token');
    }
  }

  await initAuth();
});
