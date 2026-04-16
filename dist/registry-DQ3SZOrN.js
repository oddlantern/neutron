//#region src/plugins/registry.ts
/**
* Holds loaded plugins and provides context factory for plugin execution.
*/
var PluginRegistry = class {
	ecosystemPlugins;
	domainPlugins;
	constructor(ecosystem, domain) {
		this.ecosystemPlugins = ecosystem;
		this.domainPlugins = domain;
	}
	/** Find the ecosystem plugin for a package based on its ecosystem name */
	getEcosystemForPackage(pkg) {
		return this.ecosystemPlugins.find((p) => p.name === pkg.ecosystem);
	}
	/** Find the domain plugin that can handle a bridge artifact */
	async getDomainForArtifact(artifact, root) {
		for (const plugin of this.domainPlugins) if (await plugin.detectBridge(artifact, root)) return plugin;
	}
	/** Find all ecosystem plugins that can handle a domain artifact across target packages */
	async findEcosystemHandlers(domain, artifact, targets, root) {
		const handlers = [];
		for (const pkg of targets) for (const plugin of this.ecosystemPlugins) {
			if (!plugin.canHandleDomainArtifact) continue;
			const capability = await plugin.canHandleDomainArtifact(domain, artifact, pkg, root);
			if (capability) handlers.push({
				plugin,
				pkg,
				capability
			});
		}
		return handlers;
	}
	/**
	* Ask plugins to suggest watch paths for a bridge.
	* Domain plugins get priority (they understand the artifact type).
	* Falls back to ecosystem plugin suggestions.
	*/
	async suggestWatchPaths(source, artifact, packages, root) {
		const domain = await this.getDomainForArtifact(artifact, root);
		if (domain?.suggestWatchPaths) {
			const suggestion = await domain.suggestWatchPaths(source, artifact, packages, root);
			if (suggestion) return suggestion;
		}
		const ecosystem = this.getEcosystemForPackage(source);
		if (ecosystem?.suggestWatchPaths) return ecosystem.suggestWatchPaths(source, root);
		return null;
	}
	/** Create an ExecutionContext for plugin execution */
	createContext(graph, root, packageManager, options) {
		return {
			graph,
			root,
			packageManager,
			verbose: options?.verbose,
			dryRun: options?.dryRun,
			force: options?.force,
			lintTypescript: options?.lintConfig?.typescript,
			lintDart: options?.lintConfig?.dart,
			lintPython: options?.lintConfig?.python,
			lintRust: options?.lintConfig?.rust,
			lintGo: options?.lintConfig?.go,
			lintPhp: options?.lintConfig?.php,
			formatTypescript: options?.formatConfig?.typescript,
			formatDart: options?.formatConfig?.dart,
			formatPython: options?.formatConfig?.python,
			formatRust: options?.formatConfig?.rust,
			formatGo: options?.formatConfig?.go,
			formatPhp: options?.formatConfig?.php,
			findEcosystemHandlers: async (domain, artifact) => {
				const bridgeTargetPaths = /* @__PURE__ */ new Set();
				for (const bridge of graph.bridges) for (const consumer of bridge.consumers) bridgeTargetPaths.add(consumer.path);
				const targets = [...graph.packages.values()].filter((p) => bridgeTargetPaths.has(p.path));
				return this.findEcosystemHandlers(domain, artifact, targets, root);
			}
		};
	}
};
//#endregion
export { PluginRegistry as t };

//# sourceMappingURL=registry-DQ3SZOrN.js.map