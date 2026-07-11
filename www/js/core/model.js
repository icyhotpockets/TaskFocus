export function taskById(tasks, id) {
  return tasks.find((task) => task.id === id) ?? null;
}

export function childrenOf(tasks, parentId) {
  return tasks.filter((task) => task.parentId === parentId);
}

export function rootsOf(tasks) {
  const ids = new Set(tasks.map((task) => task.id));
  return tasks.filter((task) => task.parentId == null || !ids.has(task.parentId));
}

/** Returns descendants depth-first in the same sibling order as the task array. */
export function descendantsOf(tasks, id) {
  const byParent = new Map();
  for (const task of tasks) {
    const siblings = byParent.get(task.parentId) ?? [];
    siblings.push(task);
    byParent.set(task.parentId, siblings);
  }

  const descendants = [];
  const visited = new Set([id]);
  function walk(parentId) {
    for (const child of byParent.get(parentId) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendants.push(child);
      walk(child.id);
    }
  }
  walk(id);
  return descendants;
}

export function subtreeOf(tasks, id) {
  const root = taskById(tasks, id);
  return root ? [root, ...descendantsOf(tasks, id)] : [];
}

/** Progress deliberately excludes the parent: a 2/5 chip means 2 of 5 subtasks. */
export function progressOf(tasks, id) {
  const descendants = descendantsOf(tasks, id);
  return {
    done: descendants.filter((task) => task.completedAt != null).length,
    total: descendants.length,
  };
}

export function ancestorsOf(tasks, id) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ancestors = [];
  const visited = new Set([id]);
  let task = byId.get(id);
  while (task?.parentId != null) {
    const parent = byId.get(task.parentId);
    if (!parent || visited.has(parent.id)) break;
    ancestors.unshift(parent);
    visited.add(parent.id);
    task = parent;
  }
  return ancestors;
}

export function setArchived(tasks, id, archived) {
  const ids = new Set(subtreeOf(tasks, id).map((task) => task.id));
  if (!ids.size) return tasks;
  return tasks.map((task) => ids.has(task.id) ? { ...task, archived: Boolean(archived) } : task);
}

/**
 * Toggles the root's completion state across the full subtree.
 * `previousStates` is suitable for an exact Undo, even when child states differed.
 */
export function completeWithDescendants(tasks, id, completedAt = Date.now()) {
  const root = taskById(tasks, id);
  if (!root) return { tasks, flippedIds: [], completed: false, previousStates: [] };
  const members = subtreeOf(tasks, id);
  const ids = new Set(members.map((task) => task.id));
  const completed = root.completedAt == null;
  const previousStates = members.map((task) => ({
    id: task.id,
    completedAt: task.completedAt,
    archived: task.archived,
  }));
  const flippedIds = members
    .filter((task) => (task.completedAt != null) !== completed)
    .map((task) => task.id);
  const next = tasks.map((task) => {
    if (!ids.has(task.id)) return task;
    return {
      ...task,
      completedAt: completed ? Math.trunc(completedAt) : null,
      archived: completed ? task.archived : false,
      session: completed ? null : task.session,
    };
  });
  return { tasks: next, flippedIds, completed, previousStates };
}

export function restoreTaskStates(tasks, states) {
  const byId = new Map(states.map((state) => [state.id, state]));
  return tasks.map((task) => {
    const state = byId.get(task.id);
    return state ? { ...task, completedAt: state.completedAt, archived: state.archived } : task;
  });
}

export function deleteTask(tasks, id) {
  const deletedIds = subtreeOf(tasks, id).map((task) => task.id);
  if (!deletedIds.length) return { tasks, deletedIds: [] };
  const ids = new Set(deletedIds);
  return { tasks: tasks.filter((task) => !ids.has(task.id)), deletedIds };
}

export function clearArchivedTasks(tasks) {
  const deletedIds = tasks.filter((task) => task.archived).map((task) => task.id);
  const archivedIds = new Set(deletedIds);
  return {
    tasks: tasks.filter((task) => !archivedIds.has(task.id)),
    deletedIds,
  };
}

export function updateTask(tasks, id, patch) {
  return tasks.map((task) => task.id === id ? { ...task, ...patch, id: task.id } : task);
}

export function isTaskVisibleInTree(tasks, id) {
  return ancestorsOf(tasks, id).every((ancestor) => !ancestor.collapsed);
}
