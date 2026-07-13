const { render } = require('./dist/index.js');
const fs = require('fs');
const code = fs.readFileSync('example/example.cpp', 'utf8');
function insertMetaLines(html, diagMap) {
	if (!diagMap.size) return html;
	const parts = html.split(/(<span class="line">)/);
	console.log('parts length', parts.length);
	for (let i = 0; i < Math.min(parts.length, 10); i++) {
		console.log(i, JSON.stringify(parts[i]));
	}
	let lineIndex = -1;
	let result = '';
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === '<span class="line">') {
			lineIndex += 1;
			result += part;
			continue;
		}
		if (lineIndex >= 0) {
			result += part;
			const messages = diagMap.get(lineIndex);
			if (messages) {
				console.log('insert at line', lineIndex, 'messages', messages);
				for (const message of messages) {
					result += `<div class="twoslash-meta-line twoslash-error-line vp-copy-ignore">${message}</div>`;
				}
			}
			lineIndex = -1;
			continue;
		}
		result += part;
	}
	return result;
}
(async () => {
	const result = await render(code, { fileName: 'example/example.cpp', clangdPath: 'clangd', timeout: 2000 });
	const diagMap = new Map();
	diagMap.set(4, ['Cannot initialize a variable of type int with an lvalue of type const char[6]']);
	const withMeta = insertMetaLines(result, diagMap);
	console.log('contains inserted meta', withMeta.includes('twoslash-meta-line'));
	console.log(withMeta.slice(withMeta.indexOf('<span class="line">', 0), withMeta.indexOf('<span class="line">', withMeta.indexOf('<span class="line">') + 1) + 200));
})();
