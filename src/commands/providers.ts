import { defineCommand } from "citty";
import { consola } from "consola";
import { listProviders, version } from "../index.ts";

export default defineCommand({
  meta: {
    name: "providers",
    description: "List built-in providers and their configuration status",
  },
  args: {
    json: {
      type: "boolean",
      description: "Print providers as JSON with configuration status",
      default: false,
    },
  },
  async run({ args }) {
    await import("../providers/index.ts");
    const status = listProviders();

    if (args.json) {
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    consola.log(`web ${version}`);
    for (const { name, envVar, configured } of status) {
      if (configured) {
        consola.log(`  \x1B[32m\u2713\x1B[0m ${name}`);
      } else {
        consola.log(`  \x1B[31m\u2717\x1B[0m ${name}  \x1B[90m${envVar} not set\x1B[0m`);
      }
    }
  },
});
