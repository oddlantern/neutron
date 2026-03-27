import { existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  confirm,
  isCancel,
  log,
  multiselect,
  path as clackPath,
  select,
  text,
} from "@clack/prompts";

import type { MidoConfig } from "../../config/schema.js";
import { BOLD, DIM, ORANGE, RESET } from "../../output.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { WatchPathSuggestion } from "../../plugins/types.js";
import { type BridgeWithWatch, getAllPackagePaths, handleCancel } from "./shared.js";

// ─── Watch path prompts ──────────────────────────────────────────────────────

export async function promptWatchPaths(
  root: string,
  source: string,
  suggestion?: WatchPathSuggestion | null,
  currentWatch?: readonly string[] | null,
): Promise<readonly string[] | undefined> {
  const defaultWatch = `${source}/**`;

  // Build options: plugin suggestion first (if available), then browse/manual/skip
  type WatchChoice = "suggestion" | "browse" | "manual" | "skip";
  const options: Array<{ value: WatchChoice; label: string; hint?: string }> = [];

  if (suggestion) {
    const suggestedLabel = suggestion.paths.join(", ");
    options.push({
      value: "suggestion",
      label: suggestedLabel,
      hint: `detected: ${suggestion.reason}`,
    });
  }

  // "Skip" shows current watch paths if they exist, otherwise the default
  const skipHint = currentWatch?.length
    ? `keep: ${currentWatch.join(", ")}`
    : `default: ${defaultWatch}`;

  options.push(
    { value: "browse", label: "Browse for a different path" },
    { value: "manual", label: "Enter manually" },
    { value: "skip", label: "Skip", hint: skipHint },
  );

  const choice = await select({
    message: "Watch paths for this bridge:",
    options,
    initialValue: suggestion
      ? ("suggestion" satisfies WatchChoice)
      : ("browse" satisfies WatchChoice),
  });
  if (isCancel(choice)) {
    handleCancel();
  }

  switch (choice) {
    case "suggestion": {
      return suggestion?.paths;
    }
    case "browse": {
      const browsed = await clackPath({
        message: "Select directory to watch:",
        root,
        directory: true,
      });
      if (isCancel(browsed)) {
        handleCancel();
      }
      const relPath = relative(root, join(root, browsed));
      return [`${relPath}/**`];
    }
    case "manual": {
      const entered = await text({
        message: "Watch paths (comma-separated globs):",
        placeholder: defaultWatch,
      });
      if (isCancel(entered)) {
        handleCancel();
      }
      if (!entered) {
        return undefined;
      }
      return entered
        .split(/[,\s]+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    }
    case "skip":
    default: {
      // Preserve existing watch paths if available
      return currentWatch?.length ? currentWatch : undefined;
    }
  }
}

// ─── Modify bridge prompt ────────────────────────────────────────────────────

export async function promptModifyBridge(
  root: string,
  config: MidoConfig,
  current: {
    readonly source: string;
    readonly consumers: readonly string[];
    readonly artifact: string;
    readonly watch?: readonly string[] | undefined;
  },
  pluginRegistry?: PluginRegistry,
  packageMap?: ReadonlyMap<string, import("../../graph/types.js").WorkspacePackage>,
): Promise<BridgeWithWatch | null> {
  const allPaths = getAllPackagePaths(config);

  const source = await select({
    message: `Source (currently: ${current.source}):`,
    options: allPaths.map((p) => ({ value: p, label: p })),
    initialValue: current.source,
  });
  if (isCancel(source)) {
    handleCancel();
  }

  const consumerPaths = allPaths.filter((p) => p !== source);
  const consumers = await multiselect({
    message: `Consumers (currently: [${current.consumers.join(", ")}]):`,
    options: consumerPaths.map((p) => ({
      value: p,
      label: p,
      selected: current.consumers.includes(p),
    })),
    required: true,
  });
  if (isCancel(consumers)) {
    handleCancel();
  }

  const artifact = await clackPath({
    message: `Artifact (currently: ${current.artifact}):`,
    root,
    initialValue: current.artifact,
  });
  if (isCancel(artifact)) {
    handleCancel();
  }

  // Make artifact relative to root
  const relArtifact = relative(root, join(root, artifact));

  // Get plugin suggestion for the (possibly changed) source
  let modifySuggestion: WatchPathSuggestion | null = null;
  if (pluginRegistry && packageMap) {
    const sourcePkg = packageMap.get(source);
    if (sourcePkg) {
      modifySuggestion = await pluginRegistry.suggestWatchPaths(
        sourcePkg,
        relArtifact,
        packageMap,
        root,
      );
    }
  }

  const watch = await promptWatchPaths(root, source, modifySuggestion, current.watch);

  return { source, consumers, artifact: relArtifact, watch };
}

// ─── Additional bridges prompt ───────────────────────────────────────────────

export async function promptAdditionalBridges(
  root: string,
  packagePaths: readonly string[],
): Promise<BridgeWithWatch[]> {
  const result: BridgeWithWatch[] = [];

  const addMore = await confirm({ message: "Any additional bridges?", initialValue: false });
  if (isCancel(addMore)) {
    handleCancel();
  }
  if (!addMore) {
    return result;
  }

  let adding = true;
  while (adding) {
    const source = await select({
      message: "Source (who generates the file):",
      options: packagePaths.map((p) => ({ value: p, label: p })),
    });
    if (isCancel(source)) {
      handleCancel();
    }

    const consumerPaths = packagePaths.filter((p) => p !== source);
    const consumers = await multiselect({
      message: "Consumers (who depends on it):",
      options: consumerPaths.map((p) => ({ value: p, label: p })),
      required: true,
    });
    if (isCancel(consumers)) {
      handleCancel();
    }

    const artifact = await clackPath({
      message: "Artifact (shared file, e.g. openapi.json):",
      root,
    });
    if (isCancel(artifact)) {
      handleCancel();
    }

    const relArtifact = relative(root, join(root, artifact));

    // Validate artifact
    const fullArtifactPath = join(root, relArtifact);
    if (existsSync(fullArtifactPath)) {
      try {
        if (statSync(fullArtifactPath).isDirectory()) {
          log.warn("Artifact must be a file, not a directory. Skipping bridge.");
          const retry = await confirm({ message: "Add another bridge?", initialValue: false });
          if (isCancel(retry)) {
            handleCancel();
          }
          adding = retry;
          continue;
        }
      } catch {
        // stat failed
      }
    } else {
      const proceed = await confirm({
        message: "File not found — it may not be generated yet. Continue?",
        initialValue: false,
      });
      if (isCancel(proceed)) {
        handleCancel();
      }
      if (!proceed) {
        const retry = await confirm({ message: "Add another bridge?", initialValue: false });
        if (isCancel(retry)) {
          handleCancel();
        }
        adding = retry;
        continue;
      }
    }

    const watch = await promptWatchPaths(root, source);
    result.push({ source, consumers, artifact: relArtifact, watch });
    log.step(
      `Bridge: ${ORANGE}${source}${RESET} ${DIM}\u2192${RESET} ${ORANGE}[${consumers.join(", ")}]${RESET} ${DIM}via${RESET} ${BOLD}${relArtifact}${RESET}`,
    );

    const another = await confirm({ message: "Add another bridge?", initialValue: false });
    if (isCancel(another)) {
      handleCancel();
    }
    adding = another;
  }

  return result;
}
