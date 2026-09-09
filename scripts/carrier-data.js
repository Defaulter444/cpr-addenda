/**
 * Foundry's document backend expands dotted keys recursively on create/update.
 * Compendia contain {"system.dvTable": ...}; imported flags instead contain
 * {system: {dvTable: ...}}. Accept both representations without rewriting data.
 */
function systemPaths(raw, changes) {
  const result = {};
  const visit = (value, path) => {
    if (value && typeof value === "object" && !Array.isArray(value) &&
      !(changes && Object.hasOwn(value, "op")) && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
    } else result[path] = value;
  };
  for (const [path, value] of Object.entries(raw ?? {})) {
    if (path.startsWith("system.")) result[path] = value;
    else if (path === "system") visit(value, path);
  }
  return result;
}

export function normalizeCarrierChanges(raw) {
  return systemPaths(raw, true);
}

export function normalizeCarrierRestore(raw) {
  return systemPaths(raw, false);
}
