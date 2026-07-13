const { render } = require('./dist/index.js');
const fs = require('fs');
const code = fs.readFileSync('example/example.cpp', 'utf8');
(async () => {
	const result = await render(code, { fileName: 'example/example.cpp', clangdPath: 'clangd', timeout: 2000 });
	console.log('spanCount', result.split('<span class="line">').length - 1);
	console.log('containsLine0', result.includes('<span class="line">'));
	const first = result.indexOf('<span class="line">');
	const second = result.indexOf('<span class="line">', first + 1);
	console.log('first', first, 'second', second);
	console.log('snippet', result.slice(first, second + 80));
})();
