import type { WorkspacePackage } from "@/graph/types";

/**
 * Auto-detect the design token output format from a consumer's dependencies.
 * Returns the best-matching format string for the consumer's framework.
 */
export function detectDesignFormat(pkg: WorkspacePackage): string {
  const depNames = new Set(pkg.dependencies.map((d) => d.name));

  // TypeScript/JS frameworks
  if (depNames.has("tailwindcss")) {
    return "tailwind";
  }
  if (
    depNames.has("bootstrap") ||
    depNames.has("react-bootstrap") ||
    depNames.has("@ng-bootstrap/ng-bootstrap")
  ) {
    return "bootstrap";
  }

  // Dart/Flutter
  if (pkg.ecosystem === "dart") {
    return "material3";
  }

  // Default: plain CSS custom properties + TS constants
  return "css";
}
