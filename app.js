// ===== State =====
let currentUser = null;
let tasks = {}; // { id: { id, title, description, priority, tags, column, position } }
let draggedTaskId = null;
let unsubscribe = null; // Firestore listener

// Sharing state
let currentRoomCode = null;
let isSharedBoard = false; // true if viewing someone else's board
let sharedBoardOwnerId = null; // the host's userId when on a shared board
let roomUnsubscribe = null;

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
  leaveSharedBoard();
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

      // Check if joining via ?room= parameter
      const params = new URLSearchParams(window.location.search);
      const roomCode = params.get("room");
      if (roomCode) {
        joinRoomByCode(roomCode);
      } else {
        subscribeToTasks(user.uid);
      }
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

// Subscribe to a shared board's tasks (by owner's userId)
function subscribeToSharedTasks(ownerUid) {
  if (unsubscribe) unsubscribe();

  unsubscribe = db
    .collection("tasks")
    .where("userId", "==", ownerUid)
    .orderBy("position")
    .onSnapshot(snapshot => {
      tasks = {};
      snapshot.forEach(doc => {
        tasks[doc.id] = { id: doc.id, ...doc.data() };
      });
      renderAllColumns();
    }, err => {
      console.error("Shared board listen error:", err);
    });
}

async function addTask(data) {
  const columnTasks = getColumnTasks(data.column);
  const maxPos = columnTasks.length > 0
    ? Math.max(...columnTasks.map(t => t.position)) + 1
    : 0;

  const taskData = {
    title: data.title,
    description: data.description || "",
    priority: data.priority || "medium",
    tags: data.tags || [],
    column: data.column,
    position: maxPos,
    userId: isSharedBoard ? sharedBoardOwnerId : currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  // If on a shared board, include sharedWith for security rules
  if (isSharedBoard) {
    taskData.sharedWith = firebase.firestore.FieldValue.arrayUnion(currentUser.uid);
  }

  await db.collection("tasks").add(taskData);
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

  const targetTasks = getColumnTasks(newColumn)
    .filter(t => t.id !== taskId)
    .sort((a, b) => a.position - b.position);

  targetTasks.splice(newPosition, 0, { id: taskId });

  targetTasks.forEach((t, i) => {
    const ref = db.collection("tasks").doc(t.id);
    if (t.id === taskId) {
      batch.update(ref, { column: newColumn, position: i });
    } else {
      batch.update(ref, { position: i });
    }
  });

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

// ===== Sharing =====
function genRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function generateRoomCode() {
  if (!currentUser) return;

  const code = genRoomCode();
  currentRoomCode = code;

  // Create room document
  await db.collection("rooms").doc(code).set({
    hostId: currentUser.uid,
    hostEmail: currentUser.email || "",
    hostName: currentUser.displayName || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    members: [currentUser.uid]
  });

  // Mark all existing tasks as shared
  const batch = db.batch();
  Object.values(tasks).forEach(task => {
    batch.update(db.collection("tasks").doc(task.id), {
      sharedWith: [currentUser.uid]
    });
  });
  await batch.commit();

  showShareActive(code);
}

function showShareActive(code) {
  document.getElementById("share-setup").style.display = "none";
  document.getElementById("share-active").style.display = "block";
  document.getElementById("room-code-display").textContent = code;

  const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
  document.getElementById("share-link").value = url;

  // Generate QR code
  const qrEl = document.getElementById("qrcode");
  qrEl.innerHTML = "";
  new QRCode(qrEl, {
    text: url,
    width: 150,
    height: 150,
    colorDark: "#212121",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  // Listen for member changes
  if (roomUnsubscribe) roomUnsubscribe();
  roomUnsubscribe = db.collection("rooms").doc(code).onSnapshot(snap => {
    if (snap.exists) {
      const data = snap.data();
      const count = (data.members || []).length;
      document.getElementById("share-collab-info").textContent = `${count} person${count !== 1 ? "s" : ""} online`;
      updateCollabBadge(count);
    }
  });
}

async function stopSharing() {
  if (!currentRoomCode) return;

  // Remove sharedWith from all tasks
  const batch = db.batch();
  Object.values(tasks).forEach(task => {
    batch.update(db.collection("tasks").doc(task.id), {
      sharedWith: firebase.firestore.FieldValue.delete()
    });
  });
  await batch.commit();

  // Delete room
  await db.collection("rooms").doc(currentRoomCode).delete();

  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }

  currentRoomCode = null;
  updateCollabBadge(0);

  // Reset modal
  document.getElementById("share-setup").style.display = "block";
  document.getElementById("share-active").style.display = "none";
  document.getElementById("qrcode").innerHTML = "";
  closeShareModal();
}

async function joinRoomByCode(code) {
  try {
    const roomDoc = await db.collection("rooms").doc(code).get();
    if (!roomDoc.exists) {
      alert("Room not found. Check the code and try again.");
      // Clear the URL param
      window.history.replaceState({}, "", window.location.pathname);
      subscribeToTasks(currentUser.uid);
      return;
    }

    const roomData = roomDoc.data();
    sharedBoardOwnerId = roomData.hostId;
    isSharedBoard = true;
    currentRoomCode = code;

    // Add self to members
    await db.collection("rooms").doc(code).update({
      members: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    });

    // Update header to show shared state
    document.getElementById("btn-share").style.display = "none";
    document.getElementById("btn-join").innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      Leave
    `;
    document.getElementById("btn-join").setAttribute("onclick", "leaveSharedBoard()");
    document.getElementById("btn-join").title = "Leave shared board";

    // Listen for member count
    if (roomUnsubscribe) roomUnsubscribe();
    roomUnsubscribe = db.collection("rooms").doc(code).onSnapshot(snap => {
      if (snap.exists) {
        const count = (snap.data().members || []).length;
        updateCollabBadge(count);
      } else {
        // Host stopped sharing
        alert("The host has stopped sharing this board.");
        leaveSharedBoard();
      }
    });

    // Subscribe to the host's tasks
    subscribeToSharedTasks(sharedBoardOwnerId);

    // Clear URL param
    window.history.replaceState({}, "", window.location.pathname);

  } catch (err) {
    console.error("Join room error:", err);
    alert("Failed to join room. Please try again.");
    subscribeToTasks(currentUser.uid);
  }
}

function leaveSharedBoard() {
  if (currentRoomCode && isSharedBoard && currentUser) {
    // Remove self from members
    db.collection("rooms").doc(currentRoomCode).update({
      members: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
    }).catch(() => {});
  }

  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }

  isSharedBoard = false;
  sharedBoardOwnerId = null;
  currentRoomCode = null;

  updateCollabBadge(0);

  // Restore header buttons
  document.getElementById("btn-share").style.display = "flex";
  document.getElementById("btn-join").innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v-2"/><polyline points="17 8 21 12 17 16"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
    Join
  `;
  document.getElementById("btn-join").setAttribute("onclick", "openJoinModal()");
  document.getElementById("btn-join").title = "Join Board";

  // Go back to own board
  if (currentUser) {
    subscribeToTasks(currentUser.uid);
  }
}

function updateCollabBadge(count) {
  const badge = document.getElementById("collab-badge");
  if (count > 1 || isSharedBoard) {
    badge.style.display = "flex";
    document.getElementById("collab-count").textContent = count;
  } else {
    badge.style.display = "none";
  }
}

function copyShareLink() {
  const input = document.getElementById("share-link");
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = input.nextElementSibling;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  });
}

// ===== Share Modal =====
function openShareModal() {
  document.getElementById("share-modal").style.display = "flex";
  // If already sharing, show active state
  if (currentRoomCode && !isSharedBoard) {
    showShareActive(currentRoomCode);
  }
}

function closeShareModal() {
  document.getElementById("share-modal").style.display = "none";
}

// ===== Join Modal =====
function openJoinModal() {
  document.getElementById("join-code-input").value = "";
  document.getElementById("join-modal").style.display = "flex";
  document.getElementById("join-code-input").focus();
}

function closeJoinModal() {
  document.getElementById("join-modal").style.display = "none";
}

function joinRoom() {
  const code = document.getElementById("join-code-input").value.trim();
  if (code.length !== 6 || !/^\d{6}$/.test(code)) {
    alert("Please enter a valid 6-digit code.");
    return;
  }
  closeJoinModal();
  joinRoomByCode(code);
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

      const cards = [...list.querySelectorAll(".task-card:not(.dragging)")];
      let dropIndex = cards.length;

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

// ===== Task Modal =====
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

// Close modals on Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeModal();
    closeShareModal();
    closeJoinModal();
  }
});
