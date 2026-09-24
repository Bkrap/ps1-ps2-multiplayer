/**
 * Decide how many live matches fit.
 * docker stats reports percent where 100 equals one core.
 * One core stays free for the lobby and the OS.
 * With no samples, keep the planned starting cap of 2.
 */
export function recommendMaxRooms({ hostCpus = 6, samples = [] } = {}) {
  const budget = Math.max(1, hostCpus - 1);
  if (!samples.length) {
    return { maxRooms: 2, measured: false, budgetCores: budget };
  }
  const cores = samples.map((sample) => Number(sample.cpuPercent) / 100);
  const total = cores.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(...cores);
  const projected = samples.length >= 2 ? total : peak * 2;
  return {
    maxRooms: projected > budget ? 1 : 2,
    measured: true,
    budgetCores: budget,
    projectedCores: Math.round(projected * 10) / 10,
  };
}
