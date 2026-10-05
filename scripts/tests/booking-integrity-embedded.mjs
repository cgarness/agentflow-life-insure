// Same exact fixture and SQL assertions as the native booking runner.
process.argv[2]='booking';
await import('./policy-integrity-embedded.mjs');
