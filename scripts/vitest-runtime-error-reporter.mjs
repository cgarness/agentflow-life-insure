import { writeFileSync } from 'node:fs';
import process from 'node:process';

// Use the installed Vitest reporter callback, including an explicit empty array at completion.
// A missing JSON field or absent log summary is never used as evidence of zero errors.
export default class RuntimeErrorReporter {
  onTestRunEnd(_modules, errors, reason) {
    const file = process.env.VITEST_RUNTIME_ERROR_FILE;
    if (!file || !Array.isArray(errors)) throw new Error('Runtime error evidence unavailable');
    writeFileSync(file, JSON.stringify({
      finished: true,
      reason,
      errors: errors.map(error => ({
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error),
      })),
    }) + '\n');
  }
}
