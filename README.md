# Reward Artifact Coverage Audit Module

Audits rewarded task records for evidence coverage gaps. Outputs a ranked JSON audit queue showing which operators and tasks have weak, missing, or non-public evidence coverage.

## Install & Test

```bash
npm install
npm run build
npm test
```

## Usage

```typescript
import { auditEvidenceCoverage } from './dist/audit.js';

const result = auditEvidenceCoverage({
  records: [
    {
      task_id: "t1",
      operator_id: "op1",
      reward_pft: 5000,
      rewarded_at: "2026-04-01T10:00:00Z",
      verification_type: "url",
      verification_target: "https://example.com/evidence",
      evidence_visibility: "public"
    }
  ],
  as_of: "2026-04-07T12:00:00Z"
});

console.log(result.operators[0].evidence_coverage_ratio);
console.log(result.operators[0].anomaly_flags);
console.log(result.operators[0].priority_band);
```

## Output Fields

Per-operator:
- `evidence_coverage_ratio` — 0-1, publicly_verifiable_pft / total_pft
- `publicly_verifiable_pft` — PFT with public/authenticated evidence
- `unverifiable_pft` — PFT with private/missing/malformed/expired evidence
- `anomaly_flags` — Array of detected anomalies
- `priority_band` — critical/high/medium/low
- `flagged_task_ids` — Tasks requiring manual review

## Sample Input

```json
{
  "records": [
    {
      "task_id": "clean-1",
      "operator_id": "operator-clean",
      "reward_pft": 4000,
      "rewarded_at": "2026-04-01T10:00:00Z",
      "verification_type": "url",
      "verification_target": "https://example.com/evidence/clean-1",
      "evidence_visibility": "public"
    },
    {
      "task_id": "partial-1",
      "operator_id": "operator-partial",
      "reward_pft": 6000,
      "rewarded_at": "2026-04-01T10:00:00Z",
      "verification_type": "url",
      "verification_target": "https://example.com/evidence/partial-1",
      "evidence_visibility": "private"
    },
    {
      "task_id": "critical-1",
      "operator_id": "operator-critical",
      "reward_pft": 12000,
      "rewarded_at": "2026-04-01T10:00:00Z",
      "verification_type": "url",
      "verification_target": "not-a-valid-url",
      "evidence_visibility": "public"
    }
  ],
  "as_of": "2026-04-07T12:00:00Z"
}
```

## Sample Output

```json
{
  "operators": [
    {
      "operator_id": "operator-critical",
      "total_tasks": 1,
      "total_pft": 12000,
      "publicly_verifiable_pft": 0,
      "unverifiable_pft": 12000,
      "evidence_coverage_ratio": 0,
      "anomaly_flags": ["MALFORMED_VERIFICATION", "ALL_PRIVATE", "DATA_QUALITY_RISK"],
      "priority_band": "high",
      "flagged_task_ids": ["critical-1"]
    },
    {
      "operator_id": "operator-partial",
      "total_tasks": 1,
      "total_pft": 6000,
      "publicly_verifiable_pft": 0,
      "unverifiable_pft": 6000,
      "evidence_coverage_ratio": 0,
      "anomaly_flags": ["HIGH_REWARD_NO_EVIDENCE", "ALL_PRIVATE"],
      "priority_band": "medium",
      "flagged_task_ids": ["partial-1"]
    },
    {
      "operator_id": "operator-clean",
      "total_tasks": 1,
      "total_pft": 4000,
      "publicly_verifiable_pft": 4000,
      "unverifiable_pft": 0,
      "evidence_coverage_ratio": 1,
      "anomaly_flags": [],
      "priority_band": "low",
      "flagged_task_ids": []
    }
  ]
}
```

## License

MIT
