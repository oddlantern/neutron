//#region src/guards.ts
/** Shared type guards used across the codebase */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
export { isRecord as t };

//# sourceMappingURL=guards-VZ6Ej8Ob.js.map