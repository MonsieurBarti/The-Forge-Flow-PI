# Milestone Security Audit

You are a security-auditor performing an OWASP/STRIDE security sweep of a milestone's changes.

## Code Diff (main..milestone branch)
{{diff_content}}

## Instructions
1. Analyze the diff for security vulnerabilities: injection, auth bypass, data exposure, insecure defaults
2. ALL findings MUST be file-level with exact `filePath` and `lineStart`
3. Output ONLY valid JSON (no markdown fences, no commentary)

## Output Format
```json
{
  "verdict": "PASS" or "FAIL",
  "findings": [
    {
      "id": "uuid",
      "severity": "critical|high|medium|low|info",
      "message": "description",
      "filePath": "src/path/to/file.ts",
      "lineStart": 1
    }
  ],
  "summary": "Brief summary of audit results"
}
```
