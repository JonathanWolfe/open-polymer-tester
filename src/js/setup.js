( function iife() {
	window.assert = window.chai.assert;
	window.expect = window.chai.expect;

	const params = new URLSearchParams( window.location.search );
	const reporter = params.get( 'reporter' );

	if ( reporter ) {
		window.mochaOptions = { reporter };
	}

	window.mochaInterface.stubInterfaces();

	mocha.globals( [
		'mochaRunner', 'mochaOptions', 'sweetAlert',
		'saveAs', 'XLSX', 'XLS', 'JSZip', 'QUOTE',
		'Excel', 'excel', '_hashIndex', '_listIndex',
		'style_builder', 'viz', 'tableau', 'wrap',
		'unwrap', 'WebComponents', 'JsMutationObserver',
		'HTMLImports', 'CustomElements',
	] );

	mocha.checkLeaks();

	// Stub router
	window.app = window.app || {};
	window.app.router = {
		go: sinon.spy(),
	};

	// Stub localstorage so nothing gets modified
	let tempFakeSessionStorage = {};
	let tempFakeLocalStorage = {};

	localStorage.getItem = function fakeGetItem( key ) {
		if ( key === undefined ) {
			throw new TypeError( 'Failed to execute \'getItem\' on \'Storage\': 1 argument required, but only 0 present.' );
		}

		return tempFakeLocalStorage[ key.toString() ] !== undefined ? tempFakeLocalStorage[ key ] : null;
	};
	sessionStorage.getItem = function fakeGetItem( key ) {
		if ( key === undefined ) {
			throw new TypeError( 'Failed to execute \'getItem\' on \'Storage\': 1 argument required, but only 0 present.' );
		}

		return tempFakeSessionStorage[ key.toString() ] !== undefined ? tempFakeSessionStorage[ key ] : null;
	};

	localStorage.setItem = function fakeSetItem( key, value ) {
		if ( key === undefined || value === undefined ) {
			throw new TypeError( `Failed to execute 'setItem' on 'Storage': 2 arguments required, but only ${arguments.length} present.` );
		}

		tempFakeLocalStorage[ key.toString() ] = value === null ? value : value.toString();
	};
	sessionStorage.setItem = function fakeSetItem( key, value ) {
		if ( key === undefined || value === undefined ) {
			throw new TypeError( `Failed to execute 'setItem' on 'Storage': 2 arguments required, but only ${arguments.length} present.` );
		}

		tempFakeSessionStorage[ key.toString() ] = value === null ? value : value.toString();
	};

	localStorage.removeItem = function fakeRemoveItem( key ) {
		delete tempFakeLocalStorage[ key ];
	};
	sessionStorage.removeItem = function fakeRemoveItem( key ) {
		delete tempFakeSessionStorage[ key ];
	};

	localStorage.clear = function fakeClear() {
		tempFakeLocalStorage = {};
	};
	sessionStorage.clear = function fakeClear() {
		tempFakeSessionStorage = {};
	};

	localStorage.key = function fakeKey( index ) {
		return Object.keys( tempFakeLocalStorage )[ index ];
	};
	sessionStorage.key = function fakeKey( index ) {
		return Object.keys( tempFakeSessionStorage )[ index ];
	};

	// Save original tenantMapping
	const hasTenantMapping = Boolean( window.config && window.configBuilder );
	let originalTenantsMapping;

	if ( hasTenantMapping ) {
		originalTenantsMapping = window.config.tenantMapping;

		// Create tenant mapping for unit tests execution process
		localStorage.setItem( 'localhostTenant', 'localhost:unitTests (localhost)' );

		window.config.tenantMapping = undefined;
		window.configBuilder.createTenantMapping( [ { name: 'unitTests', env: 'localhost' } ] );

	}

	function startMocha() {
		// Start Mocha Tests
		window.mochaRunner = mocha.run();

		// When everything over
		window.mochaRunner
			.on( 'suite', function cleanupBeforeEachTest() {
				localStorage.clear();
				localStorage.setItem( 'localhostTenant', 'localhost:unitTests (localhost)' );
			} )
			.on( 'fail', function testFailed( test, error ) {
				console.error( error );
			} )
			.on( 'end', function end() {
				// Restore Localstorage
				delete localStorage.getItem;
				delete sessionStorage.getItem;
				delete localStorage.setItem;
				delete sessionStorage.setItem;
				delete localStorage.removeItem;
				delete sessionStorage.removeItem;
				delete localStorage.key;
				delete sessionStorage.key;
				delete localStorage.clear;
				delete sessionStorage.clear;

				// Restore original tenants mapping
				if ( hasTenantMapping ) {
					window.config.tenantMapping = originalTenantsMapping;
				}

				// Compliment on a job well done (if earned)
				if ( window.mochaRunner.stats.failures === 0 ) {
					console.log( '✔ All Tests Pass - Good Job!' );
				}
			} );
	}

	document.addEventListener( 'DOMContentLoaded', function documentReady() {
		window.whenFrameworksReady( function runTests() {
			window.requestIdleCallback( startMocha, { timeout: 10000 } );
		} );
	} );
}() );
