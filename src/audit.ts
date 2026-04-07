/**
 * Reward Artifact Coverage Audit Module
 * 
 * Audits rewarded tasks for evidence coverage gaps.
 * Outputs ranked audit queue for manual review targeting.
 * 
 * @module audit
 */

import {
  type AuditInput,
  type AuditOutput,
  type AuditThresholds,
  type RewardedTaskRecord,
  type OperatorAuditResult,
  type FlaggedTask,
  type AnomalyFlag,
  type TaskReasonCode,
  type PriorityBand,
  type EvidenceVisibility,
  type VerificationType,
  DEFAULT_THRESHOLDS,
  SCHEMA_VERSION,
} from './types.js';

// ============================================================================
// Validation
// ============================================================================

function isValidISODate(str: string): boolean {
  return !isNaN(new Date(str).getTime());
}

function validateInput(input: AuditInput, asOf: Date): Map<string, string[]> {
  const warnings = new Map<string, string[]>();
  const taskIds = new Set<string>();
  
  const addWarning = (taskId: string, msg: string) => {
    if (!warnings.has(taskId)) warnings.set(taskId, []);
    warnings.get(taskId)!.push(msg);
  };
  
  for (const record of input.records) {
    if (taskIds.has(record.task_id)) {
      addWarning(record.task_id, `Duplicate task_id`);
    }
    taskIds.add(record.task_id);
    
    if (!isValidISODate(record.rewarded_at)) {
      addWarning(record.task_id, `Invalid rewarded_at: ${record.rewarded_at}`);
    }
    
    if (record.reward_pft < 0) {
      addWarning(record.task_id, `Negative reward: ${record.reward_pft}`);
    }
    
    if (record.verification_type === 'url' && !record.verification_target) {
      addWarning(record.task_id, `URL verification type but no target`);
    }
    
    if (record.verification_target && record.verification_type === 'url') {
      try {
        new URL(record.verification_target);
      } catch {
        addWarning(record.task_id, `Malformed URL: ${record.verification_target}`);
      }
    }
  }
  
  return warnings;
}

// ============================================================================
// Evidence Classification
// ============================================================================

function isPubliclyVerifiable(visibility: EvidenceVisibility): boolean {
  return visibility === 'public' || visibility === 'authenticated';
}

function isUnverifiable(visibility: EvidenceVisibility): boolean {
  return visibility === 'private' || visibility === 'missing' || visibility === 'malformed';
}

function getTaskReasonCodes(
  record: RewardedTaskRecord,
  asOf: Date,
  thresholds: AuditThresholds
): TaskReasonCode[] {
  const reasons: TaskReasonCode[] = [];
  
  if (record.evidence_visibility === 'missing') {
    reasons.push('MISSING_EVIDENCE');
  }
  
  if (record.evidence_visibility === 'private') {
    reasons.push('PRIVATE_ARTIFACT');
  }
  
  if (record.evidence_visibility === 'expired') {
    reasons.push('EXPIRED_LINK');
  }
  
  if (record.evidence_visibility === 'malformed') {
    reasons.push('MALFORMED_TARGET');
  }
  
  if (record.verification_type === 'self_report') {
    reasons.push('SELF_REPORT_ONLY');
  }
  
  if (record.reward_pft >= thresholds.high_reward_threshold && !isPubliclyVerifiable(record.evidence_visibility)) {
    reasons.push('HIGH_REWARD_UNVERIFIED');
  }
  
  if (record.evidence_checked_at) {
    const checkedDate = new Date(record.evidence_checked_at);
    const daysSinceCheck = Math.floor((asOf.getTime() - checkedDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceCheck > thresholds.stale_check_days) {
      reasons.push('STALE_CHECK');
    }
  }
  
  if (reasons.length === 0) {
    reasons.push('OK');
  }
  
  return reasons;
}

// ============================================================================
// Operator Aggregation
// ============================================================================

interface OperatorAggregates {
  operator_id: string;
  tasks: RewardedTaskRecord[];
  total_pft: number;
  publicly_verifiable_pft: number;
  unverifiable_pft: number;
  by_visibility: Map<EvidenceVisibility, { count: number; pft: number }>;
  by_verification_type: Map<VerificationType, { count: number; pft: number }>;
  flagged_tasks: FlaggedTask[];
  warnings: string[];
}

function aggregateByOperator(
  input: AuditInput,
  asOf: Date,
  warnings: Map<string, string[]>,
  thresholds: AuditThresholds
): Map<string, OperatorAggregates> {
  const operators = new Map<string, OperatorAggregates>();
  
  const getOrCreate = (opId: string): OperatorAggregates => {
    if (!operators.has(opId)) {
      operators.set(opId, {
        operator_id: opId,
        tasks: [],
        total_pft: 0,
        publicly_verifiable_pft: 0,
        unverifiable_pft: 0,
        by_visibility: new Map(),
        by_verification_type: new Map(),
        flagged_tasks: [],
        warnings: [],
      });
    }
    return operators.get(opId)!;
  };
  
  for (const record of input.records) {
    const op = getOrCreate(record.operator_id);
    op.tasks.push(record);
    op.total_pft += record.reward_pft;
    
    // Classify by visibility
    if (isPubliclyVerifiable(record.evidence_visibility)) {
      op.publicly_verifiable_pft += record.reward_pft;
    } else if (isUnverifiable(record.evidence_visibility)) {
      op.unverifiable_pft += record.reward_pft;
    }
    
    // By visibility breakdown
    const visEntry = op.by_visibility.get(record.evidence_visibility) ?? { count: 0, pft: 0 };
    visEntry.count++;
    visEntry.pft += record.reward_pft;
    op.by_visibility.set(record.evidence_visibility, visEntry);
    
    // By verification type breakdown
    const typeEntry = op.by_verification_type.get(record.verification_type) ?? { count: 0, pft: 0 };
    typeEntry.count++;
    typeEntry.pft += record.reward_pft;
    op.by_verification_type.set(record.verification_type, typeEntry);
    
    // Check for flagged task
    const reasonCodes = getTaskReasonCodes(record, asOf, thresholds);
    if (!reasonCodes.includes('OK')) {
      op.flagged_tasks.push({
        task_id: record.task_id,
        reward_pft: record.reward_pft,
        verification_type: record.verification_type,
        evidence_visibility: record.evidence_visibility,
        reason_codes: reasonCodes,
      });
    }
    
    // Add task-level warnings
    const taskWarnings = warnings.get(record.task_id) ?? [];
    op.warnings.push(...taskWarnings);
  }
  
  return operators;
}

// ============================================================================
// Anomaly Detection
// ============================================================================

function detectAnomalies(
  agg: OperatorAggregates,
  asOf: Date,
  thresholds: AuditThresholds
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  
  const coverageRatio = agg.total_pft > 0 ? agg.publicly_verifiable_pft / agg.total_pft : 1;
  
  // HIGH_REWARD_NO_EVIDENCE
  const highRewardMissing = agg.tasks.filter(t => 
    t.reward_pft >= thresholds.high_reward_threshold && 
    (t.evidence_visibility === 'missing' || t.evidence_visibility === 'private')
  );
  if (highRewardMissing.length > 0) {
    flags.push('HIGH_REWARD_NO_EVIDENCE');
  }
  
  // HIGH_REWARD_SELF_REPORT
  const highRewardSelfReport = agg.tasks.filter(t =>
    t.reward_pft >= thresholds.high_reward_threshold &&
    t.verification_type === 'self_report'
  );
  if (highRewardSelfReport.length > 0) {
    flags.push('HIGH_REWARD_SELF_REPORT');
  }
  
  // EVIDENCE_EXPIRED
  const expiredCount = agg.by_visibility.get('expired')?.count ?? 0;
  if (expiredCount > 0) {
    flags.push('EVIDENCE_EXPIRED');
  }
  
  // MALFORMED_VERIFICATION
  const malformedCount = agg.by_visibility.get('malformed')?.count ?? 0;
  if (malformedCount > 0) {
    flags.push('MALFORMED_VERIFICATION');
  }
  
  // ALL_PRIVATE
  if (agg.tasks.length > 0 && agg.publicly_verifiable_pft === 0) {
    flags.push('ALL_PRIVATE');
  }
  
  // LOW_COVERAGE_HIGH_VOLUME
  if (agg.tasks.length >= thresholds.min_tasks_for_patterns && 
      coverageRatio < thresholds.low_coverage_threshold) {
    flags.push('LOW_COVERAGE_HIGH_VOLUME');
  }
  
  // CONCENTRATION_RISK
  if (agg.tasks.length > 1) {
    const maxTaskPft = Math.max(...agg.tasks.map(t => t.reward_pft));
    if (maxTaskPft / agg.total_pft >= thresholds.concentration_threshold) {
      flags.push('CONCENTRATION_RISK');
    }
  }
  
  // STALE_EVIDENCE_CHECK
  const staleChecks = agg.tasks.filter(t => {
    if (!t.evidence_checked_at) return false;
    const checkedDate = new Date(t.evidence_checked_at);
    const daysSince = Math.floor((asOf.getTime() - checkedDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSince > thresholds.stale_check_days;
  });
  if (staleChecks.length > 0) {
    flags.push('STALE_EVIDENCE_CHECK');
  }
  
  return flags;
}

// ============================================================================
// Priority Scoring
// ============================================================================

function calculatePriorityScore(
  agg: OperatorAggregates,
  anomalies: AnomalyFlag[],
  thresholds: AuditThresholds
): number {
  let score = 0;
  
  // Unverifiable PFT weight (0-40 points)
  if (agg.unverifiable_pft >= 50000) score += 40;
  else if (agg.unverifiable_pft >= 20000) score += 30;
  else if (agg.unverifiable_pft >= 10000) score += 20;
  else if (agg.unverifiable_pft >= 5000) score += 10;
  
  // Anomaly count (0-30 points)
  score += Math.min(anomalies.length * 6, 30);
  
  // Coverage ratio penalty (0-20 points)
  const coverageRatio = agg.total_pft > 0 ? agg.publicly_verifiable_pft / agg.total_pft : 1;
  if (coverageRatio < 0.25) score += 20;
  else if (coverageRatio < 0.5) score += 15;
  else if (coverageRatio < 0.75) score += 10;
  
  // High-severity anomaly bonus (0-10 points)
  if (anomalies.includes('HIGH_REWARD_NO_EVIDENCE')) score += 10;
  if (anomalies.includes('ALL_PRIVATE')) score += 5;
  
  return Math.min(score, 100);
}

function getPriorityBand(score: number): PriorityBand {
  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function generateRationale(
  agg: OperatorAggregates,
  anomalies: AnomalyFlag[],
  coverageRatio: number
): string {
  if (anomalies.length === 0 && coverageRatio >= 0.9) {
    return 'Good coverage. Routine review only.';
  }
  
  const parts: string[] = [];
  
  if (anomalies.includes('HIGH_REWARD_NO_EVIDENCE')) {
    parts.push('High-value tasks with missing/private evidence');
  }
  if (anomalies.includes('ALL_PRIVATE')) {
    parts.push('Zero public artifacts');
  }
  if (anomalies.includes('LOW_COVERAGE_HIGH_VOLUME')) {
    parts.push(`Low coverage (${(coverageRatio * 100).toFixed(0)}%) across ${agg.tasks.length} tasks`);
  }
  if (anomalies.includes('EVIDENCE_EXPIRED')) {
    parts.push('Evidence links have expired');
  }
  
  if (parts.length === 0) {
    parts.push(`Coverage at ${(coverageRatio * 100).toFixed(0)}%`);
  }
  
  return parts.join('. ') + '.';
}

// ============================================================================
// Result Generation
// ============================================================================

function generateOperatorResult(
  agg: OperatorAggregates,
  asOf: Date,
  thresholds: AuditThresholds
): OperatorAuditResult {
  const anomalies = detectAnomalies(agg, asOf, thresholds);
  const priorityScore = calculatePriorityScore(agg, anomalies, thresholds);
  const priorityBand = getPriorityBand(priorityScore);
  const coverageRatio = agg.total_pft > 0 ? agg.publicly_verifiable_pft / agg.total_pft : 1;
  
  // Convert maps to records
  const byVisibility: Record<EvidenceVisibility, { count: number; pft: number }> = {
    public: { count: 0, pft: 0 },
    authenticated: { count: 0, pft: 0 },
    private: { count: 0, pft: 0 },
    expired: { count: 0, pft: 0 },
    missing: { count: 0, pft: 0 },
    malformed: { count: 0, pft: 0 },
  };
  for (const [k, v] of agg.by_visibility) {
    byVisibility[k] = v;
  }
  
  const byVerificationType: Record<VerificationType, { count: number; pft: number }> = {
    url: { count: 0, pft: 0 },
    code: { count: 0, pft: 0 },
    document: { count: 0, pft: 0 },
    screenshot: { count: 0, pft: 0 },
    transaction: { count: 0, pft: 0 },
    attestation: { count: 0, pft: 0 },
    self_report: { count: 0, pft: 0 },
    unknown: { count: 0, pft: 0 },
  };
  for (const [k, v] of agg.by_verification_type) {
    byVerificationType[k] = v;
  }
  
  return {
    operator_id: agg.operator_id,
    total_tasks: agg.tasks.length,
    total_pft: agg.total_pft,
    publicly_verifiable_tasks: agg.tasks.filter(t => isPubliclyVerifiable(t.evidence_visibility)).length,
    publicly_verifiable_pft: agg.publicly_verifiable_pft,
    unverifiable_tasks: agg.tasks.filter(t => isUnverifiable(t.evidence_visibility)).length,
    unverifiable_pft: agg.unverifiable_pft,
    evidence_coverage_ratio: Math.round(coverageRatio * 1000) / 1000,
    anomaly_flags: anomalies,
    anomaly_score: Math.min(anomalies.length * 15, 100),
    flagged_task_ids: agg.flagged_tasks.map(t => t.task_id),
    flagged_tasks: agg.flagged_tasks,
    priority_band: priorityBand,
    priority_score: priorityScore,
    review_rationale: generateRationale(agg, anomalies, coverageRatio),
    by_visibility: byVisibility,
    by_verification_type: byVerificationType,
    sort_keys: {
      priority_score: priorityScore,
      unverifiable_pft: agg.unverifiable_pft,
      operator_id: agg.operator_id,
    },
    validation_warnings: [...new Set(agg.warnings)],
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Audit rewarded task records for evidence coverage gaps.
 */
export function auditEvidenceCoverage(
  input: AuditInput,
  thresholds: AuditThresholds = DEFAULT_THRESHOLDS
): AuditOutput {
  const asOf = input.as_of ? new Date(input.as_of) : new Date();
  const generatedAt = new Date();
  
  // Validate input
  const warnings = validateInput(input, asOf);
  
  // Aggregate by operator
  const operators = aggregateByOperator(input, asOf, warnings, thresholds);
  
  // Generate results
  const results: OperatorAuditResult[] = [];
  for (const agg of operators.values()) {
    results.push(generateOperatorResult(agg, asOf, thresholds));
  }
  
  // Sort: priority_score desc, unverifiable_pft desc, operator_id asc
  results.sort((a, b) => {
    if (a.priority_score !== b.priority_score) return b.priority_score - a.priority_score;
    if (a.unverifiable_pft !== b.unverifiable_pft) return b.unverifiable_pft - a.unverifiable_pft;
    return a.operator_id.localeCompare(b.operator_id);
  });
  
  // Summary
  const totalPft = results.reduce((sum, r) => sum + r.total_pft, 0);
  const publicPft = results.reduce((sum, r) => sum + r.publicly_verifiable_pft, 0);
  const unverifiablePft = results.reduce((sum, r) => sum + r.unverifiable_pft, 0);
  
  const byPriority: Record<PriorityBand, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of results) {
    byPriority[r.priority_band]++;
  }
  
  return {
    generated_at: generatedAt.toISOString(),
    as_of: asOf.toISOString(),
    version: SCHEMA_VERSION,
    operators: results,
    summary: {
      total_operators: results.length,
      total_tasks: input.records.length,
      total_pft: totalPft,
      publicly_verifiable_pft: publicPft,
      unverifiable_pft: unverifiablePft,
      overall_coverage_ratio: totalPft > 0 ? Math.round((publicPft / totalPft) * 1000) / 1000 : 1,
      by_priority: byPriority,
      operators_with_anomalies: results.filter(r => r.anomaly_flags.length > 0).length,
    },
  };
}

// Re-exports
export { DEFAULT_THRESHOLDS, SCHEMA_VERSION } from './types.js';
export type * from './types.js';
