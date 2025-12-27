const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', '@xenova/transformers', 'vectra', 'simple-git', '@octokit/rest'],
		logLevel: 'silent',
		loader: {
			'.node': 'file'
		},
		plugins: [
			{
				name: 'watch-plugin',
				setup(build) {
					build.onEnd(result => {
						console.log(result.errors.length > 0 ? 'Build failed' : 'Build succeeded');
					});
				}
			}
		]
	});
	
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
