/* eslint-disable func-names, no-unused-vars, prefer-rest-params, no-shadow, no-underscore-dangle, no-cond-assign, no-prototype-builtins, no-plusplus, id-match, no-use-before-define */

/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

/**
 * Triggers a flush of any pending events, observations, etc and calls you back
 * after they have been processed.
 *
 * @param {function()} callback
 */
window.flush = function flush( callback ) {
	// Ideally, this function would be a call to Polymer.dom.flush, but that doesn't
	// support a callback yet (https://github.com/Polymer/polymer-dev/issues/851),
	// ...and there's cross-browser flakiness to deal with.

	// Make sure that we're invoking the callback with no arguments so that the
	// caller can pass Mocha callbacks, etc.
	let done = function done() {
		callback();
	};

	// Because endOfMicrotask is flaky for IE, we perform microtask checkpoints
	// ourselves (https://github.com/Polymer/polymer-dev/issues/114):
	const isIE = navigator.appName === 'Microsoft Internet Explorer';

	/* istanbul ignore next */
	if ( isIE && window.Platform && window.Platform.performMicrotaskCheckpoint ) {
		const reallyDone = done;

		done = function doneIE() {
			window.Platform.performMicrotaskCheckpoint();
			setTimeout( reallyDone, 0 );
		};
	}

	// Everyone else gets a regular flush.
	let scope;

	/* istanbul ignore else */
	if ( window.Polymer && window.Polymer.dom && window.Polymer.dom.flush ) {
		scope = window.Polymer.dom;
	} else if ( window.Polymer && window.Polymer.flush ) {
		scope = window.Polymer;
	} else if ( window.WebComponents && window.WebComponents.flush ) {
		scope = window.WebComponents;
	}

	/* istanbul ignore else */
	if ( scope ) {
		scope.flush();
	}

	// Ensure that we are creating a new _task_ to allow all active microtasks to
	// finish (the code you're testing may be using endOfMicrotask, too).
	setTimeout( done, 0 );
};

/**
 * Advances a single animation frame.
 *
 * Calls `flush`, `requestAnimationFrame`, `flush`, and `callback` sequentially
 * @param {function()} callback
 */
window.animationFrameFlush = function animationFrameFlush( callback ) {
	window.flush( function () {
		requestAnimationFrame( function () {
			window.flush( callback );
		} );
	} );
};

/**
 * Wait for something to be true before calling a callback
 *
 * @param {function()} conditional Function to check if done waiting
 * @param {function()} callback Function to run when done waiting
 * @param {number} interval Something to observe for mutations or an interval to check on
 * @param {number} timeout Number of milliseconds before giving up
 * @param {number} timeoutTime Percise time to wait until
 */
window.waitFor = function waitFor( conditional, callback, interval, timeout, timeoutTime ) {
	timeoutTime = timeoutTime || Date.now() + ( timeout || 1000 );
	interval = interval || 32;

	try {
		conditional();
	} catch ( e ) {
		if ( Date.now() > timeoutTime ) {
			callback( e );

			return;
		}

		setTimeout( function waitForTimeout() {
			waitFor( conditional, callback, interval, timeout, timeoutTime );
		}, interval );

		return;

	}

	callback( null );
};

/* istanbul ignore next */
/**
 * Wait for the web components to be upgraded and platform/frameworks to be loaded
 *
 * @param {function()} callback
 */
window.whenFrameworksReady = function whenFrameworksReady( callback ) {
	const done = function () {
		callback();
	};

	function whenWebComponentsReady() {
		if ( window.WebComponents && window.WebComponents.whenReady ) {
			window.WebComponents.whenReady( function () {
				done();
			} );
		} else {
			const after = function after() {
				window.removeEventListener( 'WebComponentsReady', after );
				done();
			};

			window.addEventListener( 'WebComponentsReady', after );
		}
	}

	function importsReady() {
		// handle Polymer 0.5 readiness
		if ( window.Polymer && Polymer.whenReady ) {
			Polymer.whenReady( function () {
				done();
			} );
		} else {
			whenWebComponentsReady();
		}
	}

	// All our supported framework configurations depend on imports.
	if ( !window.HTMLImports ) {
		done();
	} else if ( window.HTMLImports.ready ) {
		importsReady();
	} else if ( window.HTMLImports.whenReady ) {
		window.HTMLImports.whenReady( function () {
			importsReady();
		} );
	} else {
		whenWebComponentsReady();
	}
};
