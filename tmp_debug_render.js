const { render } = require('./dist/index.js');
const fs = require('fs');
const code = fs.readFileSync('example/example.cpp', 'utf8');
(async () => {
	const result = await render(code, { fileName: 'example/example.cpp', clangdPath: 'clangd', timeout: 2000 });
	console.log('hasErrorLine', result.includes('twoslash-error-line'));
	console.log('messageIndex', result.indexOf('Cannot initialize'));
})();
