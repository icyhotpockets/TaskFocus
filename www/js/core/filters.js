function normalizedStrings(values) {
  return new Set((values ?? [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}

export function normalizeFilters(filters = {}) {
  return {
    colors: normalizedStrings(filters.colors ?? filters.categories),
    tags: normalizedStrings(filters.tags).size
      ? new Set([...normalizedStrings(filters.tags)].map((tag) => tag.replace(/^#+/, '')))
      : new Set(),
  };
}

/** OR within colors, OR within tags, AND between the two kinds. */
export function matchesTaskFilters(task, filters = {}) {
  const normalized = normalizeFilters(filters);
  const taskColor = typeof task.color === 'string' ? task.color.toLowerCase() : null;
  const taskTags = new Set((task.tags ?? []).map((tag) => String(tag).toLowerCase()));
  const colorMatch = normalized.colors.size === 0 || normalized.colors.has(taskColor);
  const tagMatch = normalized.tags.size === 0 || [...normalized.tags].some((tag) => taskTags.has(tag));
  return colorMatch && tagMatch;
}

export function filterTasks(tasks, filters = {}) {
  return tasks.filter((task) => matchesTaskFilters(task, filters));
}

export function hasActiveFilters(filters = {}) {
  const normalized = normalizeFilters(filters);
  return normalized.colors.size > 0 || normalized.tags.size > 0;
}

export function inUseColors(tasks) {
  return [...new Set(tasks.map((task) => task.color).filter(Boolean))];
}

export function inUseTags(tasks) {
  return [...new Set(tasks.flatMap((task) => task.tags ?? []).map((tag) => tag.toLowerCase()))]
    .sort((a, b) => a.localeCompare(b));
}

export function searchTags(tags, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  return needle ? tags.filter((tag) => tag.toLowerCase().includes(needle)) : [...tags];
}
