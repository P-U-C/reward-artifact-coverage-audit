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
- `unverifiable_pft` — PFT with private/missing/malformed evidence
- `anomaly_flags` — Array of detected anomalies
- `priority_band` — critical/high/medium/low
- `flagged_task_ids` — Tasks requiring manual review

## License

MIT
