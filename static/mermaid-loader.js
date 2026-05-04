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
	const codeSelector = [
		'pre > code.language-mermaid',
		'pre > code.lang-mermaid',
		'pre > code[class~="language-mermaid"]',
		'pre > code[class~="lang-mermaid"]',
	].join(',');

	let loadPromise;
	let initialized = false;

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

	async function render(container) {
		const nodes = prepareMermaidNodes(container);
		if (!nodes.length) {
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
