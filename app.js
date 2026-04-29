// ===== Supabase 設定 =====
// 以下の2行をあなたのSupabaseプロジェクトの値に書き換えてください
const SUPABASE_URL = 'https://dohodudlajausbnemqbo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvaG9kdWRsYWphdXNibmVtcWJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTI0MTgsImV4cCI6MjA5MzAyODQxOH0.XUVMCPStcJ794qzR3Qdlfy8uwrNIvRcVyfSME-6hRdA';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== 時間ブロック定義 =====
const TIME_BLOCKS = [
  { start: 9,  label: '09:00 〜 13:00' },
  { start: 13, label: '13:00 〜 17:00' },
  { start: 17, label: '17:00 〜 21:00' },
  { start: 21, label: '21:00 〜' },
];

// ===== 状態 =====
let currentView = 'daily';
let currentDate = new Date();
let currentMonth = new Date();
let tasks = [];
let categories = [];
let completions = [];
let editingTaskId = null;

// ===== 初期化 =====
async function init() {
  await Promise.all([loadCategories(), loadTasks()]);
  renderCurrentView();
  setupEventListeners();
}

// ===== データ取得 =====
async function loadCategories() {
  const { data } = await db.from('categories').select('*').order('created_at');
  if (data) categories = data;
}

async function loadTasks() {
  const { data: taskData } = await db.from('tasks').select('*').order('created_at');
  if (taskData) tasks = taskData;

  const { data: compData } = await db.from('task_completions').select('*');
  if (compData) completions = compData;
}

// ===== 繰り返し判定 =====
function isTaskOnDate(task, dateStr) {
  if (task.date === dateStr) return true;
  if (task.repeat === 'none') return false;

  const base = new Date(task.date);
  const target = new Date(dateStr);
  if (target <= base) return false;

  if (task.repeat === 'weekly') {
    return base.getDay() === target.getDay();
  }
  if (task.repeat === 'monthly') {
    return base.getDate() === target.getDate();
  }
  return false;
}

function isTaskDoneOnDate(task, dateStr) {
  if (task.repeat === 'none') return task.done;
  return completions.some(c => c.task_id === task.id && c.date === dateStr);
}

function getTasksForDate(dateStr) {
  return tasks.filter(t => isTaskOnDate(t, dateStr));
}

// ===== 日付ユーティリティ =====
function toDateStr(date) {
  return date.toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

function formatDateJP(date) {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getMonth() + 1}月${date.getDate()}日（${days[date.getDay()]}）`;
}

// ===== ビュー切り替え =====
function renderCurrentView() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`${currentView}-view`).classList.add('active');

  if (currentView === 'daily') renderDailyView();
  else if (currentView === 'calendar') renderCalendarView();
  else if (currentView === 'category') renderCategoryView();
}

// ===== デイリービュー =====
function renderDailyView() {
  document.getElementById('current-date').textContent = formatDateJP(currentDate);
  const dateStr = toDateStr(currentDate);
  const dayTasks = getTasksForDate(dateStr);

  const container = document.getElementById('time-blocks');
  container.innerHTML = '';

  TIME_BLOCKS.forEach(block => {
    const blockTasks = dayTasks.filter(t => t.time_block === block.start);
    const div = document.createElement('div');
    div.className = 'time-block';
    div.innerHTML = `
      <div class="time-block-header">
        <span class="time-label">${block.label}</span>
        <span class="task-count">${blockTasks.length}件</span>
      </div>
      <div class="task-list">
        ${blockTasks.map(t => renderTaskItem(t, dateStr)).join('')}
      </div>
      <button class="add-in-block" data-block="${block.start}" data-date="${dateStr}">＋ タスクを追加</button>
    `;
    container.appendChild(div);
  });
}

function renderTaskItem(task, dateStr) {
  const done = isTaskDoneOnDate(task, dateStr);
  const cat = categories.find(c => c.id === task.category_id);
  const repeatLabel = { weekly: '毎週', monthly: '毎月' }[task.repeat] || '';

  return `
    <div class="task-item ${done ? 'done' : ''}">
      <button class="check-btn" onclick="toggleTask('${task.id}', '${dateStr}', ${done})">
        ${done ? '✓' : ''}
      </button>
      <div class="task-content">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <div class="task-badges">
          ${cat ? `<span class="task-cat">${escapeHtml(cat.name)}</span>` : ''}
          ${repeatLabel ? `<span class="task-repeat">${repeatLabel}</span>` : ''}
        </div>
      </div>
      <button class="delete-btn" onclick="deleteTask('${task.id}')">×</button>
    </div>
  `;
}

// ===== カレンダービュー =====
function renderCalendarView() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  document.getElementById('current-month').textContent = `${year}年${month + 1}月`;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  ['日', '月', '火', '水', '木', '金', '土'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-day-header';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const todayStr = toDateStr(new Date());

  for (let i = 0; i < firstDay.getDay(); i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-day empty';
    grid.appendChild(blank);
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    const dateStr = toDateStr(date);
    const dayTasks = getTasksForDate(dateStr);
    const isToday = dateStr === todayStr;

    const div = document.createElement('div');
    div.className = `cal-day${isToday ? ' today' : ''}`;
    div.innerHTML = `
      <span class="cal-date">${d}</span>
      ${dayTasks.length > 0 ? `<span class="cal-count">${dayTasks.length}</span>` : ''}
    `;
    div.onclick = () => {
      currentDate = date;
      switchView('daily');
    };
    grid.appendChild(div);
  }
}

// ===== カテゴリビュー =====
function renderCategoryView() {
  const container = document.getElementById('category-list');
  container.innerHTML = '';

  const noCatTasks = tasks.filter(t => !t.category_id);
  if (noCatTasks.length > 0) {
    container.appendChild(renderCategorySection('カテゴリなし', noCatTasks));
  }

  categories.forEach(cat => {
    const catTasks = tasks.filter(t => t.category_id === cat.id);
    container.appendChild(renderCategorySection(cat.name, catTasks));
  });
}

function renderCategorySection(name, catTasks) {
  const section = document.createElement('div');
  section.className = 'category-section';
  section.innerHTML = `
    <div class="category-header">
      <span class="category-name">${escapeHtml(name)}</span>
      <span class="category-count">${catTasks.length}件</span>
    </div>
    <div>
      ${catTasks.map(t => `
        <div class="task-item-simple">
          <span>${escapeHtml(t.title)}</span>
          <span class="task-date">${t.date}</span>
        </div>
      `).join('')}
      ${catTasks.length === 0 ? '<div style="padding:10px 14px;font-size:13px;color:#aaa">タスクなし</div>' : ''}
    </div>
  `;
  return section;
}

// ===== タスク操作 =====
async function toggleTask(taskId, dateStr, currentDone) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  if (task.repeat === 'none') {
    const { error } = await db.from('tasks').update({ done: !currentDone }).eq('id', taskId);
    if (!error) task.done = !currentDone;
  } else {
    if (!currentDone) {
      const { data } = await db.from('task_completions').insert({ task_id: taskId, date: dateStr }).select().single();
      if (data) completions.push(data);
    } else {
      await db.from('task_completions').delete().eq('task_id', taskId).eq('date', dateStr);
      completions = completions.filter(c => !(c.task_id === taskId && c.date === dateStr));
    }
  }
  renderCurrentView();
}

async function deleteTask(taskId) {
  if (!confirm('このタスクを削除しますか？')) return;
  const { error } = await db.from('tasks').delete().eq('id', taskId);
  if (!error) {
    tasks = tasks.filter(t => t.id !== taskId);
    renderCurrentView();
  }
}

async function saveTask() {
  const title = document.getElementById('task-title').value.trim();
  const categoryId = document.getElementById('task-category').value || null;
  const date = document.getElementById('task-date').value;
  const timeBlock = parseInt(document.getElementById('task-time-block').value);
  const repeat = document.getElementById('task-repeat').value;

  if (!title || !date) {
    alert('タスク名と日付を入力してください');
    return;
  }

  const payload = { title, category_id: categoryId, date, time_block: timeBlock, repeat, done: false };

  if (editingTaskId) {
    const { data, error } = await db.from('tasks').update(payload).eq('id', editingTaskId).select().single();
    if (!error) {
      const idx = tasks.findIndex(t => t.id === editingTaskId);
      if (idx > -1) tasks[idx] = data;
    }
  } else {
    const { data, error } = await db.from('tasks').insert(payload).select().single();
    if (!error) tasks.push(data);
  }

  closeTaskModal();
  renderCurrentView();
}

// ===== カテゴリ操作 =====
async function saveCategory() {
  const name = document.getElementById('new-category-name').value.trim();
  if (!name) return;

  const { data, error } = await db.from('categories').insert({ name }).select().single();
  if (!error) {
    categories.push(data);
    document.getElementById('new-category-name').value = '';
    renderCategoryModalList();
    refreshCategorySelect();
  }
}

async function deleteCategory(id) {
  if (!confirm('このカテゴリを削除しますか？')) return;
  const { error } = await db.from('categories').delete().eq('id', id);
  if (!error) {
    categories = categories.filter(c => c.id !== id);
    renderCategoryModalList();
    refreshCategorySelect();
    if (currentView === 'category') renderCategoryView();
  }
}

// ===== モーダル =====
function openTaskModal(timeBlock, dateStr) {
  editingTaskId = null;
  document.getElementById('modal-title').textContent = 'タスクを追加';
  document.getElementById('task-title').value = '';
  document.getElementById('task-category').value = '';
  document.getElementById('task-date').value = dateStr || toDateStr(currentDate);
  document.getElementById('task-time-block').value = timeBlock || 9;
  document.getElementById('task-repeat').value = 'none';
  refreshCategorySelect();
  document.getElementById('task-modal').classList.remove('hidden');
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
  editingTaskId = null;
}

function openCategoryModal() {
  renderCategoryModalList();
  document.getElementById('category-modal').classList.remove('hidden');
}

function closeCategoryModal() {
  document.getElementById('category-modal').classList.add('hidden');
}

function renderCategoryModalList() {
  document.getElementById('category-modal-list').innerHTML = categories.map(cat => `
    <div class="cat-modal-item">
      <span>${escapeHtml(cat.name)}</span>
      <button onclick="deleteCategory('${cat.id}')">削除</button>
    </div>
  `).join('') || '<div style="padding:10px 0;font-size:13px;color:#aaa">カテゴリがありません</div>';
}

function refreshCategorySelect() {
  const select = document.getElementById('task-category');
  const current = select.value;
  select.innerHTML = '<option value="">カテゴリなし</option>' +
    categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  select.value = current;
}

// ===== ビュー切り替えヘルパー =====
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  renderCurrentView();
}

// ===== XSS対策 =====
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== イベントリスナー =====
function setupEventListeners() {
  // ナビゲーション
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // デイリー日付移動
  document.getElementById('prev-day').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 1);
    renderDailyView();
  });
  document.getElementById('next-day').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() + 1);
    renderDailyView();
  });

  // カレンダー月移動
  document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    renderCalendarView();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    renderCalendarView();
  });

  // FABタスク追加
  document.getElementById('add-task-btn').addEventListener('click', () => openTaskModal());

  // ブロック内追加（イベント委譲）
  document.getElementById('time-blocks').addEventListener('click', e => {
    const btn = e.target.closest('.add-in-block');
    if (btn) openTaskModal(parseInt(btn.dataset.block), btn.dataset.date);
  });

  // タスクモーダル
  document.getElementById('save-task').addEventListener('click', saveTask);
  document.getElementById('cancel-task').addEventListener('click', closeTaskModal);

  // カテゴリモーダル
  document.getElementById('manage-cat-btn').addEventListener('click', openCategoryModal);
  document.getElementById('save-category').addEventListener('click', saveCategory);
  document.getElementById('close-category-modal').addEventListener('click', closeCategoryModal);

  // モーダル外タップで閉じる
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });
}

// ===== 起動 =====
init();
