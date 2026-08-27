import { parseArgs } from "node:util";

import { convertAuthoredContent } from "./convertAuthoredContent.js";
import { checkAuthoredContentDelivery } from "./checkAuthoredContentDelivery.js";
import { deriveAuthoredContentLocaleOverlayFiles } from "./deriveAuthoredContentLocaleOverlayFiles.js";
import { canonicalJson } from "./project/CanonicalJson.js";
import { AUTHORED_CONTENT_TOOL_VERSION, AuthoredContentToolError } from "./types.js";

const HELP = `Usage: laya-authored-content <check|convert|publish|check-delivery|derive-locale> [options]

Options:
  --project <file>          Laya-authored-content project file
  --workspace-root <dir>   Root used to resolve locked authored inputs
  --provider-root <dir>    Authenticated LayaAir checkout
  --output-root <dir>      Delivery root (required by convert/publish)
  --delivery-root <dir>    Existing delivery root (required by check-delivery)
  --request <file>         Locale diff request (required by derive-locale)
  --output <file>          Locale overlay output (required by derive-locale)
  --check                  Verify the deterministic locale output without writing
  --json                    Emit the deterministic receipt as JSON (default)
  --help                    Show this help
  --version                 Show the tooling version
`;

export async function main(arguments_: readonly string[]): Promise<0 | 1 | 2> {
    try {
        if (arguments_.includes("--help") || arguments_.length === 0) { process.stdout.write(HELP); return 0; }
        if (arguments_.includes("--version")) { process.stdout.write(`${AUTHORED_CONTENT_TOOL_VERSION}\n`); return 0; }
        const command = arguments_[0];
        const parsed = parseArgs({
            args: arguments_.slice(1),
            allowPositionals: false,
            strict: true,
            options: {
                project: { type: "string" },
                "workspace-root": { type: "string" },
                "provider-root": { type: "string" },
                "output-root": { type: "string" },
                "delivery-root": { type: "string" },
                request: { type: "string" },
                output: { type: "string" },
                check: { type: "boolean", default: false },
                json: { type: "boolean", default: true }
            }
        });
        if (command === "derive-locale") {
            const requestPath = parsed.values.request;
            const outputPath = parsed.values.output;
            if (!requestPath || !outputPath)
                throw new AuthoredContentToolError("AUTHORED_CONTENT_CLI_OPTION", "derive-locale requires --request and --output.", { exitCode: 1 });
            for (const option of ["project", "workspace-root", "provider-root", "output-root", "delivery-root"] as const) {
                if (parsed.values[option] !== undefined)
                    throw new AuthoredContentToolError("AUTHORED_CONTENT_CLI_OPTION", `derive-locale does not accept --${option}.`, { exitCode: 1 });
            }
            const result = await deriveAuthoredContentLocaleOverlayFiles({
                requestPath,
                outputPath,
                check: parsed.values.check ?? false,
            });
            process.stdout.write(canonicalJson(result));
            return 0;
        }
        if (command === "check-delivery") {
            const deliveryRoot = parsed.values["delivery-root"];
            const providerRoot = parsed.values["provider-root"];
            if (!deliveryRoot || !providerRoot)
                throw new AuthoredContentToolError("AUTHORED_CONTENT_CLI_OPTION", "check-delivery requires --delivery-root and --provider-root.", { exitCode: 1 });
            const result = await checkAuthoredContentDelivery({ deliveryRoot, providerRoot });
            process.stdout.write(canonicalJson(result.receipt));
            return result.exitCode;
        }
        for (const [name, value] of [["project", parsed.values.project], ["workspace-root", parsed.values["workspace-root"]], ["provider-root", parsed.values["provider-root"]]] as const) {
            if (!value) throw new AuthoredContentToolError("AUTHORED_CONTENT_CLI_OPTION", `--${name} is required.`, { exitCode: 1 });
        }
        const result = await convertAuthoredContent({
            command: command as "check" | "convert" | "publish",
            projectPath: parsed.values.project!,
            workspaceRoot: parsed.values["workspace-root"]!,
            providerRoot: parsed.values["provider-root"]!,
            ...(parsed.values["output-root"] ? { outputRoot: parsed.values["output-root"] } : {})
        });
        process.stdout.write(canonicalJson(result.receipt));
        return result.exitCode;
    }
    catch (error) {
        const known = error instanceof AuthoredContentToolError;
        const usage = !known && error instanceof TypeError && String((error as NodeJS.ErrnoException).code || "").startsWith("ERR_PARSE_ARGS");
        const exitCode = known ? error.exitCode : 1;
        const output = {
            schema: "laya-authored-content-cli-error@1",
            code: known ? error.code : usage ? "AUTHORED_CONTENT_CLI_USAGE" : "AUTHORED_CONTENT_INTERNAL_ERROR",
            message: known ? error.message.slice(error.code.length + 2) : usage ? "Invalid command-line option." : "Unexpected internal failure."
        };
        process.stderr.write(canonicalJson(output));
        return exitCode;
    }
}

void main(process.argv.slice(2)).then(exitCode => { process.exitCode = exitCode; });
