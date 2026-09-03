import { defineCommand } from "citty";
import { consola } from "consola";
import { listProviders, version } from "../index.ts";
import { formatProviderCapabilities } from "../tui.ts";

export default defineCommand({
  meta: {
    name: "providers",
    description: "List registered providers, configuration, and operation capabilities",
  },
  args: {
    json: {
      type: "boolean",
      description: "Print providers as JSON with configuration and capability details",
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
    for (const provider of status) {
      const capabilityLabel = `  \x1B[90m${formatProviderCapabilities(provider)}\x1B[0m`;
      if (provider.configured) {
        consola.log(`  \x1B[32m\u2713\x1B[0m ${provider.name}${capabilityLabel}`);
      } else {
        consola.log(
          `  \x1B[31m\u2717\x1B[0m ${provider.name}  \x1B[90m${provider.envVar} not set\x1B[0m${capabilityLabel}`,
        );
      }
    }
  },
});
