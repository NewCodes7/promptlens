#!/usr/bin/env node
import { errorMessage } from "./errors.js";
import { main } from "./main.js";

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`[promptlens] ${errorMessage(err)}`);
  process.exit(1);
});
