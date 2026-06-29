import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeatureRecord, FeaturesState } from './features-state';

export type IssueBreakdownEntry = {
  id: number;
  title: string;
  status: string;
  decomposed: boolean;
};

export type FeatureArtifacts = {
  hasGrillSession: boolean;
  hasBrief: boolean;
  hasPrd: boolean;
  hasIssues: boolean;
  issueCounts: { done: number; total: number; decomposed: number } | null;
  aiReviewPassed: boolean;
  humanReviewPassed: boolean;
};

export type MilestoneGroup = {
  milestone: number;
  total: number;
  done: number;
  inProgress: number;
  status: 'not-started' | 'in-progress' | 'done';
};

export type MilestoneSummary = {
  groups: MilestoneGroup[];
  unassigned: FeatureRecord[];
  hasMultipleActive: boolean;
};

export type StatusOutput = {
  stdout: string;
  stderr: string;
};

// ---------------------------------------------------------------------------
// Feature directory resolution (reuses the padStart convention)
// ---------------------------------------------------------------------------

function formatFeatureDir(feature: FeatureRecord): string {
  return `${String(feature.id).padStart(3, '0')}-${feature.slug}`;
}

function getFeatureDir(cwd: string, feature: FeatureRecord): string {
  return join(cwd, '.scratch', 'features', formatFeatureDir(feature));
}

// ---------------------------------------------------------------------------
// Filesystem artifact scanning
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirHasMdFiles(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.some(e => e.endsWith('.md'));
  } catch {
    return false;
  }
}

async function readIssueCounts(cwd: string, feature: FeatureRecord, hasIssues: boolean): Promise<{ done: number; total: number; decomposed: number } | null> {
  if (!hasIssues) return null;

  const issuesStatePath = join(getFeatureDir(cwd, feature), 'issues-status.json');

  try {
    const raw = await import('node:fs/promises').then(fs => fs.readFile(issuesStatePath, 'utf8'));
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.issues)) return null;

    const terminalStatuses = ['done', 'wontfix'];
    const total = parsed.issues.length;
    const done = parsed.issues.filter((issue: { status?: string }) => typeof issue.status === 'string' && terminalStatuses.includes(issue.status)).length;
    const decomposed = parsed.issues.filter((issue: { decomposed?: string }) => typeof issue.decomposed === 'string' && issue.decomposed.trim().length > 0).length;

    return { done, total, decomposed };
  } catch {
    return null;
  }
}

export async function scanFeatureArtifacts(cwd: string, feature: FeatureRecord): Promise<FeatureArtifacts> {
  const featureDir = getFeatureDir(cwd, feature);

  const hasGrillSession = await fileExists(join(featureDir, 'GRILL_SESSION.md'));
  const hasBrief = await fileExists(join(featureDir, 'BRIEF.md'));
  const hasPrd = await fileExists(join(featureDir, 'PRD.md'));
  const hasIssues = await dirHasMdFiles(join(featureDir, 'issues'));

  const issueCounts = await readIssueCounts(cwd, feature, hasIssues);

  const aiReviewPassed = await dirHasMdFiles(join(featureDir, 'reviews'));

  const humanReviewPassed = feature.status === 'archived' && feature.finalStatus === 'done';

  return {
    hasGrillSession,
    hasBrief,
    hasPrd,
    hasIssues,
    issueCounts,
    aiReviewPassed,
    humanReviewPassed
  };
}

export async function scanAllFeatures(cwd: string, state: FeaturesState): Promise<Map<number, FeatureArtifacts>> {
  const result = new Map<number, FeatureArtifacts>();

  for (const feature of state.features) {
    const artifacts = await scanFeatureArtifacts(cwd, feature);
    result.set(feature.id, artifacts);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Milestone aggregation
// ---------------------------------------------------------------------------

export function computeMilestoneSummary(features: FeatureRecord[]): MilestoneSummary {
  const byMilestone = new Map<number, FeatureRecord[]>();
  const unassigned: FeatureRecord[] = [];

  for (const feature of features) {
    if (feature.milestone === undefined) {
      unassigned.push(feature);
    } else {
      const existing = byMilestone.get(feature.milestone) ?? [];
      existing.push(feature);
      unassigned.push === undefined; // noop, just using existing
      byMilestone.set(feature.milestone, existing);
    }
  }

  const groups: MilestoneGroup[] = [];

  const sortedMilestones = [...byMilestone.keys()].sort((a, b) => a - b);

  for (const milestone of sortedMilestones) {
    const milestoneFeatures = byMilestone.get(milestone)!;

    const total = milestoneFeatures.length;
    const done = milestoneFeatures.filter(f => f.status === 'archived' && f.finalStatus === 'done').length;
    const inProgress = milestoneFeatures.filter(f => f.status === 'in-progress').length;

    let status: MilestoneGroup['status'];

    if (done === total) {
      status = 'done';
    } else if (milestoneFeatures.every(f => f.status === 'todo') && done === 0) {
      status = 'not-started';
    } else {
      status = 'in-progress';
    }

    groups.push({ milestone, total, done, inProgress, status });
  }

  const milestonesWithActive = groups.filter(g => g.status === 'in-progress');
  const hasMultipleActive = milestonesWithActive.length > 1;

  return { groups, unassigned, hasMultipleActive };
}

// ---------------------------------------------------------------------------
// Status output formatting
// ---------------------------------------------------------------------------

export function formatStatusOutput(
  summary: MilestoneSummary,
  artifacts: Map<number, FeatureArtifacts>,
  features: FeatureRecord[],
  issueBreakdowns: Map<number, IssueBreakdownEntry[]> = new Map()
): StatusOutput {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  if (features.length === 0) {
    return { stdout: 'No features registered.', stderr: '' };
  }

  // Section 1: Milestones
  stdoutLines.push('=== Milestones ===');

  if (summary.groups.length === 0) {
    stdoutLines.push('  (none)');
  } else {
    for (const group of summary.groups) {
      stdoutLines.push(`  M${group.milestone}  | ${group.done}/${group.total} done  | ${group.inProgress} in-progress  | ${group.status}`);
    }
  }

  // Warnings
  if (summary.unassigned.length > 0) {
    stderrLines.push(`⚠ ${summary.unassigned.length} feature(s) have no milestone assigned. Use update-feature <slug> --milestone <N> to assign.`);
  }

  if (summary.hasMultipleActive) {
    stderrLines.push('⚠ Multiple milestones have in-progress features. Only one active milestone is expected.');
  }

  stdoutLines.push('');

  // Section 2: Feature pipeline state
  for (const feature of features) {
    const artifact = artifacts.get(feature.id);

    if (!artifact) continue;

    stdoutLines.push(`> Feature: ${formatFeatureDir(feature)} (${feature.status})`);

    if (feature.milestone !== undefined) {
      stdoutLines.push(`  - milestone: M${feature.milestone}`);
    }

    stdoutLines.push(`  - Has Grill Session: ${artifact.hasGrillSession}`, `  - Has Brief: ${artifact.hasBrief}`, `  - Has PRD: ${artifact.hasPrd}`, `  - Has issues: ${artifact.hasIssues}`);

    if (artifact.issueCounts !== null) {
      stdoutLines.push(`  - decomposed issues: ${artifact.issueCounts.decomposed}/${artifact.issueCounts.total}`);
    } else {
      stdoutLines.push('  - decomposed issues: —');
    }

    if (artifact.issueCounts !== null) {
      stdoutLines.push(`  - completed issues: ${artifact.issueCounts.done}/${artifact.issueCounts.total}`);
    } else if (artifact.hasIssues) {
      stdoutLines.push('  - completed issues: —');
    } else {
      stdoutLines.push('  - completed issues: —');
    }

    stdoutLines.push(`  - AI Review Passed: ${artifact.aiReviewPassed}`, `  - Human Review Passed: ${artifact.humanReviewPassed}`);

    // Issue breakdown — only for in-progress features
    if (feature.status === 'in-progress') {
      const entries = issueBreakdowns.get(feature.id);
      if (entries && entries.length > 0) {
        const sorted = [...entries].sort((a, b) => a.id - b.id);
        stdoutLines.push('  - Issues:');
        for (const entry of sorted) {
          const paddedId = String(entry.id).padStart(2, '0');
          const decomposedMark = entry.decomposed ? '  ✓ decomposed' : '';
          stdoutLines.push(`    - #${paddedId} ${entry.title}  [${entry.status}]${decomposedMark}`);
        }
      } else {
        stdoutLines.push('  - Issues: none');
      }
    }
  }

  return {
    stdout: stdoutLines.join('\n'),
    stderr: stderrLines.join('\n')
  };
}
