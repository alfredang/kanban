// ===== State =====
let currentUser = null;
let tasks = {}; // { id: { id, title, description, priority, tags, column, position } }
let draggedTaskId = null;
let unsubscribe = null; // Firestore listener

// ===== Auth =====
function signInWithGoogle() {
  if (!firebaseReady) return;
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => console.error("Google sign-in error:", err));
}

function signInWithGitHub() {
  if (!firebaseReady) return;
  const provider = new firebase.auth.GithubAuthProvider();
  auth.signInWithPopup(provider).catch(err => console.error("GitHub sign-in error:", err));
}

function signOut() {
  auth.signOut();
}

// Listen for auth state
document.addEventListener("DOMContentLoaded", () => {
  if (!firebaseReady) {
    document.getElementById("auth-error").style.display = "flex";
    document.getElementById("auth-buttons").style.display = "none";
    return;
  }

  auth.onAuthStateChanged(user => {
    if (user) {
      currentUser = user;
      showBoard(user);
      subscribeToTasks(user.uid);
    } else {
      currentUser = null;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      tasks = {};
      showWelcome();
    }
  });
});

function showWelcome() {
  document.getElementById("welcome-page").style.display = "flex";
  document.getElementById("board-page").style.display = "none";
}

function showBoard(user) {
  document.getElementById("welcome-page").style.display = "none";
  document.getElementById("board-page").style.display = "flex";

  const avatar = document.getElementById("user-avatar");
  avatar.src = user.photoURL || generateAvatar(user.email);
  document.getElementById("user-email").textContent = user.email || "";
}

function generateAvatar(email) {
  // Simple placeholder avatar using UI Avatars
  const name = (email || "U").charAt(0).toUpperCase();
  return `https://ui-avatars.com/api/?name=${name}&background=7c3aed&color=fff&size=64`;
}

// ===== Firestore =====
function subscribeToTasks(uid) {
  if (unsubscribe) unsubscribe();

  unsubscribe = db
    .collection("tasks")
    .where("userId", "==", uid)
    .orderBy("position")
    .onSnapshot(snapshot => {
      tasks = {};
      snapshot.forEach(doc => {
        tasks[doc.id] = { id: doc.id, ...doc.data() };
      });
      renderAllColumns();
    }, err => {
      console.error("Firestore listen error:", err);
    });
}

async function addTask(data) {
  const columnTasks = getColumnTasks(data.column);
  const maxPos = columnTasks.length > 0
    ? Math.max(...columnTasks.map(t => t.position)) + 1
    : 0;

  await db.collection("tasks").add({
    title: data.title,
    description: data.description || "",
    priority: data.priority || "medium",
    tags: data.tags || [],
    column: data.column,
    position: maxPos,
    userId: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function updateTask(id, data) {
  await db.collection("tasks").doc(id).update({
    title: data.title,
    description: data.description || "",
    priority: data.priority || "medium",
    tags: data.tags || []
  });
}

async function deleteTask(id) {
  if (!confirm("Delete this task?")) return;
  await db.collection("tasks").doc(id).delete();
}

async function moveTask(taskId, newColumn, newPosition) {
  const task = tasks[taskId];
  if (!task) return;

  const batch = db.batch();

  // Get tasks in the target column (excluding the moved task)
  const targetTasks = getColumnTasks(newColumn)
    .filter(t => t.id !== taskId)
    .sort((a, b) => a.position - b.position);

  // Insert at position
  targetTasks.splice(newPosition, 0, { id: taskId });

  // Update all positions in target column
  targetTasks.forEach((t, i) => {
    const ref = db.collection("tasks").doc(t.id);
    if (t.id === taskId) {
      batch.update(ref, { column: newColumn, position: i });
    } else {
      batch.update(ref, { position: i });
    }
  });

  // If moved from a different column, compact the source column
  if (task.column !== newColumn) {
    const sourceTasks = getColumnTasks(task.column)
      .filter(t => t.id !== taskId)
      .sort((a, b) => a.position - b.position);

    sourceTasks.forEach((t, i) => {
      batch.update(db.collection("tasks").doc(t.id), { position: i });
    });
  }

  await batch.commit();
}

// ===== Helpers =====
function getColumnTasks(column) {
  return Object.values(tasks)
    .filter(t => t.column === column)
    .sort((a, b) => a.position - b.position);
}

const TAG_COLORS = ["violet", "sky", "pink", "indigo", "teal"];

function getTagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

// ===== Rendering =====
function renderAllColumns() {
  ["todo", "inprogress", "completed"].forEach(col => {
    renderColumn(col);
  });
}

function renderColumn(column) {
  const list = document.getElementById(`list-${column}`);
  const count = document.getElementById(`count-${column}`);
  const columnTasks = getColumnTasks(column);

  count.textContent = columnTasks.length;

  if (columnTasks.length === 0) {
    list.innerHTML = '<div class="task-list-empty">No tasks yet</div>';
    return;
  }

  list.innerHTML = columnTasks.map(task => createTaskCardHTML(task)).join("");

  // Attach drag events to cards
  list.querySelectorAll(".task-card").forEach(card => {
    card.addEventListener("dragstart", handleDragStart);
    card.addEventListener("dragend", handleDragEnd);
  });
}

function createTaskCardHTML(task) {
  const tagsHTML = (task.tags || [])
    .map(tag => `<span class="tag-badge tag-${getTagColor(tag)}">${escapeHTML(tag)}</span>`)
    .join("");

  const descHTML = task.description
    ? `<p class="task-card-desc">${escapeHTML(task.description)}</p>`
    : "";

  return `
    <div class="task-card" draggable="true" data-task-id="${task.id}">
      <div class="task-card-top">
        <svg class="task-grip" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
        </svg>
        <div class="task-card-body">
          <div class="task-card-title">${escapeHTML(task.title)}</div>
          ${descHTML}
        </div>
        <div class="task-card-actions">
          <button class="task-action-btn" onclick="openEditModal('${task.id}')" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="task-action-btn delete" onclick="deleteTask('${task.id}')" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="task-card-footer">
        <span class="priority-badge priority-${task.priority}">${task.priority}</span>
        ${tagsHTML}
      </div>
    </div>
  `;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== Drag & Drop =====
function handleDragStart(e) {
  draggedTaskId = e.currentTarget.dataset.taskId;
  e.currentTarget.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", draggedTaskId);
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  draggedTaskId = null;
  document.querySelectorAll(".task-list").forEach(el => el.classList.remove("drag-over"));
}

// Attach dragover/drop to task lists
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".task-list").forEach(list => {
    list.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      list.classList.add("drag-over");
    });

    list.addEventListener("dragleave", e => {
      // Only remove if actually leaving the list
      if (!list.contains(e.relatedTarget)) {
        list.classList.remove("drag-over");
      }
    });

    list.addEventListener("drop", e => {
      e.preventDefault();
      list.classList.remove("drag-over");

      const taskId = e.dataTransfer.getData("text/plain");
      if (!taskId) return;

      const column = list.dataset.column;

      // Determine drop position based on mouse Y
      const cards = [...list.querySelectorAll(".task-card:not(.dragging)")];
      let dropIndex = cards.length; // default: end

      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          dropIndex = i;
          break;
        }
      }

      moveTask(taskId, column, dropIndex);
    });
  });
});

// ===== Modal =====
function openModal(column) {
  document.getElementById("modal-title").textContent = "Add Task";
  document.getElementById("modal-submit-btn").textContent = "Add Task";
  document.getElementById("task-id").value = "";
  document.getElementById("task-column").value = column;
  document.getElementById("task-title-input").value = "";
  document.getElementById("task-desc-input").value = "";
  document.getElementById("task-priority-input").value = "medium";
  document.getElementById("task-tags-input").value = "";
  document.getElementById("task-modal").style.display = "flex";
  document.getElementById("task-title-input").focus();
}

function openEditModal(taskId) {
  const task = tasks[taskId];
  if (!task) return;

  document.getElementById("modal-title").textContent = "Edit Task";
  document.getElementById("modal-submit-btn").textContent = "Save Changes";
  document.getElementById("task-id").value = taskId;
  document.getElementById("task-column").value = task.column;
  document.getElementById("task-title-input").value = task.title;
  document.getElementById("task-desc-input").value = task.description || "";
  document.getElementById("task-priority-input").value = task.priority || "medium";
  document.getElementById("task-tags-input").value = (task.tags || []).join(", ");
  document.getElementById("task-modal").style.display = "flex";
  document.getElementById("task-title-input").focus();
}

function closeModal() {
  document.getElementById("task-modal").style.display = "none";
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) closeModal();
}

function handleFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById("task-id").value;
  const column = document.getElementById("task-column").value;
  const title = document.getElementById("task-title-input").value.trim();
  const description = document.getElementById("task-desc-input").value.trim();
  const priority = document.getElementById("task-priority-input").value;
  const tagsRaw = document.getElementById("task-tags-input").value;
  const tags = tagsRaw
    .split(",")
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (!title) return;

  if (id) {
    updateTask(id, { title, description, priority, tags });
  } else {
    addTask({ title, description, priority, tags, column });
  }

  closeModal();
}

// Close modal on Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});
