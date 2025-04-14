import "core-js/stable";
import "html-tag-js/dist/polyfill";

import "styles/main.scss";
import "styles/page.scss";
import "styles/list.scss";
import "styles/overrideAceStyle.scss";

import "lib/polyfill";
import "ace/supportedModes";
import "components/WebComponents";

import ajax from "@deadlyjack/ajax";
import Contextmenu from "components/contextmenu";
import Sidebar from "components/sidebar";
import tile from "components/tile";
import toast from "components/toast";
import tutorial from "components/tutorial";
import fsOperation from "fileSystem";
import intentHandler from "handlers/intent";
import keyboardHandler from "handlers/keyboard";
import quickToolsInit from "handlers/quickToolsInit";
import windowResize from "handlers/windowResize";
import Acode from "lib/acode";
import actionStack from "lib/actionStack";
import applySettings from "lib/applySettings";
import checkFiles from "lib/checkFiles";
import checkPluginsUpdate from "lib/checkPluginsUpdate";
import EditorFile from "lib/editorFile";
import EditorManager from "lib/editorManager";
import lang from "lib/lang";
import loadPlugins from "lib/loadPlugins";
import Logger from "lib/logger";
import openFolder from "lib/openFolder";
import restoreFiles from "lib/restoreFiles";
import settings from "lib/settings";
import startAd from "lib/startAd";
import mustache from "mustache";
import plugins from "pages/plugins";
import otherSettings from "settings/appSettings";
import sidebarApps from "sidebarApps";
import themes from "theme/list";
import Url from "utils/Url";
import helpers from "utils/helpers";
import loadPolyFill from "utils/polyfill";
import $_fileMenu from "views/file-menu.hbs";
import $_menu from "views/menu.hbs";

import { setKeyBindings } from "ace/commands";
import { initModes } from "ace/modelist";
import { keydownState } from "handlers/keyboard";
import { initFileList } from "lib/fileList";
import NotificationManager from "lib/notificationManager";
import { addedFolder } from "lib/openFolder";
import { getEncoding, initEncodings } from "utils/encodings";
import auth, { loginEvents } from "./auth";
import constants from "./constants";

const previousVersionCode = Number.parseInt(localStorage.versionCode, 10);

window.onload = Main;
const logger = new Logger();

async function Main() {
	const oldPreventDefault = TouchEvent.prototype.preventDefault;

	ajax.response = (xhr) => {
		return xhr.response;
	};

	loadPolyFill.apply(window);

	TouchEvent.prototype.preventDefault = function () {
		if (this.cancelable) {
			oldPreventDefault.bind(this)();
		}
	};

	window.addEventListener("resize", windowResize);
	document.addEventListener("pause", pauseHandler);
	document.addEventListener("resume", resumeHandler);
	document.addEventListener("keydown", keyboardHandler);
	document.addEventListener("deviceready", onDeviceReady);
	document.addEventListener("backbutton", backButtonHandler);
	document.addEventListener("menubutton", menuButtonHandler);
}

async function onDeviceReady() {
	await initEncodings(); // important to load encodings before anything else

	const isFreePackage = /(free)$/.test(BuildInfo.packageName);
	const oldResolveURL = window.resolveLocalFileSystemURL;
	const {
		externalCacheDirectory, //
		externalDataDirectory,
		cacheDirectory,
		dataDirectory,
	} = cordova.file;

	window.app = document.body;
	window.root = tag.get("#root");
	window.addedFolder = addedFolder;
	window.editorManager = null;
	window.toast = toast;
	window.ASSETS_DIRECTORY = Url.join(cordova.file.applicationDirectory, "www");
	window.DATA_STORAGE = externalDataDirectory || dataDirectory;
	window.CACHE_STORAGE = externalCacheDirectory || cacheDirectory;
	window.PLUGIN_DIR = Url.join(DATA_STORAGE, "plugins");
	window.KEYBINDING_FILE = Url.join(DATA_STORAGE, ".key-bindings.json");
	window.IS_FREE_VERSION = isFreePackage;
	window.log = logger.log.bind(logger);

	// Capture synchronous errors
	window.addEventListener("error", (event) => {
		const errorMsg = `Error: ${event.message}, Source: ${event.filename}, Line: ${event.lineno}, Column: ${event.colno}, Stack: ${event.error?.stack || "N/A"}`;
		window.log("error", errorMsg);
	});
	// Capture unhandled promise rejections
	window.addEventListener("unhandledrejection", (event) => {
		window.log(
			"error",
			`Unhandled rejection: ${event.reason ? event.reason.message : "Unknown reason"}\nStack: ${event.reason ? event.reason.stack : "No stack available"}`,
		);
	});

	startAd();

	try {
		await helpers.promisify(iap.startConnection).catch((e) => {
			window.log("error", "connection error");
			window.log("error", e);
		});

		if (localStorage.acode_pro === "true") {
			window.IS_FREE_VERSION = false;
		}

		if (navigator.onLine) {
			const purchases = await helpers.promisify(iap.getPurchases);
			const isPro = purchases.find((p) =>
				p.productIds.includes("acode_pro_new"),
			);
			if (isPro) {
				window.IS_FREE_VERSION = false;
			} else {
				window.IS_FREE_VERSION = isFreePackage;
			}
		}
	} catch (error) {
		window.log("error", "Purchase error");
		window.log("error", error);
	}

	try {
		window.ANDROID_SDK_INT = await new Promise((resolve, reject) =>
			system.getAndroidVersion(resolve, reject),
		);
	} catch (error) {
		window.ANDROID_SDK_INT = Number.parseInt(device.version);
	}
	window.DOES_SUPPORT_THEME = (() => {
		const $testEl = (
			<div
				style={{
					height: "var(--test-height)",
					width: "var(--test-height)",
				}}
			/>
		);
		document.body.append($testEl);
		const client = $testEl.getBoundingClientRect();

		$testEl.remove();

		if (client.height === 0) return false;
		return true;
	})();
	window.acode = new Acode();

	system.requestPermission("android.permission.READ_EXTERNAL_STORAGE");
	system.requestPermission("android.permission.WRITE_EXTERNAL_STORAGE");

	const { versionCode } = BuildInfo;

	if (previousVersionCode !== versionCode) {
		system.clearCache();
	}

	if (!(await fsOperation(PLUGIN_DIR).exists())) {
		await fsOperation(DATA_STORAGE).createDirectory("plugins");
	}

	localStorage.versionCode = versionCode;
	document.body.setAttribute(
		"data-version",
		`v${BuildInfo.version} (${versionCode})`,
	);
	acode.setLoadingMessage("Loading settings...");

	window.resolveLocalFileSystemURL = function (url, ...args) {
		oldResolveURL.call(this, Url.safe(url), ...args);
	};

	setTimeout(async () => {
		if (document.body.classList.contains("loading")) {
			window.log("warn", "App is taking unexpectedly long time!");
			document.body.setAttribute(
				"data-small-msg",
				"This is taking unexpectedly long time!",
			);
			// share the log file (but currently doesn't work)
			// system.fileAction(
			//   Url.join(DATA_STORAGE, constants.LOG_FILE_NAME),
			//   constants.LOG_FILE_NAME,
			//   "SEND",
			//   "text/plain",
			//   () => {
			//     toast(strings["no app found to handle this file"]);
			//   },
			// );
		}
	}, 1000 * 10);

	acode.setLoadingMessage("Loading settings...");
	await settings.init();
	themes.init();

	acode.setLoadingMessage("Loading language...");
	await lang.set(settings.value.lang);

	try {
		await loadApp();
	} catch (error) {
		window.log("error", error);
		toast(`Error: ${error.message}`);
	} finally {
		setTimeout(async () => {
			document.body.removeAttribute("data-small-msg");
			app.classList.remove("loading", "splash");

			// load plugins
			try {
				await loadPlugins();

				// Re-emit events for active file after plugins are loaded
				const { activeFile } = editorManager;
				if (activeFile?.uri) {
					// Re-emit file-loaded event
					editorManager.emit("file-loaded", activeFile);
					// Re-emit switch-file event
					editorManager.emit("switch-file", activeFile);
				}
			} catch (error) {
				window.log("error", "Failed to load plugins!");
				window.log("error", error);
				toast("Failed to load plugins!");
			}
			applySettings.afterRender();

			// Check login status before emitting events
			try {
				const isLoggedIn = await auth.isLoggedIn();
				if (isLoggedIn) {
					loginEvents.emit();
				}
			} catch (error) {
				console.error("Error checking login status:", error);
				toast("Error checking login status");
			}
		}, 500);
	}

	// Check for app updates
	if (navigator.onLine) {
		cordova.plugin.http.sendRequest(
			"https://api.github.com/repos/Acode-Foundation/Acode/releases/latest",
			{
				method: "GET",
				responseType: "json",
			},
			(response) => {
				const release = response.data;
				// assuming version is in format v1.2.3
				const latestVersion = release.tag_name
					.replace("v", "")
					.split(".")
					.map(Number);
				const currentVersion = BuildInfo.version.split(".").map(Number);

				const hasUpdate = latestVersion.some(
					(num, i) => num > currentVersion[i],
				);

				if (hasUpdate) {
					acode.pushNotification(
						"Update Available",
						`Acode ${release.tag_name} is now available! Click here to checkout.`,
						{
							icon: "update",
							type: "warning",
							action: () => {
								system.openInBrowser(release.html_url);
							},
						},
					);
				}
			},
			(err) => {
				window.log("error", "Failed to check for updates");
				window.log("error", err);
			},
		);
	}
	checkPluginsUpdate()
		.then((updates) => {
			if (!updates.length) return;
			acode.pushNotification(
				"Plugin Updates",
				`${updates.length} plugin${updates.length > 1 ? "s" : ""} ${updates.length > 1 ? "have" : "has"} new version${updates.length > 1 ? "s" : ""} available.`,
				{
					icon: "extension",
					action: () => {
						plugins(updates);
					},
				},
			);
		})
		.catch(console.error);
}

async function loadApp() {
	let $mainMenu;
	let $fileMenu;
	const $editMenuToggler = (
		<span
			className="icon edit"
			attr-action="toggle-edit-menu"
			style={{ fontSize: "1.2em" }}
		/>
	);
	const $navToggler = (
		<span className="icon menu" attr-action="toggle-sidebar" />
	);
	const $menuToggler = (
		<span className="icon more_vert" attr-action="toggle-menu" />
	);
	const $header = tile({
		type: "header",
		text: "Acode",
		lead: $navToggler,
		tail: $menuToggler,
	});
	const $main = <main />;
	const $sidebar = <Sidebar container={$main} toggler={$navToggler} />;
	const $runBtn = (
		<span
			style={{ fontSize: "1.2em" }}
			className="icon play_arrow"
			attr-action="run"
			onclick={() => acode.exec("run")}
			oncontextmenu={() => acode.exec("run-file")}
		/>
	);
	const $floatingNavToggler = (
		<span
			id="sidebar-toggler"
			className="floating icon menu"
			onclick={() => acode.exec("toggle-sidebar")}
		/>
	);
	const $headerToggler = (
		<span className="floating icon keyboard_arrow_left" id="header-toggler" />
	);
	const folders = helpers.parseJSON(localStorage.folders);
	const files = helpers.parseJSON(localStorage.files) || [];
	const editorManager = await EditorManager($header, $main);

	const setMainMenu = () => {
		if ($mainMenu) {
			$mainMenu.removeEventListener("click", handleMenu);
			$mainMenu.destroy();
		}
		const { openFileListPos, fullscreen } = settings.value;
		if (openFileListPos === settings.OPEN_FILE_LIST_POS_BOTTOM && fullscreen) {
			$mainMenu = createMainMenu({ bottom: "6px", toggler: $menuToggler });
		} else {
			$mainMenu = createMainMenu({ top: "6px", toggler: $menuToggler });
		}
		$mainMenu.addEventListener("click", handleMenu);
	};

	const setFileMenu = () => {
		if ($fileMenu) {
			$fileMenu.removeEventListener("click", handleMenu);
			$fileMenu.destroy();
		}
		const { openFileListPos, fullscreen } = settings.value;
		if (openFileListPos === settings.OPEN_FILE_LIST_POS_BOTTOM && fullscreen) {
			$fileMenu = createFileMenu({ bottom: "6px", toggler: $editMenuToggler });
		} else {
			$fileMenu = createFileMenu({ top: "6px", toggler: $editMenuToggler });
		}
		$fileMenu.addEventListener("click", handleMenu);
	};

	acode.$headerToggler = $headerToggler;
	window.actionStack = actionStack.windowCopy();
	window.editorManager = editorManager;
	setMainMenu(settings.value.openFileListPos);
	setFileMenu(settings.value.openFileListPos);
	actionStack.onCloseApp = () => acode.exec("save-state");
	$headerToggler.onclick = function () {
		root.classList.toggle("show-header");
		this.classList.toggle("keyboard_arrow_left");
		this.classList.toggle("keyboard_arrow_right");
	};

	//#region rendering
	applySettings.beforeRender();
	root.appendOuter($header, $main, $floatingNavToggler, $headerToggler);
	//#endregion

	//#region Add event listeners
	initModes();
	quickToolsInit();
	sidebarApps.init($sidebar);
	await sidebarApps.loadApps();
	editorManager.onupdate = onEditorUpdate;
	root.on("show", mainPageOnShow);
	app.addEventListener("click", onClickApp);
	editorManager.on("rename-file", onFileUpdate);
	editorManager.on("switch-file", onFileUpdate);
	editorManager.on("file-loaded", onFileUpdate);
	navigator.app.overrideButton("menubutton", true);
	system.setIntentHandler(intentHandler, intentHandler.onError);
	system.getCordovaIntent(intentHandler, intentHandler.onError);
	setTimeout(showTutorials, 1000);
	settings.on("update:openFileListPos", () => {
		setMainMenu();
		setFileMenu();
	});
	settings.on("update:fullscreen", () => {
		setMainMenu();
		setFileMenu();
	});

	$sidebar.onshow = () => {
		const activeFile = editorManager.activeFile;
		if (activeFile) editorManager.editor.blur();
	};
	sdcard.watchFile(KEYBINDING_FILE, async () => {
		await setKeyBindings(editorManager.editor);
		toast(strings["key bindings updated"]);
	});
	//#endregion

	const notificationManager = new NotificationManager();
	notificationManager.init();

	window.log("info", "Started app and its services...");

	new EditorFile();

	// load theme plugins
	try {
		await loadPlugins(true);
	} catch (error) {
		window.log("error", "Failed to load theme plugins!");
		window.log("error", error);
		toast("Failed to load theme plugins!");
	}

	acode.setLoadingMessage("Loading folders...");
	if (Array.isArray(folders)) {
		for (const folder of folders) {
			folder.opts.listFiles = !!folder.opts.listFiles;
			openFolder(folder.url, folder.opts);
		}
	}

	if (Array.isArray(files) && files.length) {
		try {
			await restoreFiles(files);
		} catch (error) {
			window.log("error", "File loading failed!");
			window.log("error", error);
			toast("File loading failed!");
		}
	} else {
		onEditorUpdate(undefined, false);
	}

	initFileList();

	/**
	 *
	 * @param {MouseEvent} e
	 */
	function handleMenu(e) {
		const $target = e.target;
		const action = $target.getAttribute("action");
		const value = $target.getAttribute("value") || undefined;
		if (!action) return;

		if ($mainMenu.contains($target)) $mainMenu.hide();
		if ($fileMenu.contains($target)) $fileMenu.hide();
		acode.exec(action, value);
	}

	function onEditorUpdate(mode, saveState = true) {
		const { activeFile } = editorManager;

		if (!$editMenuToggler.isConnected) {
			$header.insertBefore($editMenuToggler, $header.lastChild);
		}

		if (mode === "switch-file") {
			if (settings.value.rememberFiles && activeFile) {
				localStorage.setItem("lastfile", activeFile.id);
			}
			return;
		}

		if (saveState) acode.exec("save-state");
	}

	async function onFileUpdate() {
		try {
			const { serverPort, previewPort } = settings.value;
			let canRun = false;
			if (serverPort !== previewPort) {
				canRun = true;
			} else {
				const { activeFile } = editorManager;
				canRun = await activeFile?.canRun();
			}

			if (canRun) {
				$header.insertBefore($runBtn, $header.lastChild);
			} else {
				$runBtn.remove();
			}
		} catch (error) {
			$runBtn.removeAttribute("run-file");
			$runBtn.remove();
		}
	}
}

function onClickApp(e) {
	let el = e.target;
	if (el instanceof HTMLAnchorElement || checkIfInsideAnchor()) {
		e.preventDefault();
		e.stopPropagation();

		system.openInBrowser(el.href);
	}

	function checkIfInsideAnchor() {
		const allAs = [...document.body.getAll("a")];

		for (const a of allAs) {
			if (a.contains(el)) {
				el = a;
				return true;
			}
		}

		return false;
	}
}

function mainPageOnShow() {
	const { editor } = editorManager;
	editor.resize(true);
}

function createMainMenu({ top, bottom, toggler }) {
	return Contextmenu({
		right: "6px",
		top,
		bottom,
		toggler,
		transformOrigin: top ? "top right" : "bottom right",
		innerHTML: () => {
			return mustache.render($_menu, strings);
		},
	});
}

function createFileMenu({ top, bottom, toggler }) {
	const $menu = Contextmenu({
		top,
		bottom,
		toggler,
		transformOrigin: top ? "top right" : "bottom right",
		innerHTML: () => {
			const file = window.editorManager.activeFile;

			if (file.type === "page") {
				return "";
			}

			if (file.loading) {
				$menu.classList.add("disabled");
			} else {
				$menu.classList.remove("disabled");
			}

			const { label: encoding } = getEncoding(file.encoding);
			const isEditorFile = file.type === "editor";
			return mustache.render($_fileMenu, {
				...strings,
				file_mode: isEditorFile
					? (file.session?.getMode()?.$id || "").split("/").pop()
					: "",
				file_encoding: isEditorFile ? encoding : "",
				file_read_only: !file.editable,
				file_on_disk: !!file.uri,
				file_eol: isEditorFile ? file.eol : "",
				copy_text: !!window.editorManager.editor.getCopyText(),
				is_editor: isEditorFile,
			});
		},
	});

	return $menu;
}

function showTutorials() {
	if (window.innerWidth > 750) {
		tutorial("quicktools-tutorials", (hide) => {
			const onclick = () => {
				otherSettings();
				hide();
			};

			return (
				<p>
					Quicktools has been <strong>disabled</strong> because it seems like
					you are on a bigger screen and probably using a keyboard. To enable
					it,{" "}
					<span className="link" onclick={onclick}>
						click here
					</span>{" "}
					or press <kbd>Ctrl + Shift + P</kbd> and search for{" "}
					<code>quicktools</code>.
				</p>
			);
		});
	}
}

function backButtonHandler() {
	if (keydownState.esc) {
		keydownState.esc = false;
		return;
	}
	actionStack.pop();
}

function menuButtonHandler() {
	const { acode } = window;
	acode?.exec("toggle-sidebar");
}

function pauseHandler() {
	const { acode } = window;
	acode?.exec("save-state");
}

function resumeHandler() {
	if (!settings.value.checkFiles) return;
	checkFiles();
}
