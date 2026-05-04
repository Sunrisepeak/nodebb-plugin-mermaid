'use strict';

const assert = require('assert');
const fs = require('fs');
const { afterEach, describe, it } = require('node:test');
const { JSDOM } = require('jsdom');

function loadLoader(html, options = {}) {
	const dom = new JSDOM(html, {
		url: 'https://forum.example.test/topic/1',
		runScripts: 'outside-only',
	});

	global.window = dom.window;
	global.document = dom.window.document;
	Object.defineProperty(global, 'navigator', {
		configurable: true,
		value: dom.window.navigator,
	});
	global.config = { relative_path: options.relativePath || '' };
	dom.window.__nodebbMermaidNoAutoStart = true;

	const loaderPath = require.resolve('../static/mermaid-loader');
	delete require.cache[loaderPath];
	const api = require('../static/mermaid-loader');

	return { dom, api };
}

describe('mermaid loader', () => {
	afterEach(() => {
		delete global.window;
		delete global.document;
		delete global.DOMParser;
		delete global.Element;
		delete global.getComputedStyle;
		delete global.HTMLElement;
		delete global.navigator;
		delete global.SVGElement;
		delete global.config;
	});

	it('detects mermaid code fences and ignores unrelated code blocks', () => {
		const { api } = loadLoader(`
			<div id="content">
				<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>
				<pre><code class="language-js">console.log('nope');</code></pre>
			</div>
		`);
		const content = document.getElementById('content');

		assert.strictEqual(api.hasMermaid(content), true);
		assert.strictEqual(api.findMermaidSources(content).length, 1);
	});

	it('converts mermaid code fences into renderable nodes without duplicating them', () => {
		const { api } = loadLoader(`
			<div id="content">
				<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>
			</div>
		`);
		const content = document.getElementById('content');

		const first = api.prepareMermaidNodes(content);
		const second = api.prepareMermaidNodes(content);

		assert.strictEqual(first.length, 1);
		assert.strictEqual(second.length, 1);
		assert.strictEqual(content.querySelectorAll('.nodebb-mermaid__diagram').length, 1);
		assert.strictEqual(content.querySelector('pre'), null);
		assert.strictEqual(first[0].textContent, 'graph TD\nA-->B');
		assert.strictEqual(first[0].dataset.nodebbMermaidState, 'pending');
	});

	it('builds a local mermaid asset URL using the NodeBB relative_path', () => {
		const { api } = loadLoader('<div id="content"></div>', { relativePath: '/forum' });

		assert.strictEqual(
			api.getMermaidScriptUrl(),
			'/forum/plugins/nodebb-plugin-mermaid/mermaid/mermaid.min.js'
		);
	});

	it('renders pending diagrams with an existing Mermaid runtime only once', async () => {
		const { api } = loadLoader(`
			<div id="content">
				<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>
			</div>
		`);
		const content = document.getElementById('content');
		let initializeCalls = 0;
		let runCalls = 0;

		window.mermaid = {
			initialize(config) {
				initializeCalls += 1;
				this.config = config;
			},
			async run({ nodes, suppressErrors }) {
				runCalls += 1;
				assert.strictEqual(suppressErrors, true);
				nodes.forEach((node) => {
					node.dataset.nodebbMermaidState = 'rendered';
				});
			},
		};

		await api.render(content);
		await api.render(content);

		assert.strictEqual(initializeCalls, 1);
		assert.strictEqual(runCalls, 1);
		assert.strictEqual(content.querySelector('.nodebb-mermaid__diagram').dataset.nodebbMermaidState, 'rendered');
		assert.strictEqual(window.mermaid.config.startOnLoad, false);
		assert.strictEqual(window.mermaid.config.securityLevel, 'strict');
	});

	it('opens rendered Mermaid diagrams in a dismissible image viewer', async () => {
		const { api } = loadLoader(`
			<div id="content">
				<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>
			</div>
		`);
		const content = document.getElementById('content');

		window.mermaid = {
			initialize() {},
			async run({ nodes }) {
				nodes.forEach((node) => {
					node.innerHTML = '<svg viewBox="0 0 100 100"><rect width="100" height="100"></rect></svg>';
					node.dataset.nodebbMermaidState = 'rendered';
				});
			},
		};

		await api.render(content);
		content.querySelector('.nodebb-mermaid__diagram').click();

		const viewer = document.querySelector('.nodebb-mermaid-viewer');

		assert(viewer);
		assert(viewer.querySelector('svg'));
		assert.strictEqual(viewer.getAttribute('role'), 'dialog');
		assert.strictEqual(document.body.classList.contains('nodebb-mermaid-viewer-open'), true);

		document.dispatchEvent(new window.KeyboardEvent('keydown', {
			key: 'Escape',
			bubbles: true,
		}));

		assert.strictEqual(document.querySelector('.nodebb-mermaid-viewer'), null);
		assert.strictEqual(document.body.classList.contains('nodebb-mermaid-viewer-open'), false);
	});

	it('zooms the Mermaid image viewer around the wheel position', async () => {
		const { api } = loadLoader(`
			<div id="content">
				<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>
			</div>
		`);
		const content = document.getElementById('content');

		window.mermaid = {
			initialize() {},
			async run({ nodes }) {
				nodes.forEach((node) => {
					node.innerHTML = '<svg viewBox="0 0 100 100"><rect width="100" height="100"></rect></svg>';
					node.dataset.nodebbMermaidState = 'rendered';
				});
			},
		};

		await api.render(content);
		content.querySelector('.nodebb-mermaid__diagram').click();

		const surface = document.querySelector('.nodebb-mermaid-viewer__surface');
		const image = document.querySelector('.nodebb-mermaid-viewer__image');
		surface.getBoundingClientRect = () => ({
			left: 0,
			top: 0,
			width: 800,
			height: 600,
			right: 800,
			bottom: 600,
			x: 0,
			y: 0,
			toJSON() {},
		});

		surface.dispatchEvent(new window.WheelEvent('wheel', {
			deltaY: -100,
			clientX: 500,
			clientY: 300,
			bubbles: true,
			cancelable: true,
		}));

		assert.match(image.style.transform, /scale\(1\.1\)/);
		assert.match(image.style.transform, /translate\(-10px, 0px\)/);
	});

	it('pans the Mermaid image viewer by dragging the image', async () => {
		const { api } = loadLoader(`
			<div id="content">
				<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>
			</div>
		`);
		const content = document.getElementById('content');

		window.mermaid = {
			initialize() {},
			async run({ nodes }) {
				nodes.forEach((node) => {
					node.innerHTML = '<svg viewBox="0 0 100 100"><rect width="100" height="100"></rect></svg>';
					node.dataset.nodebbMermaidState = 'rendered';
				});
			},
		};

		await api.render(content);
		content.querySelector('.nodebb-mermaid__diagram').click();

		const image = document.querySelector('.nodebb-mermaid-viewer__image');
		image.dispatchEvent(new window.MouseEvent('mousedown', {
			clientX: 100,
			clientY: 100,
			bubbles: true,
		}));
		document.dispatchEvent(new window.MouseEvent('mousemove', {
			clientX: 130,
			clientY: 140,
			bubbles: true,
		}));
		document.dispatchEvent(new window.MouseEvent('mouseup', {
			clientX: 130,
			clientY: 140,
			bubbles: true,
		}));

		assert.match(image.style.transform, /translate\(30px, 40px\)/);
	});

	it('binds NodeBB ajaxify navigation to render new Mermaid content', async () => {
		const { api } = loadLoader('<div id="content"></div>');
		const content = document.getElementById('content');
		const events = {};

		window.app = {
			require(moduleName) {
				assert.strictEqual(moduleName, 'hooks');
				return Promise.resolve({
					on(eventName, callback) {
						events[eventName] = callback;
					},
				});
			},
		};
		window.mermaid = {
			initialize() {},
			async run({ nodes }) {
				nodes.forEach((node) => {
					node.dataset.nodebbMermaidState = 'rendered';
				});
			},
		};

		api.bind();
		await new Promise(resolve => setTimeout(resolve, 0));
		content.innerHTML = '<pre><code class="language-mermaid">graph TD\\nA-->B</code></pre>';
		await events['action:ajaxify.end']();

		assert.strictEqual(content.querySelector('.nodebb-mermaid__diagram').dataset.nodebbMermaidState, 'rendered');
	});

	it('renders a basic diagram with the pinned Mermaid runtime', async () => {
		const { api } = loadLoader(`
			<div id="content">
				<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>
			</div>
		`);
		const content = document.getElementById('content');

		global.Element = window.Element;
		global.HTMLElement = window.HTMLElement;
		global.SVGElement = window.SVGElement;
		global.DOMParser = window.DOMParser;
		global.getComputedStyle = window.getComputedStyle;
		window.SVGElement.prototype.getBBox = function () {
			const text = this.textContent || '';
			return {
				x: 0,
				y: 0,
				width: Math.max(40, text.length * 8),
				height: 20,
			};
		};
		window.mermaid = (await import('mermaid')).default;

		await api.render(content);

		assert(content.querySelector('.nodebb-mermaid__diagram svg'));
		assert.strictEqual(content.querySelector('.nodebb-mermaid__diagram').dataset.nodebbMermaidState, 'rendered');
	});

	it('loads the Mermaid browser bundle as a window global', () => {
		const bundle = fs.readFileSync('node_modules/mermaid/dist/mermaid.min.js', 'utf8');
		const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
			url: 'https://forum.example.test/',
			runScripts: 'dangerously',
			pretendToBeVisual: true,
		});
		const script = dom.window.document.createElement('script');

		script.textContent = bundle;
		dom.window.document.head.appendChild(script);

		assert(dom.window.mermaid);
		assert.strictEqual(typeof dom.window.mermaid.run, 'function');
	});
});
