/** Dependencies describe unobserved journeys, never an inferred product failure. */
export function orderScenarios(scenarios) {
  const byName = new Map(scenarios.map(scenario => [scenario.name, scenario]));
  if (byName.size !== scenarios.length) throw new Error('Duplicate scenario identity');
  const ordered = [], visiting = new Set(), visited = new Set();
  function visit(scenario) {
    if (visited.has(scenario.name)) return;
    if (visiting.has(scenario.name)) throw new Error('Scenario dependency cycle');
    visiting.add(scenario.name);
    const dependencies = scenario.dependsOn ?? [];
    if (!Array.isArray(dependencies)) throw new Error('Invalid scenario dependency');
    for (const name of dependencies) {
      if (typeof name !== 'string' || !byName.has(name)) throw new Error('Missing scenario dependency');
      visit(byName.get(name));
    }
    visiting.delete(scenario.name);
    visited.add(scenario.name);
    ordered.push(scenario);
  }
  scenarios.forEach(visit);
  return ordered;
}

export function blockedDependency(scenario, results) {
  const dependency = (scenario.dependsOn ?? []).find(name => results.get(name)?.verdict !== 'pass');
  if (!dependency) return null;
  return {name:scenario.name, what:scenario.what ?? scenario.name, verdict:'blocked',
    steps:[], screenshots:[], consoleErrors:[], networkErrors:[], pageErrors:[], brokenImages:[],
    failure:{type:'dependency', dependency, message:`Jornada não executada: pré-requisito ${dependency} não passou.`},
    startedAt:new Date().toISOString(), finishedAt:new Date().toISOString()};
}
