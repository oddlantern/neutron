#!/usr/bin/env node
import { r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-CSbDQNfR.js";
import { t as buildWorkspaceGraph } from "./workspace-D0mjV9qy.js";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
//#region src/commands/graph.ts
function buildGraphData(packages, bridges) {
	const nodes = [];
	const edges = [];
	const nodeIds = /* @__PURE__ */ new Set();
	for (const [path, pkg] of packages) {
		nodes.push({
			id: path,
			ecosystem: pkg.ecosystem,
			name: pkg.name,
			type: "package"
		});
		nodeIds.add(path);
		for (const dep of pkg.localDependencies) edges.push({
			source: dep,
			target: path,
			type: "dependency"
		});
	}
	for (const bridge of bridges) for (const consumer of bridge.consumers) {
		const consumerPkg = packages.get(consumer.path);
		if (consumerPkg) {
			const generatedId = `${bridge.source}/generated/${consumerPkg.ecosystem}`;
			if (!nodeIds.has(generatedId)) {
				nodes.push({
					id: generatedId,
					ecosystem: consumerPkg.ecosystem,
					name: `generated/${consumerPkg.ecosystem}`,
					type: "generated"
				});
				nodeIds.add(generatedId);
				edges.push({
					source: bridge.source,
					target: generatedId,
					type: "bridge",
					artifact: bridge.artifact
				});
			}
			edges.push({
				source: generatedId,
				target: consumer.path,
				type: "generated"
			});
		}
	}
	return {
		nodes,
		edges
	};
}
function generateHtml(nodes, edges, workspaceName) {
	const data = JSON.stringify({
		nodes,
		edges
	});
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace Graph — ${workspaceName}</title>
  <style>
    :root {
      --bg: #0f1117; --surface: #1a1d27; --border: #2e3342;
      --text: #e4e6ed; --text-muted: #8b90a0;
      --ts: #3b82f6; --dart: #0175c2; --generated: #a78bfa;
      --dep: #4b5563; --bridge: #fb923c;
      --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --mono: 'JetBrains Mono', 'Fira Code', monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font); background: var(--bg); color: var(--text); overflow: hidden; }
    svg { width: 100vw; height: 100vh; }
    .header {
      position: fixed; top: 0; left: 0; right: 0; padding: 1rem 1.5rem;
      background: linear-gradient(to bottom, var(--bg), transparent);
      z-index: 10; pointer-events: none;
    }
    .header h1 {
      font-size: 1.1rem; font-weight: 600;
      background: linear-gradient(135deg, #6c8cff, #a78bfa);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .header .subtitle { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem; }
    .legend {
      position: fixed; bottom: 1rem; left: 1.5rem;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.75rem;
      color: var(--text-muted); z-index: 10;
    }
    .legend-item { display: flex; align-items: center; gap: 0.5rem; margin: 0.3rem 0; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
    .legend-line { width: 20px; height: 2px; }
    .tooltip {
      position: fixed; padding: 0.5rem 0.75rem; background: var(--surface);
      border: 1px solid var(--border); border-radius: 6px; font-size: 0.8rem;
      pointer-events: none; opacity: 0; transition: opacity 0.15s;
      font-family: var(--mono); z-index: 20;
    }
    text { font-family: var(--mono); font-size: 11px; fill: var(--text); pointer-events: none; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Workspace Graph</h1>
    <div class="subtitle">${workspaceName} — ${nodes.length} nodes, ${edges.length} edges</div>
  </div>
  <div class="legend">
    <div class="legend-item"><div class="legend-dot" style="background:var(--ts)"></div> TypeScript</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--dart)"></div> Dart</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--generated)"></div> Generated</div>
    <div class="legend-item"><div class="legend-line" style="background:var(--dep)"></div> Dependency</div>
    <div class="legend-item"><div class="legend-line" style="background:var(--bridge);border-top:2px dashed var(--bridge);height:0"></div> Bridge</div>
  </div>
  <div class="tooltip" id="tooltip"></div>
  <svg id="graph"></svg>
  <script src="https://d3js.org/d3.v7.min.js"><\/script>
  <script>
    const data = ${data};
    const width = window.innerWidth;
    const height = window.innerHeight;

    const colorMap = { typescript: '#3b82f6', dart: '#0175c2' };
    const edgeColorMap = { dependency: '#4b5563', bridge: '#fb923c', generated: '#a78bfa' };

    const svg = d3.select('#graph')
      .attr('width', width).attr('height', height)
      .call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', (e) => g.attr('transform', e.transform)));

    // Arrow markers
    const defs = svg.append('defs');
    for (const [type, color] of Object.entries(edgeColorMap)) {
      defs.append('marker')
        .attr('id', 'arrow-' + type).attr('viewBox', '0 -5 10 10')
        .attr('refX', 22).attr('refY', 0).attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', color);
    }

    const g = svg.append('g');
    const tooltip = d3.select('#tooltip');

    const simulation = d3.forceSimulation(data.nodes)
      .force('link', d3.forceLink(data.edges).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    const link = g.append('g').selectAll('line')
      .data(data.edges).enter().append('line')
      .attr('stroke', d => edgeColorMap[d.type] || '#4b5563')
      .attr('stroke-width', d => d.type === 'bridge' ? 2 : 1.5)
      .attr('stroke-dasharray', d => d.type === 'bridge' ? '6,3' : 'none')
      .attr('marker-end', d => 'url(#arrow-' + d.type + ')');

    const node = g.append('g').selectAll('g')
      .data(data.nodes).enter().append('g')
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    node.append('circle')
      .attr('r', d => d.type === 'generated' ? 8 : 12)
      .attr('fill', d => d.type === 'generated' ? '#a78bfa' : (colorMap[d.ecosystem] || '#6b7280'))
      .attr('stroke', d => d.type === 'generated' ? '#7c3aed' : '#fff')
      .attr('stroke-width', d => d.type === 'generated' ? 1.5 : 2)
      .attr('opacity', d => d.type === 'generated' ? 0.7 : 1);

    node.append('text')
      .text(d => d.id.split('/').pop())
      .attr('dx', 16).attr('dy', 4);

    node.on('mouseenter', (e, d) => {
      tooltip.style('opacity', 1)
        .html(d.id + '<br><span style="color:var(--text-muted)">' + d.ecosystem + (d.type === 'generated' ? ' (generated)' : '') + '</span>')
        .style('left', (e.clientX + 12) + 'px').style('top', (e.clientY - 12) + 'px');
    }).on('mouseleave', () => tooltip.style('opacity', 0));

    simulation.on('tick', () => {
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
    });
  <\/script>
</body>
</html>`;
}
function generateDot(nodes, edges, workspaceName) {
	const lines = [
		`digraph "${workspaceName}" {`,
		"  rankdir=LR;",
		"  node [shape=box, style=rounded];"
	];
	const byEcosystem = /* @__PURE__ */ new Map();
	for (const node of nodes) {
		const eco = node.ecosystem;
		const existing = byEcosystem.get(eco);
		if (existing) existing.push(node);
		else byEcosystem.set(eco, [node]);
	}
	for (const [eco, ecoNodes] of byEcosystem) {
		lines.push(`  subgraph cluster_${eco} {`);
		lines.push(`    label="${eco}";`);
		for (const node of ecoNodes) {
			const style = node.type === "generated" ? ", style=\"dashed,rounded\"" : "";
			lines.push(`    "${node.id}" [label="${node.id.split("/").pop()}"${style}];`);
		}
		lines.push("  }");
	}
	for (const edge of edges) {
		const style = edge.type === "bridge" ? " [style=dashed, color=orange]" : edge.type === "generated" ? " [color=purple]" : "";
		lines.push(`  "${edge.source}" -> "${edge.target}"${style};`);
	}
	lines.push("}");
	return lines.join("\n");
}
function generateAscii(nodes, edges) {
	const lines = [];
	const byEcosystem = /* @__PURE__ */ new Map();
	for (const node of nodes) {
		const eco = node.ecosystem;
		const existing = byEcosystem.get(eco);
		if (existing) existing.push(node);
		else byEcosystem.set(eco, [node]);
	}
	const outgoing = /* @__PURE__ */ new Map();
	for (const edge of edges) {
		const existing = outgoing.get(edge.source);
		const label = edge.type === "bridge" ? `${edge.target} (bridge)` : edge.target;
		if (existing) existing.push(label);
		else outgoing.set(edge.source, [label]);
	}
	for (const [eco, ecoNodes] of byEcosystem) {
		lines.push(`${eco}`);
		for (const node of ecoNodes) {
			const suffix = node.type === "generated" ? " [generated]" : "";
			lines.push(`  ${node.id}${suffix}`);
			const deps = outgoing.get(node.id);
			if (deps) for (const dep of deps) lines.push(`    \u2192 ${dep}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}
/**
* Generate and display the workspace dependency graph.
*
* @returns exit code (0 = success)
*/
async function runGraph(parsers, options = {}) {
	const format = options.format ?? "html";
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const { nodes, edges } = buildGraphData(graph.packages, graph.bridges);
	if (format === "ascii") {
		console.log(generateAscii(nodes, edges));
		return 0;
	}
	if (format === "dot") {
		console.log(generateDot(nodes, edges, graph.name));
		return 0;
	}
	const html = generateHtml(nodes, edges, graph.name);
	const midoDir = join(root, ".mido");
	mkdirSync(midoDir, { recursive: true });
	const outputPath = join(midoDir, "graph.html");
	writeFileSync(outputPath, html, "utf-8");
	console.log(`${BOLD}mido graph${RESET} ${DIM}\u2192 ${outputPath}${RESET}`);
	if (options.open !== false) try {
		const { spawnSync: spawn } = await import("node:child_process");
		spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open", [outputPath], { stdio: "ignore" });
	} catch {
		console.log(`${DIM}\u2192 Could not open browser. Open ${outputPath} manually.${RESET}`);
	}
	return 0;
}
//#endregion
export { runGraph };

//# sourceMappingURL=graph-DRpru-oh.js.map