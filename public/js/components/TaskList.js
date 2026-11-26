import { apiRequest } from '../core/api.js';
import { EMPTY_MESSAGES, state } from '../core/state.js';
import { createTaskItemElement } from './TaskItem.js';

const els = {
  taskList: document.getElementById('task-list'),
  emptyState: document.getElementById('empty-state'),
  emptyStateText: document.getElementById('empty-state-text'),
};

let callbacks = null;

function toggleTaskExpanded(taskId) {
  if (state.expandedTaskIds.has(taskId)) {
    state.expandedTaskIds.delete(taskId);
    if (state.editingDescTaskId === taskId) {
      state.editingDescTaskId = null;
    }
  } else {
    state.expandedTaskIds.add(taskId);
  }
  callbacks.onRenderAll();
}

async function updateTask(taskId, patch) {
  try {
    callbacks.onClearTaskError();
    await apiRequest(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    state.editingTaskId = null;
    state.editingDescTaskId = null;
    await callbacks.onTasksChanged();
  } catch (err) {
    if (err.status === 401) {
      callbacks.onSessionExpired();
      return;
    }
    callbacks.onShowTaskError(err.message);
  }
}

async function deleteTask(taskId) {
  try {
    callbacks.onClearTaskError();
    await apiRequest(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
    if (state.editingTaskId === taskId) {
      state.editingTaskId = null;
    }
    if (state.editingDescTaskId === taskId) {
      state.editingDescTaskId = null;
    }
    state.expandedTaskIds.delete(taskId);
    await callbacks.onTasksChanged();
  } catch (err) {
    if (err.status === 401) {
      callbacks.onSessionExpired();
      return;
    }
    callbacks.onShowTaskError(err.message);
  }
}

async function addSubtask(taskId, title) {
  try {
    callbacks.onClearTaskError();
    state.expandedTaskIds.add(taskId);
    await apiRequest(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    await callbacks.onTasksChanged();
    const taskLi = els.taskList.querySelector(`[data-task-id="${taskId}"]`);
    const nextInput = taskLi?.querySelector('.subtask-add-input');
    nextInput?.focus();
  } catch (err) {
    if (err.status === 401) {
      callbacks.onSessionExpired();
      return;
    }
    callbacks.onShowTaskError(err.message);
  }
}

async function toggleSubtask(taskId, subtaskId, completed) {
  try {
    callbacks.onClearTaskError();
    await apiRequest(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed }),
    });
    await callbacks.onTasksChanged();
  } catch (err) {
    if (err.status === 401) {
      callbacks.onSessionExpired();
      return;
    }
    callbacks.onShowTaskError(err.message);
  }
}

async function deleteSubtask(taskId, subtaskId) {
  try {
    callbacks.onClearTaskError();
    await apiRequest(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'DELETE',
    });
    await callbacks.onTasksChanged();
  } catch (err) {
    if (err.status === 401) {
      callbacks.onSessionExpired();
      return;
    }
    callbacks.onShowTaskError(err.message);
  }
}

export function renderTaskList() {
  els.taskList.innerHTML = '';

  if (state.tasks.length === 0) {
    els.emptyStateText.textContent = EMPTY_MESSAGES[state.statusFilter];
    els.emptyState.hidden = false;
    return;
  }

  els.emptyState.hidden = true;
  const itemHandlers = {
    onToggleExpanded: toggleTaskExpanded,
    onUpdateTask: updateTask,
    onDeleteTask: deleteTask,
    onAddSubtask: addSubtask,
    onToggleSubtask: toggleSubtask,
    onDeleteSubtask: deleteSubtask,
    onRenderTasks: callbacks.onRenderAll,
    onShowTaskError: callbacks.onShowTaskError,
    onClearTaskError: callbacks.onClearTaskError,
  };

  const fragment = document.createDocumentFragment();
  for (const task of state.tasks) {
    fragment.appendChild(createTaskItemElement(task, itemHandlers));
  }
  els.taskList.appendChild(fragment);
}

export function initTaskList(opts) {
  callbacks = opts;
}
