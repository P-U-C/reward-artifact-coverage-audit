/**
 * Reward Artifact Coverage Audit Module — Unit Tests
 * 
 * At least 8 tests covering:
 * - Empty input
 * - Full coverage
 * - Partial coverage
 * - High-reward low-evidence operators
 * - Deterministic ordering
 * - Threshold boundaries
 * - Malformed records
 * - Tied priority cases
 */

import { describe, it, expect } from 'vitest';
import { auditEvidenceCoverage, DEFAULT_THRESHOLDS } from '../src/audit.js';
import type { AuditInput, RewardedTaskRecord } from '../src/types.js';

// ============================================================================
// Fixtures
// ============================================================================

const NOW = '2026-04-07T12:00:00Z';
const RECENT = '2026-04-01T12:00:00Z';
const OLD = '2026-03-01T12:00:00Z';

function makeRecord(overrides: Partial<RewardedTaskRecord> & { task_id: string; operator_id: string }): RewardedTaskRecord {
  return {
    reward_pft: 1000,
    rewarded_at: RECENT,
    verification_type: 'url',
    evidence_visibility: 'public',
    ...overrides,
  };
}

// ============================================================================
// Test 1: Empty Input
// ============================================================================

describe('Empty Input', () => {
  it('returns empty operators for empty input', () => {
    const input: AuditInput = { records: [], as_of: NOW };
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators).toHaveLength(0);
    expect(result.summary.total_operators).toBe(0);
    expect(result.summary.total_tasks).toBe(0);
    expect(result.version).toBe('1.0.0');
  });
});

// ============================================================================
// Test 2: Full Coverage
// ============================================================================

describe('Full Coverage', () => {
  it('reports 100% coverage for all public evidence', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 5000 }),
        makeRecord({ task_id: 't2', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 3000 }),
        makeRecord({ task_id: 't3', operator_id: 'op1', evidence_visibility: 'authenticated', reward_pft: 2000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].evidence_coverage_ratio).toBe(1);
    expect(result.operators[0].publicly_verifiable_pft).toBe(10000);
    expect(result.operators[0].unverifiable_pft).toBe(0);
    expect(result.operators[0].priority_band).toBe('low');
  });
});

// ============================================================================
// Test 3: Partial Coverage
// ============================================================================

describe('Partial Coverage', () => {
  it('calculates correct coverage ratio', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 6000 }),
        makeRecord({ task_id: 't2', operator_id: 'op1', evidence_visibility: 'private', reward_pft: 4000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].evidence_coverage_ratio).toBe(0.6);
    expect(result.operators[0].publicly_verifiable_pft).toBe(6000);
    expect(result.operators[0].unverifiable_pft).toBe(4000);
  });

  it('flags tasks with missing evidence', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 5000 }),
        makeRecord({ task_id: 't2', operator_id: 'op1', evidence_visibility: 'missing', reward_pft: 5000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].flagged_task_ids).toContain('t2');
    expect(result.operators[0].flagged_tasks[0].reason_codes).toContain('MISSING_EVIDENCE');
  });
});

// ============================================================================
// Test 4: High-Reward Low-Evidence Operators
// ============================================================================

describe('High-Reward Low-Evidence Operators', () => {
  it('flags HIGH_REWARD_NO_EVIDENCE for large private rewards', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'private', reward_pft: 10000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].anomaly_flags).toContain('HIGH_REWARD_NO_EVIDENCE');
    expect(result.operators[0].anomaly_flags).toContain('ALL_PRIVATE');
  });

  it('flags HIGH_REWARD_SELF_REPORT', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ 
          task_id: 't1', 
          operator_id: 'op1', 
          verification_type: 'self_report',
          evidence_visibility: 'public',
          reward_pft: 8000 
        }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].anomaly_flags).toContain('HIGH_REWARD_SELF_REPORT');
  });

  it('assigns critical priority to high-risk operators', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'missing', reward_pft: 25000 }),
        makeRecord({ task_id: 't2', operator_id: 'op1', evidence_visibility: 'private', reward_pft: 25000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].priority_band).toBe('critical');
  });
});

// ============================================================================
// Test 5: Deterministic Ordering
// ============================================================================

describe('Deterministic Ordering', () => {
  it('produces identical output for same input', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'charlie', evidence_visibility: 'public' }),
        makeRecord({ task_id: 't2', operator_id: 'alice', evidence_visibility: 'private', reward_pft: 5000 }),
        makeRecord({ task_id: 't3', operator_id: 'bob', evidence_visibility: 'missing', reward_pft: 3000 }),
      ],
      as_of: NOW,
    };
    
    const result1 = auditEvidenceCoverage(input);
    const result2 = auditEvidenceCoverage(input);
    
    expect(result1.operators.map(o => o.operator_id))
      .toEqual(result2.operators.map(o => o.operator_id));
  });

  it('sorts by priority desc, unverifiable_pft desc, operator_id asc', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'zeta', evidence_visibility: 'public' }),
        makeRecord({ task_id: 't2', operator_id: 'alpha', evidence_visibility: 'missing', reward_pft: 10000 }),
        makeRecord({ task_id: 't3', operator_id: 'beta', evidence_visibility: 'missing', reward_pft: 10000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    // alpha and beta both have missing evidence, should sort by operator_id
    const highPriority = result.operators.filter(o => o.unverifiable_pft > 0);
    expect(highPriority[0].operator_id).toBe('alpha');
    expect(highPriority[1].operator_id).toBe('beta');
  });
});

// ============================================================================
// Test 6: Threshold Boundaries
// ============================================================================

describe('Threshold Boundaries', () => {
  it('triggers LOW_COVERAGE_HIGH_VOLUME at exactly 50%', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 500 }),
        makeRecord({ task_id: 't2', operator_id: 'op1', evidence_visibility: 'private', reward_pft: 500 }),
        makeRecord({ task_id: 't3', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 500 }),
        makeRecord({ task_id: 't4', operator_id: 'op1', evidence_visibility: 'private', reward_pft: 500 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].evidence_coverage_ratio).toBe(0.5);
    // At exactly 50%, should NOT flag (threshold is < 0.5)
    expect(result.operators[0].anomaly_flags).not.toContain('LOW_COVERAGE_HIGH_VOLUME');
  });

  it('triggers CONCENTRATION_RISK at 50%+', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 6000 }),
        makeRecord({ task_id: 't2', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 2000 }),
        makeRecord({ task_id: 't3', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 2000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].anomaly_flags).toContain('CONCENTRATION_RISK');
  });
});

// ============================================================================
// Test 7: Malformed Records
// ============================================================================

describe('Malformed Records', () => {
  it('flags malformed verification targets', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ 
          task_id: 't1', 
          operator_id: 'op1', 
          verification_type: 'url',
          verification_target: 'not-a-valid-url',
          evidence_visibility: 'public',
        }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].validation_warnings.some(w => w.includes('Malformed URL'))).toBe(true);
  });

  it('flags duplicate task IDs', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 'dupe', operator_id: 'op1', evidence_visibility: 'public' }),
        makeRecord({ task_id: 'dupe', operator_id: 'op1', evidence_visibility: 'public' }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].validation_warnings.some(w => w.includes('Duplicate'))).toBe(true);
  });

  it('flags tasks with malformed evidence visibility', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'malformed', reward_pft: 5000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].anomaly_flags).toContain('MALFORMED_VERIFICATION');
    expect(result.operators[0].flagged_tasks[0].reason_codes).toContain('MALFORMED_TARGET');
  });
});

// ============================================================================
// Test 8: Tied Priority Cases
// ============================================================================

describe('Tied Priority Cases', () => {
  it('breaks ties deterministically by operator_id', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'zeta', evidence_visibility: 'missing', reward_pft: 5000 }),
        makeRecord({ task_id: 't2', operator_id: 'alpha', evidence_visibility: 'missing', reward_pft: 5000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    // Same priority and unverifiable_pft, should sort by operator_id asc
    expect(result.operators[0].operator_id).toBe('alpha');
    expect(result.operators[1].operator_id).toBe('zeta');
  });
});

// ============================================================================
// Test 9: Expired Evidence
// ============================================================================

describe('Expired Evidence', () => {
  it('flags expired evidence links', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'expired', reward_pft: 5000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.operators[0].anomaly_flags).toContain('EVIDENCE_EXPIRED');
    expect(result.operators[0].flagged_tasks[0].reason_codes).toContain('EXPIRED_LINK');
  });
});

// ============================================================================
// Test 10: Summary Statistics
// ============================================================================

describe('Summary Statistics', () => {
  it('correctly aggregates summary', () => {
    const input: AuditInput = {
      records: [
        makeRecord({ task_id: 't1', operator_id: 'op1', evidence_visibility: 'public', reward_pft: 5000 }),
        makeRecord({ task_id: 't2', operator_id: 'op1', evidence_visibility: 'private', reward_pft: 3000 }),
        makeRecord({ task_id: 't3', operator_id: 'op2', evidence_visibility: 'public', reward_pft: 2000 }),
      ],
      as_of: NOW,
    };
    
    const result = auditEvidenceCoverage(input);
    
    expect(result.summary.total_operators).toBe(2);
    expect(result.summary.total_tasks).toBe(3);
    expect(result.summary.total_pft).toBe(10000);
    expect(result.summary.publicly_verifiable_pft).toBe(7000);
    expect(result.summary.unverifiable_pft).toBe(3000);
    expect(result.summary.overall_coverage_ratio).toBe(0.7);
  });
});
