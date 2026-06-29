import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FEATURE_STATUSES = ['todo', 'in-progress', 'archived'] as const;

export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export type FeatureRecord = {
  id: number;
  slug: string;
  status: FeatureStatus;
  lastUpdated?: string;
  finalStatus?: 'done' | 'cancelled' | null;
  milestone?: number;
};

export type FeaturesState = {
  features: FeatureRecord[];
  lastUpdated?: string;
  nextFeatureId?: number;
  version?: string;
};

export class FeatureStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureStateError';
  }
}

export function getFeaturesStatusPath(cwd: string) {
  return join(cwd, '.scratch', 'features-status.json');
}

export function getFeaturesDir(cwd: string) {
  return join(cwd, '.scratch', 'features');
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function padFeatureId(id: number): string {
  return String(id).padStart(3, '0');
}

export function getFeatureDir(cwd: string, id: number, slug: string) {
  return join(getFeaturesDir(cwd), `${padFeatureId(id)}-${slug}`);
}

/**
 * Scaffold the pipeline state if it does not exist yet. Idempotent: an existing
 * features-status.json is left untouched. This is the supported bootstrap — it
 * replaces hand-creating the JSON before the CLI can be used.
 */
export async function initFeaturesState(options: { cwd: string }): Promise<{ created: boolean; state: FeaturesState }> {
  const filePath = getFeaturesStatusPath(options.cwd);

  await mkdir(getFeaturesDir(options.cwd), { recursive: true });

  let existing: string | undefined;

  try {
    existing = await readFile(filePath, 'utf8');
  } catch {
    existing = undefined;
  }

  if (existing !== undefined) {
    return { created: false, state: await readFeaturesState(options.cwd) };
  }

  const state: FeaturesState = {
    features: [],
    lastUpdated: new Date().toISOString(),
    nextFeatureId: 1,
    version: '1'
  };

  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  return { created: true, state };
}

/**
 * Register a brand-new feature: allocate the next id, append a `todo` record,
 * and create the feature directory. This is the only supported way to create a
 * feature — callers must never hand-edit features-status.json.
 */
export async function createFeature(options: { cwd: string; slug: string; milestone?: number }): Promise<{ feature: FeatureRecord; dir: string }> {
  const slug = options.slug.trim();

  if (!SLUG_PATTERN.test(slug)) {
    throw new FeatureStateError(`Invalid slug "${options.slug}". Use kebab-case: lowercase letters, digits, and single hyphens (e.g. card-refund-flow).`);
  }

  if (options.milestone !== undefined && (!Number.isInteger(options.milestone) || options.milestone <= 0)) {
    throw new FeatureStateError(`Invalid milestone "${options.milestone}". Expected a positive integer.`);
  }

  const state = await readFeaturesState(options.cwd);

  if (state.features.some(entry => entry.slug === slug)) {
    throw new FeatureStateError(`Feature "${slug}" already exists. Choose a different slug or update the existing feature with update-feature.`);
  }

  const maxId = state.features.reduce((max, entry) => Math.max(max, entry.id), 0);
  const id = Math.max(state.nextFeatureId ?? 1, maxId + 1);
  const timestamp = new Date().toISOString();

  const feature: FeatureRecord = {
    id,
    slug,
    status: 'todo',
    lastUpdated: timestamp,
    finalStatus: null,
    ...(options.milestone !== undefined ? { milestone: options.milestone } : {})
  };

  const nextState: FeaturesState = {
    ...state,
    features: [...state.features, feature],
    lastUpdated: timestamp,
    nextFeatureId: id + 1
  };

  await writeFile(getFeaturesStatusPath(options.cwd), `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');

  const dir = getFeatureDir(options.cwd, id, slug);
  await mkdir(dir, { recursive: true });

  return { feature, dir };
}

export async function readFeaturesState(cwd: string): Promise<FeaturesState> {
  const filePath = getFeaturesStatusPath(cwd);
  let raw: string;

  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new FeatureStateError(`Missing feature state at ${filePath}. Create .scratch/features-status.json before using the CLI.`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FeatureStateError(`Malformed feature state at ${filePath}. Expected valid JSON in .scratch/features-status.json.`);
  }

  return validateFeaturesState(parsed, filePath);
}

export function validateFeaturesState(value: unknown, sourceLabel = '.scratch/features-status.json'): FeaturesState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FeatureStateError(`Invalid feature state in ${sourceLabel}. Expected a JSON object with a features array.`);
  }

  const candidate = value as Record<string, unknown>;

  if (!Array.isArray(candidate.features)) {
    throw new FeatureStateError(`Invalid feature state in ${sourceLabel}. Expected "features" to be an array.`);
  }

  const features = candidate.features.map((feature, index) => validateFeatureRecord(feature, index, sourceLabel));

  return {
    features,
    lastUpdated: typeof candidate.lastUpdated === 'string' ? candidate.lastUpdated : undefined,
    nextFeatureId: typeof candidate.nextFeatureId === 'number' ? candidate.nextFeatureId : undefined,
    version: typeof candidate.version === 'string' ? candidate.version : undefined
  };
}

function validateFeatureRecord(value: unknown, index: number, sourceLabel: string): FeatureRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FeatureStateError(`Invalid feature at index ${index} in ${sourceLabel}. Expected an object with id, slug, and status.`);
  }

  const candidate = value as Record<string, unknown>;

  if (!Number.isInteger(candidate.id) || Number(candidate.id) <= 0) {
    throw new FeatureStateError(`Invalid feature at index ${index} in ${sourceLabel}. Expected a positive integer id.`);
  }

  if (typeof candidate.slug !== 'string' || candidate.slug.trim().length === 0) {
    throw new FeatureStateError(`Invalid feature at index ${index} in ${sourceLabel}. Expected a non-empty slug.`);
  }

  if (typeof candidate.status !== 'string' || !FEATURE_STATUSES.includes(candidate.status as FeatureStatus)) {
    throw new FeatureStateError(`Invalid feature ${candidate.slug} in ${sourceLabel}. Status must be one of: ${FEATURE_STATUSES.join(', ')}.`);
  }

  if (candidate.finalStatus !== undefined && candidate.finalStatus !== null && candidate.finalStatus !== 'done' && candidate.finalStatus !== 'cancelled') {
    throw new FeatureStateError(`Invalid feature ${candidate.slug} in ${sourceLabel}. finalStatus must be null, done, or cancelled.`);
  }

  if (candidate.milestone !== undefined && (!Number.isInteger(candidate.milestone) || Number(candidate.milestone) <= 0)) {
    throw new FeatureStateError(`Invalid feature ${candidate.slug} in ${sourceLabel}. milestone must be a positive integer.`);
  }

  return {
    id: Number(candidate.id),
    slug: candidate.slug.trim(),
    status: candidate.status as FeatureStatus,
    lastUpdated: typeof candidate.lastUpdated === 'string' ? candidate.lastUpdated : undefined,
    finalStatus: candidate.finalStatus === undefined ? undefined : (candidate.finalStatus as FeatureRecord['finalStatus']),
    milestone: candidate.milestone !== undefined ? Number(candidate.milestone) : undefined
  };
}

export function resolveCurrentFeature(state: FeaturesState): FeatureRecord {
  const activeFeatures = state.features.filter(feature => feature.status === 'in-progress');

  if (activeFeatures.length === 1) {
    return activeFeatures[0];
  }

  if (activeFeatures.length === 0) {
    throw new FeatureStateError('No current feature. Activate a feature with update-feature <slug> --status in-progress before running commands that depend on the current feature.');
  }

  const slugs = activeFeatures.map(feature => feature.slug).join(', ');

  throw new FeatureStateError(
    `Ambiguous current feature. Multiple features are in-progress: ${slugs}. Move all but one feature out of in-progress with update-feature before running commands that depend on the current feature.`
  );
}

export async function updateFeatureStatus(options: { cwd: string; slug: string; status: FeatureStatus; milestone?: number }) {
  const state = await readFeaturesState(options.cwd);
  const feature = state.features.find(entry => entry.slug === options.slug);

  if (!feature) {
    throw new FeatureStateError(`Unknown feature "${options.slug}". Choose an existing feature slug from .scratch/features-status.json.`);
  }

  if (options.status === 'in-progress') {
    const otherActiveFeature = state.features.find(entry => entry.slug !== options.slug && entry.status === 'in-progress');

    if (otherActiveFeature) {
      throw new FeatureStateError(
        `Cannot activate "${options.slug}" while "${otherActiveFeature.slug}" is already in-progress. First move the active feature out of in-progress, then retry update-feature.`
      );
    }
  }

  const resolvedMilestone = options.milestone !== undefined ? options.milestone : feature.milestone;

  const timestamp = new Date().toISOString();
  const nextState: FeaturesState = {
    ...state,
    lastUpdated: timestamp,
    features: state.features.map(entry =>
      entry.slug === options.slug
        ? {
            ...entry,
            status: options.status,
            lastUpdated: timestamp,
            ...(resolvedMilestone !== undefined ? { milestone: resolvedMilestone } : {})
          }
        : entry
    )
  };

  await writeFile(getFeaturesStatusPath(options.cwd), `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');

  const updatedFeature = nextState.features.find(entry => entry.slug === options.slug);

  if (!updatedFeature) {
    throw new FeatureStateError(`Failed to find updated feature "${options.slug}" in state after update.`);
  }

  return updatedFeature;
}
