#!/usr/bin/env node
//#region src/commands/group.ts
/** Group packages by ecosystem, applying optional filters */
function groupByEcosystem(packages, options) {
	const grouped = /* @__PURE__ */ new Map();
	for (const pkg of packages.values()) {
		if (options.package && pkg.path !== options.package) continue;
		if (options.ecosystem && pkg.ecosystem !== options.ecosystem) continue;
		const list = grouped.get(pkg.ecosystem) ?? [];
		list.push(pkg);
		grouped.set(pkg.ecosystem, list);
	}
	return grouped;
}
//#endregion
export { groupByEcosystem as t };

//# sourceMappingURL=group-C7C6m5mM.js.map