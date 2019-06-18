const fs = require( 'fs-extra' );
const gulp = require( 'gulp' );
const omneoPolymerBuild = require( 'omneo-polymer-build' );

const polymerBuildConfig = {
	locations: {
		elements: [],
		globalCSS: [],
		globalJS: [ 'src/js' ],
	},
	sass: {
		includePaths: [ '.', 'src', 'node_modules' ],
	},
	test: {
		index: 'unit-test-index.html',
		template: 'unit-test-template.html',
	},
};

omneoPolymerBuild.attachTasks( gulp, polymerBuildConfig );

gulp.task( 'clean', function clean() {
	fs.removeSync( './build' );
} );

gulp.task( 'copy', function copy() {
	fs.emptyDirSync( 'dist' );

	fs.copySync( 'build/js/global', 'dist' );
} );

gulp.task( 'build', [ 'compileJS:scripts', 'inline:tests' ] );

gulp.task( 'watch', [ 'build' ], function watch() {
	gulp.watch( [ 'src/js/**/*.js' ], [ 'compileJS:scripts' ] );
	gulp.watch( [ 'test/**/*', 'unit-test-template.html', 'unit-test-index.html' ], [ 'inline:tests' ] );
} );
