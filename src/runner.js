#!/usr/bin/env node

const chalk = require( 'chalk' ); // pretty console logs
const chokidar = require( 'chokidar' ); // file watcher
const dir = require( 'node-dir' ); // list folder contents
const fs = require( 'fs-extra' ); // interact with file system
const npmRun = require( 'npm-run' ); // normalize accessing node_modules/.bin items
const path = require( 'path' ); // handle file paths
const puppeteer = require( 'puppeteer' ); // chrome headless controller
const prettyMs = require( 'pretty-ms' ); // formats milliseconds as human readable time

const server = require( './server.js' );

// setup our global state holders
let chrome;
let tests;
let tempTestCollector = [];
let tempStatsCollector = [];
let fileWatcher;
let coverageWatcher;

/**
 * Returns a function, that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * N milliseconds. If `immediate` is passed, trigger the function on the
 * leading edge, instead of the trailing.
 *
 * @param {Function} func Function to debounce
 * @param {Number} wait Delay to wait for
 * @param {boolean} immediate Run at the start or end of the delay
 */
function debounce( func, wait, immediate ) {
	let timeout;

	return function debounced( ...args ) {
		const context = this;
		const callNow = immediate && !timeout;

		function later() {
			timeout = null;

			if ( !immediate ) func.apply( context, args );
		}

		clearTimeout( timeout );

		timeout = setTimeout( later, wait );

		if ( callNow ) func.apply( context, args );
	};
}

/**
 * Close all open processes we've spawned
 */
function close( buildFailed ) {
	let ranOnce = false;

	return ( function once() {
		if ( !ranOnce ) {
			try {
				server.stop();
			} catch ( e ) {
				// already closed
			}

			try {
				chrome.close().catch( Function.prototype );
			} catch ( e ) {
				// already closed
			}

			try {
				fileWatcher.close();
			} catch ( e ) {
				// either not on or already closed
			}

			try {
				coverageWatcher.close();
			} catch ( e ) {
				// either not on or already closed
			}

			ranOnce = true;

			process.exit( buildFailed ? 1 : process.exitCode );
		}
	}() );
}

/**
 * Run our cleanup when there's an error or user intervention
 */
function cleanupProcesses() {
	process.on( 'SIGINT', close );

	process.on( 'unhandledRejection', function unhandledRejection( err ) {
		console.error( err.stack );

		close();
	} );
}

/**
 * Start up our file server so all links and stuff work
 *
 * @returns {Promise<any>}
 */
function initServer( serverMappings, port ) {
	const filePath = path.resolve( '.', serverMappings );
	const mappings = fs.readJsonSync( filePath );

	return new Promise( function promise( resolve ) {
		server.setup( mappings );

		server.start( port, resolve );
	} );
}

/**
 * Turn on the server, chrome, and attach our process cleanup hooks
 *
 * @returns {Promise<any>}
 */
function setupServerAndChrome( args ) {
	const chromeFlags = new Set( [
		'--allow-insecure-localhost',
		'--auto-open-devtools-for-tabs',
		'--disable-accelerated-2d-canvas',
		'--disable-background-timer-throttling',
		'--disable-breakpad',
		'--disable-client-side-phishing-detection',
		'--disable-cloud-import',
		'--disable-default-apps',
		'--disable-extensions',
		'--disable-gesture-typing',
		'--disable-gpu',
		'--disable-hang-monitor',
		'--disable-infobars',
		'--disable-notifications',
		'--disable-offer-store-unmasked-wallet-cards',
		'--disable-offer-upload-credit-cards',
		'--disable-popup-blocking',
		'--disable-print-preview',
		'--disable-prompt-on-repost',
		'--disable-setuid-sandbox',
		'--disable-software-rasterizer',
		'--disable-speech-api',
		'--disable-sync',
		'--disable-tab-for-desktop-share',
		'--disable-translate',
		'--disable-voice-input',
		'--disable-wake-on-wifi',
		'--enable-async-dns',
		'--enable-simple-cache-backend',
		'--enable-tcp-fast-open',
		'--hide-scrollbars',
		'--media-cache-size=33554432',
		'--metrics-recording-only',
		'--mute-audio',
		'--no-default-browser-check',
		'--no-first-run',
		'--no-pings',
		'--no-zygote',
		'--password-store=basic',
		'--prerender-from-omnibox=disabled',
		'--use-mock-keychain',
	] );

	if ( process.env.USER === 'root' || args.noSandbox ) {
		chromeFlags.add( '--no-sandbox' );
	}

	// CI runners need these flags
	if ( process.env.CI ) {
		chromeFlags.add( '--single-process' );
		chromeFlags.add( '--no-sandbox' );
		chromeFlags.add( '--disable-dev-shm-usage' );
	}

	if ( parseInt( process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || process.env.FUNCTION_MEMORY_MB || '512' ) >= 1024 ) {
		chromeFlags.add( '--memory-pressure-off' );
	}

	return Promise.all( [
		initServer( args.serverMappings, args.port ), // turn on server
		puppeteer.launch( { // launch chrome
			headless: !args.notHeadless,
			args: Array.from( chromeFlags ),
		} ),
	] )
		.then( function setupErrorHandling( instances ) {
			chrome = instances[ 1 ];
		} )
		.then( cleanupProcesses )
		.catch( function startupError( err ) {
			console.error( 'Error on startup' );
			console.error( err );

			close( true );
		} );
}

/**
 * Verify and prune non-relevant files from the given inputs
 *
 * @param {string[]} inputs Input files and directory to be verified
 * @returns {string[]}
 */
function checkInputs( inputs ) {
	const dirs = [];
	const files = [];

	inputs.forEach( function checkInput( input ) {
		try {
			const stats = fs.statSync( input );

			if ( stats.isDirectory() ) {
				dirs.push( input );
			} else if ( stats.isFile() && input.endsWith( '.test.html' ) ) {
				files.push( input );
			} else {
				console.error( `${input} is not a file or directory??` );
			}
		} catch ( err ) {
			// file/folder doesn't exist
		}
	} );

	let combinedTests = files.slice();

	dirs.forEach( function getFilesFromDirectories( directory ) {
		const dirFiles = dir.files( path.resolve( '.', directory ), { sync: true } );
		const onlyTests = dirFiles.filter( file => file.endsWith( '.test.html' ) );

		combinedTests = combinedTests.concat( onlyTests );
	} );

	return combinedTests;
}

/**
 * Create the groups of tests based on the number of desired concurrent processes
 *
 * Also sets up the progress bar
 *
 * @param {string[]} inputs Input files that have been verfied
 * @param {number} concurrent Number of concurrent tests to run
 * @returns {string[][]}
 */
function prepareTestGroups( inputs, concurrent ) {
	const threads = Math.min( concurrent, tests.length );
	const itemsPerGroup = Math.ceil( tests.length / threads );
	const testGroups = [];

	for ( let index = 0; index < threads; index += 1 ) {
		testGroups.push( tests.slice( index * itemsPerGroup, ( index + 1 ) * itemsPerGroup ) );
	}

	return testGroups;
}

/**
 * Write out any test failures to the console, colorized for readability
 *
 * @param {string} test File that had failures
 * @param {{fullTitle: string, err: {message: string}}[]} failures Array of objects describing the failures
 */
function logFailures( test, failures ) {
	console.log( chalk.white( '--------------------' ) );

	console.log( chalk.yellow( test ) );
	console.log( chalk.red( `${failures.length} FAILURES:` ) );

	const redX = chalk.red( 'X' );

	failures.forEach( function logFailure( failure ) {
		console.log( `${redX} ${failure.fullTitle}` );
		console.log( `\t${failure.err.message}` );
	} );

	console.log( chalk.white( '--------------------' ) );
}

function printStats() {
	const combinedStats = tempStatsCollector.reduce( function combineStats( accumulator, current ) {
		return {
			suites: ( accumulator.suites || 0 ) + current.suites,
			tests: ( accumulator.tests || 0 ) + current.tests,
			passes: ( accumulator.passes || 0 ) + current.passes,
			pending: ( accumulator.pending || 0 ) + current.pending,
			failures: ( accumulator.failures || 0 ) + current.failures,
			duration: ( accumulator.duration || 0 ) + current.duration,
		};
	}, {} );

	console.log( '' );
	console.log( chalk.white( '--------------------' ) );

	const whiteDash = chalk.white( '-' );
	const prettyDuration = prettyMs( combinedStats.duration );

	console.log( `${whiteDash} Stats:` );
	console.log( `${whiteDash}` );

	console.log( `${whiteDash} Suites: ${combinedStats.suites}` );
	console.log( `${whiteDash} Tests: ${combinedStats.tests}` );
	console.log( `${whiteDash} Passed: ${combinedStats.passes}` );
	console.log( `${whiteDash} Failed: ${combinedStats.failures}` );
	console.log( `${whiteDash} Pending: ${combinedStats.pending}` );
	console.log( `${whiteDash} Duration: ${prettyDuration}` );

	console.log( chalk.white( '--------------------' ) );
}

/**
 * Run the tests in a group and write the coverage data if exists
 *
 * @param {string[]} testGroup The test group to run tests of
 * @returns {Promise<{hadErrors: boolean}>}
 */
function runTestGroup( args, testGroup ) {
	return new Promise( function promise( resolve ) {

		chrome.newPage()
			.then( function pageCreated( page ) {
				let hadErrors = false;
				let index = 0;
				let currentTest = '';

				function nextTest() {
					if ( index < testGroup.length ) {
						currentTest = path.basename( testGroup[ index ] );

						index += 1;

						page.evaluateOnNewDocument( function runInPageContext() {
							localStorage.clear();
						} )
							.then( function removeAllCookies() {
								return page.cookies()
									.then( function removeCookies( cookies ) {
										return Promise.all( cookies.map( cookie => page.deleteCookie( cookie ) ) );
									} );
							} )
							.then( function proceed() {
								page.goto( `http://localhost:3001/test/${currentTest}?reporter=json` );
							} );
					} else {
						page.close();

						resolve( { hadErrors } );
					}
				}

				function writeCoverageData() {
					return page
						.evaluate( () => window.__coverage__ ) // eslint-disable-line no-underscore-dangle
						.then( function writeOutput( data ) {
							if ( !data ) {
								return;
							}

							fs.ensureDirSync( './.nyc_output' );

							Object.keys( data ).forEach( function perCoverageData( filePath ) {
								const file = path.parse( filePath );

								// reports are given twice per element and for all elements used on a page
								// we only want the report from the element we're currently testing
								// this pruns all tests that don't match the test file being run
								// and which don't point correctly to the source file (eg: `action-bar.js` vs `/path/to/repo/folder/stuff/action-bar.js`)
								if ( !file.dir || `${file.name}.test.html` !== currentTest ) {
									return;
								}

								const output = {};

								output[ filePath ] = data[ filePath ]; // report tool needs the format of `{ 'path/to/file.js': {...reportData...} }`

								fs.writeJsonSync( `./.nyc_output/${file.name}.json`, output );
							} );
						} );
				}

				function captureConsole( consoleInstance ) {
					const text = consoleInstance.text();
					let results = false;

					try {
						// Mocha 6.x
						results = JSON.parse( text );
					} catch ( error ) {
						// Mocha 5.x
						try {
							results = JSON.parse( text.substring( 8 ) );
						} catch ( err2 ) {
							// Not a mocha results object
						}
					}

					if ( results && results.failures !== undefined ) {
						const url = page.url().split( '/' ).pop(); // eslint-disable-line newline-per-chained-call
						const filename = url.substring( 0, url.indexOf( '?' ) );

						if ( results.failures.length ) {
							hadErrors = true;

							logFailures( currentTest, results.failures );
						}

						if ( !args.errorsOnly ) {
							console.log( chalk.white( `Finished: ${filename}` ) );
						}

						tempStatsCollector.push( results.stats );

						writeCoverageData().then( nextTest );
					}
				}

				page.on( 'console', captureConsole );

				page.setDefaultNavigationTimeout( 30 * 60 * 1000 );

				page.setViewport( {
					width: 1920,
					height: 1080,
				} )
					.then( nextTest );
			} );
	} );
}

/**
 * Run the tests of all given inputs
 *
 * @param {string[]} inputs File paths to verify and create test groups from
 * @param {number} concurrent Number of concurrent tests to run
 * @returns {Promise<{hadErrors: boolean}>}
 */
function runTests( args, concurrent ) {
	const inputs = !Array.isArray( args.inputs ) ? [ args.inputs ] : args.inputs;

	tempTestCollector = [];
	tempStatsCollector = [];

	tests = checkInputs( inputs );

	if ( !tests.length ) {
		const commaSep = inputs.join( ', ' );

		console.log( chalk.bgYellow( chalk.black( `No tests found for desired inputs: ${commaSep}!` ) ) );

		return Promise.resolve();
	}

	const testGroups = prepareTestGroups( tests, concurrent );
	const testResults = testGroups.map( runTestGroup.bind( null, args ) );

	return Promise.all( testResults )
		.then( function allTestsDone( results ) {
			const hadErrors = results.some( function anyHadErrors( result ) {
				return result ? result.hadErrors : true;
			} );

			if ( !hadErrors ) {
				console.log( '' );
				console.log( chalk.green( 'All Tests That Ran Passed - Good Job!' ) );
			}

			printStats();

			return { hadErrors };
		} );
}

/**
 * Watch the coverage output folder and re-build the lcov when changes are made
 */
function watchForCoverage() {
	fs.ensureDirSync( '.nyc_output' );

	coverageWatcher = chokidar.watch( '.nyc_output', { awaitWriteFinish: true } );

	let inProgress = false;
	let runAgain = false;

	function makeReport() {
		if ( !inProgress ) {
			inProgress = true;

			console.log( chalk.cyan( 'Updating Coverage Report...' ) );

			npmRun.exec( 'nyc report', null, function doneMakingReport( err ) {
				if ( err ) {
					console.log( '' );
					console.log( chalk.red( 'Error while making report:' ) );
					console.log( err.stack );
					console.log( '' );
				}

				inProgress = false;

				if ( runAgain ) {
					runAgain = false;

					makeReport();
				}
			} );
		} else {
			runAgain = true;
		}
	}

	const debounceMakeReport = debounce( makeReport, 1000 );

	coverageWatcher.on( 'add', debounceMakeReport );
	coverageWatcher.on( 'change', debounceMakeReport );
	coverageWatcher.on( 'unlink', debounceMakeReport );
}

function run( args ) {
	const concurrent = args.notHeadless ? 1 : args.concurrent;

	setupServerAndChrome( args )
		.then( runTests.bind( null, args, concurrent ) )
		.then( function makeReport( results ) {
			if ( args.coverage ) {
				if ( fs.existsSync( path.resolve( './.nyc_output' ) ) ) {
					npmRun.execSync( 'nyc report', { stdio: 'inherit' } );
				} else {
					console.log( chalk.bgRed( chalk.white( 'Files were not built to include coverage data!' ) ) );
				}
			}

			return results;
		} )
		.then( function closeProcess( results ) {
			let buildFailed = results.hadErrors;

			if ( args.coverage && fs.existsSync( path.resolve( './.nyc_output' ) ) ) {
				const settings = fs.readJsonSync( './.nycrc' );
				const coverageSummary = fs.readJsonSync( './coverage/coverage-summary.json' );

				const lines = coverageSummary.total.lines.pct;
				const statements = coverageSummary.total.statements.pct;
				const functions = coverageSummary.total.functions.pct;
				const branches = coverageSummary.total.branches.pct;

				// Calc and print the total
				const combinedTotal = ( ( lines + statements + functions + branches ) / 4 ).toFixed( 2 );
				const redLevel = ( ( settings.watermarks.lines[ 0 ] + settings.watermarks.statements[ 0 ] + settings.watermarks.functions[ 0 ] + settings.watermarks.branches[ 0 ] ) / 4 ).toFixed( 2 );
				const yellowLevel = ( ( settings.watermarks.lines[ 1 ] + settings.watermarks.statements[ 1 ] + settings.watermarks.functions[ 1 ] + settings.watermarks.branches[ 1 ] ) / 4 ).toFixed( 2 );

				let totalColor = chalk.green;

				if ( combinedTotal <= redLevel ) {
					totalColor = chalk.red;
				} else if ( combinedTotal <= yellowLevel ) {
					totalColor = chalk.yellow;
				}

				console.log( totalColor( `Total        : ${combinedTotal}%` ) );
				console.log( chalk.white( '================================================================================' ) );

				// Big red lines if below threshholds
				if ( lines < settings.lines ) {
					buildFailed = true;

					console.log( chalk.bgRed( chalk.white( `Covered Lines below threshold: ${settings.lines}%. Actual: ${lines}%` ) ) );
				}

				if ( statements < settings.statements ) {
					buildFailed = true;

					console.log( chalk.bgRed( chalk.white( `Covered Statements below threshold: ${settings.statements}%. Actual: ${statements}%` ) ) );
				}

				if ( functions < settings.functions ) {
					buildFailed = true;

					console.log( chalk.bgRed( chalk.white( `Covered Functions below threshold: ${settings.functions}%. Actual: ${functions}%` ) ) );
				}

				if ( branches < settings.branches ) {
					buildFailed = true;

					console.log( chalk.bgRed( chalk.white( `Covered Branches below threshold: ${settings.branches}%. Actual: ${branches}%` ) ) );
				}
			}

			close( buildFailed );
		} );
}

function watch( args ) {
	const concurrent = args.notHeadless ? 1 : args.concurrent;

	fileWatcher = chokidar.watch( args.watchFiles, {
		awaitWriteFinish: true,
	} );

	watchForCoverage();

	const debouncedRunTests = debounce( runTests, 1000 );

	function runFileTests( filePath ) {
		let testFile = path.normalize( filePath );

		if ( testFile.includes( 'build\\inline' ) ) { // element was updated, try to guess the test file
			testFile = testFile.replace( 'build\\inline', 'build\\test' ).replace( '.html', '.test.html' );
		}

		tempTestCollector.push( testFile );

		return debouncedRunTests( tempTestCollector, args.concurrent );
	}

	setupServerAndChrome( args )
		.then( runTests.bind( null, args.inputs, concurrent ) )
		.then( function prepWatchEvents() {
			fileWatcher
				.on( 'add', runFileTests )
				.on( 'change', runFileTests );
		} );
}

// eslint-disable-next-line import/order
const yargs = require( 'yargs' )
	.usage( '<cmd> [args]' )
	.env( 'OPT' )
	.option( 'inputs', {
		describe: 'Folders and File paths to test',
		alias: 'i',
		default: [ 'build/test' ],
		array: true,
	} )
	.option( 'server-mappings', {
		describe: 'JSON file for mapping folders to URLs',
		alias: 'm',
		default: 'serverMappings.json',
		string: true,
	} )
	.option( 'watchFiles', {
		describe: 'Folder an File paths to watch for changes',
		alias: 'w',
		default: [ 'build/inline', 'build/test' ],
		array: true,
	} )
	.option( 'concurrent', {
		describe: 'Number of unit tests to run in parallel',
		alias: 'c',
		default: 8,
		number: true,
	} )
	.option( 'not-headless', {
		describe: 'Makes the tests run in a visible session',
		alias: 'h',
		default: false,
		boolean: true,
	} )
	.option( 'coverage', {
		describe: 'Generate a coverage report when data is obtained from tests',
		default: false,
		boolean: true,
	} )
	.option( 'port', {
		describe: 'Port to run the server on',
		default: 3001,
		number: true,
	} )
	.option( 'errors-only', {
		describe: 'Only log test failures and errors',
		default: false,
		boolean: true,
	} )
	.option( 'no-sandbox', {
		describe: 'Disables the chrome sandbox. Only used on linux for running as root',
		default: false,
		boolean: true,
	} )
	.command( 'run', 'Run all the tests found and store the results', {}, run )
	.command( 'watch', 'Same as <run> but performs action again on file changes', {}, watch )
	.demandCommand( 1, 'You must specify a command' )
	.help()
	.argv;

( function iife() {
	return yargs;
}() );
