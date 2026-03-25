#!/usr/bin/env node
import { c as YELLOW, i as GREEN, n as CYAN, o as RED, r as DIM, s as RESET, t as BOLD } from "./output-D1Xg1ws_.js";
import { t as loadConfig } from "./loader-BO3NzoPs.js";
import { t as buildWorkspaceGraph } from "./workspace-B2H5BXLY.js";
import { n as loadPlugins, t as PluginRegistry } from "./registry-C3Iky15L.js";
import { t as detectPackageManager } from "./pm-detect-wR8KpsCR.js";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { stat as stat$1, unwatchFile, watch, watchFile } from "fs";
import { lstat as lstat$1, open, readdir as readdir$1, realpath as realpath$1, stat as stat$2 } from "fs/promises";
import { EventEmitter } from "events";
import * as sysPath from "path";
import { Readable } from "node:stream";
import { type } from "os";
import { createHash } from "node:crypto";
//#region node_modules/readdirp/esm/index.js
const EntryTypes = {
	FILE_TYPE: "files",
	DIR_TYPE: "directories",
	FILE_DIR_TYPE: "files_directories",
	EVERYTHING_TYPE: "all"
};
const defaultOptions = {
	root: ".",
	fileFilter: (_entryInfo) => true,
	directoryFilter: (_entryInfo) => true,
	type: EntryTypes.FILE_TYPE,
	lstat: false,
	depth: 2147483648,
	alwaysStat: false,
	highWaterMark: 4096
};
Object.freeze(defaultOptions);
const RECURSIVE_ERROR_CODE = "READDIRP_RECURSIVE_ERROR";
const NORMAL_FLOW_ERRORS = new Set([
	"ENOENT",
	"EPERM",
	"EACCES",
	"ELOOP",
	RECURSIVE_ERROR_CODE
]);
const ALL_TYPES = [
	EntryTypes.DIR_TYPE,
	EntryTypes.EVERYTHING_TYPE,
	EntryTypes.FILE_DIR_TYPE,
	EntryTypes.FILE_TYPE
];
const DIR_TYPES = new Set([
	EntryTypes.DIR_TYPE,
	EntryTypes.EVERYTHING_TYPE,
	EntryTypes.FILE_DIR_TYPE
]);
const FILE_TYPES = new Set([
	EntryTypes.EVERYTHING_TYPE,
	EntryTypes.FILE_DIR_TYPE,
	EntryTypes.FILE_TYPE
]);
const isNormalFlowError = (error) => NORMAL_FLOW_ERRORS.has(error.code);
const wantBigintFsStats = process.platform === "win32";
const emptyFn = (_entryInfo) => true;
const normalizeFilter = (filter) => {
	if (filter === void 0) return emptyFn;
	if (typeof filter === "function") return filter;
	if (typeof filter === "string") {
		const fl = filter.trim();
		return (entry) => entry.basename === fl;
	}
	if (Array.isArray(filter)) {
		const trItems = filter.map((item) => item.trim());
		return (entry) => trItems.some((f) => entry.basename === f);
	}
	return emptyFn;
};
/** Readable readdir stream, emitting new files as they're being listed. */
var ReaddirpStream = class extends Readable {
	constructor(options = {}) {
		super({
			objectMode: true,
			autoDestroy: true,
			highWaterMark: options.highWaterMark
		});
		const opts = {
			...defaultOptions,
			...options
		};
		const { root, type } = opts;
		this._fileFilter = normalizeFilter(opts.fileFilter);
		this._directoryFilter = normalizeFilter(opts.directoryFilter);
		const statMethod = opts.lstat ? lstat : stat;
		if (wantBigintFsStats) this._stat = (path) => statMethod(path, { bigint: true });
		else this._stat = statMethod;
		this._maxDepth = opts.depth ?? defaultOptions.depth;
		this._wantsDir = type ? DIR_TYPES.has(type) : false;
		this._wantsFile = type ? FILE_TYPES.has(type) : false;
		this._wantsEverything = type === EntryTypes.EVERYTHING_TYPE;
		this._root = resolve(root);
		this._isDirent = !opts.alwaysStat;
		this._statsProp = this._isDirent ? "dirent" : "stats";
		this._rdOptions = {
			encoding: "utf8",
			withFileTypes: this._isDirent
		};
		this.parents = [this._exploreDir(root, 1)];
		this.reading = false;
		this.parent = void 0;
	}
	async _read(batch) {
		if (this.reading) return;
		this.reading = true;
		try {
			while (!this.destroyed && batch > 0) {
				const par = this.parent;
				const fil = par && par.files;
				if (fil && fil.length > 0) {
					const { path, depth } = par;
					const slice = fil.splice(0, batch).map((dirent) => this._formatEntry(dirent, path));
					const awaited = await Promise.all(slice);
					for (const entry of awaited) {
						if (!entry) continue;
						if (this.destroyed) return;
						const entryType = await this._getEntryType(entry);
						if (entryType === "directory" && this._directoryFilter(entry)) {
							if (depth <= this._maxDepth) this.parents.push(this._exploreDir(entry.fullPath, depth + 1));
							if (this._wantsDir) {
								this.push(entry);
								batch--;
							}
						} else if ((entryType === "file" || this._includeAsFile(entry)) && this._fileFilter(entry)) {
							if (this._wantsFile) {
								this.push(entry);
								batch--;
							}
						}
					}
				} else {
					const parent = this.parents.pop();
					if (!parent) {
						this.push(null);
						break;
					}
					this.parent = await parent;
					if (this.destroyed) return;
				}
			}
		} catch (error) {
			this.destroy(error);
		} finally {
			this.reading = false;
		}
	}
	async _exploreDir(path, depth) {
		let files;
		try {
			files = await readdir(path, this._rdOptions);
		} catch (error) {
			this._onError(error);
		}
		return {
			files,
			depth,
			path
		};
	}
	async _formatEntry(dirent, path) {
		let entry;
		const basename = this._isDirent ? dirent.name : dirent;
		try {
			const fullPath = resolve(join(path, basename));
			entry = {
				path: relative(this._root, fullPath),
				fullPath,
				basename
			};
			entry[this._statsProp] = this._isDirent ? dirent : await this._stat(fullPath);
		} catch (err) {
			this._onError(err);
			return;
		}
		return entry;
	}
	_onError(err) {
		if (isNormalFlowError(err) && !this.destroyed) this.emit("warn", err);
		else this.destroy(err);
	}
	async _getEntryType(entry) {
		if (!entry && this._statsProp in entry) return "";
		const stats = entry[this._statsProp];
		if (stats.isFile()) return "file";
		if (stats.isDirectory()) return "directory";
		if (stats && stats.isSymbolicLink()) {
			const full = entry.fullPath;
			try {
				const entryRealPath = await realpath(full);
				const entryRealPathStats = await lstat(entryRealPath);
				if (entryRealPathStats.isFile()) return "file";
				if (entryRealPathStats.isDirectory()) {
					const len = entryRealPath.length;
					if (full.startsWith(entryRealPath) && full.substr(len, 1) === sep) {
						const recursiveError = /* @__PURE__ */ new Error(`Circular symlink detected: "${full}" points to "${entryRealPath}"`);
						recursiveError.code = RECURSIVE_ERROR_CODE;
						return this._onError(recursiveError);
					}
					return "directory";
				}
			} catch (error) {
				this._onError(error);
				return "";
			}
		}
	}
	_includeAsFile(entry) {
		const stats = entry && entry[this._statsProp];
		return stats && this._wantsEverything && !stats.isDirectory();
	}
};
/**
* Streaming version: Reads all files and directories in given root recursively.
* Consumes ~constant small amount of RAM.
* @param root Root directory
* @param options Options to specify root (start directory), filters and recursion depth
*/
function readdirp(root, options = {}) {
	let type = options.entryType || options.type;
	if (type === "both") type = EntryTypes.FILE_DIR_TYPE;
	if (type) options.type = type;
	if (!root) throw new Error("readdirp: root argument is required. Usage: readdirp(root, options)");
	else if (typeof root !== "string") throw new TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
	else if (type && !ALL_TYPES.includes(type)) throw new Error(`readdirp: Invalid type passed. Use one of ${ALL_TYPES.join(", ")}`);
	options.root = root;
	return new ReaddirpStream(options);
}
//#endregion
//#region node_modules/chokidar/esm/handler.js
const STR_DATA = "data";
const STR_CLOSE = "close";
const EMPTY_FN = () => {};
const pl = process.platform;
const isWindows = pl === "win32";
const isMacos = pl === "darwin";
const isLinux = pl === "linux";
const isFreeBSD = pl === "freebsd";
const isIBMi = type() === "OS400";
const EVENTS = {
	ALL: "all",
	READY: "ready",
	ADD: "add",
	CHANGE: "change",
	ADD_DIR: "addDir",
	UNLINK: "unlink",
	UNLINK_DIR: "unlinkDir",
	RAW: "raw",
	ERROR: "error"
};
const EV = EVENTS;
const THROTTLE_MODE_WATCH = "watch";
const statMethods = {
	lstat: lstat$1,
	stat: stat$2
};
const KEY_LISTENERS = "listeners";
const KEY_ERR = "errHandlers";
const KEY_RAW = "rawEmitters";
const HANDLER_KEYS = [
	KEY_LISTENERS,
	KEY_ERR,
	KEY_RAW
];
const binaryExtensions = new Set([
	"3dm",
	"3ds",
	"3g2",
	"3gp",
	"7z",
	"a",
	"aac",
	"adp",
	"afdesign",
	"afphoto",
	"afpub",
	"ai",
	"aif",
	"aiff",
	"alz",
	"ape",
	"apk",
	"appimage",
	"ar",
	"arj",
	"asf",
	"au",
	"avi",
	"bak",
	"baml",
	"bh",
	"bin",
	"bk",
	"bmp",
	"btif",
	"bz2",
	"bzip2",
	"cab",
	"caf",
	"cgm",
	"class",
	"cmx",
	"cpio",
	"cr2",
	"cur",
	"dat",
	"dcm",
	"deb",
	"dex",
	"djvu",
	"dll",
	"dmg",
	"dng",
	"doc",
	"docm",
	"docx",
	"dot",
	"dotm",
	"dra",
	"DS_Store",
	"dsk",
	"dts",
	"dtshd",
	"dvb",
	"dwg",
	"dxf",
	"ecelp4800",
	"ecelp7470",
	"ecelp9600",
	"egg",
	"eol",
	"eot",
	"epub",
	"exe",
	"f4v",
	"fbs",
	"fh",
	"fla",
	"flac",
	"flatpak",
	"fli",
	"flv",
	"fpx",
	"fst",
	"fvt",
	"g3",
	"gh",
	"gif",
	"graffle",
	"gz",
	"gzip",
	"h261",
	"h263",
	"h264",
	"icns",
	"ico",
	"ief",
	"img",
	"ipa",
	"iso",
	"jar",
	"jpeg",
	"jpg",
	"jpgv",
	"jpm",
	"jxr",
	"key",
	"ktx",
	"lha",
	"lib",
	"lvp",
	"lz",
	"lzh",
	"lzma",
	"lzo",
	"m3u",
	"m4a",
	"m4v",
	"mar",
	"mdi",
	"mht",
	"mid",
	"midi",
	"mj2",
	"mka",
	"mkv",
	"mmr",
	"mng",
	"mobi",
	"mov",
	"movie",
	"mp3",
	"mp4",
	"mp4a",
	"mpeg",
	"mpg",
	"mpga",
	"mxu",
	"nef",
	"npx",
	"numbers",
	"nupkg",
	"o",
	"odp",
	"ods",
	"odt",
	"oga",
	"ogg",
	"ogv",
	"otf",
	"ott",
	"pages",
	"pbm",
	"pcx",
	"pdb",
	"pdf",
	"pea",
	"pgm",
	"pic",
	"png",
	"pnm",
	"pot",
	"potm",
	"potx",
	"ppa",
	"ppam",
	"ppm",
	"pps",
	"ppsm",
	"ppsx",
	"ppt",
	"pptm",
	"pptx",
	"psd",
	"pya",
	"pyc",
	"pyo",
	"pyv",
	"qt",
	"rar",
	"ras",
	"raw",
	"resources",
	"rgb",
	"rip",
	"rlc",
	"rmf",
	"rmvb",
	"rpm",
	"rtf",
	"rz",
	"s3m",
	"s7z",
	"scpt",
	"sgi",
	"shar",
	"snap",
	"sil",
	"sketch",
	"slk",
	"smv",
	"snk",
	"so",
	"stl",
	"suo",
	"sub",
	"swf",
	"tar",
	"tbz",
	"tbz2",
	"tga",
	"tgz",
	"thmx",
	"tif",
	"tiff",
	"tlz",
	"ttc",
	"ttf",
	"txz",
	"udf",
	"uvh",
	"uvi",
	"uvm",
	"uvp",
	"uvs",
	"uvu",
	"viv",
	"vob",
	"war",
	"wav",
	"wax",
	"wbmp",
	"wdp",
	"weba",
	"webm",
	"webp",
	"whl",
	"wim",
	"wm",
	"wma",
	"wmv",
	"wmx",
	"woff",
	"woff2",
	"wrm",
	"wvx",
	"xbm",
	"xif",
	"xla",
	"xlam",
	"xls",
	"xlsb",
	"xlsm",
	"xlsx",
	"xlt",
	"xltm",
	"xltx",
	"xm",
	"xmind",
	"xpi",
	"xpm",
	"xwd",
	"xz",
	"z",
	"zip",
	"zipx"
]);
const isBinaryPath = (filePath) => binaryExtensions.has(sysPath.extname(filePath).slice(1).toLowerCase());
const foreach = (val, fn) => {
	if (val instanceof Set) val.forEach(fn);
	else fn(val);
};
const addAndConvert = (main, prop, item) => {
	let container = main[prop];
	if (!(container instanceof Set)) main[prop] = container = new Set([container]);
	container.add(item);
};
const clearItem = (cont) => (key) => {
	const set = cont[key];
	if (set instanceof Set) set.clear();
	else delete cont[key];
};
const delFromSet = (main, prop, item) => {
	const container = main[prop];
	if (container instanceof Set) container.delete(item);
	else if (container === item) delete main[prop];
};
const isEmptySet = (val) => val instanceof Set ? val.size === 0 : !val;
const FsWatchInstances = /* @__PURE__ */ new Map();
/**
* Instantiates the fs_watch interface
* @param path to be watched
* @param options to be passed to fs_watch
* @param listener main event handler
* @param errHandler emits info about errors
* @param emitRaw emits raw event data
* @returns {NativeFsWatcher}
*/
function createFsWatchInstance(path, options, listener, errHandler, emitRaw) {
	const handleEvent = (rawEvent, evPath) => {
		listener(path);
		emitRaw(rawEvent, evPath, { watchedPath: path });
		if (evPath && path !== evPath) fsWatchBroadcast(sysPath.resolve(path, evPath), KEY_LISTENERS, sysPath.join(path, evPath));
	};
	try {
		return watch(path, { persistent: options.persistent }, handleEvent);
	} catch (error) {
		errHandler(error);
		return;
	}
}
/**
* Helper for passing fs_watch event data to a collection of listeners
* @param fullPath absolute path bound to fs_watch instance
*/
const fsWatchBroadcast = (fullPath, listenerType, val1, val2, val3) => {
	const cont = FsWatchInstances.get(fullPath);
	if (!cont) return;
	foreach(cont[listenerType], (listener) => {
		listener(val1, val2, val3);
	});
};
/**
* Instantiates the fs_watch interface or binds listeners
* to an existing one covering the same file system entry
* @param path
* @param fullPath absolute path
* @param options to be passed to fs_watch
* @param handlers container for event listener functions
*/
const setFsWatchListener = (path, fullPath, options, handlers) => {
	const { listener, errHandler, rawEmitter } = handlers;
	let cont = FsWatchInstances.get(fullPath);
	let watcher;
	if (!options.persistent) {
		watcher = createFsWatchInstance(path, options, listener, errHandler, rawEmitter);
		if (!watcher) return;
		return watcher.close.bind(watcher);
	}
	if (cont) {
		addAndConvert(cont, KEY_LISTENERS, listener);
		addAndConvert(cont, KEY_ERR, errHandler);
		addAndConvert(cont, KEY_RAW, rawEmitter);
	} else {
		watcher = createFsWatchInstance(path, options, fsWatchBroadcast.bind(null, fullPath, KEY_LISTENERS), errHandler, fsWatchBroadcast.bind(null, fullPath, KEY_RAW));
		if (!watcher) return;
		watcher.on(EV.ERROR, async (error) => {
			const broadcastErr = fsWatchBroadcast.bind(null, fullPath, KEY_ERR);
			if (cont) cont.watcherUnusable = true;
			if (isWindows && error.code === "EPERM") try {
				await (await open(path, "r")).close();
				broadcastErr(error);
			} catch (err) {}
			else broadcastErr(error);
		});
		cont = {
			listeners: listener,
			errHandlers: errHandler,
			rawEmitters: rawEmitter,
			watcher
		};
		FsWatchInstances.set(fullPath, cont);
	}
	return () => {
		delFromSet(cont, KEY_LISTENERS, listener);
		delFromSet(cont, KEY_ERR, errHandler);
		delFromSet(cont, KEY_RAW, rawEmitter);
		if (isEmptySet(cont.listeners)) {
			cont.watcher.close();
			FsWatchInstances.delete(fullPath);
			HANDLER_KEYS.forEach(clearItem(cont));
			cont.watcher = void 0;
			Object.freeze(cont);
		}
	};
};
const FsWatchFileInstances = /* @__PURE__ */ new Map();
/**
* Instantiates the fs_watchFile interface or binds listeners
* to an existing one covering the same file system entry
* @param path to be watched
* @param fullPath absolute path
* @param options options to be passed to fs_watchFile
* @param handlers container for event listener functions
* @returns closer
*/
const setFsWatchFileListener = (path, fullPath, options, handlers) => {
	const { listener, rawEmitter } = handlers;
	let cont = FsWatchFileInstances.get(fullPath);
	const copts = cont && cont.options;
	if (copts && (copts.persistent < options.persistent || copts.interval > options.interval)) {
		unwatchFile(fullPath);
		cont = void 0;
	}
	if (cont) {
		addAndConvert(cont, KEY_LISTENERS, listener);
		addAndConvert(cont, KEY_RAW, rawEmitter);
	} else {
		cont = {
			listeners: listener,
			rawEmitters: rawEmitter,
			options,
			watcher: watchFile(fullPath, options, (curr, prev) => {
				foreach(cont.rawEmitters, (rawEmitter) => {
					rawEmitter(EV.CHANGE, fullPath, {
						curr,
						prev
					});
				});
				const currmtime = curr.mtimeMs;
				if (curr.size !== prev.size || currmtime > prev.mtimeMs || currmtime === 0) foreach(cont.listeners, (listener) => listener(path, curr));
			})
		};
		FsWatchFileInstances.set(fullPath, cont);
	}
	return () => {
		delFromSet(cont, KEY_LISTENERS, listener);
		delFromSet(cont, KEY_RAW, rawEmitter);
		if (isEmptySet(cont.listeners)) {
			FsWatchFileInstances.delete(fullPath);
			unwatchFile(fullPath);
			cont.options = cont.watcher = void 0;
			Object.freeze(cont);
		}
	};
};
/**
* @mixin
*/
var NodeFsHandler = class {
	constructor(fsW) {
		this.fsw = fsW;
		this._boundHandleError = (error) => fsW._handleError(error);
	}
	/**
	* Watch file for changes with fs_watchFile or fs_watch.
	* @param path to file or dir
	* @param listener on fs change
	* @returns closer for the watcher instance
	*/
	_watchWithNodeFs(path, listener) {
		const opts = this.fsw.options;
		const directory = sysPath.dirname(path);
		const basename = sysPath.basename(path);
		this.fsw._getWatchedDir(directory).add(basename);
		const absolutePath = sysPath.resolve(path);
		const options = { persistent: opts.persistent };
		if (!listener) listener = EMPTY_FN;
		let closer;
		if (opts.usePolling) {
			options.interval = opts.interval !== opts.binaryInterval && isBinaryPath(basename) ? opts.binaryInterval : opts.interval;
			closer = setFsWatchFileListener(path, absolutePath, options, {
				listener,
				rawEmitter: this.fsw._emitRaw
			});
		} else closer = setFsWatchListener(path, absolutePath, options, {
			listener,
			errHandler: this._boundHandleError,
			rawEmitter: this.fsw._emitRaw
		});
		return closer;
	}
	/**
	* Watch a file and emit add event if warranted.
	* @returns closer for the watcher instance
	*/
	_handleFile(file, stats, initialAdd) {
		if (this.fsw.closed) return;
		const dirname = sysPath.dirname(file);
		const basename = sysPath.basename(file);
		const parent = this.fsw._getWatchedDir(dirname);
		let prevStats = stats;
		if (parent.has(basename)) return;
		const listener = async (path, newStats) => {
			if (!this.fsw._throttle(THROTTLE_MODE_WATCH, file, 5)) return;
			if (!newStats || newStats.mtimeMs === 0) try {
				const newStats = await stat$2(file);
				if (this.fsw.closed) return;
				const at = newStats.atimeMs;
				const mt = newStats.mtimeMs;
				if (!at || at <= mt || mt !== prevStats.mtimeMs) this.fsw._emit(EV.CHANGE, file, newStats);
				if ((isMacos || isLinux || isFreeBSD) && prevStats.ino !== newStats.ino) {
					this.fsw._closeFile(path);
					prevStats = newStats;
					const closer = this._watchWithNodeFs(file, listener);
					if (closer) this.fsw._addPathCloser(path, closer);
				} else prevStats = newStats;
			} catch (error) {
				this.fsw._remove(dirname, basename);
			}
			else if (parent.has(basename)) {
				const at = newStats.atimeMs;
				const mt = newStats.mtimeMs;
				if (!at || at <= mt || mt !== prevStats.mtimeMs) this.fsw._emit(EV.CHANGE, file, newStats);
				prevStats = newStats;
			}
		};
		const closer = this._watchWithNodeFs(file, listener);
		if (!(initialAdd && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(file)) {
			if (!this.fsw._throttle(EV.ADD, file, 0)) return;
			this.fsw._emit(EV.ADD, file, stats);
		}
		return closer;
	}
	/**
	* Handle symlinks encountered while reading a dir.
	* @param entry returned by readdirp
	* @param directory path of dir being read
	* @param path of this item
	* @param item basename of this item
	* @returns true if no more processing is needed for this entry.
	*/
	async _handleSymlink(entry, directory, path, item) {
		if (this.fsw.closed) return;
		const full = entry.fullPath;
		const dir = this.fsw._getWatchedDir(directory);
		if (!this.fsw.options.followSymlinks) {
			this.fsw._incrReadyCount();
			let linkPath;
			try {
				linkPath = await realpath$1(path);
			} catch (e) {
				this.fsw._emitReady();
				return true;
			}
			if (this.fsw.closed) return;
			if (dir.has(item)) {
				if (this.fsw._symlinkPaths.get(full) !== linkPath) {
					this.fsw._symlinkPaths.set(full, linkPath);
					this.fsw._emit(EV.CHANGE, path, entry.stats);
				}
			} else {
				dir.add(item);
				this.fsw._symlinkPaths.set(full, linkPath);
				this.fsw._emit(EV.ADD, path, entry.stats);
			}
			this.fsw._emitReady();
			return true;
		}
		if (this.fsw._symlinkPaths.has(full)) return true;
		this.fsw._symlinkPaths.set(full, true);
	}
	_handleRead(directory, initialAdd, wh, target, dir, depth, throttler) {
		directory = sysPath.join(directory, "");
		throttler = this.fsw._throttle("readdir", directory, 1e3);
		if (!throttler) return;
		const previous = this.fsw._getWatchedDir(wh.path);
		const current = /* @__PURE__ */ new Set();
		let stream = this.fsw._readdirp(directory, {
			fileFilter: (entry) => wh.filterPath(entry),
			directoryFilter: (entry) => wh.filterDir(entry)
		});
		if (!stream) return;
		stream.on(STR_DATA, async (entry) => {
			if (this.fsw.closed) {
				stream = void 0;
				return;
			}
			const item = entry.path;
			let path = sysPath.join(directory, item);
			current.add(item);
			if (entry.stats.isSymbolicLink() && await this._handleSymlink(entry, directory, path, item)) return;
			if (this.fsw.closed) {
				stream = void 0;
				return;
			}
			if (item === target || !target && !previous.has(item)) {
				this.fsw._incrReadyCount();
				path = sysPath.join(dir, sysPath.relative(dir, path));
				this._addToNodeFs(path, initialAdd, wh, depth + 1);
			}
		}).on(EV.ERROR, this._boundHandleError);
		return new Promise((resolve, reject) => {
			if (!stream) return reject();
			stream.once("end", () => {
				if (this.fsw.closed) {
					stream = void 0;
					return;
				}
				const wasThrottled = throttler ? throttler.clear() : false;
				resolve(void 0);
				previous.getChildren().filter((item) => {
					return item !== directory && !current.has(item);
				}).forEach((item) => {
					this.fsw._remove(directory, item);
				});
				stream = void 0;
				if (wasThrottled) this._handleRead(directory, false, wh, target, dir, depth, throttler);
			});
		});
	}
	/**
	* Read directory to add / remove files from `@watched` list and re-read it on change.
	* @param dir fs path
	* @param stats
	* @param initialAdd
	* @param depth relative to user-supplied path
	* @param target child path targeted for watch
	* @param wh Common watch helpers for this path
	* @param realpath
	* @returns closer for the watcher instance.
	*/
	async _handleDir(dir, stats, initialAdd, depth, target, wh, realpath) {
		const parentDir = this.fsw._getWatchedDir(sysPath.dirname(dir));
		const tracked = parentDir.has(sysPath.basename(dir));
		if (!(initialAdd && this.fsw.options.ignoreInitial) && !target && !tracked) this.fsw._emit(EV.ADD_DIR, dir, stats);
		parentDir.add(sysPath.basename(dir));
		this.fsw._getWatchedDir(dir);
		let throttler;
		let closer;
		const oDepth = this.fsw.options.depth;
		if ((oDepth == null || depth <= oDepth) && !this.fsw._symlinkPaths.has(realpath)) {
			if (!target) {
				await this._handleRead(dir, initialAdd, wh, target, dir, depth, throttler);
				if (this.fsw.closed) return;
			}
			closer = this._watchWithNodeFs(dir, (dirPath, stats) => {
				if (stats && stats.mtimeMs === 0) return;
				this._handleRead(dirPath, false, wh, target, dir, depth, throttler);
			});
		}
		return closer;
	}
	/**
	* Handle added file, directory, or glob pattern.
	* Delegates call to _handleFile / _handleDir after checks.
	* @param path to file or ir
	* @param initialAdd was the file added at watch instantiation?
	* @param priorWh depth relative to user-supplied path
	* @param depth Child path actually targeted for watch
	* @param target Child path actually targeted for watch
	*/
	async _addToNodeFs(path, initialAdd, priorWh, depth, target) {
		const ready = this.fsw._emitReady;
		if (this.fsw._isIgnored(path) || this.fsw.closed) {
			ready();
			return false;
		}
		const wh = this.fsw._getWatchHelpers(path);
		if (priorWh) {
			wh.filterPath = (entry) => priorWh.filterPath(entry);
			wh.filterDir = (entry) => priorWh.filterDir(entry);
		}
		try {
			const stats = await statMethods[wh.statMethod](wh.watchPath);
			if (this.fsw.closed) return;
			if (this.fsw._isIgnored(wh.watchPath, stats)) {
				ready();
				return false;
			}
			const follow = this.fsw.options.followSymlinks;
			let closer;
			if (stats.isDirectory()) {
				const absPath = sysPath.resolve(path);
				const targetPath = follow ? await realpath$1(path) : path;
				if (this.fsw.closed) return;
				closer = await this._handleDir(wh.watchPath, stats, initialAdd, depth, target, wh, targetPath);
				if (this.fsw.closed) return;
				if (absPath !== targetPath && targetPath !== void 0) this.fsw._symlinkPaths.set(absPath, targetPath);
			} else if (stats.isSymbolicLink()) {
				const targetPath = follow ? await realpath$1(path) : path;
				if (this.fsw.closed) return;
				const parent = sysPath.dirname(wh.watchPath);
				this.fsw._getWatchedDir(parent).add(wh.watchPath);
				this.fsw._emit(EV.ADD, wh.watchPath, stats);
				closer = await this._handleDir(parent, stats, initialAdd, depth, path, wh, targetPath);
				if (this.fsw.closed) return;
				if (targetPath !== void 0) this.fsw._symlinkPaths.set(sysPath.resolve(path), targetPath);
			} else closer = this._handleFile(wh.watchPath, stats, initialAdd);
			ready();
			if (closer) this.fsw._addPathCloser(path, closer);
			return false;
		} catch (error) {
			if (this.fsw._handleError(error)) {
				ready();
				return path;
			}
		}
	}
};
//#endregion
//#region node_modules/chokidar/esm/index.js
/*! chokidar - MIT License (c) 2012 Paul Miller (paulmillr.com) */
const SLASH = "/";
const SLASH_SLASH = "//";
const ONE_DOT = ".";
const TWO_DOTS = "..";
const STRING_TYPE = "string";
const BACK_SLASH_RE = /\\/g;
const DOUBLE_SLASH_RE = /\/\//;
const DOT_RE = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/;
const REPLACER_RE = /^\.[/\\]/;
function arrify(item) {
	return Array.isArray(item) ? item : [item];
}
const isMatcherObject = (matcher) => typeof matcher === "object" && matcher !== null && !(matcher instanceof RegExp);
function createPattern(matcher) {
	if (typeof matcher === "function") return matcher;
	if (typeof matcher === "string") return (string) => matcher === string;
	if (matcher instanceof RegExp) return (string) => matcher.test(string);
	if (typeof matcher === "object" && matcher !== null) return (string) => {
		if (matcher.path === string) return true;
		if (matcher.recursive) {
			const relative = sysPath.relative(matcher.path, string);
			if (!relative) return false;
			return !relative.startsWith("..") && !sysPath.isAbsolute(relative);
		}
		return false;
	};
	return () => false;
}
function normalizePath(path) {
	if (typeof path !== "string") throw new Error("string expected");
	path = sysPath.normalize(path);
	path = path.replace(/\\/g, "/");
	let prepend = false;
	if (path.startsWith("//")) prepend = true;
	const DOUBLE_SLASH_RE = /\/\//;
	while (path.match(DOUBLE_SLASH_RE)) path = path.replace(DOUBLE_SLASH_RE, "/");
	if (prepend) path = "/" + path;
	return path;
}
function matchPatterns(patterns, testString, stats) {
	const path = normalizePath(testString);
	for (let index = 0; index < patterns.length; index++) {
		const pattern = patterns[index];
		if (pattern(path, stats)) return true;
	}
	return false;
}
function anymatch(matchers, testString) {
	if (matchers == null) throw new TypeError("anymatch: specify first argument");
	const patterns = arrify(matchers).map((matcher) => createPattern(matcher));
	if (testString == null) return (testString, stats) => {
		return matchPatterns(patterns, testString, stats);
	};
	return matchPatterns(patterns, testString);
}
const unifyPaths = (paths_) => {
	const paths = arrify(paths_).flat();
	if (!paths.every((p) => typeof p === STRING_TYPE)) throw new TypeError(`Non-string provided as watch path: ${paths}`);
	return paths.map(normalizePathToUnix);
};
const toUnix = (string) => {
	let str = string.replace(BACK_SLASH_RE, SLASH);
	let prepend = false;
	if (str.startsWith(SLASH_SLASH)) prepend = true;
	while (str.match(DOUBLE_SLASH_RE)) str = str.replace(DOUBLE_SLASH_RE, SLASH);
	if (prepend) str = SLASH + str;
	return str;
};
const normalizePathToUnix = (path) => toUnix(sysPath.normalize(toUnix(path)));
const normalizeIgnored = (cwd = "") => (path) => {
	if (typeof path === "string") return normalizePathToUnix(sysPath.isAbsolute(path) ? path : sysPath.join(cwd, path));
	else return path;
};
const getAbsolutePath = (path, cwd) => {
	if (sysPath.isAbsolute(path)) return path;
	return sysPath.join(cwd, path);
};
const EMPTY_SET = Object.freeze(/* @__PURE__ */ new Set());
/**
* Directory entry.
*/
var DirEntry = class {
	constructor(dir, removeWatcher) {
		this.path = dir;
		this._removeWatcher = removeWatcher;
		this.items = /* @__PURE__ */ new Set();
	}
	add(item) {
		const { items } = this;
		if (!items) return;
		if (item !== ONE_DOT && item !== TWO_DOTS) items.add(item);
	}
	async remove(item) {
		const { items } = this;
		if (!items) return;
		items.delete(item);
		if (items.size > 0) return;
		const dir = this.path;
		try {
			await readdir$1(dir);
		} catch (err) {
			if (this._removeWatcher) this._removeWatcher(sysPath.dirname(dir), sysPath.basename(dir));
		}
	}
	has(item) {
		const { items } = this;
		if (!items) return;
		return items.has(item);
	}
	getChildren() {
		const { items } = this;
		if (!items) return [];
		return [...items.values()];
	}
	dispose() {
		this.items.clear();
		this.path = "";
		this._removeWatcher = EMPTY_FN;
		this.items = EMPTY_SET;
		Object.freeze(this);
	}
};
const STAT_METHOD_F = "stat";
const STAT_METHOD_L = "lstat";
var WatchHelper = class {
	constructor(path, follow, fsw) {
		this.fsw = fsw;
		const watchPath = path;
		this.path = path = path.replace(REPLACER_RE, "");
		this.watchPath = watchPath;
		this.fullWatchPath = sysPath.resolve(watchPath);
		this.dirParts = [];
		this.dirParts.forEach((parts) => {
			if (parts.length > 1) parts.pop();
		});
		this.followSymlinks = follow;
		this.statMethod = follow ? STAT_METHOD_F : STAT_METHOD_L;
	}
	entryPath(entry) {
		return sysPath.join(this.watchPath, sysPath.relative(this.watchPath, entry.fullPath));
	}
	filterPath(entry) {
		const { stats } = entry;
		if (stats && stats.isSymbolicLink()) return this.filterDir(entry);
		const resolvedPath = this.entryPath(entry);
		return this.fsw._isntIgnored(resolvedPath, stats) && this.fsw._hasReadPermissions(stats);
	}
	filterDir(entry) {
		return this.fsw._isntIgnored(this.entryPath(entry), entry.stats);
	}
};
/**
* Watches files & directories for changes. Emitted events:
* `add`, `addDir`, `change`, `unlink`, `unlinkDir`, `all`, `error`
*
*     new FSWatcher()
*       .add(directories)
*       .on('add', path => log('File', path, 'was added'))
*/
var FSWatcher = class extends EventEmitter {
	constructor(_opts = {}) {
		super();
		this.closed = false;
		this._closers = /* @__PURE__ */ new Map();
		this._ignoredPaths = /* @__PURE__ */ new Set();
		this._throttled = /* @__PURE__ */ new Map();
		this._streams = /* @__PURE__ */ new Set();
		this._symlinkPaths = /* @__PURE__ */ new Map();
		this._watched = /* @__PURE__ */ new Map();
		this._pendingWrites = /* @__PURE__ */ new Map();
		this._pendingUnlinks = /* @__PURE__ */ new Map();
		this._readyCount = 0;
		this._readyEmitted = false;
		const awf = _opts.awaitWriteFinish;
		const DEF_AWF = {
			stabilityThreshold: 2e3,
			pollInterval: 100
		};
		const opts = {
			persistent: true,
			ignoreInitial: false,
			ignorePermissionErrors: false,
			interval: 100,
			binaryInterval: 300,
			followSymlinks: true,
			usePolling: false,
			atomic: true,
			..._opts,
			ignored: _opts.ignored ? arrify(_opts.ignored) : arrify([]),
			awaitWriteFinish: awf === true ? DEF_AWF : typeof awf === "object" ? {
				...DEF_AWF,
				...awf
			} : false
		};
		if (isIBMi) opts.usePolling = true;
		if (opts.atomic === void 0) opts.atomic = !opts.usePolling;
		const envPoll = process.env.CHOKIDAR_USEPOLLING;
		if (envPoll !== void 0) {
			const envLower = envPoll.toLowerCase();
			if (envLower === "false" || envLower === "0") opts.usePolling = false;
			else if (envLower === "true" || envLower === "1") opts.usePolling = true;
			else opts.usePolling = !!envLower;
		}
		const envInterval = process.env.CHOKIDAR_INTERVAL;
		if (envInterval) opts.interval = Number.parseInt(envInterval, 10);
		let readyCalls = 0;
		this._emitReady = () => {
			readyCalls++;
			if (readyCalls >= this._readyCount) {
				this._emitReady = EMPTY_FN;
				this._readyEmitted = true;
				process.nextTick(() => this.emit(EVENTS.READY));
			}
		};
		this._emitRaw = (...args) => this.emit(EVENTS.RAW, ...args);
		this._boundRemove = this._remove.bind(this);
		this.options = opts;
		this._nodeFsHandler = new NodeFsHandler(this);
		Object.freeze(opts);
	}
	_addIgnoredPath(matcher) {
		if (isMatcherObject(matcher)) {
			for (const ignored of this._ignoredPaths) if (isMatcherObject(ignored) && ignored.path === matcher.path && ignored.recursive === matcher.recursive) return;
		}
		this._ignoredPaths.add(matcher);
	}
	_removeIgnoredPath(matcher) {
		this._ignoredPaths.delete(matcher);
		if (typeof matcher === "string") {
			for (const ignored of this._ignoredPaths) if (isMatcherObject(ignored) && ignored.path === matcher) this._ignoredPaths.delete(ignored);
		}
	}
	/**
	* Adds paths to be watched on an existing FSWatcher instance.
	* @param paths_ file or file list. Other arguments are unused
	*/
	add(paths_, _origAdd, _internal) {
		const { cwd } = this.options;
		this.closed = false;
		this._closePromise = void 0;
		let paths = unifyPaths(paths_);
		if (cwd) paths = paths.map((path) => {
			return getAbsolutePath(path, cwd);
		});
		paths.forEach((path) => {
			this._removeIgnoredPath(path);
		});
		this._userIgnored = void 0;
		if (!this._readyCount) this._readyCount = 0;
		this._readyCount += paths.length;
		Promise.all(paths.map(async (path) => {
			const res = await this._nodeFsHandler._addToNodeFs(path, !_internal, void 0, 0, _origAdd);
			if (res) this._emitReady();
			return res;
		})).then((results) => {
			if (this.closed) return;
			results.forEach((item) => {
				if (item) this.add(sysPath.dirname(item), sysPath.basename(_origAdd || item));
			});
		});
		return this;
	}
	/**
	* Close watchers or start ignoring events from specified paths.
	*/
	unwatch(paths_) {
		if (this.closed) return this;
		const paths = unifyPaths(paths_);
		const { cwd } = this.options;
		paths.forEach((path) => {
			if (!sysPath.isAbsolute(path) && !this._closers.has(path)) {
				if (cwd) path = sysPath.join(cwd, path);
				path = sysPath.resolve(path);
			}
			this._closePath(path);
			this._addIgnoredPath(path);
			if (this._watched.has(path)) this._addIgnoredPath({
				path,
				recursive: true
			});
			this._userIgnored = void 0;
		});
		return this;
	}
	/**
	* Close watchers and remove all listeners from watched paths.
	*/
	close() {
		if (this._closePromise) return this._closePromise;
		this.closed = true;
		this.removeAllListeners();
		const closers = [];
		this._closers.forEach((closerList) => closerList.forEach((closer) => {
			const promise = closer();
			if (promise instanceof Promise) closers.push(promise);
		}));
		this._streams.forEach((stream) => stream.destroy());
		this._userIgnored = void 0;
		this._readyCount = 0;
		this._readyEmitted = false;
		this._watched.forEach((dirent) => dirent.dispose());
		this._closers.clear();
		this._watched.clear();
		this._streams.clear();
		this._symlinkPaths.clear();
		this._throttled.clear();
		this._closePromise = closers.length ? Promise.all(closers).then(() => void 0) : Promise.resolve();
		return this._closePromise;
	}
	/**
	* Expose list of watched paths
	* @returns for chaining
	*/
	getWatched() {
		const watchList = {};
		this._watched.forEach((entry, dir) => {
			const index = (this.options.cwd ? sysPath.relative(this.options.cwd, dir) : dir) || ONE_DOT;
			watchList[index] = entry.getChildren().sort();
		});
		return watchList;
	}
	emitWithAll(event, args) {
		this.emit(event, ...args);
		if (event !== EVENTS.ERROR) this.emit(EVENTS.ALL, event, ...args);
	}
	/**
	* Normalize and emit events.
	* Calling _emit DOES NOT MEAN emit() would be called!
	* @param event Type of event
	* @param path File or directory path
	* @param stats arguments to be passed with event
	* @returns the error if defined, otherwise the value of the FSWatcher instance's `closed` flag
	*/
	async _emit(event, path, stats) {
		if (this.closed) return;
		const opts = this.options;
		if (isWindows) path = sysPath.normalize(path);
		if (opts.cwd) path = sysPath.relative(opts.cwd, path);
		const args = [path];
		if (stats != null) args.push(stats);
		const awf = opts.awaitWriteFinish;
		let pw;
		if (awf && (pw = this._pendingWrites.get(path))) {
			pw.lastChange = /* @__PURE__ */ new Date();
			return this;
		}
		if (opts.atomic) {
			if (event === EVENTS.UNLINK) {
				this._pendingUnlinks.set(path, [event, ...args]);
				setTimeout(() => {
					this._pendingUnlinks.forEach((entry, path) => {
						this.emit(...entry);
						this.emit(EVENTS.ALL, ...entry);
						this._pendingUnlinks.delete(path);
					});
				}, typeof opts.atomic === "number" ? opts.atomic : 100);
				return this;
			}
			if (event === EVENTS.ADD && this._pendingUnlinks.has(path)) {
				event = EVENTS.CHANGE;
				this._pendingUnlinks.delete(path);
			}
		}
		if (awf && (event === EVENTS.ADD || event === EVENTS.CHANGE) && this._readyEmitted) {
			const awfEmit = (err, stats) => {
				if (err) {
					event = EVENTS.ERROR;
					args[0] = err;
					this.emitWithAll(event, args);
				} else if (stats) {
					if (args.length > 1) args[1] = stats;
					else args.push(stats);
					this.emitWithAll(event, args);
				}
			};
			this._awaitWriteFinish(path, awf.stabilityThreshold, event, awfEmit);
			return this;
		}
		if (event === EVENTS.CHANGE) {
			if (!this._throttle(EVENTS.CHANGE, path, 50)) return this;
		}
		if (opts.alwaysStat && stats === void 0 && (event === EVENTS.ADD || event === EVENTS.ADD_DIR || event === EVENTS.CHANGE)) {
			const fullPath = opts.cwd ? sysPath.join(opts.cwd, path) : path;
			let stats;
			try {
				stats = await stat$2(fullPath);
			} catch (err) {}
			if (!stats || this.closed) return;
			args.push(stats);
		}
		this.emitWithAll(event, args);
		return this;
	}
	/**
	* Common handler for errors
	* @returns The error if defined, otherwise the value of the FSWatcher instance's `closed` flag
	*/
	_handleError(error) {
		const code = error && error.code;
		if (error && code !== "ENOENT" && code !== "ENOTDIR" && (!this.options.ignorePermissionErrors || code !== "EPERM" && code !== "EACCES")) this.emit(EVENTS.ERROR, error);
		return error || this.closed;
	}
	/**
	* Helper utility for throttling
	* @param actionType type being throttled
	* @param path being acted upon
	* @param timeout duration of time to suppress duplicate actions
	* @returns tracking object or false if action should be suppressed
	*/
	_throttle(actionType, path, timeout) {
		if (!this._throttled.has(actionType)) this._throttled.set(actionType, /* @__PURE__ */ new Map());
		const action = this._throttled.get(actionType);
		if (!action) throw new Error("invalid throttle");
		const actionPath = action.get(path);
		if (actionPath) {
			actionPath.count++;
			return false;
		}
		let timeoutObject;
		const clear = () => {
			const item = action.get(path);
			const count = item ? item.count : 0;
			action.delete(path);
			clearTimeout(timeoutObject);
			if (item) clearTimeout(item.timeoutObject);
			return count;
		};
		timeoutObject = setTimeout(clear, timeout);
		const thr = {
			timeoutObject,
			clear,
			count: 0
		};
		action.set(path, thr);
		return thr;
	}
	_incrReadyCount() {
		return this._readyCount++;
	}
	/**
	* Awaits write operation to finish.
	* Polls a newly created file for size variations. When files size does not change for 'threshold' milliseconds calls callback.
	* @param path being acted upon
	* @param threshold Time in milliseconds a file size must be fixed before acknowledging write OP is finished
	* @param event
	* @param awfEmit Callback to be called when ready for event to be emitted.
	*/
	_awaitWriteFinish(path, threshold, event, awfEmit) {
		const awf = this.options.awaitWriteFinish;
		if (typeof awf !== "object") return;
		const pollInterval = awf.pollInterval;
		let timeoutHandler;
		let fullPath = path;
		if (this.options.cwd && !sysPath.isAbsolute(path)) fullPath = sysPath.join(this.options.cwd, path);
		const now = /* @__PURE__ */ new Date();
		const writes = this._pendingWrites;
		function awaitWriteFinishFn(prevStat) {
			stat$1(fullPath, (err, curStat) => {
				if (err || !writes.has(path)) {
					if (err && err.code !== "ENOENT") awfEmit(err);
					return;
				}
				const now = Number(/* @__PURE__ */ new Date());
				if (prevStat && curStat.size !== prevStat.size) writes.get(path).lastChange = now;
				if (now - writes.get(path).lastChange >= threshold) {
					writes.delete(path);
					awfEmit(void 0, curStat);
				} else timeoutHandler = setTimeout(awaitWriteFinishFn, pollInterval, curStat);
			});
		}
		if (!writes.has(path)) {
			writes.set(path, {
				lastChange: now,
				cancelWait: () => {
					writes.delete(path);
					clearTimeout(timeoutHandler);
					return event;
				}
			});
			timeoutHandler = setTimeout(awaitWriteFinishFn, pollInterval);
		}
	}
	/**
	* Determines whether user has asked to ignore this path.
	*/
	_isIgnored(path, stats) {
		if (this.options.atomic && DOT_RE.test(path)) return true;
		if (!this._userIgnored) {
			const { cwd } = this.options;
			const ignored = (this.options.ignored || []).map(normalizeIgnored(cwd));
			this._userIgnored = anymatch([...[...this._ignoredPaths].map(normalizeIgnored(cwd)), ...ignored], void 0);
		}
		return this._userIgnored(path, stats);
	}
	_isntIgnored(path, stat) {
		return !this._isIgnored(path, stat);
	}
	/**
	* Provides a set of common helpers and properties relating to symlink handling.
	* @param path file or directory pattern being watched
	*/
	_getWatchHelpers(path) {
		return new WatchHelper(path, this.options.followSymlinks, this);
	}
	/**
	* Provides directory tracking objects
	* @param directory path of the directory
	*/
	_getWatchedDir(directory) {
		const dir = sysPath.resolve(directory);
		if (!this._watched.has(dir)) this._watched.set(dir, new DirEntry(dir, this._boundRemove));
		return this._watched.get(dir);
	}
	/**
	* Check for read permissions: https://stackoverflow.com/a/11781404/1358405
	*/
	_hasReadPermissions(stats) {
		if (this.options.ignorePermissionErrors) return true;
		return Boolean(Number(stats.mode) & 256);
	}
	/**
	* Handles emitting unlink events for
	* files and directories, and via recursion, for
	* files and directories within directories that are unlinked
	* @param directory within which the following item is located
	* @param item      base path of item/directory
	*/
	_remove(directory, item, isDirectory) {
		const path = sysPath.join(directory, item);
		const fullPath = sysPath.resolve(path);
		isDirectory = isDirectory != null ? isDirectory : this._watched.has(path) || this._watched.has(fullPath);
		if (!this._throttle("remove", path, 100)) return;
		if (!isDirectory && this._watched.size === 1) this.add(directory, item, true);
		this._getWatchedDir(path).getChildren().forEach((nested) => this._remove(path, nested));
		const parent = this._getWatchedDir(directory);
		const wasTracked = parent.has(item);
		parent.remove(item);
		if (this._symlinkPaths.has(fullPath)) this._symlinkPaths.delete(fullPath);
		let relPath = path;
		if (this.options.cwd) relPath = sysPath.relative(this.options.cwd, path);
		if (this.options.awaitWriteFinish && this._pendingWrites.has(relPath)) {
			if (this._pendingWrites.get(relPath).cancelWait() === EVENTS.ADD) return;
		}
		this._watched.delete(path);
		this._watched.delete(fullPath);
		const eventName = isDirectory ? EVENTS.UNLINK_DIR : EVENTS.UNLINK;
		if (wasTracked && !this._isIgnored(path)) this._emit(eventName, path);
		this._closePath(path);
	}
	/**
	* Closes all watchers for a path
	*/
	_closePath(path) {
		this._closeFile(path);
		const dir = sysPath.dirname(path);
		this._getWatchedDir(dir).remove(sysPath.basename(path));
	}
	/**
	* Closes only file-specific watchers
	*/
	_closeFile(path) {
		const closers = this._closers.get(path);
		if (!closers) return;
		closers.forEach((closer) => closer());
		this._closers.delete(path);
	}
	_addPathCloser(path, closer) {
		if (!closer) return;
		let list = this._closers.get(path);
		if (!list) {
			list = [];
			this._closers.set(path, list);
		}
		list.push(closer);
	}
	_readdirp(root, opts) {
		if (this.closed) return;
		let stream = readdirp(root, {
			type: EVENTS.ALL,
			alwaysStat: true,
			lstat: true,
			...opts,
			depth: 0
		});
		this._streams.add(stream);
		stream.once(STR_CLOSE, () => {
			stream = void 0;
		});
		stream.once("end", () => {
			if (stream) {
				this._streams.delete(stream);
				stream = void 0;
			}
		});
		return stream;
	}
};
/**
* Instantiates watcher with paths to be tracked.
* @param paths file / directory paths
* @param options opts, such as `atomic`, `awaitWriteFinish`, `ignored`, and others
* @returns an instance of FSWatcher for chaining.
* @example
* const watcher = watch('.').on('all', (event, path) => { console.log(event, path); });
* watch('.', { atomic: true, awaitWriteFinish: true, ignored: (f, stats) => stats?.isFile() && !f.endsWith('.js') })
*/
function watch$1(paths, options = {}) {
	const watcher = new FSWatcher(options);
	watcher.add(paths);
	return watcher;
}
var esm_default = {
	watch: watch$1,
	FSWatcher
};
//#endregion
//#region src/watcher/debouncer.ts
const DEFAULT_DELAY_MS = 2e3;
/**
* Create a debouncer that fires the callback after a quiet period.
* Each trigger() call resets the timer. Only fires once per quiet period.
*/
function createDebouncer(callback, delayMs = DEFAULT_DELAY_MS) {
	let timer;
	return {
		trigger() {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = void 0;
				callback();
			}, delayMs);
		},
		cancel() {
			if (timer) {
				clearTimeout(timer);
				timer = void 0;
			}
		}
	};
}
//#endregion
//#region src/watcher/pipeline.ts
/**
* Hash a file's contents. Returns empty string if the file doesn't exist.
*/
async function hashFile(filePath) {
	try {
		const content = await readFile(filePath);
		return createHash("sha256").update(content).digest("hex");
	} catch {
		return "";
	}
}
/**
* Hash all output files for a step. Returns a map of path → hash.
*/
async function hashOutputFiles(root, paths) {
	const hashes = /* @__PURE__ */ new Map();
	for (const relPath of paths) {
		const hash = await hashFile(join(root, relPath));
		hashes.set(relPath, hash);
	}
	return hashes;
}
/**
* Compare before/after hashes to detect changes.
* Treats files that don't exist in either snapshot as "changed"
* (the step was expected to create them but didn't).
*/
function hasChanges(before, after) {
	for (const [path, beforeHash] of before) {
		const afterHash = after.get(path) ?? "";
		if (!beforeHash && !afterHash) return true;
		if (afterHash !== beforeHash) return true;
	}
	return false;
}
/**
* Execute a pipeline of steps sequentially.
*
* - Each step runs after the previous one succeeds
* - If a step fails, the pipeline stops immediately
* - Output files are hashed before/after each step for change detection
* - Returns a full result with per-step timing and change status
*/
async function runPipeline(steps, root) {
	const results = [];
	let totalDuration = 0;
	for (const step of steps) {
		const beforeHashes = step.outputPaths ? await hashOutputFiles(root, step.outputPaths) : /* @__PURE__ */ new Map();
		const result = await step.execute();
		totalDuration += result.duration;
		const afterHashes = step.outputPaths ? await hashOutputFiles(root, step.outputPaths) : /* @__PURE__ */ new Map();
		const changed = step.outputPaths ? hasChanges(beforeHashes, afterHashes) : true;
		results.push({
			step,
			success: result.success,
			duration: result.duration,
			output: result.output,
			changed
		});
		if (!result.success) return {
			success: false,
			totalDuration,
			steps: results
		};
	}
	return {
		success: true,
		totalDuration,
		steps: results
	};
}
//#endregion
//#region src/watcher/dev.ts
const MAGENTA = "\x1B[35m";
const CONFIG_FILENAME = "mido.yml";
function formatMs(ms) {
	return ms >= 1e3 ? `${(ms / 1e3).toFixed(1)}s` : `${ms}ms`;
}
function log(icon, message) {
	console.log(`  ${icon} ${message}`);
}
function logStep(message) {
	log(`${DIM}\u25C7${RESET}`, `${DIM}${message}${RESET}`);
}
function logSuccess(message) {
	log(`${GREEN}\u2713${RESET}`, `${GREEN}${message}${RESET}`);
}
function logFail(message) {
	log(`${RED}\u2717${RESET}`, `${RED}${message}${RESET}`);
}
function logChange(path) {
	log(`${CYAN}\u25CB${RESET}`, `changes in ${DIM}${path}${RESET}`);
}
function logWaiting() {
	log(`${DIM}\u2298${RESET}`, `${DIM}waiting for next change...${RESET}`);
}
function logUnchanged(message) {
	log(`${DIM}\u00B7${RESET}`, `${DIM}${message}${RESET}`);
}
function logOutput(output) {
	const lines = output.trim().split("\n");
	const MAX_OUTPUT_LINES = 15;
	const shown = lines.slice(0, MAX_OUTPUT_LINES);
	for (const line of shown) console.log(`    ${DIM}${line}${RESET}`);
	if (lines.length > MAX_OUTPUT_LINES) console.log(`    ${DIM}... ${lines.length - MAX_OUTPUT_LINES} more line(s)${RESET}`);
}
function logDebug(message) {
	console.log(`  ${MAGENTA}[verbose]${RESET} ${DIM}${message}${RESET}`);
}
async function resolveBridges(bridges, packages, registry, root) {
	const resolved = [];
	for (const bridge of bridges) {
		const source = packages.get(bridge.source);
		if (!source) {
			console.error(`${YELLOW}warn:${RESET} bridge source "${bridge.source}" not found in graph`);
			continue;
		}
		const target = packages.get(bridge.target);
		if (!target) {
			console.error(`${YELLOW}warn:${RESET} bridge target "${bridge.target}" not found in graph`);
			continue;
		}
		const domain = await registry.getDomainForArtifact(bridge.artifact, root);
		const sourcePlugin = registry.getEcosystemForPackage(source);
		let watchPatterns;
		if (bridge.watch?.length) watchPatterns = bridge.watch;
		else watchPatterns = [join(source.path, "**")];
		resolved.push({
			bridge,
			watchPatterns,
			domain,
			sourcePlugin,
			source,
			targets: [target]
		});
	}
	return resolved;
}
function printBridgeSummary(resolved, registry) {
	for (const r of resolved) {
		const artifact = r.bridge.artifact;
		const sourceLabel = r.source.path;
		const targetLabels = r.targets.map((t) => t.path).join(", ");
		const watchLabels = r.watchPatterns.join(", ");
		if (r.domain) {
			const plugins = [`mido-${r.domain.name}`];
			if (r.sourcePlugin) plugins.push(`mido-${r.sourcePlugin.name}`);
			for (const t of r.targets) {
				const eco = registry.getEcosystemForPackage(t);
				if (eco && !plugins.includes(`mido-${eco.name}`)) plugins.push(`mido-${eco.name}`);
			}
			console.log(`  ${BOLD}${r.domain.name}:${RESET} ${sourceLabel} \u2192 ${artifact}`);
			console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
			console.log(`    ${DIM}targets: ${targetLabels}${RESET}`);
			console.log(`    ${DIM}plugins: ${plugins.join(", ")}${RESET}`);
		} else if (r.bridge.run) {
			console.log(`  ${BOLD}bridge:${RESET} ${sourceLabel} \u2192 ${artifact}`);
			console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
			console.log(`    ${DIM}run: ${r.bridge.run}${RESET}`);
		} else if (r.sourcePlugin) {
			console.log(`  ${BOLD}${r.sourcePlugin.name}:${RESET} ${sourceLabel} \u2192 ${artifact}`);
			console.log(`    ${DIM}watching: ${watchLabels}${RESET}`);
			console.log(`    ${DIM}targets: ${targetLabels}${RESET}`);
		} else {
			console.log(`  ${YELLOW}${BOLD}unmatched:${RESET} ${artifact}`);
			console.log(`    ${YELLOW}No plugin found \u2014 add run: <script> to this bridge${RESET}`);
		}
		console.log();
	}
}
function printStartup(resolved, registry) {
	console.log(`\n${CYAN}${BOLD}mido dev${RESET} ${DIM}\u2014 watching ${resolved.length} bridge(s)${RESET}\n`);
	printBridgeSummary(resolved, registry);
	console.log(`  ${DIM}Waiting for changes...${RESET}\n`);
}
function printStepResult(stepResult) {
	if (!stepResult.success) {
		logFail(`${stepResult.step.description.replace(/\.\.\.$/, "")} failed (${formatMs(stepResult.duration)})`);
		if (stepResult.output) logOutput(stepResult.output);
		return;
	}
	if (!stepResult.changed) {
		logUnchanged(`${stepResult.step.description.replace(/\.\.\.$/, "")} \u2014 unchanged`);
		return;
	}
	logSuccess(`${stepResult.step.description.replace(/\.\.\.$/, "")} (${formatMs(stepResult.duration)})`);
}
async function executeBridge(resolved, registry, graph, root, pm, verbose) {
	const bridge = resolved.bridge;
	const context = registry.createContext(graph, root, pm, { verbose });
	if (bridge.run && resolved.sourcePlugin) {
		logStep(`running "${bridge.run}" on ${resolved.source.name}...`);
		printResult(await resolved.sourcePlugin.execute(bridge.run, resolved.source, root, context), `${bridge.source} bridge`);
		return;
	}
	if (resolved.domain) {
		if (resolved.domain.buildPipeline) {
			const steps = await resolved.domain.buildPipeline(resolved.source, bridge.artifact, resolved.targets, root, context);
			if (steps.length > 0) {
				const pipelineResult = await runPipelineWithProgress(steps, root);
				if (pipelineResult.success) {
					const stepCount = pipelineResult.steps.length;
					logSuccess(`${resolved.domain.name} bridge: synced (${formatMs(pipelineResult.totalDuration)}) \u2014 ${stepCount} step(s)`);
				} else logWaiting();
				return;
			}
		}
		logStep(`mido-${resolved.domain.name}: exporting spec...`);
		const exportResult = await resolved.domain.exportArtifact(resolved.source, bridge.artifact, root, context);
		if (!exportResult.success) {
			logFail(`export failed (${formatMs(exportResult.duration)})`);
			if (exportResult.output) logOutput(exportResult.output);
			logWaiting();
			return;
		}
		logSuccess(`${bridge.artifact} updated (${formatMs(exportResult.duration)})`);
		if (resolved.targets.length > 0) {
			const downstreamResults = await resolved.domain.generateDownstream(bridge.artifact, resolved.targets, root, context);
			let totalDuration = exportResult.duration;
			let allSuccess = true;
			for (const result of downstreamResults) {
				totalDuration += result.duration;
				if (result.success) logSuccess(`${result.summary} (${formatMs(result.duration)})`);
				else {
					logFail(`${result.summary} (${formatMs(result.duration)})`);
					allSuccess = false;
				}
			}
			if (allSuccess) logSuccess(`${resolved.domain.name} bridge: synced (${formatMs(totalDuration)})`);
		}
		return;
	}
	if (resolved.sourcePlugin) {
		const actions = await resolved.sourcePlugin.getActions(resolved.source, root);
		const action = actions.includes("generate") ? "generate" : actions[0];
		if (!action) {
			logFail(`no actions available for ${resolved.source.name}`);
			logWaiting();
			return;
		}
		logStep(`mido-${resolved.sourcePlugin.name}: running "${action}"...`);
		printResult(await resolved.sourcePlugin.execute(action, resolved.source, root, context), `${resolved.source.path} bridge`);
		return;
	}
	logFail(`No plugin found for ${bridge.artifact} \u2014 add run: <script> to this bridge`);
	logWaiting();
}
/**
* Run a pipeline step-by-step, printing progress as each step completes.
*/
async function runPipelineWithProgress(steps, root) {
	const result = await runPipeline(steps, root);
	for (const stepResult of result.steps) printStepResult(stepResult);
	return result;
}
function printResult(result, label) {
	if (result.success) logSuccess(`${label}: synced (${formatMs(result.duration)})`);
	else {
		logFail(`${label}: failed (${formatMs(result.duration)})`);
		if (result.output) logOutput(result.output);
		logWaiting();
	}
}
function matchesBridge(relPath, bridge) {
	for (const pattern of bridge.watchPatterns) {
		const patternBase = pattern.replace(/\/?\*\*.*$/, "");
		if (patternBase && relPath.startsWith(patternBase)) return true;
	}
	return false;
}
/** Resolve watch patterns to base directories for chokidar */
function resolveWatchDirs(resolved, root) {
	const watchDirs = /* @__PURE__ */ new Set();
	for (const r of resolved) for (const pattern of r.watchPatterns) {
		const baseDir = pattern.replace(/\/?\*\*.*$/, "") || ".";
		watchDirs.add(join(root, baseDir));
	}
	return [...watchDirs];
}
/** Tear down an existing watcher session */
function teardownSession(session) {
	for (const debouncer of session.bridgeDebouncers.values()) debouncer.cancel();
	session.configDebouncer.cancel();
	session.watcher.close();
}
/**
* Run the mido dev watcher daemon.
*
* Loads config, builds graph, discovers plugins, watches files,
* and re-runs bridge pipelines on changes. Watches mido.yml and
* reloads everything when the config changes.
*/
async function runDev(parsers, options = {}) {
	const verbose = options.verbose ?? false;
	let session;
	async function startSession() {
		const { config, root } = await loadConfig();
		const graph = await buildWorkspaceGraph(config, root, parsers);
		const pm = detectPackageManager(root);
		if (verbose) {
			logDebug(`workspace root: ${root}`);
			logDebug(`package manager: ${pm}`);
			logDebug(`packages in graph: ${graph.packages.size}`);
		}
		const { ecosystem, domain } = loadPlugins();
		const registry = new PluginRegistry(ecosystem, domain);
		if (graph.bridges.length === 0) {
			console.error(`${YELLOW}warn:${RESET} No bridges defined in mido.yml. Nothing to watch.`);
			return;
		}
		const resolved = await resolveBridges(graph.bridges, graph.packages, registry, root);
		if (resolved.length === 0) {
			console.error(`${RED}error:${RESET} No bridges could be resolved.`);
			return;
		}
		const bridgeWatchDirs = resolveWatchDirs(resolved, root);
		const configPath = join(root, CONFIG_FILENAME);
		const allWatchPaths = [...bridgeWatchDirs, configPath];
		if (verbose) {
			logDebug(`chokidar watching ${allWatchPaths.length} path(s):`);
			for (const p of allWatchPaths) logDebug(`  ${p}`);
		}
		let running = false;
		let pending = /* @__PURE__ */ new Set();
		async function processPending() {
			if (running) return;
			running = true;
			while (pending.size > 0) {
				const batch = [...pending];
				pending = /* @__PURE__ */ new Set();
				for (const item of batch) await executeBridge(item, registry, graph, root, pm, verbose);
			}
			running = false;
		}
		const bridgeDebouncers = /* @__PURE__ */ new Map();
		for (const r of resolved) {
			const debouncer = createDebouncer(() => {
				if (verbose) logDebug(`debouncer fired for bridge: ${r.bridge.source} \u2192 ${r.bridge.target}`);
				pending.add(r);
				processPending();
			});
			bridgeDebouncers.set(r, debouncer);
		}
		const configDebouncer = createDebouncer(async () => {
			logStep("mido.yml changed — reloading config...");
			if (session) teardownSession(session);
			try {
				const newSession = await startSession();
				if (newSession) {
					session = newSession;
					console.log();
					printBridgeSummary(newSession.resolved, newSession.registry);
					console.log(`  ${DIM}Waiting for changes...${RESET}\n`);
				} else logFail("Config reload failed — no valid bridges. Fix mido.yml and save again.");
			} catch (err) {
				logFail(`Config reload failed: ${err instanceof Error ? err.message : String(err)}`);
				logWaiting();
			}
		}, 500);
		const watcher = esm_default.watch(allWatchPaths, {
			ignoreInitial: true,
			ignored: [
				"**/node_modules/**",
				"**/.dart_tool/**",
				"**/build/**",
				"**/dist/**",
				"**/.symlinks/**"
			],
			awaitWriteFinish: {
				stabilityThreshold: 300,
				pollInterval: 100
			}
		});
		if (verbose) watcher.on("ready", () => {
			logDebug("chokidar ready — watcher initialized");
			const watched = watcher.getWatched();
			let fileCount = 0;
			for (const files of Object.values(watched)) fileCount += files.length;
			logDebug(`chokidar tracking ${Object.keys(watched).length} dir(s), ${fileCount} file(s)`);
		});
		function handleFileEvent(event, filePath) {
			const relPath = relative(root, filePath);
			if (verbose) logDebug(`chokidar ${event}: ${filePath}`);
			if (relPath === CONFIG_FILENAME) {
				if (verbose) logDebug("config file changed — scheduling reload");
				configDebouncer.trigger();
				return;
			}
			logChange(relPath);
			let matched = false;
			for (const r of resolved) if (matchesBridge(relPath, r)) {
				matched = true;
				if (verbose) logDebug(`  matched bridge: ${r.bridge.source} \u2192 ${r.bridge.target} (triggering debouncer)`);
				const debouncer = bridgeDebouncers.get(r);
				if (debouncer) debouncer.trigger();
			}
			if (verbose && !matched) logDebug(`  no bridge matched for ${relPath}`);
		}
		watcher.on("change", (path) => handleFileEvent("change", path));
		watcher.on("add", (path) => handleFileEvent("add", path));
		watcher.on("unlink", (path) => {
			if (verbose) logDebug(`chokidar unlink: ${path}`);
		});
		return {
			watcher,
			bridgeDebouncers,
			configDebouncer,
			resolved,
			graph,
			registry,
			root,
			pm
		};
	}
	session = await startSession();
	if (!session) return 1;
	printStartup(session.resolved, session.registry);
	return new Promise((resolve) => {
		const cleanup = () => {
			console.log(`\n  ${DIM}Shutting down...${RESET}`);
			if (session) teardownSession(session);
			resolve(0);
		};
		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);
	});
}
//#endregion
export { runDev };

//# sourceMappingURL=dev-Db52tFK_.js.map