/**
 * Validate CloudFormation template for circular dependencies
 * @param {Object} cloudformation - CloudFormation template
 * @returns {Object} Validation result with { valid: boolean, cycles: Array }
 */
function validateDependencies(cloudformation) {
  const resources = cloudformation.Resources || {};
  const graph = new Map(); // resourceId -> Set of dependencies
  const allDependencies = new Set(); // All resource IDs that are depended upon

  // Build dependency graph
  for (const [resourceId, resource] of Object.entries(resources)) {
    if (!resource) continue;

    const dependencies = new Set();

    // Check explicit DependsOn
    if (resource.DependsOn) {
      const deps = Array.isArray(resource.DependsOn)
        ? resource.DependsOn
        : [resource.DependsOn];
      for (const dep of deps) {
        if (typeof dep === "string" && resources[dep]) {
          dependencies.add(dep);
          allDependencies.add(dep);
        }
      }
    }

    // Check implicit dependencies via Ref
    if (resource.Properties) {
      const refs = findRefs(resource.Properties);
      for (const ref of refs) {
        if (resources[ref]) {
          dependencies.add(ref);
          allDependencies.add(ref);
        }
      }
    }

    // Check implicit dependencies via Fn::GetAtt
    if (resource.Properties) {
      const getAtts = findGetAtts(resource.Properties);
      for (const getAtt of getAtts) {
        if (resources[getAtt]) {
          dependencies.add(getAtt);
          allDependencies.add(getAtt);
        }
      }
    }

    if (dependencies.size > 0) {
      graph.set(resourceId, dependencies);
    } else {
      // Resource with no dependencies
      graph.set(resourceId, new Set());
    }
  }

  // Detect cycles using DFS
  const cycles = detectCycles(graph);

  return {
    valid: cycles.length === 0,
    cycles,
    graph: Object.fromEntries(
      Array.from(graph.entries()).map(([k, v]) => [k, Array.from(v)])
    ),
  };
}

/**
 * Find all Ref references in an object (recursive)
 */
function findRefs(obj, refs = new Set()) {
  if (obj === null || obj === undefined) return refs;
  if (typeof obj !== "object") return refs;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findRefs(item, refs);
    }
    return refs;
  }

  // Check for Ref
  if (obj.Ref && typeof obj.Ref === "string") {
    refs.add(obj.Ref);
  }

  // Check for Fn::Ref
  if (obj["Fn::Ref"] && typeof obj["Fn::Ref"] === "string") {
    refs.add(obj["Fn::Ref"]);
  }

  // Recursively check all properties
  for (const value of Object.values(obj)) {
    findRefs(value, refs);
  }

  return refs;
}

/**
 * Find all Fn::GetAtt references in an object (recursive)
 */
function findGetAtts(obj, getAtts = new Set()) {
  if (obj === null || obj === undefined) return getAtts;
  if (typeof obj !== "object") return getAtts;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findGetAtts(item, getAtts);
    }
    return getAtts;
  }

  // Check for Fn::GetAtt
  if (obj["Fn::GetAtt"]) {
    const getAtt = obj["Fn::GetAtt"];
    if (Array.isArray(getAtt) && getAtt.length > 0) {
      const resourceId = getAtt[0];
      if (typeof resourceId === "string") {
        getAtts.add(resourceId);
      }
    }
  }

  // Recursively check all properties
  for (const value of Object.values(obj)) {
    findGetAtts(value, getAtts);
  }

  return getAtts;
}

/**
 * Detect cycles in a dependency graph using DFS
 * @param {Map<string, Set<string>>} graph - Dependency graph
 * @returns {Array<Array<string>>} Array of cycles, each cycle is an array of resource IDs
 */
function detectCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const recursionStack = new Set();
  const path = [];

  function dfs(node) {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const dependencies = graph.get(node) || new Set();
    for (const dep of dependencies) {
      if (!visited.has(dep)) {
        const cycle = dfs(dep);
        if (cycle) {
          return cycle;
        }
      } else if (recursionStack.has(dep)) {
        // Found a cycle! Build the cycle path
        const cycleStart = path.indexOf(dep);
        const cycle = path.slice(cycleStart).concat([dep]);
        return cycle;
      }
    }

    recursionStack.delete(node);
    path.pop();
    return null;
  }

  // Check all nodes
  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      const cycle = dfs(node);
      if (cycle) {
        cycles.push(cycle);
        // Reset visited for this cycle to find other cycles
        // But keep track of nodes we've already found cycles for
        const cycleNodes = new Set(cycle);
        for (const cycleNode of cycleNodes) {
          visited.delete(cycleNode);
        }
      }
    }
  }

  return cycles;
}

/**
 * Format cycle for error message
 */
function formatCycle(cycle) {
  if (cycle.length === 0) return "";
  return cycle.join(" → ");
}

/**
 * Format all cycles for error message
 */
function formatCycles(cycles) {
  if (cycles.length === 0) return "No cycles found";
  return cycles.map((cycle, i) => `Cycle ${i + 1}: ${formatCycle(cycle)}`).join("\n");
}

module.exports = {
  validateDependencies,
  formatCycles,
  detectCycles,
};

