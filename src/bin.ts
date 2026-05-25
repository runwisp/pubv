import { main } from './cli/main.js';

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    // Should be unreachable — main() catches everything — but be defensive.
    process.stderr.write(`pubv: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
