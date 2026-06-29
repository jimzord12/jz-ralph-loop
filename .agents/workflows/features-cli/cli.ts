import { createFeature, FEATURE_STATUSES, FeatureStateError, initFeaturesState, readFeaturesState, resolveCurrentFeature, updateFeatureStatus } from './features-state';
import {
  getActionableIssues,
  IssueStateError,
  readIssuesState,
  regenerateIssuesStateFromIssueFiles,
  resolveFeatureForIssueRead,
  selectNextIssue,
  updateIssueBlockers,
  updateIssueStatus
} from './issues-state';
import { computeMilestoneSummary, formatStatusOutput, type IssueBreakdownEntry, scanAllFeatures } from './status-scanner';

export type CliResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export async function runIssuesManagerCli(args: string[], options: { cwd: string }): Promise<CliResult> {
  try {
    if (args[0] === 'list-issues') {
      const featureFlagIndex = args.indexOf('--feature');
      const actionableOnly = args.includes('--actionable');
      const state = await readFeaturesState(options.cwd);
      const feature = resolveFeatureForIssueRead(state, featureFlagIndex >= 0 ? args[featureFlagIndex + 1] : undefined);

      const issuesState = await readIssuesState(options.cwd, feature);
      const issues = actionableOnly ? getActionableIssues(issuesState) : issuesState.issues;

      return {
        exitCode: 0,
        stderr: '',
        stdout: [
          actionableOnly ? 'Feature issues (actionable)' : 'Feature issues',
          `id: ${issuesState.featureId}`,
          `slug: ${issuesState.featureSlug}`,
          `status: ${issuesState.featureStatus ?? 'unknown'}`,
          ...issues.flatMap(issue => [
            '',
            `${issue.id}. ${issue.title}`,
            `status: ${issue.status}`,
            `method: ${issue.method}`,
            `complexity: ${issue.complexity}`,
            `decomposed: ${issue.decomposed ?? 'no'}`,
            `path: ${issue.filePath}`
          ])
        ].join('\n')
      };
    }

    if (args[0] === 'init') {
      const { created } = await initFeaturesState({ cwd: options.cwd });

      return {
        exitCode: 0,
        stderr: '',
        stdout: created ? 'Initialized pipeline state at .scratch/features-status.json' : 'Pipeline state already exists at .scratch/features-status.json (left unchanged)'
      };
    }

    if (args[0] === 'create-feature') {
      const slugFlagIndex = args.indexOf('--slug');
      const slug = slugFlagIndex >= 0 ? args[slugFlagIndex + 1] : args[1];
      const milestoneFlagIndex = args.indexOf('--milestone');
      const milestoneRaw = milestoneFlagIndex >= 0 ? args[milestoneFlagIndex + 1] : undefined;

      if (!slug || slug.startsWith('--')) {
        throw new FeatureStateError('Usage: create-feature <slug> [--milestone <number>]');
      }

      const milestone = milestoneRaw !== undefined ? Number(milestoneRaw) : undefined;

      const { feature, dir } = await createFeature({
        cwd: options.cwd,
        slug,
        milestone
      });

      const lines = ['Created feature', `id: ${feature.id}`, `slug: ${feature.slug}`, `status: ${feature.status}`, `dir: ${dir}`];

      if (feature.milestone !== undefined) {
        lines.push(`milestone: ${feature.milestone}`);
      }

      return {
        exitCode: 0,
        stderr: '',
        stdout: lines.join('\n')
      };
    }

    if (args[0] === 'get-feature') {
      const state = await readFeaturesState(options.cwd);
      const feature = resolveCurrentFeature(state);

      return {
        exitCode: 0,
        stderr: '',
        stdout: ['Current feature', `id: ${feature.id}`, `slug: ${feature.slug}`, `status: ${feature.status}`].join('\n')
      };
    }

    if (args[0] === 'status') {
      const state = await readFeaturesState(options.cwd);

      if (state.features.length === 0) {
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'No features registered.'
        };
      }

      const artifacts = await scanAllFeatures(options.cwd, state);
      const summary = computeMilestoneSummary(state.features);

      // Build issue breakdowns for in-progress features
      const issueBreakdowns = new Map<number, IssueBreakdownEntry[]>();
      for (const feature of state.features) {
        if (feature.status !== 'in-progress') continue;
        try {
          const issuesState = await readIssuesState(options.cwd, feature);
          const entries: IssueBreakdownEntry[] = issuesState.issues.map(issue => ({
            id: issue.id,
            title: issue.title,
            status: issue.status,
            decomposed: typeof issue.decomposed === 'string' && issue.decomposed.trim().length > 0
          }));
          issueBreakdowns.set(feature.id, entries);
        } catch {
          // No issues-status.json or malformed — treat as no issues
          issueBreakdowns.set(feature.id, []);
        }
      }

      const output = formatStatusOutput(summary, artifacts, state.features, issueBreakdowns);

      return {
        exitCode: 0,
        stderr: output.stderr,
        stdout: output.stdout
      };
    }

    if (args[0] === 'update-feature') {
      const slug = args[1];
      const statusFlagIndex = args.indexOf('--status');
      const status = statusFlagIndex >= 0 ? args[statusFlagIndex + 1] : undefined;
      const milestoneFlagIndex = args.indexOf('--milestone');
      const milestoneRaw = milestoneFlagIndex >= 0 ? args[milestoneFlagIndex + 1] : undefined;

      if (!slug || (!status && !milestoneRaw)) {
        throw new FeatureStateError('Usage: update-feature <slug> --status <todo|in-progress|archived> [--milestone <number>]');
      }

      if (status !== undefined && !FEATURE_STATUSES.includes(status as (typeof FEATURE_STATUSES)[number])) {
        throw new FeatureStateError(`Invalid feature status "${status}". Expected one of: ${FEATURE_STATUSES.join(', ')}.`);
      }

      let milestone: number | undefined;

      if (milestoneRaw !== undefined) {
        const parsed = Number(milestoneRaw);

        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new FeatureStateError(`Invalid milestone "${milestoneRaw}". Expected a positive integer.`);
        }

        milestone = parsed;
      }

      // Resolve effective status: use --status if provided, otherwise keep current
      let effectiveStatus: (typeof FEATURE_STATUSES)[number];

      if (status !== undefined) {
        effectiveStatus = status as (typeof FEATURE_STATUSES)[number];
      } else {
        const currentState = await readFeaturesState(options.cwd);
        const currentFeature = currentState.features.find(entry => entry.slug === slug);

        if (!currentFeature) {
          throw new FeatureStateError(`Unknown feature "${slug}". Choose an existing feature slug from .scratch/features-status.json.`);
        }

        effectiveStatus = currentFeature.status;
      }

      const feature = await updateFeatureStatus({
        cwd: options.cwd,
        slug,
        status: effectiveStatus,
        milestone
      });

      const lines = ['Updated feature', `id: ${feature.id}`, `slug: ${feature.slug}`, `status: ${feature.status}`];

      if (feature.milestone !== undefined) {
        lines.push(`milestone: ${feature.milestone}`);
      }

      return {
        exitCode: 0,
        stderr: '',
        stdout: lines.join('\n')
      };
    }

    if (args[0] === 'update-blockers') {
      const issueIdRaw = args[1];
      const blockersFlagIndex = args.indexOf('--blockers');
      const featureFlagIndex = args.indexOf('--feature');
      const blockersRaw = blockersFlagIndex >= 0 ? args[blockersFlagIndex + 1] : undefined;

      if (!issueIdRaw || !blockersRaw) {
        throw new IssueStateError('Usage: update-blockers <issue-id> --blockers <none|id[,id...]> [--feature <slug>]');
      }

      const issueId = Number(issueIdRaw);

      if (!Number.isInteger(issueId) || issueId <= 0) {
        throw new IssueStateError(`Invalid issue id "${issueIdRaw}". Expected a positive integer issue id.`);
      }

      const blockedBy = parseBlockedByArgument(blockersRaw);
      const state = await readFeaturesState(options.cwd);
      const feature = resolveFeatureForIssueRead(state, featureFlagIndex >= 0 ? args[featureFlagIndex + 1] : undefined);

      const update = await updateIssueBlockers({
        cwd: options.cwd,
        feature,
        issueId,
        blockedBy
      });

      // Re-validate the regenerated state explicitly as a feature-wide guard.
      await regenerateIssuesStateFromIssueFiles({
        cwd: options.cwd,
        feature
      });

      return {
        exitCode: 0,
        stderr: '',
        stdout: [
          'Updated blockers',
          `feature: ${update.featureSlug}`,
          `issue: ${update.issueId}`,
          `blockedBy: ${update.blockedBy.length > 0 ? update.blockedBy.join(', ') : 'none'}`,
          `path: ${update.issuePath}`
        ].join('\n')
      };
    }

    if (args[0] === 'get-issue' && args[1] === '--next') {
      const featureFlagIndex = args.indexOf('--feature');
      const state = await readFeaturesState(options.cwd);
      const feature = resolveFeatureForIssueRead(state, featureFlagIndex >= 0 ? args[featureFlagIndex + 1] : undefined);

      const issuesState = await readIssuesState(options.cwd, feature);
      const result = selectNextIssue(issuesState);

      if (result.kind === 'winner') {
        return {
          exitCode: 0,
          stderr: '',
          stdout: [
            'Next issue',
            `feature: ${issuesState.featureSlug}`,
            `id: ${result.issue.id}`,
            `title: ${result.issue.title}`,
            `complexity: ${result.issue.complexity}`,
            `path: ${result.issue.filePath}`
          ].join('\n')
        };
      }

      if (result.reason === 'no-actionable') {
        return {
          exitCode: 1,
          stderr: 'No actionable issues found. All issues are blocked or not in ready-for-agent status.',
          stdout: ''
        };
      }

      const message = result.reason === 'empty' ? 'No issues found for this feature.' : 'All issues are complete.';

      return {
        exitCode: 0,
        stderr: '',
        stdout: message
      };
    }

    if (args[0] === 'update-status') {
      const issueIdRaw = args[1];
      const statusFlagIndex = args.indexOf('--status');
      const featureFlagIndex = args.indexOf('--feature');
      const force = args.includes('--force');
      const status = statusFlagIndex >= 0 ? args[statusFlagIndex + 1] : undefined;

      if (!issueIdRaw || !status) {
        throw new IssueStateError('Usage: update-status <issue-id> --status <status> [--feature <slug>] [--force]');
      }

      const issueId = Number(issueIdRaw);
      if (!Number.isInteger(issueId) || issueId <= 0) {
        throw new IssueStateError(`Invalid issue id "${issueIdRaw}". Expected a positive integer issue id.`);
      }

      const state = await readFeaturesState(options.cwd);
      const feature = resolveFeatureForIssueRead(state, featureFlagIndex >= 0 ? args[featureFlagIndex + 1] : undefined);

      const update = await updateIssueStatus({
        cwd: options.cwd,
        feature,
        issueId,
        status,
        force
      });

      return {
        exitCode: 0,
        stderr: '',
        stdout: ['Updated status', `feature: ${update.featureSlug}`, `issue: ${update.issueId}`, `status: ${update.status}`, `path: ${update.issuePath}`].join('\n')
      };
    }

    return {
      exitCode: 1,
      stderr: 'Unknown command. Supported commands: init, create-feature, status, list-issues, get-issue, get-feature, update-feature, update-blockers, update-status.',
      stdout: ''
    };
  } catch (error) {
    if (error instanceof FeatureStateError || error instanceof IssueStateError) {
      return {
        exitCode: 1,
        stderr: error.message,
        stdout: ''
      };
    }

    throw error;
  }
}

function parseBlockedByArgument(value: string): number[] {
  if (value.trim().toLowerCase() === 'none') {
    return [];
  }

  const parts = value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);

  if (parts.length === 0) {
    throw new IssueStateError('Invalid blockers value. Use --blockers none or --blockers <id[,id...]>');
  }

  return parts.map(part => {
    if (!/^\d+$/.test(part) || Number(part) <= 0) {
      throw new IssueStateError(`Invalid blocker id "${part}". Blocker IDs must be positive integers.`);
    }

    return Number(part);
  });
}

export async function runIssuesManagerCliMain(args: string[], options?: { cwd?: string }): Promise<number> {
  const result = await runIssuesManagerCli(args, {
    cwd: options?.cwd ?? process.cwd()
  });

  if (result.stdout) {
    process.stdout.write(`${result.stdout}\n`);
  }

  if (result.stderr) {
    process.stderr.write(`${result.stderr}\n`);
  }

  return result.exitCode;
}
