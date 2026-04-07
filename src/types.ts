/**
 * Reward Artifact Coverage Audit Module — Types
 * 
 * Audits rewarded tasks for evidence coverage gaps.
 * Outputs ranked audit queue for manual review targeting.
 */

export const SCHEMA_VERSION = '1.0.0';

// ============================================================================
// Input Types
// ============================================================================

/**
 * Verification type for the task
 */
export type VerificationType = 
  | 'url'           // Public URL submission
  | 'code'          // Code artifact
  | 'document'      // Document/report
  | 'screenshot'    // Visual evidence
  | 'transaction'   // On-chain transaction
  | 'attestation'   // Third-party attestation
  | 'self_report'   // Self-reported completion
  | 'unknown';

/**
 * Evidence visibility/accessibility status
 */
export type EvidenceVisibility = 
  | 'public'        // Publicly accessible (URL works, repo is public)
  | 'authenticated' // Requires auth but verifiable
  | 'private'       // Private/internal only
  | 'expired'       // Was public, now inaccessible
  | 'missing'       // No evidence provided
  | 'malformed';    // Evidence metadata is invalid

/**
 * Single rewarded task record
 */
export interface RewardedTaskRecord {
  task_id: string;
  operator_id: string;
  reward_pft: number;
  rewarded_at: string;           // ISO 8601
  verification_type: VerificationType;
  verification_target?: string;  // URL, hash, or reference
  evidence_visibility: EvidenceVisibility;
  evidence_checked_at?: string;  // When visibility was last verified
  notes?: string;
}

/**
 * Input to the audit module
 */
export interface AuditInput {
  records: RewardedTaskRecord[];
  as_of?: string;
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Anomaly flag codes
 */
export type AnomalyFlag = 
  | 'HIGH_REWARD_NO_EVIDENCE'      // Large reward with missing/private evidence
  | 'HIGH_REWARD_SELF_REPORT'      // Large reward with only self-report
  | 'EVIDENCE_EXPIRED'             // Evidence was public, now inaccessible
  | 'MALFORMED_VERIFICATION'       // Invalid verification metadata
  | 'ALL_PRIVATE'                  // Operator has 0% public evidence
  | 'LOW_COVERAGE_HIGH_VOLUME'     // Many tasks, low public coverage
  | 'CONCENTRATION_RISK'           // Single task > 50% of operator's rewards
  | 'DATA_QUALITY_RISK'            // Duplicate task IDs, malformed URLs, etc.
  | 'STALE_EVIDENCE_CHECK';        // Evidence not re-verified recently

/**
 * Per-task audit reason
 */
export type TaskReasonCode = 
  | 'MISSING_EVIDENCE'
  | 'PRIVATE_ARTIFACT'
  | 'EXPIRED_LINK'
  | 'MALFORMED_TARGET'
  | 'SELF_REPORT_ONLY'
  | 'HIGH_REWARD_UNVERIFIED'
  | 'STALE_CHECK'
  | 'OK';

/**
 * Priority band for review
 */
export type PriorityBand = 'critical' | 'high' | 'medium' | 'low';

/**
 * Flagged task detail
 */
export interface FlaggedTask {
  task_id: string;
  reward_pft: number;
  verification_type: VerificationType;
  evidence_visibility: EvidenceVisibility;
  reason_codes: TaskReasonCode[];
}

/**
 * Per-operator audit result
 */
export interface OperatorAuditResult {
  operator_id: string;
  
  // Coverage metrics
  total_tasks: number;
  total_pft: number;
  publicly_verifiable_tasks: number;
  publicly_verifiable_pft: number;
  unverifiable_tasks: number;
  unverifiable_pft: number;
  evidence_coverage_ratio: number;  // 0-1, publicly_verifiable_pft / total_pft
  
  // Anomalies
  anomaly_flags: AnomalyFlag[];
  anomaly_score: number;            // 0-100, higher = more concerning
  
  // Flagged tasks
  flagged_task_ids: string[];
  flagged_tasks: FlaggedTask[];
  
  // Review priority
  priority_band: PriorityBand;
  priority_score: number;           // 0-100 for sorting
  review_rationale: string;
  
  // Breakdown by visibility
  by_visibility: Record<EvidenceVisibility, { count: number; pft: number }>;
  by_verification_type: Record<VerificationType, { count: number; pft: number }>;
  
  // Sort keys
  sort_keys: {
    priority_score: number;
    unverifiable_pft: number;
    operator_id: string;
  };
  
  validation_warnings: string[];
}

/**
 * Audit output
 */
export interface AuditOutput {
  generated_at: string;
  as_of: string;
  version: string;
  operators: OperatorAuditResult[];
  summary: {
    total_operators: number;
    total_tasks: number;
    total_pft: number;
    publicly_verifiable_pft: number;
    unverifiable_pft: number;
    overall_coverage_ratio: number;
    by_priority: Record<PriorityBand, number>;
    operators_with_anomalies: number;
  };
}

// ============================================================================
// Thresholds
// ============================================================================

export interface AuditThresholds {
  high_reward_threshold: number;       // PFT amount to consider "high reward"
  low_coverage_threshold: number;      // Coverage ratio below which to flag
  concentration_threshold: number;     // Single task % of total to flag
  stale_check_days: number;            // Days since evidence check to flag
  min_tasks_for_patterns: number;      // Min tasks to detect patterns
}

export const DEFAULT_THRESHOLDS: AuditThresholds = {
  high_reward_threshold: 5000,
  low_coverage_threshold: 0.5,
  concentration_threshold: 0.5,
  stale_check_days: 30,
  min_tasks_for_patterns: 3,
};
