'use strict';

const state = {
  apiBaseUrl: '',
  exercises: []
};

const elements = {
  exerciseInput: document.getElementById('exerciseInput'),
  exerciseSuggestions: document.getElementById('exerciseSuggestions'),
  workoutDate: document.getElementById('workoutDate'),
  workoutForm: document.getElementById('workoutForm'),
  setsContainer: document.getElementById('setsContainer'),
  addSetBtn: document.getElementById('addSetBtn'),
  formMessage: document.getElementById('formMessage'),
  latestSession: document.getElementById('latestSession'),
  stats: document.getElementById('stats'),
  historyList: document.getElementById('historyList'),
  tabs: document.querySelectorAll('.tab'),
  tabPanels: document.querySelectorAll('.tab-panel')
};

init().catch((error) => {
  console.error(error);
  setFormMessage('Could not initialize app.', 'error');
});

async function init() {
  elements.workoutDate.value = formatLocalDate(new Date());
  addSetRow();

  elements.addSetBtn.addEventListener('click', () => addSetRow());
  elements.workoutForm.addEventListener('submit', onSubmitWorkout);
  elements.exerciseInput.addEventListener('change', onExerciseChange);
  elements.exerciseInput.addEventListener('blur', onExerciseChange);

  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
  });

  await loadConfig();
  await loadExercises();
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

async function loadExercises() {
  const data = await apiFetch('/exercises');
  state.exercises = Array.isArray(data.items) ? data.items : [];

  elements.exerciseSuggestions.innerHTML = state.exercises
    .map((exercise) => `<option value="${escapeHtml(exercise.exerciseName)}"></option>`)
    .join('');
}

async function onExerciseChange() {
  const exerciseName = elements.exerciseInput.value.trim();

  if (!exerciseName) {
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

  const exerciseName = elements.exerciseInput.value.trim();
  const workoutDate = elements.workoutDate.value || formatLocalDate(new Date());

  if (!exerciseName) {
    setFormMessage('Exercise name is required.', 'error');
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

    await loadExercises();
    await refreshExerciseViews(exerciseName);
    setFormMessage('Workout saved.', 'success');
    setActiveTab('historySection');
  } catch (error) {
    console.error(error);
    setFormMessage(error.message || 'Failed to save workout.', 'error');
  }
}

function collectSets() {
  const rows = [...elements.setsContainer.querySelectorAll('.set-row')];
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

function addSetRow(defaultReps = '', defaultWeight = '') {
  const row = document.createElement('div');
  row.className = 'set-row';
  row.innerHTML = `
    <span class="set-label"></span>
    <input class="reps-input" type="number" min="1" max="200" step="1" placeholder="Reps" value="${defaultReps}" required />
    <input class="weight-input" type="number" min="0" max="2000" step="0.01" placeholder="Weight (kg)" value="${defaultWeight}" required />
    <button type="button" class="remove-set">Remove</button>
  `;

  row.querySelector('.remove-set').addEventListener('click', () => {
    row.remove();
    if (!elements.setsContainer.children.length) {
      addSetRow();
    }
    updateSetLabels();
  });

  elements.setsContainer.appendChild(row);
  updateSetLabels();
}

function updateSetLabels() {
  [...elements.setsContainer.querySelectorAll('.set-row .set-label')].forEach((label, index) => {
    label.textContent = `Set ${index + 1}`;
  });
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
