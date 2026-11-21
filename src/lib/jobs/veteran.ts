const VETERAN_PREFERENCE_PATTERNS = [
  /\b(?:protected )?veterans? (?:are )?(?:strongly )?(?:encouraged|urged|welcome) to apply\b/i,
  /\bveterans? (?:are )?preferred\b/i,
  /\bveterans?'? preference\b/i,
  /\b(?:preference|priority) (?:is )?given to veterans?\b/i,
  /\bseeking (?:qualified )?veterans?\b/i,
  /\btransitioning service members? (?:are )?(?:encouraged|welcome)\b/i,
  /\bmilitary experience (?:is )?(?:preferred|valued)\b/i,
];

const VETERAN_STATUS_BOILERPLATE = [
  /\b(?:no|without) veterans? preference\b/i,
  /\bnot (?:an? )?veterans?'? preference\b/i,
  /\bveterans?'? preference (?:does|did|will|would|can|may) not (?:apply|exist)\b/i,
  /\bveterans?'? preference (?:is|are) not (?:applicable|available|offered|provided)\b/i,
  /\b(?:regardless of|without regard to) (?:protected )?veteran status\b/i,
  /\bprotected veteran status\b/i,
];

/** True only for explicit veteran recruiting or preference language, not EEO boilerplate. */
export function hasVeteranPreference(job: {
  description?: string | null;
  requirements?: readonly string[] | null;
}): boolean {
  const text = [job.description, ...(job.requirements ?? [])].filter(Boolean).join("\n");
  const evidence = VETERAN_STATUS_BOILERPLATE.reduce((value, pattern) => value.replace(pattern, ""), text);
  return VETERAN_PREFERENCE_PATTERNS.some((pattern) => pattern.test(evidence));
}
