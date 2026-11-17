/**
 * dsh-screenshot-plugin — client half (hand-written lazy-CJS bundle).
 *
 * Registers one compact control at the left of the composer tool row: a camera
 * button that opens a two-item menu.
 *   - 隐藏界面截图: the host hides this DSH window, captures the desktop behind
 *     it, then restores the window.
 *   - 显示界面截图: the host captures the desktop with this window in place.
 * Both paths end in a frozen full-screen region picker; the chosen rectangle is
 * cropped to a PNG and added to the composer draft as an image attachment, so
 * the user can type the question and send it in one go.
 */
window.__ModuleLoader__.load({
	id: "dsh-screenshot-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		// `createPortal` lives on react-dom, not on react. Resolve it defensively
		// (the module table seeds react-dom, but a degraded shell must still
		// render the control) and fall back to in-tree rendering.
		const reactDom = (() => {
			try {
				return require("react-dom");
			} catch {
				return null;
			}
		})();
		const createPortal =
			typeof reactDom?.createPortal === "function"
				? reactDom.createPortal
				: typeof react.createPortal === "function"
					? react.createPortal
					: null;

		const NS = "dsh-screenshot";
		const CAPTURE_PATH = "/dsh-screenshot/capture";
		const SLOT_ID = "screenshot-capture";
		const STYLE_ID = "dsh-screenshot-styles";
		const MIN_SELECTION = 4;

		const ZH = {
			"label": "截图提问",
			"mode.hide": "隐藏界面截图",
			"mode.hide.desc": "先隐藏此窗口，截取它背后的屏幕",
			"mode.show": "显示界面截图",
			"mode.show.desc": "保持此窗口可见，直接截取当前屏幕",
			"picker.hint": "拖动框选区域 · Enter 确认 · Esc 取消",
			"picker.full": "整屏",
			"picker.cancel": "取消",
			"picker.confirm": "完成",
			"toast.attached": "截图已加入输入框",
			"toast.failed": "截图失败",
			"toast.busy": "输入框正忙，请稍后再试",
			"toast.unsupported": "当前输入框不接受图片",
		};

		const EN = {
			"label": "Screenshot",
			"mode.hide": "Hide this window, then capture",
			"mode.hide.desc": "Hide the DSH window first and grab what is behind it",
			"mode.show": "Capture with this window visible",
			"mode.show.desc": "Keep the DSH window on screen and capture it as it is",
			"picker.hint": "Drag to select a region · Enter to confirm · Esc to cancel",
			"picker.full": "Full screen",
			"picker.cancel": "Cancel",
			"picker.confirm": "Done",
			"toast.attached": "Screenshot added to the composer",
			"toast.failed": "Screenshot failed",
			"toast.busy": "The composer is busy, try again",
			"toast.unsupported": "This composer does not accept images",
		};

		const ICONS = {
			camera: [
				["path", { d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" }],
				["circle", { cx: 12, cy: 13, r: 3 }],
			],
			eyeOff: [
				["path", { d: "M10.7 5.1A10.7 10.7 0 0 1 21.9 11.7a1 1 0 0 1 0 .6 10.7 10.7 0 0 1-1.4 2.5" }],
				["path", { d: "M14.1 14.2a3 3 0 0 1-4.2-4.2" }],
				["path", { d: "M17.5 17.5A10.8 10.8 0 0 1 2.1 12.3a1 1 0 0 1 0-.6 10.8 10.8 0 0 1 4.5-5.1" }],
				["path", { d: "m2 2 20 20" }],
			],
			monitor: [
				["rect", { x: 2, y: 3, width: 20, height: 14, rx: 2 }],
				["path", { d: "M8 21h8" }],
				["path", { d: "M12 17v4" }],
			],
		};

		// ---------------------------------------------------------------- utils

		function renderIcon(name, size, strokeWidth) {
			const nodes = ICONS[name] || [];
			return react.createElement(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: strokeWidth === undefined ? 1.7 : strokeWidth,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					focusable: "false",
				},
				nodes.map((node, index) =>
					react.createElement(node[0], Object.assign({ key: index }, node[1])),
				),
			);
		}

		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), max);
		}

		function ensureStyles() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = `
.dsh-shot-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;opacity:.68;transition:opacity .14s ease,background-color .14s ease}
.dsh-shot-button:hover{opacity:1;background:rgba(127,127,127,.16)}
.dsh-shot-button[data-open="true"]{opacity:1;background:rgba(127,127,127,.22)}
.dsh-shot-button[disabled]{opacity:.35;cursor:default;background:transparent}
.dsh-shot-button[data-busy="true"] svg{animation:dsh-shot-spin .9s linear infinite}
@keyframes dsh-shot-spin{to{transform:rotate(360deg)}}
.dsh-shot-menu{position:fixed;z-index:2147482000;width:264px;padding:6px;border-radius:14px;border:1px solid rgba(127,127,127,.28);box-shadow:0 18px 46px rgba(0,0,0,.22);font-size:13px;line-height:1.35;font-family:inherit}
.dsh-shot-menu[data-tone="light"]{background:#fff;color:#1b1c1e}
.dsh-shot-menu[data-tone="dark"]{background:#22242a;color:#f1f2f4;border-color:rgba(255,255,255,.14)}
.dsh-shot-item{display:flex;align-items:flex-start;gap:10px;width:100%;padding:9px 10px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.dsh-shot-item:hover,.dsh-shot-item:focus-visible{background:rgba(127,127,127,.18);outline:none}
.dsh-shot-item svg{flex:none;margin-top:2px;opacity:.85}
.dsh-shot-item-title{display:block;font-weight:600}
.dsh-shot-item-desc{display:block;margin-top:2px;font-size:12px;opacity:.62;font-weight:400}
.dsh-shot-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483002;max-width:min(560px,86vw);padding:9px 16px;border-radius:10px;font-size:13px;line-height:1.4;color:#fff;background:rgba(28,30,34,.94);box-shadow:0 12px 32px rgba(0,0,0,.28);pointer-events:none;animation:dsh-shot-fade .16s ease-out}
.dsh-shot-toast[data-tone="error"]{background:rgba(178,42,42,.96)}
.dsh-shot-overlay{position:fixed;inset:0;z-index:2147483001;background:#07080a;overflow:hidden;cursor:crosshair;user-select:none;-webkit-user-select:none;touch-action:none;font-family:inherit}
.dsh-shot-image{position:absolute;left:0;top:0;pointer-events:none;user-select:none;-webkit-user-drag:none;background:#07080a}
.dsh-shot-selection{position:absolute;z-index:1;border:1px solid #7fb2ff;background:rgba(127,178,255,.14);box-shadow:0 0 0 100vmax rgba(0,0,0,.5);pointer-events:none}
.dsh-shot-selection[hidden]{display:none}
.dsh-shot-dims{position:absolute;right:0;bottom:0;margin:4px;padding:1px 7px;border-radius:5px;background:rgba(16,18,22,.86);color:#fff;font-size:11px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dsh-shot-hint{position:absolute;left:50%;top:18px;transform:translateX(-50%);z-index:2;padding:6px 14px;border-radius:999px;background:rgba(20,22,26,.82);color:rgba(255,255,255,.88);font-size:12.5px;line-height:1.4;white-space:nowrap;pointer-events:none}
.dsh-shot-bar{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:2;display:flex;align-items:center;gap:8px;padding:7px;border-radius:14px;background:rgba(26,28,33,.94);box-shadow:0 18px 44px rgba(0,0,0,.45);cursor:default}
.dsh-shot-action{min-width:64px;padding:7px 14px;border:0;border-radius:10px;background:rgba(255,255,255,.1);color:#eef0f3;font:inherit;font-size:13px;cursor:pointer;transition:background-color .14s ease}
.dsh-shot-action:hover{background:rgba(255,255,255,.18)}
.dsh-shot-action-primary{background:#3f7cf5;color:#fff}
.dsh-shot-action-primary:hover{background:#5089f7}
.dsh-shot-action:focus-visible{outline:2px solid #7fb2ff;outline-offset:2px}
@media (prefers-reduced-motion: reduce){.dsh-shot-button[data-busy="true"] svg{animation:none}}
`;
			document.head.appendChild(style);
		}

		let toastTimer = null;
		function toast(message, tone) {
			const existing = document.querySelector(".dsh-shot-toast");
			if (existing !== null) existing.remove();
			if (toastTimer !== null) {
				clearTimeout(toastTimer);
				toastTimer = null;
			}
			const element = document.createElement("div");
			element.className = "dsh-shot-toast";
			if (tone === "error") element.dataset.tone = "error";
			element.textContent = message;
			document.body.appendChild(element);
			toastTimer = setTimeout(() => {
				toastTimer = null;
				element.remove();
			}, tone === "error" ? 4200 : 2400);
		}

		async function requestCapture(mode, title) {
			let response;
			try {
				response = await fetch(CAPTURE_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ mode, title }),
					credentials: "same-origin",
				});
			} catch (error) {
				throw new Error("无法连接到 DSH 主机 / cannot reach the DSH host");
			}
			let payload = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (!response.ok || payload === null || payload.ok !== true) {
				const reason = payload !== null && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
				throw new Error(reason);
			}
			if (typeof payload.image !== "string" || !payload.image.startsWith("data:image/")) {
				throw new Error("capture returned no image");
			}
			return payload;
		}

		/** Reads the surrounding text color to pick a menu tone that matches the theme. */
		function readTone(element) {
			try {
				const color = window.getComputedStyle(element).color || "";
				const match = /rgba?\(([^)]+)\)/.exec(color);
				if (match === null) return "dark";
				const parts = match[1].split(/[,\s/]+/).filter((part) => part.length > 0);
				const red = Number(parts[0]);
				const green = Number(parts[1]);
				const blue = Number(parts[2]);
				const alpha = parts.length > 3 ? Number(parts[3]) : 1;
				if (![red, green, blue].every(Number.isFinite) || alpha < 0.5) return "dark";
				const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
				// Light text on a dark page -> dark menu; dark text -> light menu.
				return luminance > 0.5 ? "dark" : "light";
			} catch {
				return "dark";
			}
		}

		// ------------------------------------------------------- region picking

		function cropToBlob(image, box, target) {
			const naturalWidth = image.naturalWidth;
			const naturalHeight = image.naturalHeight;
			const scaleX = naturalWidth / box.width;
			const scaleY = naturalHeight / box.height;
			const rect = target === null ? { x: box.left, y: box.top, w: box.width, h: box.height } : target;
			const sourceX = clamp(Math.round((rect.x - box.left) * scaleX), 0, Math.max(0, naturalWidth - 1));
			const sourceY = clamp(Math.round((rect.y - box.top) * scaleY), 0, Math.max(0, naturalHeight - 1));
			const sourceWidth = clamp(Math.round(rect.w * scaleX), 1, naturalWidth - sourceX);
			const sourceHeight = clamp(Math.round(rect.h * scaleY), 1, naturalHeight - sourceY);
			const canvas = document.createElement("canvas");
			canvas.width = sourceWidth;
			canvas.height = sourceHeight;
			const context = canvas.getContext("2d");
			if (context === null) return Promise.reject(new Error("canvas is unavailable"));
			context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
			return new Promise((resolve, reject) => {
				canvas.toBlob((blob) => {
					if (blob === null || blob.size === 0) reject(new Error("could not encode the selection"));
					else resolve(blob);
				}, "image/png");
			});
		}

		/**
		 * Shows the frozen screenshot and resolves with the cropped PNG blob, or
		 * null when the user cancels.
		 */
		function pickRegion(dataUrl, tr) {
			return new Promise((resolve, reject) => {
				const overlay = document.createElement("div");
				overlay.className = "dsh-shot-overlay";
				overlay.setAttribute("role", "dialog");
				overlay.setAttribute("aria-modal", "true");

				const image = document.createElement("img");
				image.className = "dsh-shot-image";
				image.alt = "";
				image.draggable = false;

				const selection = document.createElement("div");
				selection.className = "dsh-shot-selection";
				selection.hidden = true;
				const dims = document.createElement("span");
				dims.className = "dsh-shot-dims";
				selection.appendChild(dims);

				const hint = document.createElement("div");
				hint.className = "dsh-shot-hint";
				hint.textContent = tr("picker.hint");

				const bar = document.createElement("div");
				bar.className = "dsh-shot-bar";
				const makeAction = (action, text, primary) => {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "dsh-shot-action" + (primary ? " dsh-shot-action-primary" : "");
					button.dataset.action = action;
					button.textContent = text;
					bar.appendChild(button);
					return button;
				};
				const fullAction = makeAction("full", tr("picker.full"), false);
				const cancelAction = makeAction("cancel", tr("picker.cancel"), false);
				const confirmAction = makeAction("confirm", tr("picker.confirm"), true);

				overlay.append(image, selection, hint, bar);

				let box = null;
				let selectionRect = null;
				let dragStart = null;
				let dragging = false;
				let cropping = false;
				let finished = false;
				const previousOverflow = document.documentElement.style.overflow;

				const layout = () => {
					const naturalWidth = image.naturalWidth;
					const naturalHeight = image.naturalHeight;
					if (!naturalWidth || !naturalHeight) return;
					const viewportWidth = window.innerWidth;
					const viewportHeight = window.innerHeight;
					const scale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight, 1);
					const width = Math.max(1, Math.round(naturalWidth * scale));
					const height = Math.max(1, Math.round(naturalHeight * scale));
					const left = Math.round((viewportWidth - width) / 2);
					const top = Math.round((viewportHeight - height) / 2);
					image.style.width = `${width}px`;
					image.style.height = `${height}px`;
					image.style.left = `${left}px`;
					image.style.top = `${top}px`;
					box = { left, top, width, height };
					clearSelection();
				};

				const clearSelection = () => {
					selectionRect = null;
					selection.hidden = true;
					confirmAction.disabled = true;
					confirmAction.style.opacity = "0.55";
					confirmAction.style.cursor = "default";
				};

				const deviceScale = () => {
					if (box === null || !box.width) return { x: 1, y: 1 };
					return { x: image.naturalWidth / box.width, y: image.naturalHeight / box.height };
				};

				const paintSelection = (from, to) => {
					if (box === null) return;
					const x = Math.min(from.x, to.x);
					const y = Math.min(from.y, to.y);
					const width = Math.abs(to.x - from.x);
					const height = Math.abs(to.y - from.y);
					selectionRect = { x, y, w: width, h: height };
					selection.hidden = false;
					selection.style.left = `${x}px`;
					selection.style.top = `${y}px`;
					selection.style.width = `${width}px`;
					selection.style.height = `${height}px`;
					const scale = deviceScale();
					dims.textContent = `${Math.round(width * scale.x)} × ${Math.round(height * scale.y)}`;
					const usable = width >= MIN_SELECTION && height >= MIN_SELECTION;
					confirmAction.disabled = !usable;
					confirmAction.style.opacity = usable ? "" : "0.55";
					confirmAction.style.cursor = usable ? "" : "default";
				};

				const pointOf = (event) => {
					if (box === null) return { x: event.clientX, y: event.clientY };
					return {
						x: clamp(event.clientX, box.left, box.left + box.width),
						y: clamp(event.clientY, box.top, box.top + box.height),
					};
				};

				const cleanup = () => {
					document.removeEventListener("keydown", onKeyDown, true);
					window.removeEventListener("resize", layout);
					document.documentElement.style.overflow = previousOverflow;
					overlay.remove();
				};

				const settle = (value) => {
					if (finished) return;
					finished = true;
					cleanup();
					resolve(value);
				};

				const abort = (error) => {
					if (finished) return;
					finished = true;
					cleanup();
					reject(error);
				};

				const confirm = () => {
					if (finished || cropping || box === null) return;
					const target =
						selectionRect !== null && selectionRect.w >= MIN_SELECTION && selectionRect.h >= MIN_SELECTION
							? selectionRect
							: null;
					cropping = true;
					cropToBlob(image, box, target).then(settle, abort);
				};

				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						settle(null);
						return;
					}
					if (event.key === "Enter") {
						event.preventDefault();
						event.stopPropagation();
						confirm();
					}
				};

				const onPointerDown = (event) => {
					if (event.button !== 0) return;
					const target = event.target;
					if (target instanceof Element && target.closest(".dsh-shot-bar, .dsh-shot-hint")) return;
					if (box === null) return;
					dragging = true;
					dragStart = pointOf(event);
					clearSelection();
					overlay.setPointerCapture(event.pointerId);
				};

				const onPointerMove = (event) => {
					if (!dragging || dragStart === null) return;
					paintSelection(dragStart, pointOf(event));
				};

				const onPointerUp = (event) => {
					if (!dragging) return;
					dragging = false;
					if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
					if (selectionRect !== null && (selectionRect.w < MIN_SELECTION || selectionRect.h < MIN_SELECTION)) {
						clearSelection();
					}
				};

				const onDoubleClick = (event) => {
					const target = event.target;
					if (target instanceof Element && target.closest(".dsh-shot-bar")) return;
					confirm();
				};

				fullAction.addEventListener("click", () => {
					if (box === null) return;
					paintSelection(
						{ x: box.left, y: box.top },
						{ x: box.left + box.width, y: box.top + box.height },
					);
					confirm();
				});
				cancelAction.addEventListener("click", () => settle(null));
				confirmAction.addEventListener("click", () => confirm());

				clearSelection();
				overlay.addEventListener("pointerdown", onPointerDown);
				overlay.addEventListener("pointermove", onPointerMove);
				overlay.addEventListener("pointerup", onPointerUp);
				overlay.addEventListener("pointercancel", onPointerUp);
				overlay.addEventListener("dblclick", onDoubleClick);
				document.addEventListener("keydown", onKeyDown, true);
				window.addEventListener("resize", layout);
				document.documentElement.style.overflow = "hidden";

				image.addEventListener("load", layout);
				image.addEventListener("error", () => abort(new Error("could not decode the screenshot")));
				image.src = dataUrl;
				document.body.appendChild(overlay);
				requestAnimationFrame(() => {
					layout();
					confirmAction.focus({ preventScroll: true });
				});
			});
		}

		// ------------------------------------------------------------ attaching

		function timestamp() {
			const now = new Date();
			const pad = (value) => String(value).padStart(2, "0");
			return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
		}

		function focusComposer(services, sessionId) {
			try {
				const scope = services.sessions.scope(sessionId);
				const input = services.conversation.input.for(scope);
				input.focus();
			} catch {
				// Focusing is best effort: the attachment is what the user asked for.
			}
		}

		function attachBlob(services, sessionId, inputActions, blob, tr) {
			const file = new File([blob], `screenshot-${timestamp()}.png`, { type: "image/png" });
			const drafts = services.conversation.createDrafts(sessionId, [file]);
			if (!Array.isArray(drafts) || drafts.length === 0) {
				throw new Error(tr("toast.unsupported"));
			}
			const ids = drafts.map((draft) => draft.id);
			if (!inputActions.addAttachments(ids)) {
				try {
					services.conversation.releaseDraftAttachments(drafts);
				} catch {
					// ignore: the drafts are released by the composer anyway
				}
				throw new Error(tr("toast.busy"));
			}
			focusComposer(services, sessionId);
		}

		// ------------------------------------------------------------ component

		function ScreenshotControl(props) {
			const sessionId = props.sessionId;
			const inputActions = props.inputActions;
			const locked = props.locked === true;
			const tr = props.tr;
			const services = props.services;

			const buttonRef = react.useRef(null);
			const menuRef = react.useRef(null);
			const aliveRef = react.useRef(true);
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [anchor, setAnchor] = react.useState(null);

			react.useEffect(() => {
				return () => {
					aliveRef.current = false;
				};
			}, []);

			react.useEffect(() => {
				if (!open) return undefined;
				const onPointerDown = (event) => {
					const target = event.target;
					if (!(target instanceof Node)) return;
					if (buttonRef.current !== null && buttonRef.current.contains(target)) return;
					if (menuRef.current !== null && menuRef.current.contains(target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}, [open]);

			const toggleMenu = react.useCallback(() => {
				if (busy) return;
				const element = buttonRef.current;
				if (element === null) return;
				if (open) {
					setOpen(false);
					return;
				}
				const rect = element.getBoundingClientRect();
				const width = 264;
				setAnchor({
					left: clamp(Math.round(rect.left), 8, Math.max(8, window.innerWidth - width - 8)),
					bottom: Math.round(window.innerHeight - rect.top + 8),
					tone: readTone(element),
				});
				setOpen(true);
			}, [busy, open]);

			const run = react.useCallback(
				async (mode) => {
					if (busy) return;
					setOpen(false);
					setBusy(true);
					try {
						const shot = await requestCapture(mode, typeof document === "undefined" ? "" : document.title);
						if (!aliveRef.current) return;
						const blob = await pickRegion(shot.image, tr);
						if (blob === null) return;
						attachBlob(services, sessionId, inputActions, blob, tr);
						toast(tr("toast.attached"), "ok");
					} catch (error) {
						const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
						toast(`${tr("toast.failed")}${detail}`, "error");
					} finally {
						if (aliveRef.current) setBusy(false);
					}
				},
				[busy, inputActions, services, sessionId, tr],
			);

			const hidden = busy || locked;
			const button = react.createElement(
				"button",
				{
					ref: buttonRef,
					type: "button",
					className: "dsh-shot-button",
					"data-open": open ? "true" : "false",
					"data-busy": busy ? "true" : "false",
					title: tr("label"),
					"aria-label": tr("label"),
					"aria-haspopup": "menu",
					"aria-expanded": open ? "true" : "false",
					disabled: hidden,
					onClick: toggleMenu,
				},
				renderIcon("camera", 16, 1.7),
			);

			const menuElement =
				open && anchor !== null
					? react.createElement(
							"div",
							{
								ref: menuRef,
								className: "dsh-shot-menu",
								"data-tone": anchor.tone,
								role: "menu",
								style: { left: `${anchor.left}px`, bottom: `${anchor.bottom}px` },
							},
							renderItem("eyeOff", tr("mode.hide"), tr("mode.hide.desc"), () => run("hide")),
							renderItem("monitor", tr("mode.show"), tr("mode.show.desc"), () => run("show")),
						)
					: null;

			// The menu is layered over the composer, so prefer a portal to body;
			// the menu's own CSS is position:fixed, so an in-tree render is correct
			// too when the portal helper is unavailable.
			const menu =
				menuElement === null || createPortal === null
					? menuElement
					: createPortal(menuElement, document.body);

			return react.createElement(react.Fragment, null, button, menu);
		}

		function renderItem(icon, title, description, onSelect) {
			return react.createElement(
				"button",
				{ type: "button", className: "dsh-shot-item", role: "menuitem", onClick: onSelect },
				renderIcon(icon, 16, 1.7),
				react.createElement(
					"span",
					null,
					react.createElement("span", { className: "dsh-shot-item-title" }, title),
					react.createElement("span", { className: "dsh-shot-item-desc" }, description),
				),
			);
		}

		// --------------------------------------------------------------- plugin

		/** Contains a render failure in this control instead of the composer row. */
		class Guard extends react.Component {
			static getDerivedStateFromError() {
				return { failed: true };
			}

			constructor(props) {
				super(props);
				this.state = { failed: false };
			}

			componentDidCatch(error) {
				console.error("dsh-screenshot: the capture control failed to render", error);
			}

			render() {
				return this.state.failed ? null : this.props.children;
			}
		}

		function apply(ctx) {
			ensureStyles();
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), "dsh-screenshot: dictionaries");

			const translate = (key) => {
				try {
					const text = t(key);
					return typeof text === "string" && text.length > 0 ? text : key;
				} catch {
					return key;
				}
			};

			const services = { conversation: ctx.conversation, sessions: ctx.sessions };

			ctx.slots.inject("conversation.input.left", () =>
				ctx.slots.register(
					{
						name: "conversation.input.left",
						id: SLOT_ID,
						order: 40,
						label: () => translate("label"),
					},
					(props) =>
						react.createElement(
							Guard,
							null,
							react.createElement(ScreenshotControl, Object.assign({}, props, { tr: translate, services })),
						),
				),
			);
		}

		exports.name = "ui-screenshot";
		exports.inject = ["slots", "locale", "conversation", "sessions"];
		exports.apply = apply;
		return module.exports;
	},
});
