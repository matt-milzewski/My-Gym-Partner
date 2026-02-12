'use strict';

const DRAFT_STORAGE_KEY = 'gym-tracker-draft-v1';
const ROUTINES_STORAGE_KEY = 'gym-tracker-routines-v1';

const DEFAULT_ROUTINES = [
  {
    id: 'day-1-push',
    name: 'Day 1 - Push',
    exercises: [
      'Barbell Bench Press',
      'Incline Dumbbell Press',
      'Seated Dumbbell Shoulder Press',
      'Cable or Dumbbell Lateral Raises',
      'Tricep Pushdowns',
      'Overhead Tricep Extensions',
      'Push-ups (Finisher)'
    ]
  },
  {
    id: 'day-2-pull',
    name: 'Day 2 - Pull',
    exercises: [
      'Lat Pulldown or Assisted Pull-ups',
      'Barbell or Dumbbell Rows',
      'Seated Cable Row',
      'Face Pulls',
      'Dumbbell Bicep Curls',
      'Hammer Curls'
    ]
  },
  {
    id: 'day-3-legs',
    name: 'Day 3 - Legs',
    exercises: ['Barbell Back Squats', 'Leg Press', 'Walking Lunges', 'Leg Extensions', 'Standing Calf Raises']
  },
  {
    id: 'day-4-upper',
    name: 'Day 4 - Upper',
    exercises: [
      'Incline Barbell or Machine Press',
      'Chest Supported Row',
      'Dumbbell Lateral Raises',
      'Rear Delt Fly (machine or dumbbell)',
      'Cable Chest Fly',
      'EZ Bar Curls',
      'Tricep Pushdowns'
    ]
  },
  {
    id: 'day-5-lower',
    name: 'Day 5 - Lower',
    exercises: [
      'Romanian Deadlifts',
      'Hip Thrusts or Barbell Glute Bridges',
      'Hamstring Curls',
      'Bulgarian Split Squats',
      'Seated Calf Raises'
    ]
  }
];

const state = {
  apiBaseUrl: '',
  currentLatest: null,
  routines: []
};

const elements = {
  routineSelect: document.getElementById('routineSelect'),
  exerciseSelect: document.getElementById('exerciseSelect'),
  workoutDate: document.getElementById('workoutDate'),
  workoutForm: document.getElementById('workoutForm'),
  setsContainer: document.getElementById('setsContainer'),
  addSetBtn: document.getElementById('addSetBtn'),
  reuseLastBtn: document.getElementById('reuseLastBtn'),
  copyLastSetBtn: document.getElementById('copyLastSetBtn'),
  clearSetsBtn: document.getElementById('clearSetsBtn'),
  formMessage: document.getElementById('formMessage'),
  latestSession: document.getElementById('latestSession'),
  stats: document.getElementById('stats'),
  historyList: document.getElementById('historyList'),
  routineEditorSelect: document.getElementById('routineEditorSelect'),
  routineNameInput: document.getElementById('routineNameInput'),
  routineExercisesInput: document.getElementById('routineExercisesInput'),
  saveRoutineBtn: document.getElementById('saveRoutineBtn'),
  addRoutineBtn: document.getElementById('addRoutineBtn'),
  deleteRoutineBtn: document.getElementById('deleteRoutineBtn'),
  resetRoutinesBtn: document.getElementById('resetRoutinesBtn'),
  routineMessage: document.getElementById('routineMessage'),
  tabs: document.querySelectorAll('.tab'),
  tabPanels: document.querySelectorAll('.tab-panel')
};

init().catch((error) => {
  console.error(error);
  setFormMessage('Could not initialize app.', 'error');
});

async function init() {
  elements.workoutDate.value = formatLocalDate(new Date());

  state.routines = loadRoutines();
  renderRoutineSelects();

  resetSetRows();
  restoreDraft();
  updateQuickActionState();

  elements.addSetBtn.addEventListener('click', onAddSet);
  elements.reuseLastBtn.addEventListener('click', onReuseLastSession);
  elements.copyLastSetBtn.addEventListener('click', onCopyLastSet);
  elements.clearSetsBtn.addEventListener('click', onClearSets);
  elements.workoutForm.addEventListener('submit', onSubmitWorkout);
  elements.workoutForm.addEventListener('input', saveDraft);
  elements.workoutDate.addEventListener('change', saveDraft);

  elements.routineSelect.addEventListener('change', () => {
    onRoutineChange().catch((error) => {
      console.error(error);
      setFormMessage(error.message || 'Failed to switch workout.', 'error');
    });
  });

  elements.exerciseSelect.addEventListener('change', () => {
    onExerciseChange().catch((error) => {
      console.error(error);
      setFormMessage(error.message || 'Failed to load exercise.', 'error');
    });
  });

  elements.routineEditorSelect.addEventListener('change', onRoutineEditorChange);
  elements.saveRoutineBtn.addEventListener('click', onSaveRoutine);
  elements.addRoutineBtn.addEventListener('click', onAddRoutine);
  elements.deleteRoutineBtn.addEventListener('click', onDeleteRoutine);
  elements.resetRoutinesBtn.addEventListener('click', onResetRoutines);

  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
  });

  await loadConfig();

  if (elements.exerciseSelect.value) {
    await refreshExerciseViews(elements.exerciseSelect.value);
  }
}

async function loadConfig() {
  const response = await fetch('./config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Missing config.json');
  }

  const config = await response.json();
  const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');

  if (!apiBaseUrl) {
    throw new Error('config.json must include apiBaseUrl');
  }

  state.apiBaseUrl = apiBaseUrl;
}

function renderRoutineSelects(preferredLogRoutineId = '', preferredExerciseName = '', preferredEditorRoutineId = '') {
  if (!state.routines.length) {
    state.routines = cloneDefaultRoutines();
  }

  const logFallbackId = state.routines[0].id;
  const editorFallbackId = state.routines[0].id;

  const logCurrentId = preferredLogRoutineId || elements.routineSelect.value || logFallbackId;
  const editorCurrentId = preferredEditorRoutineId || elements.routineEditorSelect.value || editorFallbackId;

  const optionHtml = state.routines
    .map((routine) => `<option value="${escapeAttribute(routine.id)}">${escapeHtml(routine.name)}</option>`)
    .join('');

  elements.routineSelect.innerHTML = optionHtml;
  elements.routineEditorSelect.innerHTML = optionHtml;

  const selectedLogRoutine = getRoutineById(logCurrentId) ? logCurrentId : logFallbackId;
  elements.routineSelect.value = selectedLogRoutine;
  renderExerciseOptions(preferredExerciseName);

  const selectedEditorRoutine = getRoutineById(editorCurrentId) ? editorCurrentId : editorFallbackId;
  elements.routineEditorSelect.value = selectedEditorRoutine;
  populateRoutineEditor(selectedEditorRoutine);
}

function renderExerciseOptions(preferredExerciseName = '') {
  const routine = getRoutineById(elements.routineSelect.value);

  if (!routine || !routine.exercises.length) {
    elements.exerciseSelect.innerHTML = '<option value="">No exercises available</option>';
    elements.exerciseSelect.disabled = true;
    return;
  }

  elements.exerciseSelect.disabled = false;

  const optionHtml = routine.exercises
    .map((exercise) => `<option value="${escapeAttribute(exercise)}">${escapeHtml(exercise)}</option>`)
    .join('');

  elements.exerciseSelect.innerHTML = optionHtml;

  const currentExercise = preferredExerciseName || elements.exerciseSelect.value;
  const matchedExercise = findExerciseMatch(routine.exercises, currentExercise);
  elements.exerciseSelect.value = matchedExercise || routine.exercises[0];
}

async function onRoutineChange() {
  renderExerciseOptions();
  saveDraft();
  setFormMessage('', '');

  if (state.apiBaseUrl) {
    await onExerciseChange();
  }
}

async function onExerciseChange() {
  const exerciseName = elements.exerciseSelect.value.trim();
  saveDraft();

  if (!exerciseName || !state.apiBaseUrl) {
    state.currentLatest = null;
    updateQuickActionState();
    renderLatest(null);
    renderStats([]);
    renderHistory([]);
    return;
  }

  await refreshExerciseViews(exerciseName);
}

async function refreshExerciseViews(exerciseName) {
  try {
    const encoded = encodeURIComponent(exerciseName);
    const [latestResponse, historyResponse] = await Promise.all([
      apiFetch(`/workouts/latest?exercise=${encoded}`),
      apiFetch(`/workouts?exercise=${encoded}&limit=50`)
    ]);

    const latest = latestResponse.item || null;
    const history = Array.isArray(historyResponse.items) ? historyResponse.items : [];
    const latestSets = Array.isArray(latest?.sets) ? latest.sets : [];
    state.currentLatest = latest;
    updateQuickActionState();

    if (latestSets.length && !hasAnySetInput()) {
      resetSetRows(
        latestSets.map((set) => ({
          reps: set.reps,
          weight: set.weight
        }))
      );
      setFormMessage('Loaded last session sets. Adjust and save.', 'success');
    }

    renderLatest(latest);
    renderStats(history);
    renderHistory(history);
  } catch (error) {
    console.error(error);
    renderLatest(null);
    renderStats([]);
    renderHistory([]);
    setFormMessage(error.message || 'Could not load exercise data.', 'error');
  }
}

function renderLatest(item) {
  if (!item) {
    elements.latestSession.innerHTML = '<h2>Last Session</h2><p class="meta">No previous session found.</p>';
    return;
  }

  const sets = Array.isArray(item.sets) ? item.sets : [];
  const setSummary = sets.map((set) => `${set.reps} reps @ ${formatWeight(set.weight)} kg`).join(', ');
  const topWeight = item.derived?.topSetWeight;
  const topReps = item.derived?.topSetReps;

  elements.latestSession.innerHTML = `
    <h2>Last Session</h2>
    <p class="meta">${item.workoutDate}</p>
    <p>${setSummary || 'No sets'}</p>
    <p class="meta">Top set: ${topReps || 0} reps @ ${formatWeight(topWeight || 0)} kg</p>
  `;
}

function renderStats(items) {
  if (!items.length) {
    elements.stats.innerHTML = '<h2>Stats</h2><p class="meta">No stats yet.</p>';
    return;
  }

  const topWeights = items.map((item) => Number(item.derived?.topSetWeight || 0));
  const bestTopSet = Math.max(...topWeights);
  const latestTopSet = Number(items[0]?.derived?.topSetWeight || 0);
  const latestEst1rm = Number(items[0]?.derived?.est1rm || 0);

  elements.stats.innerHTML = `
    <h2>Stats</h2>
    <p>Best top-set weight: <strong>${formatWeight(bestTopSet)} kg</strong></p>
    <p>Latest top-set weight: <strong>${formatWeight(latestTopSet)} kg</strong></p>
    <p>Latest est. 1RM (Epley): <strong>${formatWeight(latestEst1rm)} kg</strong></p>
  `;
}

function renderHistory(items) {
  if (!items.length) {
    elements.historyList.innerHTML = '<li class="meta">No history for this exercise.</li>';
    return;
  }

  elements.historyList.innerHTML = items
    .map((item) => {
      const topWeight = formatWeight(item.derived?.topSetWeight || 0);
      const topReps = item.derived?.topSetReps || 0;
      return `
        <li class="history-item">
          <p><strong>${item.workoutDate}</strong></p>
          <p class="meta">Top set: ${topReps} reps @ ${topWeight} kg</p>
        </li>
      `;
    })
    .join('');
}

async function onSubmitWorkout(event) {
  event.preventDefault();
  setFormMessage('', '');

  const exerciseName = elements.exerciseSelect.value.trim();
  const workoutDate = elements.workoutDate.value || formatLocalDate(new Date());

  if (!exerciseName) {
    setFormMessage('Select an exercise.', 'error');
    return;
  }

  let sets;
  try {
    sets = collectSets();
  } catch (error) {
    setFormMessage(error.message, 'error');
    return;
  }

  try {
    await apiFetch('/workouts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workoutDate, exerciseName, sets })
    });

    await refreshExerciseViews(exerciseName);
    resetSetRows();
    setFormMessage('Workout saved.', 'success');
    setActiveTab('logSection');
    clearDraft();
    saveDraft();
  } catch (error) {
    console.error(error);
    setFormMessage(error.message || 'Failed to save workout.', 'error');
  }
}

function collectSets() {
  const rows = getSetRows();
  if (!rows.length) {
    throw new Error('Add at least one set.');
  }

  return rows.map((row, index) => {
    const repsValue = row.querySelector('.reps-input').value;
    const weightValue = row.querySelector('.weight-input').value;

    const reps = Number.parseInt(repsValue, 10);
    const weight = Number(weightValue);

    if (!Number.isInteger(reps) || reps < 1 || reps > 200) {
      throw new Error(`Set ${index + 1}: reps must be 1-200.`);
    }

    if (!Number.isFinite(weight) || weight < 0 || weight > 2000) {
      throw new Error(`Set ${index + 1}: weight must be 0-2000.`);
    }

    return { reps, weight };
  });
}

function onAddSet() {
  addSetRow();
  focusLastSetInput('reps-input');
  saveDraft();
}

function onCopyLastSet() {
  const rows = getSetRows();
  if (!rows.length) {
    addSetRow();
    focusLastSetInput('reps-input');
    saveDraft();
    return;
  }

  const lastRow = rows[rows.length - 1];
  const defaultReps = lastRow.querySelector('.reps-input').value;
  const defaultWeight = lastRow.querySelector('.weight-input').value;

  addSetRow(defaultReps, defaultWeight);
  focusLastSetInput('reps-input');
  saveDraft();
}

function onClearSets() {
  resetSetRows();
  saveDraft();
}

function onReuseLastSession() {
  const latestSets = state.currentLatest?.sets;
  if (!Array.isArray(latestSets) || !latestSets.length) {
    setFormMessage('No previous session to reuse.', 'error');
    return;
  }

  resetSetRows(
    latestSets.map((set) => ({
      reps: set.reps,
      weight: set.weight
    }))
  );
  setFormMessage('Loaded last session sets. Adjust and save.', 'success');
  focusLastSetInput('weight-input');
  saveDraft();
}

function resetSetRows(defaultSets = [{ reps: '', weight: '' }]) {
  const rows = Array.isArray(defaultSets) && defaultSets.length ? defaultSets : [{ reps: '', weight: '' }];

  elements.setsContainer.innerHTML = '';
  rows.forEach((set) => addSetRow(set.reps, set.weight));
  updateSetLabels();
  updateQuickActionState();
}

function addSetRow(defaultReps = '', defaultWeight = '') {
  const row = document.createElement('div');
  row.className = 'set-row';
  row.innerHTML = `
    <span class="set-label"></span>
    <input class="reps-input" type="number" min="1" max="200" step="1" inputmode="numeric" placeholder="Reps" value="${escapeAttribute(
      defaultReps
    )}" required />
    <input class="weight-input" type="number" min="0" max="2000" step="0.01" inputmode="decimal" placeholder="Weight (kg)" value="${escapeAttribute(
      defaultWeight
    )}" required />
    <button type="button" class="remove-set">Remove</button>
  `;

  row.querySelector('.remove-set').addEventListener('click', () => {
    row.remove();
    if (!elements.setsContainer.children.length) {
      addSetRow();
    }
    updateSetLabels();
    updateQuickActionState();
    saveDraft();
  });

  elements.setsContainer.appendChild(row);
  updateSetLabels();
  updateQuickActionState();
}

function updateSetLabels() {
  [...elements.setsContainer.querySelectorAll('.set-row .set-label')].forEach((label, index) => {
    label.textContent = `Set ${index + 1}`;
  });
}

function updateQuickActionState() {
  const hasLatestSets = Array.isArray(state.currentLatest?.sets) && state.currentLatest.sets.length > 0;
  const rows = getSetRows();
  const hasRow = rows.length > 0;
  const hasInput = hasAnySetInput(rows);

  elements.reuseLastBtn.disabled = !hasLatestSets;
  elements.copyLastSetBtn.disabled = !hasRow;
  elements.clearSetsBtn.disabled = !hasInput && rows.length <= 1;
}

function getSetRows() {
  return [...elements.setsContainer.querySelectorAll('.set-row')];
}

function hasAnySetInput(rows = getSetRows()) {
  return rows.some((row) => {
    const reps = row.querySelector('.reps-input').value.trim();
    const weight = row.querySelector('.weight-input').value.trim();
    return reps || weight;
  });
}

function onRoutineEditorChange() {
  populateRoutineEditor(elements.routineEditorSelect.value);
  setRoutineMessage('', '');
}

function onSaveRoutine() {
  const routineId = elements.routineEditorSelect.value;
  const routine = getRoutineById(routineId);

  if (!routine) {
    setRoutineMessage('Select a workout to edit.', 'error');
    return;
  }

  const routineName = sanitizeRoutineName(elements.routineNameInput.value);
  const exercises = parseExerciseList(elements.routineExercisesInput.value);

  if (!routineName) {
    setRoutineMessage('Workout name is required.', 'error');
    return;
  }

  if (!exercises.length) {
    setRoutineMessage('Add at least one exercise.', 'error');
    return;
  }

  const duplicateName = state.routines.some(
    (item) => item.id !== routineId && normalizeKey(item.name) === normalizeKey(routineName)
  );

  if (duplicateName) {
    setRoutineMessage('Workout name must be unique.', 'error');
    return;
  }

  routine.name = routineName;
  routine.exercises = exercises;

  persistRoutines();

  const selectedLogRoutine = elements.routineSelect.value;
  const selectedExercise = elements.exerciseSelect.value;
  const nextExercise =
    selectedLogRoutine === routineId && !findExerciseMatch(exercises, selectedExercise)
      ? exercises[0]
      : selectedExercise;

  renderRoutineSelects(selectedLogRoutine, nextExercise, routineId);
  saveDraft();

  if (state.apiBaseUrl && elements.exerciseSelect.value) {
    onExerciseChange().catch((error) => {
      console.error(error);
      setFormMessage(error.message || 'Failed to refresh exercise view.', 'error');
    });
  }

  setRoutineMessage('Workout saved.', 'success');
}

function onAddRoutine() {
  const usedIds = new Set(state.routines.map((routine) => routine.id));
  let number = state.routines.length + 1;
  let nameCandidate = `Workout ${number}`;

  while (state.routines.some((routine) => normalizeKey(routine.name) === normalizeKey(nameCandidate))) {
    number += 1;
    nameCandidate = `Workout ${number}`;
  }

  const newRoutine = {
    id: buildRoutineId(nameCandidate, usedIds),
    name: nameCandidate,
    exercises: ['New Exercise']
  };

  state.routines.push(newRoutine);
  persistRoutines();

  renderRoutineSelects(elements.routineSelect.value, elements.exerciseSelect.value, newRoutine.id);
  setRoutineMessage('New workout added. Edit and save it when ready.', 'success');
  setActiveTab('routinesSection');
  elements.routineNameInput.focus();
  elements.routineNameInput.select();
}

function onDeleteRoutine() {
  if (state.routines.length <= 1) {
    setRoutineMessage('At least one workout must remain.', 'error');
    return;
  }

  const routineId = elements.routineEditorSelect.value;
  const routine = getRoutineById(routineId);

  if (!routine) {
    setRoutineMessage('Select a workout to delete.', 'error');
    return;
  }

  if (!confirm(`Delete "${routine.name}"?`)) {
    return;
  }

  state.routines = state.routines.filter((item) => item.id !== routineId);
  persistRoutines();

  const fallbackRoutineId = state.routines[0].id;
  const nextLogRoutine = elements.routineSelect.value === routineId ? fallbackRoutineId : elements.routineSelect.value;

  renderRoutineSelects(nextLogRoutine, elements.exerciseSelect.value, fallbackRoutineId);
  saveDraft();

  if (state.apiBaseUrl) {
    onExerciseChange().catch((error) => {
      console.error(error);
      setFormMessage(error.message || 'Failed to refresh exercise view.', 'error');
    });
  }

  setRoutineMessage('Workout deleted.', 'success');
}

function onResetRoutines() {
  if (!confirm('Reset all workouts to the original defaults?')) {
    return;
  }

  state.routines = cloneDefaultRoutines();
  persistRoutines();

  renderRoutineSelects(state.routines[0].id, '', state.routines[0].id);
  saveDraft();

  if (state.apiBaseUrl) {
    onExerciseChange().catch((error) => {
      console.error(error);
      setFormMessage(error.message || 'Failed to refresh exercise view.', 'error');
    });
  }

  setRoutineMessage('Workouts reset to defaults.', 'success');
}

function populateRoutineEditor(routineId) {
  const routine = getRoutineById(routineId);
  if (!routine) {
    elements.routineNameInput.value = '';
    elements.routineExercisesInput.value = '';
    return;
  }

  elements.routineNameInput.value = routine.name;
  elements.routineExercisesInput.value = routine.exercises.join('\n');
}

function getRoutineById(routineId) {
  return state.routines.find((routine) => routine.id === routineId) || null;
}

function loadRoutines() {
  try {
    const rawValue = localStorage.getItem(ROUTINES_STORAGE_KEY);
    if (rawValue) {
      const parsed = JSON.parse(rawValue);
      const sanitized = sanitizeRoutines(parsed);
      if (sanitized.length) {
        return sanitized;
      }
    }
  } catch (_) {
    // Ignore malformed storage value.
  }

  const defaults = cloneDefaultRoutines();
  persistRoutines(defaults);
  return defaults;
}

function sanitizeRoutines(rawRoutines) {
  if (!Array.isArray(rawRoutines)) {
    return [];
  }

  const routines = [];
  const usedIds = new Set();

  rawRoutines.forEach((item, index) => {
    const name = sanitizeRoutineName(item?.name);
    const exercises = parseExerciseList(item?.exercises);

    if (!name || !exercises.length) {
      return;
    }

    let id = sanitizeRoutineId(item?.id);
    if (!id || usedIds.has(id)) {
      id = buildRoutineId(`${name}-${index + 1}`, usedIds);
    }

    usedIds.add(id);
    routines.push({ id, name, exercises });
  });

  return routines;
}

function persistRoutines(routines = state.routines) {
  try {
    localStorage.setItem(ROUTINES_STORAGE_KEY, JSON.stringify(routines));
  } catch (_) {
    // Ignore storage write failures.
  }
}

function parseExerciseList(rawValue) {
  const lines = Array.isArray(rawValue) ? rawValue : String(rawValue || '').split('\n');
  const unique = [];
  const seen = new Set();

  lines.forEach((line) => {
    const normalizedName = sanitizeExerciseName(line);
    if (!normalizedName) {
      return;
    }

    const key = normalizeKey(normalizedName);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    unique.push(normalizedName);
  });

  return unique;
}

function findExerciseMatch(exercises, targetExerciseName) {
  const targetKey = normalizeKey(targetExerciseName);
  if (!targetKey) {
    return '';
  }

  return exercises.find((exercise) => normalizeKey(exercise) === targetKey) || '';
}

function sanitizeExerciseName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function sanitizeRoutineName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function sanitizeRoutineId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildRoutineId(seed, usedIds = new Set(state.routines.map((routine) => routine.id))) {
  const base =
    String(seed || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'workout';

  let suffix = 1;
  let candidate = base;

  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

function cloneDefaultRoutines() {
  return DEFAULT_ROUTINES.map((routine) => ({
    id: routine.id,
    name: routine.name,
    exercises: [...routine.exercises]
  }));
}

function normalizeKey(value) {
  return sanitizeExerciseName(value).toLowerCase();
}

function setActiveTab(tabId) {
  elements.tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });

  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${state.apiBaseUrl}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

function setFormMessage(message, type) {
  elements.formMessage.textContent = message;
  elements.formMessage.className = `message ${type || ''}`.trim();
}

function setRoutineMessage(message, type) {
  elements.routineMessage.textContent = message;
  elements.routineMessage.className = `message ${type || ''}`.trim();
}

function saveDraft() {
  try {
    const draft = {
      routineId: elements.routineSelect.value,
      exerciseName: elements.exerciseSelect.value,
      workoutDate: elements.workoutDate.value || formatLocalDate(new Date()),
      sets: getSetRows().map((row) => ({
        reps: row.querySelector('.reps-input').value.trim(),
        weight: row.querySelector('.weight-input').value.trim()
      }))
    };

    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch (_) {
    // Ignore storage errors.
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const draft = JSON.parse(raw);
    const workoutDate = sanitizeDraftField(draft.workoutDate);
    const routineId = sanitizeRoutineId(draft.routineId);
    const exerciseName = sanitizeExerciseName(draft.exerciseName);

    if (/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
      elements.workoutDate.value = workoutDate;
    }

    if (getRoutineById(routineId)) {
      elements.routineSelect.value = routineId;
    }

    renderExerciseOptions(exerciseName);

    if (Array.isArray(draft.sets) && draft.sets.length) {
      resetSetRows(
        draft.sets.map((set) => ({
          reps: sanitizeDraftField(set.reps),
          weight: sanitizeDraftField(set.weight)
        }))
      );
    }
  } catch (_) {
    // Ignore malformed drafts.
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch (_) {
    // Ignore storage errors.
  }
}

function sanitizeDraftField(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function focusLastSetInput(className) {
  const rows = getSetRows();
  if (!rows.length) {
    return;
  }

  const targetInput = rows[rows.length - 1].querySelector(`.${className}`);
  if (targetInput) {
    targetInput.focus();
  }
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatWeight(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
