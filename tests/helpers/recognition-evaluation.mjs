// Pure checks shared by offline regression tests and opt-in live evaluation.
// Input results are visual observations BEFORE source-list matching.
export function evaluateRecognition(fixture, result) {
  const issues = [];
  const { expected } = fixture;
  for (const alternatives of expected.requiredTagGroups) {
    if (!alternatives.some(tag => result.tags.includes(tag)))
      issues.push(`Missing visible tag: ${alternatives.join(" or ")}`);
  }
  for (const tag of expected.forbiddenTags) {
    if (result.tags.includes(tag)) issues.push(`Unsupported tag: ${tag}`);
  }
  const actualNumbers = [...new Set(result.vehicles.map(v => v.number).filter(Boolean))].sort();
  if (JSON.stringify(actualNumbers) !== JSON.stringify([...expected.numbers].sort()))
    issues.push(`Numbers differ: expected ${expected.numbers.join(",") || "unknown"}; got ${actualNumbers.join(",") || "unknown"}`);
  for (const [index, vehicle] of result.vehicles.entries()) {
    if (vehicle.source !== "visual") issues.push(`Vehicle ${index}: source must be visual`);
    for (const field of expected.unknownFields) {
      if (vehicle[field]) issues.push(`Vehicle ${index}: ${field} must remain unknown`);
    }
  }
  if (result.vehicles.length > 12) issues.push("More than 12 observations");
  if (expected.vehicleCount && (result.vehicles.length < expected.vehicleCount.min ||
      result.vehicles.length > expected.vehicleCount.max))
    issues.push(`Vehicle count must be ${expected.vehicleCount.min}..${expected.vehicleCount.max}`);
  return issues;
}

// Comparison is meaningful only for the same reviewed expectations and pixels.
// Do not quietly compare runs with revised targets or missing samples.
export function compareReviewedRuns(previous, current) {
  if (previous.reviewedManifestSha256 !== current.reviewedManifestSha256)
    throw new Error("Cannot compare different reviewed expectations");
  if (previous.samples.length !== current.samples.length)
    throw new Error("Cannot compare incomplete fixture sets");
  const before = new Map(previous.samples.map(row => [row.id, row]));
  if (before.size !== previous.samples.length ||
      new Set(current.samples.map(row => row.id)).size !== current.samples.length)
    throw new Error("Cannot compare duplicate fixture IDs");
  const changes = current.samples.map(row => {
    const old = before.get(row.id);
    if (!old || old.imageSha256 !== row.imageSha256)
      throw new Error("Cannot compare unreviewed or changed images");
    return {
      id: row.id,
      introducedIssues: row.issues.filter(issue => !old.issues.includes(issue)),
      resolvedIssues: old.issues.filter(issue => !row.issues.includes(issue)),
    };
  });
  return {
    previousModel: previous.model, currentModel: current.model,
    previousPassed: previous.samples.filter(row => row.passed).length,
    currentPassed: current.samples.filter(row => row.passed).length,
    sampleCount: current.samples.length, changes,
  };
}
