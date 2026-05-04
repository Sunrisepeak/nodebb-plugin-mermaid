'use strict';

(function (root, factory) {
	const api = factory(root);
	root.NodeBBMermaid = api;

	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	}

	if (!root.__nodebbMermaidNoAutoStart) {
		api.bind();
	}
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
	const pluginId = 'nodebb-plugin-mermaid';
	const stateAttribute = 'data-nodebb-mermaid-state';
	const pendingState = 'pending';
	const renderedState = 'rendered';
	const errorState = 'error';
	const viewerBoundAttribute = 'data-nodebb-mermaid-viewer-bound';
	const viewerOpenClass = 'nodebb-mermaid-viewer-open';
	const minViewerScale = 0.2;
	const maxViewerScale = 8;
	const viewerZoomStep = 1.1;
	const codeSelector = [
		'pre > code.language-mermaid',
		'pre > code.lang-mermaid',
		'pre > code[class~="language-mermaid"]',
		'pre > code[class~="lang-mermaid"]',
	].join(',');

	let loadPromise;
	let initialized = false;
	let activeViewer;

	function getDocument() {
		return root.document;
	}

	function getContentRoot(container) {
		const doc = getDocument();
		if (container) {
			return container;
		}
		return doc?.querySelector('#content') || doc?.body || doc;
	}

	function getRelativePath() {
		const globalConfig = typeof globalThis !== 'undefined' ? globalThis.config : {};
		const runtimeConfig = root.config || globalConfig || {};
		const relativePath = runtimeConfig.relative_path || '';

		return relativePath.replace(/\/+$/, '');
	}

	function getMermaidScriptUrl() {
		return `${getRelativePath()}/plugins/${pluginId}/mermaid/mermaid.min.js`;
	}

	function unique(nodes) {
		return Array.from(new Set(nodes));
	}

	function clamp(value, min, max) {
		return Math.min(Math.max(value, min), max);
	}

	function formatNumber(value) {
		return Number.parseFloat(value.toFixed(3)).toString();
	}

	function findMermaidSources(container) {
		const rootEl = getContentRoot(container);
		if (!rootEl?.querySelectorAll) {
			return [];
		}

		const codeBlocks = Array.from(rootEl.querySelectorAll(codeSelector));
		const explicitBlocks = Array.from(rootEl.querySelectorAll(`.mermaid:not([${stateAttribute}])`))
			.filter(block => !block.matches(codeSelector));

		return unique([...codeBlocks, ...explicitBlocks]);
	}

	function hasMermaid(container) {
		return findMermaidSources(container).length > 0;
	}

	function createDiagramNode(code) {
		const diagram = code.ownerDocument.createElement('div');
		diagram.className = 'nodebb-mermaid nodebb-mermaid__diagram mermaid';
		diagram.dataset.nodebbMermaidState = pendingState;
		diagram.textContent = code.textContent.trim();
		return diagram;
	}

	function prepareMermaidNodes(container) {
		const rootEl = getContentRoot(container);
		if (!rootEl?.querySelectorAll) {
			return [];
		}

		Array.from(rootEl.querySelectorAll(codeSelector)).forEach((code) => {
			const pre = code.closest('pre');
			if (!pre || pre.dataset.nodebbMermaidState) {
				return;
			}

			pre.replaceWith(createDiagramNode(code));
		});

		Array.from(rootEl.querySelectorAll(`.mermaid:not([${stateAttribute}])`)).forEach((block) => {
			block.classList.add('nodebb-mermaid', 'nodebb-mermaid__diagram');
			block.dataset.nodebbMermaidState = pendingState;
		});

		return Array.from(rootEl.querySelectorAll(`[${stateAttribute}="${pendingState}"]`));
	}

	function loadMermaid() {
		if (root.mermaid) {
			return Promise.resolve(root.mermaid);
		}

		if (loadPromise) {
			return loadPromise;
		}

		loadPromise = new Promise((resolve, reject) => {
			const doc = getDocument();
			if (!doc?.head) {
				reject(new Error('Unable to load Mermaid: document.head is unavailable'));
				return;
			}

			const script = doc.createElement('script');
			script.src = getMermaidScriptUrl();
			script.async = true;
			script.onload = () => {
				if (root.mermaid) {
					resolve(root.mermaid);
				} else {
					reject(new Error('Mermaid script loaded but window.mermaid is unavailable'));
				}
			};
			script.onerror = () => reject(new Error(`Failed to load Mermaid from ${script.src}`));
			doc.head.appendChild(script);
		});

		return loadPromise;
	}

	function initializeMermaid(mermaid) {
		if (initialized) {
			return;
		}

		mermaid.initialize({
			startOnLoad: false,
			securityLevel: 'strict',
		});
		initialized = true;
	}

	function applyViewerTransform(viewer) {
		viewer.image.style.transform = [
			`translate(${formatNumber(viewer.translateX)}px, ${formatNumber(viewer.translateY)}px)`,
			`scale(${formatNumber(viewer.scale)})`,
		].join(' ');
	}

	function addViewerListener(viewer, target, eventName, handler, options) {
		target.addEventListener(eventName, handler, options);
		viewer.cleanup.push(() => target.removeEventListener(eventName, handler, options));
	}

	function closeActiveViewer() {
		if (!activeViewer) {
			return;
		}

		const viewer = activeViewer;
		activeViewer = undefined;
		viewer.cleanup.forEach(cleanup => cleanup());
		viewer.overlay.remove();
		viewer.doc.body.classList.remove(viewerOpenClass);

		if (viewer.previousFocus?.focus) {
			viewer.previousFocus.focus();
		}
	}

	function getEventPoint(event) {
		const touch = event.touches?.[0] || event.changedTouches?.[0];
		return touch || event;
	}

	function zoomViewer(viewer, event) {
		event.preventDefault();

		const rect = viewer.surface.getBoundingClientRect();
		const centerX = rect.left + (rect.width / 2);
		const centerY = rect.top + (rect.height / 2);
		const oldScale = viewer.scale;
		const nextScale = clamp(
			oldScale * (event.deltaY < 0 ? viewerZoomStep : 1 / viewerZoomStep),
			minViewerScale,
			maxViewerScale
		);

		if (nextScale === oldScale) {
			return;
		}

		const localX = (event.clientX - centerX - viewer.translateX) / oldScale;
		const localY = (event.clientY - centerY - viewer.translateY) / oldScale;

		viewer.scale = nextScale;
		viewer.translateX = event.clientX - centerX - (localX * nextScale);
		viewer.translateY = event.clientY - centerY - (localY * nextScale);
		applyViewerTransform(viewer);
	}

	function startViewerDrag(viewer, event) {
		if (event.button !== undefined && event.button !== 0) {
			return;
		}

		const point = getEventPoint(event);
		viewer.dragging = true;
		viewer.dragStartX = point.clientX;
		viewer.dragStartY = point.clientY;
		viewer.dragStartTranslateX = viewer.translateX;
		viewer.dragStartTranslateY = viewer.translateY;
		viewer.image.classList.add('nodebb-mermaid-viewer__image--dragging');
		event.preventDefault();
	}

	function dragViewer(viewer, event) {
		if (!viewer.dragging) {
			return;
		}

		const point = getEventPoint(event);
		viewer.translateX = viewer.dragStartTranslateX + point.clientX - viewer.dragStartX;
		viewer.translateY = viewer.dragStartTranslateY + point.clientY - viewer.dragStartY;
		applyViewerTransform(viewer);
		event.preventDefault();
	}

	function stopViewerDrag(viewer) {
		viewer.dragging = false;
		viewer.image.classList.remove('nodebb-mermaid-viewer__image--dragging');
	}

	function createViewer(svg) {
		const doc = svg.ownerDocument || getDocument();
		if (!doc?.body) {
			return undefined;
		}

		const overlay = doc.createElement('div');
		overlay.className = 'nodebb-mermaid-viewer';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', 'Mermaid diagram image viewer');

		const surface = doc.createElement('div');
		surface.className = 'nodebb-mermaid-viewer__surface';

		const image = doc.createElement('div');
		image.className = 'nodebb-mermaid-viewer__image';
		image.appendChild(svg.cloneNode(true));

		const closeButton = doc.createElement('button');
		closeButton.type = 'button';
		closeButton.className = 'nodebb-mermaid-viewer__close';
		closeButton.setAttribute('aria-label', 'Close Mermaid diagram image viewer');

		surface.appendChild(image);
		overlay.append(surface, closeButton);

		const viewer = {
			cleanup: [],
			closeButton,
			doc,
			dragging: false,
			image,
			overlay,
			previousFocus: doc.activeElement,
			scale: 1,
			surface,
			translateX: 0,
			translateY: 0,
		};

		applyViewerTransform(viewer);
		addViewerListener(viewer, closeButton, 'click', closeActiveViewer);
		addViewerListener(viewer, overlay, 'click', (event) => {
			if (event.target === overlay || event.target === surface) {
				closeActiveViewer();
			}
		});
		addViewerListener(viewer, surface, 'wheel', event => zoomViewer(viewer, event), { passive: false });
		addViewerListener(viewer, image, 'mousedown', event => startViewerDrag(viewer, event));
		addViewerListener(viewer, image, 'touchstart', event => startViewerDrag(viewer, event), { passive: false });
		addViewerListener(viewer, doc, 'mousemove', event => dragViewer(viewer, event));
		addViewerListener(viewer, doc, 'touchmove', event => dragViewer(viewer, event), { passive: false });
		addViewerListener(viewer, doc, 'mouseup', () => stopViewerDrag(viewer));
		addViewerListener(viewer, doc, 'touchend', () => stopViewerDrag(viewer));
		addViewerListener(viewer, doc, 'keydown', (event) => {
			if (event.key === 'Escape') {
				closeActiveViewer();
			}
		});

		return viewer;
	}

	function openViewer(svg) {
		const viewer = createViewer(svg);
		if (!viewer) {
			return;
		}

		closeActiveViewer();
		activeViewer = viewer;
		viewer.doc.body.classList.add(viewerOpenClass);
		viewer.doc.body.appendChild(viewer.overlay);
		viewer.closeButton.focus();
	}

	function shouldIgnoreViewerClick(event) {
		return event.defaultPrevented || Boolean(event.target?.closest?.('a, button, input, select, textarea'));
	}

	function bindDiagramViewer(diagram) {
		if (diagram.getAttribute(viewerBoundAttribute) === 'true') {
			return;
		}

		const svg = diagram.querySelector('svg');
		if (!svg) {
			return;
		}

		diagram.setAttribute(viewerBoundAttribute, 'true');
		diagram.setAttribute('role', 'button');
		diagram.setAttribute('aria-label', 'Open Mermaid diagram image viewer');
		diagram.tabIndex = diagram.tabIndex >= 0 ? diagram.tabIndex : 0;
		diagram.addEventListener('click', (event) => {
			if (!shouldIgnoreViewerClick(event)) {
				openViewer(svg);
			}
		});
		diagram.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				openViewer(svg);
			}
		});
	}

	function bindDiagramViewers(container) {
		const rootEl = getContentRoot(container);
		if (!rootEl?.querySelectorAll) {
			return;
		}

		Array.from(rootEl.querySelectorAll(
			`.nodebb-mermaid__diagram[${stateAttribute}="${renderedState}"]`
		)).forEach(bindDiagramViewer);
	}

	async function render(container) {
		const nodes = prepareMermaidNodes(container);
		if (!nodes.length) {
			bindDiagramViewers(container);
			return [];
		}

		try {
			const mermaid = await loadMermaid();
			initializeMermaid(mermaid);

			if (typeof mermaid.run === 'function') {
				await mermaid.run({ nodes, suppressErrors: true });
			} else if (typeof mermaid.init === 'function') {
				mermaid.init(undefined, nodes);
			}

			nodes.forEach((node) => {
				if (node.dataset.nodebbMermaidState === pendingState) {
					node.dataset.nodebbMermaidState = renderedState;
				}
			});
			bindDiagramViewers(container);
			return nodes;
		} catch (err) {
			nodes.forEach((node) => {
				node.dataset.nodebbMermaidState = errorState;
			});
			console.warn('[nodebb-plugin-mermaid] Failed to render Mermaid diagrams:', err);
			return nodes;
		}
	}

	function renderContent() {
		return render(getContentRoot());
	}

	function onReady(callback) {
		const doc = getDocument();
		if (!doc) {
			return;
		}

		if (doc.readyState === 'loading') {
			doc.addEventListener('DOMContentLoaded', callback, { once: true });
		} else {
			setTimeout(callback, 0);
		}
	}

	function bind() {
		if (root.app?.require) {
			root.app.require('hooks').then((hooks) => {
				hooks.on('action:ajaxify.end', renderContent);
			}).catch((err) => {
				console.warn('[nodebb-plugin-mermaid] Failed to register ajaxify hook:', err);
			});
		}

		onReady(renderContent);
	}

	return {
		bind,
		findMermaidSources,
		getMermaidScriptUrl,
		hasMermaid,
		loadMermaid,
		prepareMermaidNodes,
		render,
	};
});
