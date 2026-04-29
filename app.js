// ===== Supabase 設定 =====
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

// ===== 状態管理 =====
let currentView = 'gtd';
let activePanel = 'inbox';
let currentDate = new Date();
let currentMonth = new Date();
let tasks = [];
let categories = [];
let completions = [];
let editingTaskId = null;
let defaultTimeBlock = 9;
let blockSortables = [];
let inboxSortable = null;

// ===== 初期化 =====
async function init() {
  // イベントリスナーを最初に設定（データ読み込み前でもボタンが動くように）
  setupEventListeners();
  try {
    await Promise.all([loadCategories(), loadTasks()]);
    renderCurrentView();
    setupRealtime(); // リアルタイム同期を開始
  } catch (err) {
    console.error('読み込みエラー:', err);
  }
}

// ===== データ取得 =====
async function loadCategories() {
  const { data } = await db.from('categories').select('*').order('created_at');
  if (data) categories = data;
}

async function loadTasks() {
  const { data: t } = await db.from('tasks').select('*').order('created_at');
  if (t) tasks = t;
  const { data: c } = await db.from('task_completions').select('*');
  if (c) completions = c;
}

// ===== 日付ユーティリティ =====
function toDateStr(date) {
  return date.toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

function formatDateJP(date) {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getMonth() + 1}月${date.getDate()}日（${days[date.getDay()]}）`;
}

// ===== 繰り返し判定 =====
function isTaskOnDate(task, dateStr) {
  if (task.date === dateStr) return true;
  if (!task.repeat || task.repeat === 'none') return false;
  const base = new Date(task.date);
  const target = new Date(dateStr);
  if (target <= base) return false;
  if (task.repeat === 'daily') return true;
  if (task.repeat === 'weekly') return base.getDay() === target.getDay();
  if (task.repeat === 'monthly') return base.getDate() === target.getDate();
  return false;
}

function isTaskDoneOnDate(task, dateStr) {
  if (!task.repeat || task.repeat === 'none') return task.done;
  return completions.some(c => c.task_id === task.id && c.date === dateStr);
}

function getTasksForDate(dateStr) {
  // in_inbox が true のタスクは除外（INBOXにあるもの）
  return tasks.filter(t => !t.in_inbox && isTaskOnDate(t, dateStr));
}

// ===== 時間 → ブロック自動振り分け =====
function timeToBlock(timeStr) {
  if (!timeStr) return null;
  const hour = parseInt(timeStr.split(':')[0]);
  if (hour < 13) return 9;
  if (hour < 17) return 13;
  if (hour < 21) return 17;
  return 21;
}

// ===== ビュー切り替え =====
function renderCurrentView() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`${currentView}-view`).classList.add('active');
  if (currentView === 'gtd') renderGTDView();
  else if (currentView === 'calendar') renderCalendarView();
  else if (currentView === 'category') renderCategoryView();
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  renderCurrentView();
}

// ===== GTD ビュー =====
function renderGTDView() {
  renderInbox();
  renderDailyBlocks();
  updatePanelVisibility();
}

function updatePanelVisibility() {
  const isTablet = window.innerWidth >= 768;
  const inboxCol = document.getElementById('inbox-col');
  const todayCol = document.getElementById('today-col');
  if (isTablet) {
    inboxCol.classList.add('active');
    todayCol.classList.add('active');
  } else {
    inboxCol.classList.toggle('active', activePanel === 'inbox');
    todayCol.classList.toggle('active', activePanel === 'today');
  }
}

// ===== INBOX =====
function renderInbox() {
  const inboxTasks = tasks.filter(t => t.in_inbox === true);
  const count = inboxTasks.length;

  document.getElementById('inbox-count').textContent = count;
  document.getElementById('inbox-badge').textContent = count;

  const list = document.getElementById('inbox-list');
  list.innerHTML = '';

  if (inboxTasks.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:#aaa">タスクなし</div>';
  } else {
    inboxTasks.forEach(task => {
      const cat = categories.find(c => c.id === task.category_id);
      const el = document.createElement('div');
      el.className = `inbox-item${task.done ? ' done' : ''}`;
      el.dataset.taskId = task.id;
      el.innerHTML = `
        <span class="drag-handle">⠿</span>
        <button class="check-btn" onclick="toggleInboxTask('${task.id}')">${task.done ? '✓' : ''}</button>
        <div class="task-content">
          <span class="task-title">${escapeHtml(task.title)}</span>
          ${cat ? `<div class="task-badges"><span class="task-cat">${escapeHtml(cat.name)}</span></div>` : ''}
        </div>
        <button class="edit-btn" onclick="editTask('${task.id}')">編集</button>
        <button class="delete-btn" onclick="deleteTask('${task.id}')">×</button>
      `;
      list.appendChild(el);
    });
  }

  setupInboxSortable();
}

function setupInboxSortable() {
  if (typeof Sortable === 'undefined') return; // SortableJS未読み込み時はスキップ
  if (inboxSortable) { inboxSortable.destroy(); inboxSortable = null; }
  const list = document.getElementById('inbox-list');
  inboxSortable = new Sortable(list, {
    group: { name: 'tasks', pull: true, put: true },
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    handle: '.drag-handle',
    onAdd: async (evt) => {
      const taskId = evt.item.dataset.taskId;
      if (taskId) await moveTaskToInbox(taskId);
    },
    onStart: highlightDropZones,
    onEnd: clearDropZones,
  });
}

// ===== 時間ブロック =====
function renderDailyBlocks() {
  document.getElementById('current-date').textContent = formatDateJP(currentDate);
  const dateStr = toDateStr(currentDate);
  const dayTasks = getTasksForDate(dateStr);

  // 古いSortableを破棄
  blockSortables.forEach(s => s.destroy());
  blockSortables = [];

  const container = document.getElementById('time-blocks');
  container.innerHTML = '';

  TIME_BLOCKS.forEach(block => {
    const blockTasks = dayTasks
      .filter(t => t.time_block === block.start)
      .sort((a, b) => (a.task_time || '99:99').localeCompare(b.task_time || '99:99'));

    const blockEl = document.createElement('div');
    blockEl.className = 'time-block';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'time-block-header';
    header.innerHTML = `
      <span class="time-label">${block.label}</span>
      <span class="task-count">${blockTasks.length}件</span>
    `;
    blockEl.appendChild(header);

    // ドロップゾーン
    const zone = document.createElement('div');
    zone.className = 'block-task-zone';
    zone.dataset.block = block.start;
    zone.dataset.date = dateStr;

    blockTasks.forEach(t => zone.appendChild(createTaskElement(t, dateStr)));
    blockEl.appendChild(zone);

    // ＋追加ボタン
    const addBtn = document.createElement('button');
    addBtn.className = 'add-in-block';
    addBtn.textContent = '＋ タスクを追加';
    addBtn.addEventListener('click', () => openTaskModal(block.start, dateStr));
    blockEl.appendChild(addBtn);

    container.appendChild(blockEl);

    // SortableJS をドロップゾーンにセット（読み込まれていれば）
    if (typeof Sortable !== 'undefined') {
      const s = new Sortable(zone, {
        group: { name: 'tasks', pull: true, put: true },
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        filter: '.is-repeat',
        onAdd: async (evt) => {
          const taskId = evt.item.dataset.taskId;
          if (taskId) await moveTaskToBlock(taskId, block.start, dateStr);
        },
        onStart: highlightDropZones,
        onEnd: clearDropZones,
      });
      blockSortables.push(s);
    }
  });
}

function createTaskElement(task, dateStr) {
  const done = isTaskDoneOnDate(task, dateStr);
  const cat = categories.find(c => c.id === task.category_id);
  const isRepeat = task.repeat && task.repeat !== 'none';
  const repeatLabel = { daily: '毎日', weekly: '毎週', monthly: '毎月' }[task.repeat] || '';

  const el = document.createElement('div');
  el.className = `task-item${done ? ' done' : ''}${isRepeat ? ' is-repeat' : ''}`;
  el.dataset.taskId = task.id;

  const badges = [];
  if (cat) badges.push(`<span class="task-cat">${escapeHtml(cat.name)}</span>`);
  if (repeatLabel) badges.push(`<span class="task-repeat">${repeatLabel}</span>`);

  el.innerHTML = `
    ${!isRepeat ? '<span class="drag-handle">⠿</span>' : '<span style="width:8px;flex-shrink:0"></span>'}
    <button class="check-btn" onclick="toggleTask('${task.id}','${dateStr}',${done})">${done ? '✓' : ''}</button>
    <div class="task-content">
      <span class="task-title">${escapeHtml(task.title)}</span>
      ${task.task_time ? `<span class="task-time-range">${task.task_time.slice(0,5)}${task.task_time_end ? ' 〜 ' + task.task_time_end.slice(0,5) : ''}</span>` : ''}
      ${badges.length ? `<div class="task-badges">${badges.join('')}</div>` : ''}
    </div>
    <button class="edit-btn" onclick="editTask('${task.id}')">編集</button>
    <button class="delete-btn" onclick="deleteTask('${task.id}')">×</button>
  `;
  return el;
}

// ===== ドロップゾーンのハイライト =====
function highlightDropZones() {
  document.querySelectorAll('.block-task-zone').forEach(z => z.classList.add('drop-highlight'));
}

function clearDropZones() {
  document.querySelectorAll('.block-task-zone').forEach(z => z.classList.remove('drop-highlight'));
}

// ===== タスク移動 =====
async function moveTaskToBlock(taskId, block, dateStr) {
  const task = tasks.find(t => t.id === taskId);
  // 繰り返しタスクは移動不可
  if (task && task.repeat && task.repeat !== 'none') {
    setTimeout(() => renderGTDView(), 50);
    return;
  }
  const { error } = await db.from('tasks')
    .update({ in_inbox: false, time_block: block, date: dateStr })
    .eq('id', taskId);
  if (!error && task) {
    task.in_inbox = false;
    task.time_block = block;
    task.date = dateStr;
  }
  setTimeout(() => renderGTDView(), 100);
}

async function moveTaskToInbox(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (task && task.repeat && task.repeat !== 'none') {
    setTimeout(() => renderGTDView(), 50);
    return;
  }
  const { error } = await db.from('tasks')
    .update({ in_inbox: true })
    .eq('id', taskId);
  if (!error && task) task.in_inbox = true;
  setTimeout(() => renderGTDView(), 100);
}

// ===== タスク操作 =====
async function toggleInboxTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const { error } = await db.from('tasks').update({ done: !task.done }).eq('id', taskId);
  if (!error) task.done = !task.done;
  renderInbox();
}

async function toggleTask(taskId, dateStr, currentDone) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!task.repeat || task.repeat === 'none') {
    const { error } = await db.from('tasks').update({ done: !currentDone }).eq('id', taskId);
    if (!error) task.done = !currentDone;
  } else {
    if (!currentDone) {
      const { data } = await db.from('task_completions')
        .insert({ task_id: taskId, date: dateStr }).select().single();
      if (data) completions.push(data);
    } else {
      await db.from('task_completions').delete()
        .eq('task_id', taskId).eq('date', dateStr);
      completions = completions.filter(c => !(c.task_id === taskId && c.date === dateStr));
    }
  }
  renderDailyBlocks();
}

async function deleteTask(taskId) {
  if (!confirm('このタスクを削除しますか？')) return;
  const { error } = await db.from('tasks').delete().eq('id', taskId);
  if (!error) {
    tasks = tasks.filter(t => t.id !== taskId);
    renderGTDView();
  }
}

// ===== クイック追加（INBOX） =====
async function quickAddTask() {
  const input = document.getElementById('quick-add-input');
  const title = input.value.trim();
  if (!title) return;
  const { data, error } = await db.from('tasks')
    .insert({ title, in_inbox: true, done: false, repeat: 'none' })
    .select().single();
  if (error) {
    alert('追加に失敗しました。\n' + error.message);
    return;
  }
  tasks.push(data);
  input.value = '';
  renderInbox();
}

// ===== タスク保存（詳細モーダル） =====
async function saveTask() {
  const title = document.getElementById('task-title').value.trim();
  const categoryId = document.getElementById('task-category').value || null;
  const date = document.getElementById('task-date').value || null;
  const taskTimeStart = document.getElementById('task-time-start').value || null;
  const taskTimeEnd = document.getElementById('task-time-end').value || null;
  const repeat = document.getElementById('task-repeat').value;

  if (!title) { alert('タスク名を入力してください'); return; }

  const isRepeat = repeat !== 'none';
  const hasDate = !!date;

  if (isRepeat && !date) {
    alert('繰り返しタスクには開始日を入力してください');
    return;
  }

  // 日付・繰り返しがあればブロックへ、なければINBOX
  const inInbox = !isRepeat && !hasDate;
  const timeBlock = taskTimeStart
    ? timeToBlock(taskTimeStart)
    : (hasDate || isRepeat) ? defaultTimeBlock : null;

  const payload = {
    title,
    category_id: categoryId,
    date: date,
    time_block: timeBlock,
    task_time: taskTimeStart,
    task_time_end: taskTimeEnd,
    repeat,
    done: false,
    in_inbox: inInbox,
  };

  if (editingTaskId) {
    const { data, error } = await db.from('tasks')
      .update(payload).eq('id', editingTaskId).select().single();
    if (error) { alert('更新に失敗しました。\n' + error.message); return; }
    const idx = tasks.findIndex(t => t.id === editingTaskId);
    if (idx > -1) tasks[idx] = data;
  } else {
    const { data, error } = await db.from('tasks').insert(payload).select().single();
    if (error) { alert('追加に失敗しました。\n' + error.message); return; }
    tasks.push(data);
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
    renderCurrentView();
  }
}

// ===== モーダル =====
function editTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  editingTaskId = taskId;
  defaultTimeBlock = task.time_block || 9;
  document.getElementById('modal-title').textContent = 'タスクを編集';
  document.getElementById('task-title').value = task.title || '';
  document.getElementById('task-date').value = task.date || '';
  document.getElementById('task-time-start').value = task.task_time ? task.task_time.slice(0, 5) : '';
  document.getElementById('task-time-end').value = task.task_time_end ? task.task_time_end.slice(0, 5) : '';
  document.getElementById('task-repeat').value = task.repeat || 'none';
  refreshCategorySelect();
  document.getElementById('task-category').value = task.category_id || '';
  updateDestinationHint();
  document.getElementById('task-modal').classList.remove('hidden');
}

function openTaskModal(timeBlock, dateStr) {
  editingTaskId = null;
  defaultTimeBlock = timeBlock || 9;
  document.getElementById('modal-title').textContent = 'タスクを追加';
  document.getElementById('task-title').value = '';
  document.getElementById('task-category').value = '';
  document.getElementById('task-date').value = dateStr || '';
  document.getElementById('task-time-start').value = '';
  document.getElementById('task-time-end').value = '';
  document.getElementById('task-repeat').value = 'none';
  refreshCategorySelect();
  updateDestinationHint();
  document.getElementById('task-modal').classList.remove('hidden');
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
  editingTaskId = null;
}

function updateDestinationHint() {
  const date = document.getElementById('task-date').value;
  const repeat = document.getElementById('task-repeat').value;
  const hint = document.getElementById('task-destination');
  if (repeat !== 'none') {
    hint.textContent = '→ 繰り返しタスクとして時間ブロックに追加されます';
  } else if (date) {
    hint.textContent = `→ ${date} の時間ブロックに追加されます`;
  } else {
    hint.textContent = '→ 日付なしの場合は INBOX に追加されます';
  }
}

function openCategoryModal() {
  renderCategoryModalList();
  document.getElementById('category-modal').classList.remove('hidden');
}

function closeCategoryModal() {
  document.getElementById('category-modal').classList.add('hidden');
}

function renderCategoryModalList() {
  document.getElementById('category-modal-list').innerHTML =
    categories.map(cat => `
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
      activePanel = 'today';
      switchView('gtd');
    };
    grid.appendChild(div);
  }
}

// ===== カテゴリビュー =====
function renderCategoryView() {
  const container = document.getElementById('category-list');
  container.innerHTML = '';

  const noCatTasks = tasks.filter(t => !t.category_id);
  if (noCatTasks.length > 0) container.appendChild(renderCategorySection('カテゴリなし', noCatTasks));

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
          <span class="task-date">${t.in_inbox ? 'INBOX' : (t.date || '-')}</span>
        </div>
      `).join('') || '<div style="padding:10px 14px;font-size:13px;color:#aaa">タスクなし</div>'}
    </div>
  `;
  return section;
}

// ===== XSS対策 =====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== イベントリスナー =====
function setupEventListeners() {
  // ナビゲーション
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // モバイル パネル切り替え
  document.querySelectorAll('.panel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.panel-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePanel = btn.dataset.panel;
      updatePanelVisibility();
    });
  });

  // 日付移動
  document.getElementById('prev-day').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 1);
    renderDailyBlocks();
  });
  document.getElementById('next-day').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() + 1);
    renderDailyBlocks();
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

  // クイック追加
  document.getElementById('quick-add-btn').addEventListener('click', quickAddTask);
  document.getElementById('quick-add-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') quickAddTask();
  });

  // FAB
  document.getElementById('add-task-btn').addEventListener('click', () => openTaskModal());

  // タスクモーダル
  document.getElementById('save-task').addEventListener('click', saveTask);
  document.getElementById('cancel-task').addEventListener('click', closeTaskModal);
  document.getElementById('task-date').addEventListener('change', updateDestinationHint);
  document.getElementById('task-repeat').addEventListener('change', updateDestinationHint);

  // カテゴリ
  document.getElementById('manage-cat-btn').addEventListener('click', openCategoryModal);
  document.getElementById('save-category').addEventListener('click', saveCategory);
  document.getElementById('close-category-modal').addEventListener('click', closeCategoryModal);

  // モーダル外タップで閉じる
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // 画面リサイズ時にパネル表示を更新
  window.addEventListener('resize', updatePanelVisibility);
}

// ===== リアルタイム同期 =====
function setupRealtime() {
  db.channel('realtime-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' },
      async () => {
        await loadTasks();
        renderCurrentView();
      }
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' },
      async () => {
        await loadCategories();
        renderCurrentView();
      }
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_completions' },
      async () => {
        const { data } = await db.from('task_completions').select('*');
        if (data) completions = data;
        renderCurrentView();
      }
    )
    .subscribe();
}

// ===== 起動 =====
init();
